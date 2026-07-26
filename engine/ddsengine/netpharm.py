"""Network pharmacology pipeline for DDS.

A compound → target → disease → network → hubs → enrichment workflow built on
free, key-free public resources:

  * disease targets   — Open Targets Platform (GraphQL) + CTD (batch query),
                        unioned with any user-pasted/uploaded gene list
  * compound targets  — ChEMBL (bioactivity → targets), unioned with uploads
  * PPI network       — STRING (network API)
  * hub genes         — NetworkX centrality (degree / betweenness / closeness)
  * enrichment        — Enrichr (GO BP/MF/CC, KEGG)

Every network call is defensive: short timeouts, hard caps, and graceful
degradation so one slow/broken source never sinks the whole run. This module is
online by design — it queries live biological databases.
"""
import json
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor

import requests
import networkx as nx

UA = {"User-Agent": "DrugDesignStudio/1.0 (network-pharmacology)"}
OT_GQL = "https://api.platform.opentargets.org/api/v4/graphql"
CHEMBL = "https://www.ebi.ac.uk/chembl/api/data"
STRING = "https://string-db.org/api"
ENRICHR = "https://maayanlab.cloud/Enrichr"
CTD_BATCH = "https://ctdbase.org/tools/batchQuery.go"

ENRICHR_LIBS = {
    "GO_BP": "GO_Biological_Process_2021",
    "GO_MF": "GO_Molecular_Function_2021",
    "GO_CC": "GO_Cellular_Component_2021",
    "KEGG": "KEGG_2021_Human",
}

_GENE_RE = re.compile(r"^[A-Za-z0-9\-]{1,20}$")

# Curated covalent-ligandability reference — human proteins that are established
# covalent drug targets or carry a well-characterised reactive residue (targetable
# cysteine, catalytic serine/cysteine, reactive lysine/tyrosine) that a covalent
# warhead can engage. This mirrors DDS's covalent-docking nucleophiles
# (Cys/Ser/Thr/Lys/Tyr/His). It is a curated set — comprehensive for known covalent
# targets, not exhaustive for every possible reactive site.
COVALENT_TARGETS = frozenset({
    # covalent kinase targets (reactive Cys near the ATP pocket)
    "EGFR", "ERBB2", "ERBB4", "BTK", "ITK", "TEC", "BMX", "TXK", "JAK3", "BLK",
    "MAP2K1", "MAP2K2", "MAP2K3", "MAP2K4", "MAP2K6", "MAP2K7", "NEK2",
    "FGFR1", "FGFR2", "FGFR3", "FGFR4", "CDK7", "CDK9", "CDK12", "CDK13", "PLK1",
    "RPS6KA1", "RPS6KA3", "MKNK2", "LIMK1", "LIMK2", "GAK", "AAK1", "MELK",
    "MAPK8", "MAPK9", "MAPK10", "MAPK14", "GSK3B", "GSK3A", "SIK2",
    # small GTPases (G12C etc.)
    "KRAS", "HRAS", "NRAS",
    # cysteine proteases
    "CASP1", "CASP2", "CASP3", "CASP4", "CASP5", "CASP6", "CASP7", "CASP8", "CASP9",
    "CASP10", "CTSB", "CTSC", "CTSF", "CTSH", "CTSK", "CTSL", "CTSS", "CTSV", "CTSW",
    "CAPN1", "CAPN2", "LGMN", "ATG4A", "ATG4B",
    # deubiquitinases / SUMO proteases (catalytic Cys)
    "USP1", "USP2", "USP7", "USP8", "USP14", "USP28", "UCHL1", "UCHL3", "UCHL5",
    "OTUB1", "OTUB2", "SENP1", "SENP2", "SENP6", "BAP1", "MPND",
    # serine hydrolases (covalent to the catalytic Ser)
    "ACHE", "BCHE", "FAAH", "MGLL", "DPP4", "DPP8", "DPP9", "FAP", "PREP", "PRCP",
    "LYPLA1", "LYPLA2", "PNPLA6", "ABHD6", "ABHD11", "ABHD12", "CES1", "CES2",
    "PLA2G4A", "PLA2G6", "PLA2G7", "LIPE", "MAOA", "MAOB",
    # serine proteases with covalent inhibitors
    "F2", "F7", "F9", "F10", "PLG", "PLAU", "PLAT", "ELANE", "PRTN3", "CTSG",
    "GZMA", "GZMB", "TMPRSS2", "HTRA1", "HTRA2", "C1R", "C1S", "MASP1", "MASP2",
    "KLK5", "KLK7", "PRSS8",
    # cysteine-based phosphatases (catalytic Cys)
    "PTPN1", "PTPN2", "PTPN11", "PTP4A3", "PTEN", "CDC25A", "CDC25B", "CDC25C",
    "DUSP3", "MTMR",
    # reactive-cysteine / thiol sensors, redox and metabolic proteins
    "KEAP1", "TGM1", "TGM2", "GAPDH", "PARK7", "PIN1", "GSTP1", "GSTO1", "GSTM1",
    "ALDH1A1", "ALDH2", "ALDH1B1", "ALDH3A1", "XDH", "PTGS1", "PTGS2", "NLRP3",
    "IDH1", "CBR1", "AKR1B1", "AKR1C1", "PGD", "GLO1", "HAGH", "SQLE", "PPT1",
    "NAMPT", "GPX4", "NQO1", "NQO2",
    # thioredoxin / peroxiredoxin system
    "TXN", "TXNRD1", "TXNRD2", "PRDX1", "PRDX2", "PRDX3", "PRDX4", "PRDX5", "PRDX6",
    "GLRX", "P4HB", "PDIA3",
    # apoptosis / transcription with covalent ligands
    "BAX", "MCL1", "BCL2A1", "TP53", "STAT3", "STAT6",
    # TEAD (palmitate-pocket Cys), E3 handles, proteasome, E1
    "TEAD1", "TEAD2", "TEAD3", "TEAD4", "DCAF16", "RNF114", "RNF126", "FEM1B",
    "PSMB5", "PSMB1", "PSMB2", "PSMB8", "PSMB9", "PSMB10", "UBA1", "NAE1",
})


