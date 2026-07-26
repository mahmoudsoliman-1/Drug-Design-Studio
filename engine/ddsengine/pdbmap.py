"""Resolve hub genes to representative experimental structures for docking.

For each gene symbol:
  gene → UniProt accession (human, reviewed) → candidate PDB entries → rank → pick.

Ranking favours a structure that is actually useful for structure-based docking:
X-ray/cryo-EM over NMR, good resolution, broad coverage of the mapped domain, and —
most importantly — a bound drug-like ligand that marks the real binding pocket (and
lets the docking box be centred on it). When no experimental structure exists we fall
back to the AlphaFold model. All sources are key-free (UniProt, RCSB, AlphaFold DB).
"""
import re
import requests
from concurrent.futures import ThreadPoolExecutor

UA = {"User-Agent": "DDS/1.0 (network-pharmacology)"}
UNIPROT = "https://rest.uniprot.org/uniprotkb"
RCSB_GQL = "https://data.rcsb.org/graphql"
ALPHAFOLD = "https://alphafold.ebi.ac.uk/api/prediction"

# ligands that mark no real pocket — waters, ions, cryo-protectants, buffers, detergents
_JUNK = frozenset("""
HOH DOD PEO
NA CL K MG CA ZN MN FE FE2 CU CU1 NI CO CD HG BA SR CS RB LI IOD BR IUM
SO4 PO4 PO3 2HP NO3 NH4 CO3 AZI SCN CAC CACO OXY PER
GOL EDO PEG PG4 PG0 1PE 2PE P6G PGE 7PE 12P 15P DMS DMF EOH IPA MOH ACT ACY FMT
TRS TAM BTB EPE MES MPD BME DTT TCEP IMD CIT FLC TLA MLA MLI SIN SUC BEZ PGA
FES SF4 F3S HEC HEM MSE PTR SEP TPO KCX LLP CSO CSD OCS CME
""".split())

_METALS = frozenset("NA CL K MG CA ZN MN FE CU NI CO CD HG".split())


def _first_accession(gene):
    """Canonical reviewed human UniProt accession for a gene symbol."""
    q = f"gene_exact:{gene} AND organism_id:9606 AND reviewed:true"
    try:
        r = requests.get(f"{UNIPROT}/search", headers=UA, timeout=25,
                         params={"query": q, "fields": "accession", "format": "json", "size": 1})
        hits = r.json().get("results", [])
        return hits[0]["primaryAccession"] if hits else None
    except Exception:
        return None


def _entry(acc):
    """Full UniProt entry (name, sequence length, PDB cross-references)."""
    try:
        return requests.get(f"{UNIPROT}/{acc}.json", headers=UA, timeout=25).json()
    except Exception:
        return {}


def _parse_chains(val):
    """'A/B=127-722' → (['A','B'], span_length) ; robust to odd formats."""
    try:
        chains, _, rng = val.partition("=")
        chain_ids = [c.strip() for c in chains.split("/") if c.strip()]
        m = re.match(r"(-?\d+)-(-?\d+)", rng.strip())
        span = (int(m.group(2)) - int(m.group(1)) + 1) if m else 0
        return chain_ids, max(0, span)
    except Exception:
        return [], 0


def _pdb_candidates(entry):
    """PDB cross-refs from a UniProt entry: id, method, resolution, chains, coverage."""
    length = (entry.get("sequence") or {}).get("length") or 0
    out = []
    for xr in entry.get("uniProtKBCrossReferences", []):
        if xr.get("database") != "PDB":
            continue
        props = {p["key"]: p.get("value", "") for p in xr.get("properties", [])}
        method = props.get("Method", "")
        res = props.get("Resolution", "")
        res_val = None
        m = re.search(r"([\d.]+)", res)
        if m:
            try:
                res_val = float(m.group(1))
            except ValueError:
                res_val = None
        chains, span = _parse_chains(props.get("Chains", ""))
        out.append({
            "pdb_id": xr.get("id", "").upper(), "method": method, "resolution": res_val,
            "chains": chains, "coverage": round(span / length, 3) if length else None,
        })
    return out


