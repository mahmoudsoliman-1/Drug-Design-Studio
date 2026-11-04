"""DDS Module 5 — Tissues.  Fast, mechanistic membrane-permeability prediction.

Combines 11 physicochemical descriptors with 4 implicit-membrane Generalized-Born
energetics, calibrated per tissue.  Validated tissues use trained RandomForest
models; estimate-tier barriers return physics-only output, clearly flagged.
No molecular dynamics; ~0.1 s per molecule.
"""
import os, functools
import numpy as np
from rdkit import Chem
from rdkit.Chem import Descriptors, Crippen, rdMolDescriptors, Lipinski
from rdkit import RDLogger
RDLogger.DisableLog('rdApp.*')

from . import tissues_physics as mp

_HERE = os.path.dirname(os.path.abspath(__file__))
_MODELS = os.path.join(_HERE, "tissues_models")

DESC = ["logP", "TPSA", "HBD", "HBA", "MW", "RotB", "ArRings", "FrCSP3", "charge", "MR", "HeavyA"]

# tissue catalogue --------------------------------------------------------------
# tier: 'validated' (trained model) or 'estimate' (physics-only, flagged)
TISSUES = [
    {"id": "gut",      "name": "Gut (intestinal, Caco-2)", "tier": "validated", "kind": "reg",
     "unit": "log Papp", "metric": "Pearson r = 0.71", "note": "Oral absorption surrogate."},
    {"id": "bbb",      "name": "Blood-brain barrier",      "tier": "validated", "kind": "clf",
     "unit": "P(BBB+)",  "metric": "ROC-AUC = 0.90", "note": "CNS penetration."},
    {"id": "skin",     "name": "Skin (stratum corneum)",   "tier": "validated", "kind": "reg",
     "unit": "log Kp",   "metric": "Pearson r = 0.75", "note": "Transdermal delivery."},
    {"id": "pampa",    "name": "PAMPA (artificial membrane)", "tier": "validated", "kind": "clf",
     "unit": "P(permeable)", "metric": "ROC-AUC = 0.72", "note": "Passive-permeability reference."},
    {"id": "nasal",    "name": "Nasal mucosa",   "tier": "estimate", "kind": "physics", "unit": "barrier",
     "metric": "physics estimate", "note": "No validation-grade public dataset yet."},
    {"id": "placenta", "name": "Placenta",       "tier": "estimate", "kind": "physics", "unit": "barrier",
     "metric": "physics estimate", "note": "Sparse data; active transport not modelled."},
    {"id": "mdck",     "name": "MDCK monolayer", "tier": "estimate", "kind": "physics", "unit": "barrier",
     "metric": "physics estimate", "note": "No open small-molecule dataset."},
    {"id": "lung",     "name": "Lung (pulmonary)", "tier": "estimate", "kind": "physics", "unit": "barrier",
     "metric": "physics estimate", "note": "Data-poor; physics estimate only."},
]
_TMAP = {t["id"]: t for t in TISSUES}

def tissue_catalog():
    return {"tissues": TISSUES}

def descriptors(m):
    return [Crippen.MolLogP(m), rdMolDescriptors.CalcTPSA(m), Lipinski.NumHDonors(m),
            Lipinski.NumHAcceptors(m), Descriptors.MolWt(m), Lipinski.NumRotatableBonds(m),
            rdMolDescriptors.CalcNumAromaticRings(m), rdMolDescriptors.CalcFractionCSP3(m),
            Chem.GetFormalCharge(m), Crippen.MolMR(m), m.GetNumHeavyAtoms()]

@functools.lru_cache(maxsize=8)
def _load(tid):
    import joblib
    p = os.path.join(_MODELS, "model_%s.joblib" % tid)
    return joblib.load(p) if os.path.exists(p) else None

def _gut_class(v):
    return "High absorption" if v >= -5.0 else ("Moderate absorption" if v >= -6.0 else "Low absorption")
def _skin_class(v):
    return "High permeation" if v >= -5.5 else ("Moderate permeation" if v >= -7.0 else "Low permeation")
def _barrier_class(b):
    return "Likely permeant" if b < 6.0 else ("Borderline" if b < 10.0 else "Likely impermeant")