def _is_covalent(gene):
    return str(gene).strip().upper() in COVALENT_TARGETS


# common gene-symbol aliases → official HGNC symbol, so cross-source intersection
# doesn't lose matches (e.g. GeneCards/TCMSP exports use legacy names)
_ALIASES = {
    "HER2": "ERBB2", "HER1": "EGFR", "HER3": "ERBB3", "HER4": "ERBB4",
    "COX1": "PTGS1", "COX2": "PTGS2", "PGP": "ABCB1", "MDR1": "ABCB1",
    "P53": "TP53", "PKB": "AKT1", "PKBALPHA": "AKT1", "GSK3": "GSK3B",
    "NRF2": "NFE2L2", "TNFA": "TNF", "TNF-A": "TNF", "NFKB": "NFKB1",
    "VEGF": "VEGFA", "MMP-9": "MMP9", "MMP-2": "MMP2", "CBP": "CREBBP",
    "P300": "EP300", "IL-6": "IL6", "IL-1B": "IL1B", "CASP-3": "CASP3",
    "PPAR-G": "PPARG", "PPARGAMMA": "PPARG", "BCL-2": "BCL2", "C-MYC": "MYC",
    "HIF1A": "HIF1A", "HIF-1A": "HIF1A", "ER": "ESR1", "PR": "PGR",
}


def _norm(g):
    g = str(g).strip().upper().replace(" ", "")
    return _ALIASES.get(g, g)


def _clean_genes(seq):
    """Normalise a gene-symbol iterable: upper-case, alias→official, de-dup, keep order."""
    out, seen = [], set()
    for g in seq or []:
        s = _norm(g)
        if s and _GENE_RE.match(s) and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def parse_gene_list(text):
    """Split a pasted/uploaded blob (commas, whitespace, newlines) into symbols."""
    if not text:
        return []
    return _clean_genes(re.split(r"[\s,;]+", text))


