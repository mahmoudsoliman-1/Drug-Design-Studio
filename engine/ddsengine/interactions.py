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


def _d(a, b):
    return math.sqrt((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2 + (a["z"] - b["z"]) ** 2)


def detect(receptor_pdbqt, pose_pdbqt, max_items=12):
    R = [a for a in _atoms(receptor_pdbqt) if a["elem"] != "H"]
    L = [a for a in _atoms(pose_pdbqt) if a["elem"] != "H"]
    found, seen = [], set()

    # hydrogen bonds: polar-polar, 2.4-3.5 A
    for a in L:
        if a["elem"] not in ("N", "O"):
            continue
        for b in R:
            if b["elem"] not in ("N", "O"):
                continue
            d = _d(a, b)
            if 2.4 <= d <= 3.5:
                key = (b["resn"], b["resi"], "H-bond")
                if key in seen:
                    continue
                seen.add(key)
                found.append({"residue": b["resn"] + b["resi"], "chain": b["chain"],
                              "type": "H-bond", "distance": round(d, 1)})

    # salt bridges: charged group heuristic, <= 4.0 A
    for a in L:
        for b in R:
            d = _d(a, b)
            if d > 4.0:
                continue
            sb = (a["elem"] == "O" and b["resn"] in BASIC and b["elem"] == "N") or \
                 (a["elem"] == "N" and b["resn"] in ACIDIC and b["elem"] == "O")
            if sb:
                key = (b["resn"], b["resi"], "Salt bridge")
                if key in seen:
                    continue
                seen.add(key)
                found.append({"residue": b["resn"] + b["resi"], "chain": b["chain"],
                              "type": "Salt bridge", "distance": round(d, 1)})

    # hydrophobic: closest C-C per residue, <= 4.0 A, excluding polar-contacted residues
    polar_res = {(r, i) for (r, i, t) in seen}
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
                if k not in best or d < best[k]:
                    best[k] = d
    for (resn, resi, chain), d in sorted(best.items(), key=lambda kv: kv[1]):
        if (resn, resi) in polar_res:
            continue
        found.append({"residue": resn + resi, "chain": chain,
                      "type": "Hydrophobic", "distance": round(d, 1)})

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
        elem = _elem(adtype, name)
        if elem == "H":
            continue
        lines.append("HETATM%5d %4s %3s L 999    %8s%8s%8s  1.00  0.00          %2s" %
                     (serial, name[:4], resname, x, y, z, elem.rjust(2)))
        serial += 1
    return "\n".join(lines)