def _drivers(desc, phys, tissue):
    logP, tpsa, hbd, hba = desc[0], desc[1], int(desc[2]), int(desc[3])
    dGt = phys[1]
    out = [
        {"k": "logP", "v": round(logP, 1),
         "note": "lipophilic — favours membrane" if logP >= 2 else ("hydrophilic" if logP < 1 else "moderate")},
        {"k": "TPSA", "v": round(tpsa, 0),
         "note": "high polar area — resists permeation" if tpsa > 90 else ("low" if tpsa < 60 else "moderate")},
        {"k": "H-bond D/A", "v": "%d / %d" % (hbd, hba), "note": "donors slow permeation" if hbd >= 3 else ""},
        {"k": "ΔG(water→membrane)", "v": round(dGt, 1),
         "note": "favourable insertion" if dGt < 0 else "desolvation-limited"},
    ]
    return out

def _pdb_block(coords, syms):
    lines = []
    for i, (xyz, s) in enumerate(zip(coords, syms), 1):
        el = s.capitalize()
        lines.append("HETATM%5d %-4s LIG A   1    %8.3f%8.3f%8.3f  1.00  0.00          %2s" %
                     (i, (s[:3]+str(i))[:4], xyz[0], xyz[1], xyz[2], el[:2]))
    lines.append("END")
    return "\n".join(lines)

def predict(smiles, tissues=None):
    m = Chem.MolFromSmiles(smiles or "")
    if m is None:
        return {"error": "Could not parse SMILES."}
    tissues = tissues or ["gut", "bbb", "skin", "pampa"]
    d = descriptors(m)
    ct = mp.core_terms(smiles)                       # (S, ASA) shared physics
    if ct is None:
        return {"error": "Could not generate a 3D conformer for this molecule."}
    S, ASA = ct
    out = {"smiles": smiles, "tissues": {}}
    for tid in tissues:
        meta = _TMAP.get(tid)
        if meta is None:
            continue
        phys = mp.features(smiles, tid)              # (Gpol, dGtransfer, ASA, dGelec)
        prof = mp.gz_profile(None, tid, terms=(S, ASA))
        gz = {"z": [round(float(z), 1) for z in prof["z"]],
              "Gz": [round(float(g), 2) for g in prof["Gz"]],
              "barrier": round(prof["barrier"], 2), "well": round(prof["well"], 2),
              "z0": prof.get("tissue") and mp.TISSUE_THICK.get(tid, 13.0)}
        logp_eff = mp.permeability_from_gz(prof)
        res = {"tier": meta["tier"], "unit": meta["unit"], "name": meta["name"],
               "note": meta["note"], "metric": meta["metric"], "gz": gz,
               "logP_eff": round(logp_eff, 2) if logp_eff is not None else None,
               "drivers": _drivers(d, phys, tid)}
        if meta["tier"] == "validated":
            bundle = _load(tid)
            x = np.array(list(d) + list(phys), float).reshape(1, -1)
            if meta["kind"] == "reg":
                val = float(bundle["model"].predict(x)[0])
                res["value"] = round(val, 2)
                res["class"] = _gut_class(val) if tid == "gut" else _skin_class(val)
            else:
                p = float(bundle["model"].predict_proba(x)[0, 1])
                res["prob"] = round(p, 3)
                if tid == "bbb":
                    res["class"] = "BBB+ (penetrant)" if p >= 0.5 else "BBB- (non-penetrant)"
                else:
                    res["class"] = "High passive permeability" if p >= 0.5 else "Low/moderate permeability"
        else:
            res["class"] = _barrier_class(prof["barrier"])
            res["barrier"] = round(prof["barrier"], 2)
        out["tissues"][tid] = res
    return out

def place(smiles, tissue="bbb"):
    """3D scene payload: physically-placed molecule + membrane geometry."""
    r = mp.place_in_membrane(smiles, tissue)
    if r is None:
        return {"error": "Could not place molecule."}
    coords = r["coords"]
    return {
        "pdb": _pdb_block(coords, r["sym"]),
        "lipophilicity": [round(float(c), 2) for c in r["crippen_logp"]],
        "z_com": round(r["z_com"], 1), "tilt_deg": round(r["tilt_deg"], 0),
        "core_halfwidth": r["core_halfwidth"], "barrier": round(r.get("barrier", 0.0), 2),
        "tissue": tissue,
    }