# --------------------------- disease targets ---------------------------
def _ot_disease_targets(disease, limit):
    """Open Targets: resolve the disease to an EFO id, then its associated targets."""
    try:
        sr = requests.post(OT_GQL, headers=UA, timeout=20, json={
            "query": "query($q:String!){search(queryString:$q,entityNames:[\"disease\"],"
                     "page:{index:0,size:1}){hits{id name}}}",
            "variables": {"q": disease},
        })
        hits = sr.json().get("data", {}).get("search", {}).get("hits", [])
        if not hits:
            return {"genes": [], "label": None, "efo": None}
        efo, label = hits[0]["id"], hits[0]["name"]
        scored, page, size = {}, 0, 500
        while len(scored) < int(limit):
            ar = requests.post(OT_GQL, headers=UA, timeout=40, json={
                "query": "query($efo:String!,$i:Int!,$size:Int!){disease(efoId:$efo){associatedTargets"
                         "(page:{index:$i,size:$size}){rows{target{approvedSymbol}score}}}}",
                "variables": {"efo": efo, "i": page, "size": size},
            })
            rows = ar.json().get("data", {}).get("disease", {}).get("associatedTargets", {}).get("rows", [])
            if not rows:
                break
            for r in rows:
                t = r.get("target")
                if not t:
                    continue
                g = _norm(t.get("approvedSymbol", ""))
                if g and _GENE_RE.match(g) and g not in scored:
                    scored[g] = round(float(r.get("score", 0) or 0), 3)
            page += 1
            if len(rows) < size:
                break
        return {"scored": scored, "label": label, "efo": efo}
    except Exception as e:
        return {"scored": {}, "label": None, "efo": None, "error": str(e)[:200]}


def _ctd_disease_targets(disease, limit):
    """CTD batch query for curated disease-associated genes (best-effort by name)."""
    try:
        r = requests.get(CTD_BATCH, headers=UA, timeout=30, params={
            "inputType": "disease", "inputTerms": disease,
            "report": "genes_curated", "format": "json",
        })
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else []
        genes = []
        for row in (data or [])[: int(limit) * 3]:
            g = row.get("GeneSymbol") or row.get("Gene Symbol") or row.get("geneSymbol")
            if g:
                genes.append(g)
        return {"genes": _clean_genes(genes)[: int(limit)]}
    except Exception as e:
        return {"genes": [], "error": str(e)[:200]}


def disease_targets(disease, sources=("opentargets",), uploaded="", limit=300):
    """Ranked disease-associated genes unioned across the selected key-free sources
    plus any user list. Each gene carries an Open Targets association score (0–1,
    None if only from CTD/upload) and a covalent-targetable flag, sorted by score."""
    disease = (disease or "").strip()
    scored, sources_of, label, efo, errors = {}, {}, None, None, {}

    def note(g, src):
        sources_of.setdefault(g, set()).add(src)

    if "opentargets" in sources and disease:
        ot = _ot_disease_targets(disease, limit)
        label, efo = ot.get("label"), ot.get("efo")
        for g, sc in ot.get("scored", {}).items():
            scored[g] = sc
            note(g, "opentargets")
        if ot.get("error"):
            errors["opentargets"] = ot["error"]
    if "ctd" in sources and disease:
        ct = _ctd_disease_targets(disease, limit)
        for g in ct.get("genes", []):
            note(g, "ctd")
        if ct.get("error"):
            errors["ctd"] = ct["error"]
    for g in parse_gene_list(uploaded):
        note(g, "uploaded")

    # scored genes first (desc), then unscored (CTD/upload only), alphabetical
    all_genes = list(sources_of.keys())
    all_genes.sort(key=lambda g: (-(scored.get(g) if scored.get(g) is not None else -1), g))
    genes = [{"gene": g, "score": scored.get(g), "covalent": _is_covalent(g),
              "sources": sorted(sources_of[g])} for g in all_genes]

    by_source = {}
    for g, srcs in sources_of.items():
        for s in srcs:
            by_source[s] = by_source.get(s, 0) + 1

    return {
        "disease": disease, "label": label or disease, "efo": efo,
        "genes": genes, "count": len(genes),
        "covalent_count": sum(1 for x in genes if x["covalent"]),
        "scored_count": sum(1 for x in genes if x["score"] is not None),
        "by_source": by_source,
        "errors": errors,
    }


def _one_disease(disease, sources, limit):
    """Resolve ONE disease to {gene: score} + display label."""
    disease = (disease or "").strip()
    scored, label = {}, None
    if "opentargets" in sources and disease:
        ot = _ot_disease_targets(disease, limit)
        label = ot.get("label")
        for g, s in ot.get("scored", {}).items():
            scored[g] = s
    if "ctd" in sources and disease:
        for g in _ctd_disease_targets(disease, limit).get("genes", []):
            scored.setdefault(g, None)
    return label or disease, scored


