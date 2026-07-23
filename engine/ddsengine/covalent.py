"""Geometry-guided covalent docking.

DDS keeps covalent docking deliberately simple and robust: it does a normal
AutoDock Vina run, then scores each pose by how well the ligand's electrophilic
warhead reaches the target residue's nucleophilic atom. No new heavy dependencies
— just RDKit SMARTS (warhead perception) and plain distance geometry.

Public API
----------
find_nucleophiles(protein_pdb, center, size)   -> [ {key, residue, atom, x,y,z, ...} ]
resolve_nucleophile(protein_pdb, key)          -> one nucleophile dict, or None
warhead_catalog()                              -> [ {name, label} ]  (for the override menu)
detect_warhead(mol, override=None)             -> {name, label, reactive_atoms} | None
score_pose(pose_pdbqt, nucleophile, override, max_dist) -> covalent info dict | None
combined_score(affinity, covalent)             -> float  (lower = better; used to rank)
"""
import math
from rdkit import Chem

# --------------------------------------------------------------------------- #
#  Nucleophilic residues  (residue name -> reactive side-chain atom names)     #
#  Order matters: the first atom present is used as the reactive atom.         #
# --------------------------------------------------------------------------- #
NUCLEOPHILES = {
    "CYS": ["SG"],          # cysteine thiol — by far the most common covalent target
    "SER": ["OG"],          # serine hydroxyl (e.g. serine hydrolases)
    "THR": ["OG1"],         # threonine hydroxyl
    "LYS": ["NZ"],          # lysine ε-amine
    "TYR": ["OH"],          # tyrosine phenol
    "HIS": ["NE2", "ND1"],  # histidine imidazole nitrogens
}
_ATOM_LABEL = {"SG": "Sγ", "OG": "Oγ", "OG1": "Oγ1", "NZ": "Nζ",
               "OH": "Oη", "NE2": "Nε2", "ND1": "Nδ1"}

# --------------------------------------------------------------------------- #
#  Electrophilic warheads.  (name, label, SMARTS, reactive-atom index in match) #
#  The reactive atom is the electrophilic atom that forms the covalent bond to  #
#  the nucleophile.  Specific patterns come before generic ones so the nicest   #
#  label wins.                                                                   #
# --------------------------------------------------------------------------- #
_WARHEADS = [
    ("acrylamide",      "Acrylamide (Michael acceptor)", "[CH2]=[CH][CX3](=[OX1])[NX3]", 0),
    ("michael",         "Michael acceptor",              "[CX3]=[CX3][CX3]=[OX1]",       0),
    ("vinyl_sulfone",   "Vinyl sulfone",                 "[CH2]=[CH][SX4](=[OX1])=[OX1]", 0),
    ("haloacetamide",   "Haloacetamide",                 "[F,Cl,Br,I][CH2][CX3]=[OX1]",  1),
    ("sulfonyl_fluoride", "Sulfonyl fluoride (SuFEx)",   "[SX4](=[OX1])(=[OX1])[F]",     0),
    ("epoxide",         "Epoxide",                       "[CX4]1[OX2][CX4]1",            0),
    ("nitrile",         "Nitrile",                       "[CX2]#[NX1]",                  0),
    ("boronic",         "Boronic acid/ester",            "[BX3]([OX2])[OX2]",            0),
    ("aldehyde",        "Aldehyde",                      "[CX3H1]=[OX1]",                0),
]

# how far beyond the acceptance cutoff a pose can drift before it's rejected;
# and the per-Angstrom penalty applied to the ranking score past the cutoff.
_PENALTY_PER_A = 0.5
_NO_REACH_PENALTY = 5.0   # pose whose warhead doesn't reach the nucleophile at all


def _dist(ax, ay, az, bx, by, bz):
    return math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2)


# --------------------------------------------------------------------------- #
#  Nucleophile detection (on the original-atom-name protein PDB)               #
# --------------------------------------------------------------------------- #
def find_nucleophiles(protein_pdb, center=None, size=None, limit=60):
    """Scan the receptor for nucleophilic residues and return their reactive-atom
    positions. If center+size are given, keep only residues whose reactive atom
    sits inside the search box, sorted by distance to the box centre."""
    res_atoms = {}   # (chain, resi, resn) -> {atom_name: (x, y, z)}
    for l in protein_pdb.splitlines():
        if not l.startswith("ATOM"):
            continue
        resn = l[17:20].strip()
        if resn not in NUCLEOPHILES:
            continue
        atom = l[12:16].strip()
        if atom not in NUCLEOPHILES[resn]:
            continue
        try:
            x, y, z = float(l[30:38]), float(l[38:46]), float(l[46:54])
        except ValueError:
            continue
        key = ((l[21].strip() or "A"), l[22:26].strip(), resn)
        res_atoms.setdefault(key, {})[atom] = (x, y, z)

    out = []
    for (chain, resi, resn), atoms in res_atoms.items():
        aname = next((a for a in NUCLEOPHILES[resn] if a in atoms), None)
        if aname is None:
            continue
        x, y, z = atoms[aname]
        item = {
            "key": "%s:%s:%s" % (chain, resn, resi),
            "residue": "%s%s" % (resn, resi),
            "resn": resn, "resi": resi, "chain": chain,
            "atom": aname, "atom_label": _ATOM_LABEL.get(aname, aname),
            "x": round(x, 3), "y": round(y, 3), "z": round(z, 3),
        }
        if center:
            item["dist_to_center"] = round(
                _dist(x, y, z, center["x"], center["y"], center["z"]), 2)
        out.append(item)

    if center and size:
        half = {k: float(size[k]) / 2.0 for k in "xyz"}
        out = [n for n in out
               if abs(n["x"] - center["x"]) <= half["x"]
               and abs(n["y"] - center["y"]) <= half["y"]
               and abs(n["z"] - center["z"]) <= half["z"]]
    if center:
        out.sort(key=lambda n: n.get("dist_to_center", 1e9))
    return out[:limit]


