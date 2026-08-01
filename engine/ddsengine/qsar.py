"""
QSAR / 3D-QSAR & pharmacophore engine for DDS.

Ligand-based modelling from established open codes only (RDKit + scikit-learn),
so it is fast, reliable, offline and bundleable. Provides:
  - structure standardization + featurization (2D descriptors, ECFP/Morgan,
    MACCS, alignment-free 3D descriptors, 2D-pharmacophore fingerprints),
  - dataset assembly (ChEMBL fetch by target, bundled reproducibility test sets),
  - model training + rigorous validation (CV Q2/ROC-AUC, external test, applicability
    domain, Y-scrambling) with Random Forest / PLS / SVM / gradient boosting,
  - prediction on new molecules with an applicability-domain flag.
"""
from __future__ import annotations
import os, csv, math, uuid
import numpy as np

from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, MACCSkeys, Descriptors, rdMolDescriptors
from rdkit.Chem.Scaffolds import MurckoScaffold
RDLogger.DisableLog("rdApp.*")

from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier, GradientBoostingRegressor, GradientBoostingClassifier
from sklearn.svm import SVR, SVC
from sklearn.cross_decomposition import PLSRegression
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import cross_val_predict, KFold, StratifiedKFold
from sklearn.metrics import (r2_score, mean_squared_error, mean_absolute_error,
                             roc_auc_score, matthews_corrcoef, accuracy_score, confusion_matrix)
from sklearn.neighbors import NearestNeighbors

_DATA = os.path.join(os.path.dirname(__file__), "qsar_data")
MODELS = {}  # id -> trained pipeline bundle

# --------------------------------------------------------------------------
#  structure handling + featurization
# --------------------------------------------------------------------------
_morgan = AllChem.GetMorganGenerator(radius=2, fpSize=2048)
_2d_names = [n for n, _ in Descriptors._descList]


def standardize(smiles):
    """Parse + canonicalize; keep the largest organic fragment. Returns mol or None."""
    m = Chem.MolFromSmiles(smiles or "")
    if m is None:
        return None
    frags = Chem.GetMolFrags(m, asMols=True, sanitizeFrags=False)
    if len(frags) > 1:
        m = max(frags, key=lambda f: f.GetNumHeavyAtoms())
    try:
        Chem.SanitizeMol(m)
    except Exception:
        return None
    return m


def _feat_one(m, kind):
    if kind == "morgan":
        return np.array(_morgan.GetFingerprint(m), dtype=float)
    if kind == "maccs":
        return np.array(MACCSkeys.GenMACCSKeys(m), dtype=float)
    if kind == "rdkit2d":
        vals = []
        for n in _2d_names:
            try:
                vals.append(float(getattr(Descriptors, n)(m)))
            except Exception:
                vals.append(0.0)
        return np.array(vals, dtype=float)
    if kind == "pharm2d":
        from rdkit.Chem.Pharm2D import Generate, Gobbi_Pharm2D
        fp = Generate.Gen2DFingerprint(m, Gobbi_Pharm2D.factory)
        return np.array(fp, dtype=float)
    if kind == "desc3d":
        mh = Chem.AddHs(m)
        if AllChem.EmbedMolecule(mh, AllChem.ETKDGv3()) != 0:
            return None
        try:
            AllChem.MMFFOptimizeMolecule(mh)
        except Exception:
            pass
        d = [rdMolDescriptors.CalcAsphericity(mh), rdMolDescriptors.CalcEccentricity(mh),
             rdMolDescriptors.CalcInertialShapeFactor(mh), rdMolDescriptors.CalcNPR1(mh),
             rdMolDescriptors.CalcNPR2(mh), rdMolDescriptors.CalcRadiusOfGyration(mh),
             rdMolDescriptors.CalcSpherocityIndex(mh)]
        d += list(rdMolDescriptors.CalcWHIM(mh))
        d += list(rdMolDescriptors.CalcAUTOCORR3D(mh))
        d += list(rdMolDescriptors.CalcRDF(mh))
        return np.array(d, dtype=float)
    raise ValueError("unknown descriptor kind: %s" % kind)