def disease_targets_multi(diseases, sources=("opentargets",), uploaded="", limit=2000):
    """Multi-disease mode: resolve several diseases and take the INTERSECTION — the
    targets common to ALL selected diseases (the comorbid / shared-mechanism genes).
    Those common targets are what proceed into the normal pipeline. Returns per-disease
    totals for a Venn plus the common gene set."""
    qlist = [str(d).strip() for d in (diseases or []) if str(d).strip()][:6]
    if not qlist:
        return {"diseases": [], "label": "0 diseases", "genes": [], "count": 0,
                "covalent_count": 0, "scored_count": 0,
                "venn": {"per": [], "common": 0}}
    with ThreadPoolExecutor(max_workers=6) as pool:
        res = list(pool.map(lambda d: _one_disease(d, sources, limit), qlist))

    sets = [set(s.keys()) for (_, s) in res]
    common = set.intersection(*sets) if sets else set()
    best = {}
    for _, s in res:
        for g, sc in s.items():
            if sc is not None and (g not in best or sc > best[g]):
                best[g] = sc

    genes = [{"gene": g, "score": best.get(g), "covalent": _is_covalent(g), "n_diseases": len(qlist)}
             for g in common]
    genes.sort(key=lambda x: (-(x["score"] if x["score"] is not None else -1), x["gene"]))
    per = [{"query": q, "label": lbl, "count": len(s)} for q, (lbl, s) in zip(qlist, res)]
    return {
        "diseases": per, "label": "%d diseases" % len(per),
        "genes": genes, "count": len(genes),
        "covalent_count": sum(1 for x in genes if x["covalent"]),
        "scored_count": sum(1 for x in genes if x["score"] is not None),
        "venn": {"per": [{"label": p["label"], "total": p["count"]} for p in per], "common": len(common)},
    }


# --------------------------- compound targets ---------------------------
def _chembl_resolve(query, is_smiles):
    """Resolve a compound (name or SMILES) to a ChEMBL molecule id + display name."""
    try:
        if is_smiles:
            r = requests.get(f"{CHEMBL}/molecule.json", headers=UA, timeout=25, params={
                "molecule_structures__canonical_smiles__flexmatch": query, "limit": 1})
            mols = r.json().get("molecules", [])
        else:
            r = requests.get(f"{CHEMBL}/molecule/search.json", headers=UA, timeout=25,
                             params={"q": query, "limit": 1})
            mols = r.json().get("molecules", [])
        if not mols:
            return None, None
        m = mols[0]
        return m["molecule_chembl_id"], (m.get("pref_name") or query)
    except Exception:
        return None, None


def _resolve_target_genes(tid):
    """Gene symbols behind one ChEMBL target id (a target may be a complex)."""
    try:
        tr = requests.get(f"{CHEMBL}/target/{tid}.json", headers=UA, timeout=15)
        out = []
        for c in tr.json().get("target_components", []):
            for syn in c.get("target_component_synonyms", []):
                if syn.get("syn_type") == "GENE_SYMBOL":
                    out.append(syn.get("component_synonym", "").strip().upper())
        return out
    except Exception:
        return []


def _chembl_targets(chembl_id, pchembl_min, limit):
    """Human targets a molecule is active against → {gene: best pChEMBL}. The best
    (max) pChEMBL is the target's potency score. Target ids are resolved to genes
    concurrently — one-by-one would be very slow for promiscuous compounds."""
    try:
        r = requests.get(f"{CHEMBL}/activity.json", headers=UA, timeout=30, params={
            "molecule_chembl_id": chembl_id, "pchembl_value__gte": pchembl_min,
            "target_organism": "Homo sapiens", "limit": 1000,
            "only": "target_chembl_id,pchembl_value"})
        tmax = {}
        for a in r.json().get("activities", []):
            t = a.get("target_chembl_id")
            try:
                pv = float(a.get("pchembl_value"))
            except (TypeError, ValueError):
                continue
            if t and (t not in tmax or pv > tmax[t]):
                tmax[t] = pv
        tids = sorted(tmax, key=lambda t: tmax[t], reverse=True)[: int(limit)]
        gene_score = {}
        with ThreadPoolExecutor(max_workers=12) as pool:
            for tid, syms in zip(tids, pool.map(_resolve_target_genes, tids)):
                sc = tmax[tid]
                for g in syms:
                    g = str(g).strip().upper()
                    if g and _GENE_RE.match(g) and (g not in gene_score or sc > gene_score[g]):
                        gene_score[g] = round(sc, 2)
        return gene_score
    except Exception:
        return {}