def resolve_nucleophile(protein_pdb, key):
    """Return the nucleophile dict for a 'chain:resn:resi' key, or None."""
    for n in find_nucleophiles(protein_pdb):
        if n["key"] == key:
            return n
    return None


# --------------------------------------------------------------------------- #
#  Warhead detection (on an RDKit mol)                                         #
# --------------------------------------------------------------------------- #
def warhead_catalog():
    return [{"name": n, "label": lbl} for (n, lbl, _s, _i) in _WARHEADS]


def _match_warhead(mol, name, label, smarts, ridx):
    patt = Chem.MolFromSmarts(smarts)
    if patt is None:
        return None
    matches = mol.GetSubstructMatches(patt)
    if not matches:
        return None
    reactive = sorted({m[ridx] for m in matches if ridx < len(m)})
    if not reactive:
        return None
    return {"name": name, "label": label, "reactive_atoms": reactive}


def detect_warhead(mol, override=None):
    """Return {name, label, reactive_atoms} for the ligand's electrophilic
    warhead. If `override` names a catalog warhead and it matches, use that;
    otherwise fall back to auto-detection (first matching pattern wins)."""
    if mol is None:
        return None
    m = Chem.Mol(mol)
    if override and override not in ("auto", ""):
        for (n, lbl, s, i) in _WARHEADS:
            if n == override:
                hit = _match_warhead(m, n, lbl, s, i)
                if hit:
                    return hit
                break  # named warhead not present — fall through to auto
    for (n, lbl, s, i) in _WARHEADS:
        hit = _match_warhead(m, n, lbl, s, i)
        if hit:
            return hit
    return None


# --------------------------------------------------------------------------- #
#  Per-pose scoring                                                            #
# --------------------------------------------------------------------------- #
def _pose_min_distance(pose_mol, reactive_atoms, nucleophile):
    """Returns (min_distance, [x,y,z] of the closest reactive atom, its atom index)."""
    conf = pose_mol.GetConformer()
    nx, ny, nz = nucleophile["x"], nucleophile["y"], nucleophile["z"]
    n_atoms = pose_mol.GetNumAtoms()
    best, best_pt, best_idx = None, None, None
    for idx in reactive_atoms:
        if idx >= n_atoms:
            continue
        p = conf.GetAtomPosition(idx)
        d = _dist(p.x, p.y, p.z, nx, ny, nz)
        if best is None or d < best:
            best, best_pt, best_idx = d, [round(p.x, 3), round(p.y, 3), round(p.z, 3)], idx
    return best, best_pt, best_idx


def score_pose(pose_pdbqt, nucleophile, override=None, max_dist=3.5):
    """Covalent geometry for one docked pose. Returns a dict with the warhead
    label, the warhead↔nucleophile distance, whether it's within bonding reach,
    the ranking penalty, and the 3D coordinates of both atoms (so the viewer can
    draw the bond). Returns None if the pose can't be rebuilt."""
    from . import analysis  # local import avoids a heavy import at module load
    try:
        mol = Chem.RemoveHs(analysis.pose_to_rdkit(pose_pdbqt))
    except Exception:
        return None
    wh = detect_warhead(mol, override)
    base = {
        "residue": nucleophile["residue"], "chain": nucleophile["chain"],
        "atom": nucleophile["atom"], "atom_label": nucleophile["atom_label"],
        "nuc_resi": nucleophile["resi"], "nuc_resn": nucleophile["resn"],
        "nuc_xyz": [nucleophile["x"], nucleophile["y"], nucleophile["z"]],
        "nuc_elem": (nucleophile["atom"][0] if nucleophile.get("atom") else "S"),
    }
    if not wh:
        return {**base, "warhead": None, "distance": None,
                "compatible": False, "penalty": _NO_REACH_PENALTY}
    d, wpt, widx = _pose_min_distance(mol, wh["reactive_atoms"], nucleophile)
    if d is None:
        return {**base, "warhead": wh["label"], "warhead_name": wh["name"],
                "distance": None, "compatible": False, "penalty": _NO_REACH_PENALTY}
    try:
        warhead_elem = mol.GetAtomWithIdx(widx).GetSymbol()
    except Exception:
        warhead_elem = "C"
    return {
        **base, "warhead": wh["label"], "warhead_name": wh["name"],
        "distance": round(d, 2), "compatible": d <= max_dist,
        "penalty": round(_PENALTY_PER_A * max(0.0, d - max_dist), 2),
        "warhead_xyz": wpt, "warhead_elem": warhead_elem, "warhead_atom": widx,
        "mode": "geometry",
    }