def _ligands_batch(pdb_ids):
    """One RCSB GraphQL call → {pdb_id: {title, ligands:[{id,name,mw}]}} for all ids."""
    if not pdb_ids:
        return {}
    ids = '","'.join(pdb_ids)
    query = ('{entries(entry_ids:["' + ids + '"]){rcsb_id struct{title} '
             'nonpolymer_entities{nonpolymer_comp{chem_comp{id name formula_weight}}}}}')
    try:
        r = requests.post(RCSB_GQL, headers=UA, json={"query": query}, timeout=30)
        data = (r.json().get("data") or {}).get("entries") or []
    except Exception:
        return {}
    out = {}
    for e in data:
        if not e:
            continue
        ligs = []
        for ne in (e.get("nonpolymer_entities") or []):
            cc = ((ne or {}).get("nonpolymer_comp") or {}).get("chem_comp") or {}
            cid = (cc.get("id") or "").upper()
            if not cid or cid in _JUNK:
                continue
            ligs.append({"id": cid, "name": cc.get("name") or cid,
                         "mw": cc.get("formula_weight")})
        out[e["rcsb_id"].upper()] = {"title": (e.get("struct") or {}).get("title") or "", "ligands": ligs}
    return out


def _drug_like(lig):
    """Score a ligand as a pocket marker: prefer drug-like MW (150–700 Da)."""
    mw = lig.get("mw")
    if mw is None:
        return 8
    if 150 <= mw <= 700:
        return 25
    if 700 < mw <= 1200:
        return 14
    if 90 <= mw < 150:
        return 6
    return 3


def _score(cand):
    """Composite docking-suitability score (higher = better representative)."""
    s = 0.0
    method = (cand.get("method") or "").lower()
    if "x-ray" in method:
        s += 40
    elif "em" in method or "electron" in method or "cryo" in method:
        s += 32
    elif "nmr" in method:
        s += 10
    else:
        s += 6
    res = cand.get("resolution")
    if res is not None and ("x-ray" in method or "em" in method or "electron" in method or "cryo" in method):
        s += max(0.0, 30.0 - (res - 1.5) * 12.0)   # ≤1.5Å ~30 → 3.5Å ~6
    cov = cand.get("coverage")
    if cov is not None:
        s += min(20.0, cov * 20.0)
    best = cand.get("best_ligand")
    if best:
        s += _drug_like(best)
    return round(s, 1)


def _one_gene(gene, max_candidates=24):
    gene = (gene or "").strip().upper()
    acc = _first_accession(gene)
    if not acc:
        return {"gene": gene, "uniprot": None, "name": None,
                "recommended": None, "alternatives": [], "alphafold": None,
                "error": "no reviewed human UniProt entry"}
    entry = _entry(acc)
    name = (((entry.get("proteinDescription") or {}).get("recommendedName") or {})
            .get("fullName") or {}).get("value")
    cands = _pdb_candidates(entry)

    af = {"model_id": f"AF-{acc}-F1",
          "url": f"https://alphafold.ebi.ac.uk/entry/{acc}"} if acc else None

    if not cands:
        return {"gene": gene, "uniprot": acc, "name": name,
                "recommended": None, "alternatives": [], "alphafold": af,
                "error": "no experimental PDB — use the AlphaFold model"}

    # pre-rank by structure quality to bound the ligand lookup, then enrich with ligands
    cands.sort(key=lambda c: (
        0 if "x-ray" in (c.get("method") or "").lower() else 1,
        c.get("resolution") if c.get("resolution") is not None else 99,
        -(c.get("coverage") or 0),
    ))
    top = cands[:max_candidates]
    lig_map = _ligands_batch([c["pdb_id"] for c in top])
    for c in top:
        info = lig_map.get(c["pdb_id"], {})
        c["title"] = info.get("title", "")
        ligs = sorted(info.get("ligands", []), key=lambda l: -_drug_like(l))
        c["ligands"] = ligs[:6]
        c["best_ligand"] = ligs[0] if ligs else None
        c["score"] = _score(c)

    top.sort(key=lambda c: -c["score"])
    return {"gene": gene, "uniprot": acc, "name": name,
            "recommended": top[0], "alternatives": top[1:4], "alphafold": af, "error": None}


def hub_structures(genes, max_genes=12):
    """Resolve a list of hub genes to representative PDB structures (parallel)."""
    genes = [g for g in dict.fromkeys(g.strip().upper() for g in genes if g and g.strip())][:max_genes]
    if not genes:
        return {"structures": [], "error": "no genes supplied"}
    with ThreadPoolExecutor(max_workers=min(8, len(genes))) as ex:
        results = list(ex.map(_one_gene, genes))
    order = {g: i for i, g in enumerate(genes)}
    results.sort(key=lambda r: order.get(r["gene"], 99))
    return {"structures": results, "error": None}