def _chembl_conf(pv):
    """Map a pChEMBL potency (~4–11) onto a 0–1 confidence so measured and predicted
    targets share one scale (pChEMBL 4 → 0, 10 → 1)."""
    return round(min(1.0, max(0.0, (pv - 4) / 6.0)), 2)


def _dgidb_targets(name, limit=400):
    """Curated drug→gene interactions from DGIdb (aggregates DrugBank, ChEMBL, TTD,
    PharmGKB, …) → {gene: 0–1 confidence}. Key-free GraphQL; unions all drug nodes
    matching the name (DGIdb often has several curcumin records)."""
    try:
        q = ('{ drugs(names:["%s"]) { nodes { interactions { gene { name } interactionScore } } } }'
             % name.upper().replace('"', "").replace("\\", ""))
        r = requests.post("https://dgidb.org/api/graphql",
                          headers={**UA, "Content-Type": "application/json"}, timeout=30,
                          json={"query": q})
        nodes = r.json().get("data", {}).get("drugs", {}).get("nodes", [])
        raw = {}
        for nd in nodes:
            for it in nd.get("interactions", []):
                g = _norm((it.get("gene") or {}).get("name", ""))
                if not g or not _GENE_RE.match(g):
                    continue
                s = it.get("interactionScore") or 0.0
                raw[g] = max(raw.get(g, 0.0), float(s))
        return {g: round(min(1.0, 0.4 + s / 8.0), 2) for g, s in list(raw.items())[: int(limit)]}
    except Exception:
        return {}


def _one_compound(query, is_smiles, sources, limit):
    """Resolve ONE compound to {gene: 0–1 confidence} + {gene: source} + display name.
    DGIdb (curated interactions) and ChEMBL (measured bioactivity) map to one scale."""
    query = (query or "").strip()
    name, cid = query, None
    conf, src = {}, {}

    def bump(g, c, s):
        g = _norm(g)
        if not g or not _GENE_RE.match(g):
            return
        if g not in conf:
            conf[g], src[g] = c, s
        elif c is not None and (conf[g] is None or c > conf[g]):
            conf[g], src[g] = c, s

    if query and "dgidb" in sources and not is_smiles:
        for g, c in _dgidb_targets(query, limit).items():
            bump(g, c, "dgidb")
    if query and "chembl" in sources:
        cid, name = _chembl_resolve(query, is_smiles)
        if cid:
            for g, pv in _chembl_targets(cid, 5.0, limit).items():  # broad; UI cutoff filters
                bump(g, _chembl_conf(pv), "chembl")
    return name, cid, conf, src


def _by_source(src):
    n = {"dgidb": 0, "chembl": 0, "uploaded": 0}
    for s in src.values():
        if s in n:
            n[s] += 1
    return n


def compound_targets(query, is_smiles=False, sources=("dgidb", "chembl"), uploaded="", limit=400):
    """Ranked targets for ONE compound (DGIdb + ChEMBL + upload), 0–1 confidence.
    Uploaded targets (SwissTargetPrediction / TCMSP) carry no score but always pass."""
    name, cid, conf, src = _one_compound(query, is_smiles, sources, limit)
    for g in parse_gene_list(uploaded):
        if g not in conf:
            conf[g], src[g] = None, "uploaded"
    genes = [{"gene": g, "score": conf[g], "covalent": _is_covalent(g), "source": src[g]} for g in conf]
    genes.sort(key=lambda x: (-(x["score"] if x["score"] is not None else -1), x["gene"]))
    return {
        "query": (query or "").strip(), "name": name, "chembl_id": cid,
        "genes": genes, "count": len(genes),
        "covalent_count": sum(1 for x in genes if x["covalent"]),
        "scored_count": sum(1 for x in genes if x["score"] is not None),
        "by_source": _by_source(src),
    }