def combined_score(affinity, covalent):
    """Ranking key (lower is better): affinity plus the covalent geometry
    penalty, so poses whose warhead reaches the nucleophile rise to the top."""
    pen = _NO_REACH_PENALTY
    if covalent and covalent.get("penalty") is not None:
        pen = covalent["penalty"]
    return (affinity if affinity is not None else 0.0) + pen


# --------------------------------------------------------------------------- #
#  Tethered (bond-restrained) refinement                                       #
#  Pull the warhead atom to true covalent bonding distance of the (fixed)      #
#  nucleophile atom and relax the ligand on a force field. Reuses Open Babel's #
#  distance-restraint support — the rigorous "enforced bond" mode.             #
# --------------------------------------------------------------------------- #
# ideal covalent bond lengths (Å) by (warhead reactive element, nucleophile element)
_BOND_LEN = {
    ("C", "S"): 1.81, ("C", "O"): 1.43, ("C", "N"): 1.47, ("C", "C"): 1.54,
    ("B", "O"): 1.37, ("B", "N"): 1.58, ("S", "O"): 1.60, ("S", "N"): 1.68,
}


def _target_bond_length(warhead_elem, nuc_elem):
    return _BOND_LEN.get((warhead_elem, nuc_elem), 1.8)


def tether_complex(complex_pdb, warhead_xyz, nuc_xyz, warhead_elem="C", nuc_elem="S",
                   forcefield="uff", steps=600):
    """Distance-restrained refinement of a docked complex. The receptor is held
    rigid; a harmonic restraint pulls the ligand's warhead atom to the ideal
    covalent bond length of the nucleophile, and the ligand is minimised. Returns
    {pdb, distance (achieved), target, moved (warhead displacement), warhead_xyz}."""
    import math
    from openbabel import openbabel as ob
    from openbabel import pybel

    mol = pybel.readstring("pdb", complex_pdb)
    obmol = mol.OBMol
    obmol.AddHydrogens()

    def _nearest(target, want_lig):
        best_idx, best_d = None, None
        for atom in ob.OBMolAtomIter(obmol):
            res = atom.GetResidue()
            is_lig = bool(res and res.GetName().strip() == "LIG")
            if is_lig != want_lig:
                continue
            d = ((atom.GetX() - target[0]) ** 2 + (atom.GetY() - target[1]) ** 2
                 + (atom.GetZ() - target[2]) ** 2)
            if best_d is None or d < best_d:
                best_d, best_idx = d, atom.GetIdx()
        return best_idx

    w_idx = _nearest(warhead_xyz, True)
    n_idx = _nearest(nuc_xyz, False)
    if w_idx is None or n_idx is None:
        raise RuntimeError("could not map warhead/nucleophile atoms for tethering")

    target_len = _target_bond_length(warhead_elem, nuc_elem)

    lig_ids = {atom.GetIdx() for atom in ob.OBMolAtomIter(obmol)
               if atom.GetResidue() and atom.GetResidue().GetName().strip() == "LIG"}

    constraints = ob.OBFFConstraints()
    for atom in ob.OBMolAtomIter(obmol):        # freeze the receptor (rigid)
        if atom.GetIdx() not in lig_ids:
            constraints.AddAtomConstraint(atom.GetIdx())
    constraints.AddDistanceConstraint(w_idx, n_idx, target_len)  # harmonic bond restraint

    ff = ob.OBForceField.FindForceField(forcefield)
    if ff is None or not ff.Setup(obmol, constraints):
        ff = ob.OBForceField.FindForceField("mmff94")
        if ff is None or not ff.Setup(obmol, constraints):
            raise RuntimeError("force field setup failed for tethering")
    ff.ConjugateGradients(int(steps))
    ff.GetCoordinates(obmol)

    wa, na = obmol.GetAtom(w_idx), obmol.GetAtom(n_idx)
    achieved = math.sqrt((wa.GetX() - na.GetX()) ** 2 + (wa.GetY() - na.GetY()) ** 2
                         + (wa.GetZ() - na.GetZ()) ** 2)
    new_w = [round(wa.GetX(), 3), round(wa.GetY(), 3), round(wa.GetZ(), 3)]
    moved = math.sqrt(sum((new_w[i] - warhead_xyz[i]) ** 2 for i in range(3)))
    return {
        "pdb": mol.write("pdb"),
        "distance": round(achieved, 2),
        "target": target_len,
        "moved": round(moved, 2),
        "warhead_xyz": new_w,
    }
