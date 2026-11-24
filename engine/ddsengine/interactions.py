"""Distance-based protein-ligand interaction detection on docked poses."""
import math

ACIDIC = {"ASP", "GLU"}
BASIC = {"ARG", "LYS", "HIS"}


def _elem(adtype, name):
    t = (adtype or "").upper()
    if t.startswith("H"):
        return "H"
    if t.startswith(("C", "A")):
        return "C"
    if t.startswith("N"):
        return "N"
    if t.startswith("O"):
        return "O"
    if t.startswith("S"):
        return "S"
    if t.startswith("P"):
        return "P"
    n = (name or "").strip()
    return n[0] if n else "C"


def _atoms(pdbqt_text):
    out = []
    for l in pdbqt_text.splitlines():
        if l.startswith(("ATOM", "HETATM")):
            try:
                x, y, z = float(l[30:38]), float(l[38:46]), float(l[46:54])
            except ValueError:
                continue
            adtype = l[77:79].strip() if len(l) >= 78 else ""
            name = l[12:16].strip()
            out.append({
                "x": x, "y": y, "z": z, "elem": _elem(adtype, name),
                "resn": l[17:20].strip(), "resi": l[22:26].strip(),
                "chain": (l[21].strip() or "A"), "name": name,
            })
    return out


def _receptor_atoms(pdb_text):
    """Heavy PROTEIN atoms (ATOM records only) from the ORIGINAL protein PDB, keeping
    the author residue numbering — so 2D/side-panel labels match the 3D complex viewer
    (which likewise ignores HETATM cofactors via hetflag:false). The Open Babel PDBQT
    renumbers residues from 1, which is why it must NOT be used for residue identity."""
    out = []
    for l in pdb_text.splitlines():
        if not l.startswith("ATOM"):
            continue
        try:
            x, y, z = float(l[30:38]), float(l[38:46]), float(l[46:54])
        except ValueError:
            continue
        name = l[12:16].strip()
        el = l[76:78].strip() if len(l) >= 78 else ""
        if not el or not el[0].isalpha():
            nm = name.lstrip("0123456789")   # e.g. "1HB" -> "HB"
            el = nm[:1] if nm else "C"
        e = el[0].upper()
        if e == "H" or el.upper() == "D":
            continue
        out.append({
            "x": x, "y": y, "z": z, "elem": e,
            "resn": l[17:20].strip(), "resi": l[22:26].strip(),
            "chain": (l[21].strip() or "A"), "name": name,
        })
    return out


def _d(a, b):
    return math.sqrt((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2 + (a["z"] - b["z"]) ** 2)


def detect(receptor_pdb, pose_pdbqt, max_items=16):
    R = _receptor_atoms(receptor_pdb)
    # ligand heavy atoms, numbered in pose order (== the RDKit 2D depiction order,
    # so the 2D map can anchor each bond to the real ligand atom it belongs to)
    L = [a for a in _atoms(pose_pdbqt) if a["elem"] != "H"]
    for i, a in enumerate(L):
        a["li"] = i
    found = []
    polar_res = set()   # residues already in a polar contact (so hydrophobic skips them)

    # hydrogen bonds: ligand N/O <-> protein N/O, 2.4-3.5 A. Counted PER BOND —
    # one per protein polar atom (its nearest ligand partner), matching the 3D view
    # and the side-panel list. A residue making several H-bonds shows several.
    hb_cand = []
    for a in L:
        if a["elem"] not in ("N", "O"):
            continue
        for b in R:
            if b["elem"] not in ("N", "O"):
                continue
            d = _d(a, b)
            if 2.4 <= d <= 3.5:
                hb_cand.append((d, a, b))
    hb_cand.sort(key=lambda t: t[0])
    seen_prot = set()
    for d, a, b in hb_cand:
        pk = (b["chain"], b["resi"], b["name"])   # dedup per protein atom (nearest kept)
        if pk in seen_prot:
            continue
        seen_prot.add(pk)
        polar_res.add((b["resn"], b["resi"]))
        found.append({"residue": b["resn"] + b["resi"], "chain": b["chain"],
                      "type": "H-bond", "distance": round(d, 1), "lig_i": a["li"]})

    # salt bridges: charged group heuristic, <= 4.0 A (one per residue)
    seen_sb = set()
    for a in L:
        for b in R:
            d = _d(a, b)
            if d > 4.0:
                continue
            sb = (a["elem"] == "O" and b["resn"] in BASIC and b["elem"] == "N") or \
                 (a["elem"] == "N" and b["resn"] in ACIDIC and b["elem"] == "O")
            if sb:
                key = (b["resn"], b["resi"])
                if key in seen_sb:
                    continue
                seen_sb.add(key)
                polar_res.add(key)
                found.append({"residue": b["resn"] + b["resi"], "chain": b["chain"],
                              "type": "Salt bridge", "distance": round(d, 1), "lig_i": a["li"]})

    # hydrophobic: closest C-C per residue, <= 4.0 A, excluding polar-contacted residues
    best = {}
    for a in L:
        if a["elem"] != "C":
            continue
        for b in R:
            if b["elem"] != "C":
                continue
            d = _d(a, b)
            if d <= 4.0:
                k = (b["resn"], b["resi"], b["chain"])
                if k not in best or d < best[k][0]:
                    best[k] = (d, a["li"])
    for (resn, resi, chain), (d, li) in sorted(best.items(), key=lambda kv: kv[1][0]):
        if (resn, resi) in polar_res:
            continue
        found.append({"residue": resn + resi, "chain": chain,
                      "type": "Hydrophobic", "distance": round(d, 1), "lig_i": li})

    # order: H-bond, Salt bridge, Pi, Hydrophobic; then by distance
    order = {"H-bond": 0, "Salt bridge": 1, "π-stacking": 2, "Hydrophobic": 3}
    found.sort(key=lambda x: (order.get(x["type"], 9), x["distance"]))
    return found[:max_items]


def pose_to_pdb_hetatm(pose_pdbqt, resname="LIG", start_serial=9000):
    """Convert docked-pose PDBQT atom lines to PDB HETATM lines (for the viewer)."""
    lines = []
    serial = start_serial
    for l in pose_pdbqt.splitlines():
        if not l.startswith(("ATOM", "HETATM")):
            continue
        name = l[12:16]
        x, y, z = l[30:38], l[38:46], l[46:54]
        adtype = l[77:79].strip() if len(l) >= 78 else ""
        # skip meeko macrocycle "glue" pseudo-atoms (AutoDock type G0/G1): dummy
        # placeholders inserted to open/reclose a flexible ring during sampling.
        # They carry no element and break any downstream RDKit rebuild of the
        # ligand (MM-GBSA, re-docking validation). The real ring carbons are the
        # separate CG0/CG1 atoms, which are kept and typed as carbon.
        if adtype[:1] == "G":
            continue
        elem = _elem(adtype, name)
        if elem in ("H", "G"):
            continue
        lines.append("HETATM%5d %4s %3s L 999    %8s%8s%8s  1.00  0.00          %2s" %
                     (serial, name[:4], resname, x, y, z, elem.rjust(2)))
        serial += 1
    return "\n".join(lines)