def compound_targets_multi(compounds, is_smiles=False, sources=("dgidb", "chembl"), uploaded="", limit=400):
    """Multi-compound mode: resolve several compounds (in parallel) and pool their
    targets into ONE set, tagging each target with which compounds hit it. Targets hit
    by more compounds rank higher. The pooled set then feeds the same
    disease-intersection → PPI → hub-gene pipeline (the shared goal: top hub genes)."""
    qlist = [str(c).strip() for c in (compounds or []) if str(c).strip()][:20]
    if not qlist:
        return {"compounds": [], "name": "0 compounds", "genes": [], "count": 0,
                "covalent_count": 0, "scored_count": 0, "shared_by_multi": 0,
                "by_source": {"dgidb": 0, "chembl": 0, "uploaded": 0}}
    with ThreadPoolExecutor(max_workers=6) as pool:
        res = list(pool.map(lambda q: _one_compound(q, is_smiles, sources, limit), qlist))

    conf, src, comps, per = {}, {}, {}, []
    for q, (name, cid, cconf, csrc) in zip(qlist, res):
        per.append({"query": q, "name": name, "chembl_id": cid, "count": len(cconf)})
        for g, c in cconf.items():
            if g not in conf:
                conf[g], src[g] = c, csrc[g]
            elif c is not None and (conf[g] is None or c > conf[g]):
                conf[g], src[g] = c, csrc[g]
            comps.setdefault(g, set()).add(name)
    for g in parse_gene_list(uploaded):
        if g not in conf:
            conf[g], src[g] = None, "uploaded"

    genes = []
    for g in conf:
        cl = sorted(comps.get(g, set()))
        genes.append({"gene": g, "score": conf[g], "covalent": _is_covalent(g),
                      "source": src[g], "compounds": cl, "n_compounds": len(cl)})
    genes.sort(key=lambda x: (-x["n_compounds"], -(x["score"] if x["score"] is not None else -1), x["gene"]))
    return {
        "compounds": per, "name": "%d compounds" % len(per),
        "genes": genes, "count": len(genes),
        "covalent_count": sum(1 for x in genes if x["covalent"]),
        "scored_count": sum(1 for x in genes if x["score"] is not None),
        "shared_by_multi": sum(1 for x in genes if x["n_compounds"] > 1),
        "by_source": _by_source(src),
    }


# --------------------------- PPI network (STRING) ---------------------------
def string_network(genes, confidence=0.7, species=9606):
    """STRING PPI edges among the given genes. Returns edges [{source,target,score}]
    and the connected node set (STRING drops singletons)."""
    genes = _clean_genes(genes)
    if len(genes) < 2:
        return {"edges": [], "nodes": genes, "error": None}
    try:
        r = requests.post(f"{STRING}/tsv/network", headers=UA, timeout=45, data={
            "identifiers": "%0d".join(genes[:400]), "species": species,
            "required_score": int(float(confidence) * 1000),
            "caller_identity": "drugdesignstudio"})
        edges, nodes = [], set()
        for line in r.text.strip().splitlines()[1:]:
            f = line.split("\t")
            if len(f) < 6:
                continue
            a, b, score = _norm(f[2]), _norm(f[3]), float(f[5])
            if a == b:
                continue
            edges.append({"source": a, "target": b, "score": round(score, 3)})
            nodes.add(a)
            nodes.add(b)
        return {"edges": edges, "nodes": sorted(nodes), "error": None}
    except Exception as e:
        return {"edges": [], "nodes": genes, "error": str(e)[:200]}


# --------------------------- hub genes (centrality) ---------------------------
def _mcc(G):
    """Maximal Clique Centrality (cytoHubba): MCC(v) = Σ over maximal cliques C∋v of
    (|C|−1)!. The standard hub metric reported in network-pharmacology papers."""
    mcc = {n: 0 for n in G.nodes()}
    for c in nx.find_cliques(G):
        f = math.factorial(len(c) - 1)
        for node in c:
            mcc[node] += f
    return mcc


def hub_genes(nodes, edges, method="mcc", topn=10):
    """Rank nodes by a topological centrality; the top slice are the hub genes.
    Default is MCC (cytoHubba) to match the network-pharmacology literature."""
    G = nx.Graph()
    G.add_nodes_from(nodes)
    for e in edges:
        G.add_edge(e["source"], e["target"], weight=e.get("score", 1.0))
    if G.number_of_nodes() == 0:
        return {"method": method, "ranking": []}
    try:
        if method == "mcc":
            cent = _mcc(G)
        elif method == "betweenness":
            cent = nx.betweenness_centrality(G)
        elif method == "closeness":
            cent = nx.closeness_centrality(G)
        else:
            method = "degree"
            cent = {n: G.degree(n) for n in G.nodes()}
    except Exception:
        method = "degree"
        cent = {n: G.degree(n) for n in G.nodes()}

    ranking = [{"gene": n, "score": round(float(cent[n]), 4), "degree": int(G.degree(n))}
               for n in G.nodes()]
    ranking.sort(key=lambda r: (r["score"], r["degree"]), reverse=True)
    hub_set = {r["gene"] for r in ranking[: int(topn)]}
    for r in ranking:
        r["hub"] = r["gene"] in hub_set
    return {"method": method, "ranking": ranking, "hubs": sorted(hub_set)}