def featurize(smiles_list, kind="morgan"):
    """Featurize; returns (X, keep_idx) where keep_idx are rows that parsed/embedded."""
    X, keep = [], []
    for i, s in enumerate(smiles_list):
        m = standardize(s)
        if m is None:
            continue
        v = _feat_one(m, kind)
        if v is None or not np.all(np.isfinite(v)):
            if v is None:
                continue
            v = np.nan_to_num(v, nan=0.0, posinf=0.0, neginf=0.0)
        X.append(v); keep.append(i)
    return np.array(X, dtype=float), np.array(keep, dtype=int)


def scaffold_split(smiles_list, test_frac=0.2, seed=42):
    """Bemis-Murcko scaffold split — the rigorous generalization test."""
    scaffolds = {}
    for i, s in enumerate(smiles_list):
        m = standardize(s)
        core = MurckoScaffold.MurckoScaffoldSmiles(mol=m) if m else ""
        scaffolds.setdefault(core, []).append(i)
    groups = sorted(scaffolds.values(), key=len, reverse=True)
    n_test = int(len(smiles_list) * test_frac)
    test, train = [], []
    for g in groups:
        (test if len(test) < n_test else train).extend(g)
    return np.array(train), np.array(test)


# --------------------------------------------------------------------------
#  models
# --------------------------------------------------------------------------
def _make_model(task, algo, n_samples):
    if task == "regression":
        return {"rf": RandomForestRegressor(n_estimators=200, random_state=42, n_jobs=-1),
                "gbm": GradientBoostingRegressor(random_state=42),
                "svm": SVR(C=10, gamma="scale"),
                "pls": PLSRegression(n_components=min(5, max(1, n_samples // 10)))}[algo]
    return {"rf": RandomForestClassifier(n_estimators=200, random_state=42, n_jobs=-1, class_weight="balanced"),
            "gbm": GradientBoostingClassifier(random_state=42),
            "svm": SVC(C=10, gamma="scale", probability=True, class_weight="balanced"),
            "logreg": LogisticRegression(max_iter=2000, class_weight="balanced")}[algo]


def build_and_evaluate(smiles, y, task="regression", algo="rf", descriptor="morgan",
                       split="random", cv=5, y_scramble=True, seed=42):
    """Full QSAR pipeline: featurize -> split -> CV -> external test -> AD -> Y-scramble.
    Returns a dict of metrics, per-point predictions, importances, and a model id."""
    y = np.asarray(y, dtype=float)
    X, keep = featurize(smiles, descriptor)
    y = y[keep]; smi = [smiles[i] for i in keep]
    n = len(y)
    if n < 20:
        return {"error": "need at least ~20 valid molecules (got %d)" % n}

    scale = descriptor in ("rdkit2d", "desc3d")
    scaler = StandardScaler().fit(X) if scale else None
    Xs = scaler.transform(X) if scale else X

    if split == "scaffold":
        tr, te = scaffold_split(smi, seed=seed)
    else:
        rng = np.random.default_rng(seed); idx = rng.permutation(n)
        cut = int(n * 0.8); tr, te = idx[:cut], idx[cut:]

    model = _make_model(task, algo, len(tr))
    cvk = (StratifiedKFold(cv, shuffle=True, random_state=seed) if task == "classification"
           else KFold(cv, shuffle=True, random_state=seed))

    out = {"task": task, "algo": algo, "descriptor": descriptor, "split": split,
           "n_total": n, "n_train": int(len(tr)), "n_test": int(len(te))}

    if task == "regression":
        yhat_cv = cross_val_predict(model, Xs[tr], y[tr], cv=cvk)
        model.fit(Xs[tr], y[tr])
        yhat_te = np.asarray(model.predict(Xs[te])).ravel()
        out.update({
            "Q2": float(r2_score(y[tr], yhat_cv)),
            "R2_test": float(r2_score(y[te], yhat_te)),
            "RMSE_test": float(math.sqrt(mean_squared_error(y[te], yhat_te))),
            "MAE_test": float(mean_absolute_error(y[te], yhat_te)),
            "R2_train": float(model.score(Xs[tr], y[tr])) if algo != "pls" else float(r2_score(y[tr], np.asarray(model.predict(Xs[tr])).ravel())),
            "obs": y[te].tolist(), "pred": yhat_te.tolist(),
        })
        if y_scramble:
            sc = []
            for k in range(3):
                ys = np.random.default_rng(k).permutation(y[tr])
                sc.append(r2_score(ys, cross_val_predict(_make_model(task, algo, len(tr)), Xs[tr], ys, cv=3)))
            out["Yscramble_Q2_mean"] = float(np.mean(sc))
    else:
        yhat_cv = cross_val_predict(model, Xs[tr], y[tr], cv=cvk, method="predict_proba")[:, 1]
        model.fit(Xs[tr], y[tr])
        proba_te = model.predict_proba(Xs[te])[:, 1]
        pred_te = (proba_te >= 0.5).astype(int)
        tn, fp, fn, tp = confusion_matrix(y[te], pred_te, labels=[0, 1]).ravel()
        out.update({
            "AUC_cv": float(roc_auc_score(y[tr], yhat_cv)),
            "AUC_test": float(roc_auc_score(y[te], proba_te)),
            "accuracy": float(accuracy_score(y[te], pred_te)),
            "MCC": float(matthews_corrcoef(y[te], pred_te)),
            "sensitivity": float(tp / (tp + fn)) if (tp + fn) else 0.0,
            "specificity": float(tn / (tn + fp)) if (tn + fp) else 0.0,
            "obs": y[te].astype(int).tolist(), "proba": proba_te.tolist(),
        })
        if y_scramble:
            sc = []
            for k in range(3):
                ys = np.random.default_rng(k).permutation(y[tr])
                p = cross_val_predict(_make_model(task, algo, len(tr)), Xs[tr], ys, cv=3, method="predict_proba")[:, 1]
                sc.append(roc_auc_score(ys, p))
            out["Yscramble_AUC_mean"] = float(np.mean(sc))

    # feature importance (tree models)
    if hasattr(model, "feature_importances_") and descriptor in ("rdkit2d", "desc3d"):
        imp = model.feature_importances_
        names = _2d_names if descriptor == "rdkit2d" else [f"3D_{i}" for i in range(len(imp))]
        top = sorted(zip(names, imp), key=lambda t: -t[1])[:12]
        out["importance"] = [{"name": n, "value": float(v)} for n, v in top]

    # applicability domain: kNN distance threshold (95th pct of train distances)
    nn = NearestNeighbors(n_neighbors=min(5, len(tr))).fit(Xs[tr])
    d_tr = nn.kneighbors(Xs[tr])[0].mean(axis=1)
    thr = float(np.percentile(d_tr, 95))
    d_te = nn.kneighbors(Xs[te])[0].mean(axis=1)
    out["AD_fraction_in"] = float(np.mean(d_te <= thr))

    mid = uuid.uuid4().hex[:12]
    MODELS[mid] = {"model": model, "scaler": scaler, "descriptor": descriptor,
                   "task": task, "nn": nn, "ad_thr": thr}
    out["model_id"] = mid
    return out


# --------------------------------------------------------------------------
#  2D depiction with pharmacophore-feature highlighting (RDKit)
# --------------------------------------------------------------------------
_PH_FACTORY = None
# pharmacophore feature family -> highlight colour (RGB 0-1)
_PH_COLORS = {
    "Donor": (0.30, 0.55, 1.00), "Acceptor": (1.00, 0.45, 0.45), "Aromatic": (0.96, 0.66, 0.16),
    "Hydrophobe": (0.42, 0.80, 0.40), "LumpedHydrophobe": (0.42, 0.80, 0.40),
    "PosIonizable": (0.66, 0.46, 0.95), "NegIonizable": (0.95, 0.45, 0.85),
}
_PH_LEGEND = [("Donor", _PH_COLORS["Donor"]), ("Acceptor", _PH_COLORS["Acceptor"]),
              ("Aromatic", _PH_COLORS["Aromatic"]), ("Hydrophobe", _PH_COLORS["Hydrophobe"]),
              ("Pos. ionizable", _PH_COLORS["PosIonizable"]), ("Neg. ionizable", _PH_COLORS["NegIonizable"])]


def _pharm_factory():
    global _PH_FACTORY
    if _PH_FACTORY is None:
        from rdkit.Chem import ChemicalFeatures
        from rdkit import RDConfig
        _PH_FACTORY = ChemicalFeatures.BuildFeatureFactory(os.path.join(RDConfig.RDDataDir, "BaseFeatures.fdef"))
    return _PH_FACTORY


def _pharm_atom_colors(m, factory):
    amap = {}
    for f in factory.GetFeaturesForMol(m):
        c = _PH_COLORS.get(f.GetFamily())
        if c is None:
            continue
        for a in f.GetAtomIds():
            amap[int(a)] = c
    return amap


def pharmacophore_legend():
    return [{"label": lab, "color": "rgb(%d,%d,%d)" % (int(c[0] * 255), int(c[1] * 255), int(c[2] * 255))}
            for lab, c in _PH_LEGEND]


def depict_grid(smiles, legends=None, pharmacophore=True, per_row=4, cell=250, max_n=24):
    """Render a grid of 2D structures as a single SVG, optionally highlighting
    pharmacophore features (H-bond donor/acceptor, aromatic, hydrophobic, charged)."""
    from rdkit.Chem.Draw import rdMolDraw2D
    from rdkit.Chem import rdDepictor
    factory = _pharm_factory() if pharmacophore else None
    mols, labs, hi_atoms, hi_colors = [], [], [], []
    for i, s in enumerate(smiles[:max_n]):
        m = standardize(s)
        if m is None:
            continue
        rdDepictor.Compute2DCoords(m)
        mols.append(m)
        labs.append(legends[i] if legends and i < len(legends) else "")
        if pharmacophore:
            amap = _pharm_atom_colors(m, factory)
            hi_atoms.append(list(amap.keys()))
            hi_colors.append(amap)
    if not mols:
        return {"error": "no valid structures to draw"}
    import math
    per_row = max(1, min(per_row, len(mols)))
    nrows = math.ceil(len(mols) / per_row)
    d = rdMolDraw2D.MolDraw2DSVG(per_row * cell, nrows * cell, cell, cell)
    o = d.drawOptions()
    o.clearBackground = False
    o.legendFontSize = 15
    o.legendFraction = 0.16
    if pharmacophore:
        d.DrawMolecules(mols, legends=labs, highlightAtoms=hi_atoms, highlightAtomColors=hi_colors)
    else:
        d.DrawMolecules(mols, legends=labs)
    d.FinishDrawing()
    svg = d.GetDrawingText()
    return {"svg": svg, "n": len(mols), "legend": pharmacophore_legend() if pharmacophore else []}


def _druglike(m):
    """Simple, standard developability descriptors + Lipinski rule-of-five status."""
    mw = Descriptors.MolWt(m)
    logp = Descriptors.MolLogP(m)
    hbd = rdMolDescriptors.CalcNumHBD(m)
    hba = rdMolDescriptors.CalcNumHBA(m)
    viol = int((mw > 500) + (logp > 5) + (hbd > 5) + (hba > 10))
    return {"mw": round(float(mw), 1), "logp": round(float(logp), 2),
            "hbd": int(hbd), "hba": int(hba), "ro5_violations": viol, "lipinski_ok": viol <= 1}


def _prep_rgroup(rsmi, pos):
    """Turn a substituent (e.g. 'F', 'OC', 'c1ccccc1', or '[H]') into a fragment
    carrying an attachment dummy [*:pos] so it can be zipped onto the scaffold."""
    rsmi = (rsmi or "").strip()
    if not rsmi:
        return None
    lab = "[*:%d]" % pos
    if "*" in rsmi:
        smi = rsmi.replace("[*]", lab).replace("*", lab, 1)
    else:
        smi = lab + rsmi
    return Chem.MolFromSmiles(smi)


def enumerate_library(scaffold, rgroups, max_n=400):
    """Combinatorially enumerate analogs of a scaffold.

    scaffold : SMILES with attachment points marked [*:1], [*:2], ...
    rgroups  : {"1": [subst, ...], "2": [subst, ...]} substituents per position.
    Returns product SMILES (deduplicated) + the chosen R-group at each position.
    """
    from itertools import product
    core = Chem.MolFromSmiles(scaffold or "")
    if core is None:
        return {"error": "could not parse the scaffold SMILES"}
    positions = sorted({a.GetAtomMapNum() for a in core.GetAtoms()
                        if a.GetAtomicNum() == 0 and a.GetAtomMapNum() > 0})
    if not positions:
        return {"error": "scaffold has no attachment points — mark them as [*:1], [*:2], ..."}
    lists = [(rgroups.get(str(p)) or rgroups.get(p) or ["[H]"]) for p in positions]
    combos = list(product(*lists))
    truncated = len(combos) > max_n
    combos = combos[:max_n]
    seen = {}
    for combo in combos:
        parts, labels, ok = [core], {}, True
        for p, rsmi in zip(positions, combo):
            frag = _prep_rgroup(rsmi, p)
            if frag is None:
                ok = False
                break
            parts.append(frag)
            labels[str(p)] = rsmi
        if not ok:
            continue
        combined = parts[0]
        for fr in parts[1:]:
            combined = Chem.CombineMols(combined, fr)
        try:
            prod = Chem.molzip(combined)
            Chem.SanitizeMol(prod)
            smi = Chem.MolToSmiles(prod)
        except Exception:
            continue
        seen.setdefault(smi, {"smiles": smi, "rgroups": labels})
    return {"analogs": list(seen.values()), "positions": positions,
            "n_combos": len(combos), "truncated": truncated}


def design(model_id, scaffold=None, rgroups=None, smiles=None, max_n=400):
    """Prospective design: enumerate (or take a list of) candidate analogs, predict
    their activity with a validated model, add drug-likeness, and rank so the most
    promising, in-domain, drug-like candidates to synthesize rise to the top."""
    b = MODELS.get(model_id)
    if not b:
        return {"error": "unknown model_id (build and validate a model first)"}
    max_n = max(1, min(int(max_n or 400), 1000))
    if smiles:
        analogs = [{"smiles": s.strip(), "rgroups": {}} for s in smiles if s and s.strip()]
        meta = {"mode": "list", "n_combos": len(analogs), "truncated": False, "positions": []}
    else:
        en = enumerate_library(scaffold or "", rgroups or {}, max_n=max_n)
        if "error" in en:
            return en
        analogs = en["analogs"]
        meta = {"mode": "enumerate", "positions": en["positions"],
                "n_combos": en["n_combos"], "truncated": en["truncated"]}
    if not analogs:
        return {"error": "no valid analogs were generated"}
    pr = predict(model_id, [a["smiles"] for a in analogs])
    if "error" in pr:
        return pr
    rows = []
    for a, p in zip(analogs, pr["predictions"]):
        if p["prediction"] is None:
            continue
        m = standardize(a["smiles"])
        dl = _druglike(m) if m is not None else {}
        rows.append({**a, "prediction": p["prediction"], "in_domain": p["in_domain"], **dl})
    rows.sort(key=lambda r: r["prediction"], reverse=True)   # higher predicted activity first
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    n_in = sum(1 for r in rows if r["in_domain"])
    n_ro5 = sum(1 for r in rows if r.get("lipinski_ok"))
    return {"task": b["task"], "descriptor": b["descriptor"], "n": len(rows),
            "n_in_domain": n_in, "n_lipinski": n_ro5, "analogs": rows, **meta}


def predict(model_id, smiles_list):
    """Predict for new molecules with an applicability-domain flag."""
    b = MODELS.get(model_id)
    if not b:
        return {"error": "unknown model_id (train a model first)"}
    X, keep = featurize(smiles_list, b["descriptor"])
    if not len(keep):
        return {"error": "no valid molecules"}
    Xs = b["scaler"].transform(X) if b["scaler"] is not None else X
    m = b["model"]
    if b["task"] == "regression":
        vals = np.asarray(m.predict(Xs)).ravel().tolist()
    else:
        vals = m.predict_proba(Xs)[:, 1].tolist()
    d = b["nn"].kneighbors(Xs)[0].mean(axis=1)
    in_ad = (d <= b["ad_thr"]).tolist()
    res = []
    ki = 0
    for i, s in enumerate(smiles_list):
        if ki < len(keep) and keep[ki] == i:
            res.append({"smiles": s, "prediction": round(vals[ki], 3), "in_domain": bool(in_ad[ki])})
            ki += 1
        else:
            res.append({"smiles": s, "prediction": None, "in_domain": None})
    return {"predictions": res}


# --------------------------------------------------------------------------
#  datasets
# --------------------------------------------------------------------------
def load_test_case(name):
    """Bundled, fixed reproducibility datasets with published baselines."""
    if name == "esol":       # regression: aqueous solubility (Delaney)
        path = os.path.join(_DATA, "esol.csv"); smi_col = "smiles"; y_col = "measured log solubility in mols per litre"
        task = "regression"
    elif name == "bbbp":     # classification: blood-brain-barrier penetration
        path = os.path.join(_DATA, "bbbp.csv"); smi_col = "smiles"; y_col = "p_np"
        task = "classification"
    else:
        return {"error": "unknown test case"}
    smiles, y = [], []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            s = row.get(smi_col, "").strip()
            try:
                v = float(row[y_col])
            except Exception:
                continue
            if s:
                smiles.append(s); y.append(v)
    return {"name": name, "task": task, "smiles": smiles, "y": y, "count": len(smiles)}


def fetch_chembl(target, activity_type="IC50", limit=1500):
    """Assemble a QSAR dataset from ChEMBL for a target (name or CHEMBL id).
    Returns molecules with pChEMBL (-log10 M) as the activity."""
    import requests
    UA = {"User-Agent": "DDS/QSAR"}
    base = "https://www.ebi.ac.uk/chembl/api/data"
    tid = target.strip()
    if not tid.upper().startswith("CHEMBL"):
        r = requests.get(f"{base}/target/search.json", headers=UA, params={"q": tid}, timeout=30)
        hits = r.json().get("targets", [])
        if not hits:
            return {"error": f"no ChEMBL target for '{target}'", "molecules": []}
        tid = hits[0]["target_chembl_id"]
    mols, offset = [], 0
    while len(mols) < limit:
        r = requests.get(f"{base}/activity.json", headers=UA, timeout=40, params={
            "target_chembl_id": tid, "standard_type": activity_type,
            "pchembl_value__isnull": "false", "limit": 1000, "offset": offset})
        js = r.json(); acts = js.get("activities", [])
        for a in acts:
            smi = a.get("canonical_smiles"); pv = a.get("pchembl_value")
            if smi and pv:
                mols.append({"smiles": smi, "value": float(pv)})
        if not js.get("page_meta", {}).get("next"):
            break
        offset += 1000
    # de-duplicate by canonical SMILES (median activity)
    agg = {}
    for m in mols:
        cm = standardize(m["smiles"])
        if cm is None:
            continue
        key = Chem.MolToSmiles(cm)
        agg.setdefault(key, []).append(m["value"])
    smiles = list(agg.keys()); y = [float(np.median(v)) for v in agg.values()]
    return {"target": tid, "activity_type": activity_type, "task": "regression",
            "smiles": smiles, "y": y, "count": len(smiles)}