# --------------------------- enrichment (Enrichr) ---------------------------
def _enrichr_addlist(genes):
    r = requests.post(f"{ENRICHR}/addList", headers=UA, timeout=30,
                      files={"list": (None, "\n".join(genes)), "description": (None, "DDS")})
    return r.json().get("userListId")


def _enrichr_enrich(list_id, library, top):
    r = requests.get(f"{ENRICHR}/enrich", headers=UA, timeout=30,
                     params={"userListId": list_id, "backgroundType": library})
    rows = r.json().get(library, [])[: int(top)]
    out = []
    for row in rows:
        # [rank, term, pvalue, zscore, combined, overlap_genes, adj_pvalue, ...]
        out.append({
            "term": row[1], "pvalue": row[2], "combined": round(row[4], 2),
            "genes": row[5], "count": len(row[5]), "adj_pvalue": row[6],
        })
    return out


def enrichment(genes, libraries=("GO_BP", "KEGG"), top=12):
    """GO / KEGG enrichment via Enrichr for the target gene set."""
    genes = _clean_genes(genes)
    if len(genes) < 3:
        return {"results": {}, "error": "need at least 3 genes for enrichment"}
    try:
        list_id = _enrichr_addlist(genes)
        if not list_id:
            return {"results": {}, "error": "Enrichr rejected the gene list"}
        results = {}
        for key in libraries:
            lib = ENRICHR_LIBS.get(key)
            if not lib:
                continue
            try:
                results[key] = _enrichr_enrich(list_id, lib, top)
            except Exception:
                results[key] = []
            time.sleep(0.2)
        return {"results": results, "error": None}
    except Exception as e:
        return {"results": {}, "error": str(e)[:200]}


# --------------------------- full pipeline (job) ---------------------------
def run_pipeline(disease_genes, compound_genes, confidence=0.4,
                 centrality="mcc", topn=10, libraries=("GO_BP", "KEGG"),
                 progress=None):
    """Intersect → PPI → hubs → enrichment. Returns the full result for the UI."""
    def step(done, total, msg):
        if progress:
            progress(done, total, msg)

    dset = _clean_genes(disease_genes)
    cset = _clean_genes(compound_genes)
    shared = [g for g in cset if g in set(dset)]

    step(1, 4, "Building PPI network (STRING)")
    net = string_network(shared, confidence)

    step(2, 4, "Ranking hub genes")
    hubs = hub_genes(net["nodes"], net["edges"], centrality, topn)

    step(3, 4, "Pathway & GO enrichment (Enrichr)")
    enr = enrichment(shared, libraries)

    step(4, 4, "Done")
    hub_set = set(hubs.get("hubs", []))
    degree = {r["gene"]: r["degree"] for r in hubs.get("ranking", [])}
    cyto_nodes = [{"data": {"id": n, "label": n, "degree": degree.get(n, 0),
                            "hub": n in hub_set, "covalent": _is_covalent(n)}} for n in net["nodes"]]
    cyto_edges = [{"data": {"id": f"{e['source']}-{e['target']}", "source": e["source"],
                            "target": e["target"], "score": e["score"]}} for e in net["edges"]]

    return {
        "counts": {"disease": len(dset), "compound": len(cset), "shared": len(shared),
                   "nodes": len(net["nodes"]), "edges": len(net["edges"]),
                   "covalent": sum(1 for n in net["nodes"] if _is_covalent(n))},
        "shared_genes": shared,
        "network": {"nodes": cyto_nodes, "edges": cyto_edges},
        "hubs": hubs,
        "enrichment": enr,
        "params": {"confidence": confidence, "centrality": centrality, "topn": topn,
                   "libraries": list(libraries)},
        "warnings": [w for w in [net.get("error"), enr.get("error")] if w],
    }
