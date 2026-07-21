"""Rebuild the docked ligand as an RDKit molecule (via Meeko), produce a real
2D depiction, and detect protein-ligand interactions with exact ligand-atom
indices so the 2D diagram can connect each contact to the right atom."""
import math
from rdkit import Chem
from rdkit.Chem import AllChem
from meeko import PDBQTMolecule, RDKitMolCreate

from .interactions import _atoms as parse_pdbqt_atoms

ACIDIC = {"ASP", "GLU"}
BASIC = {"ARG", "LYS", "HIS"}


def pose_to_rdkit(pose_pdbqt):
    wrapped = "MODEL 1\n" + pose_pdbqt + ("" if pose_pdbqt.endswith("\n") else "\n") + "ENDMDL\n"
    pmol = PDBQTMolecule(wrapped, is_dlg=False, skip_typing=True)
    mols = RDKitMolCreate.from_pdbqt_mol(pmol)
    if not mols or mols[0] is None:
        raise RuntimeError("could not rebuild ligand from pose")
    return mols[0]


def _label(atom):
    el = atom.GetSymbol()
    if el == "C":
        return None
    n = atom.GetTotalNumHs()
    if el in ("N", "O", "S"):
        return el + ("H" + (str(n) if n > 1 else "") if n > 0 else "")
    return el  # halogens, P, etc.


def _depiction(mol):
    """2D atoms/bonds/aromatic-rings for a heavy-atom RDKit mol."""
    mol2d = Chem.Mol(mol)
    AllChem.Compute2DCoords(mol2d)
    conf = mol2d.GetConformer()
    atoms = []
    for a in mol.GetAtoms():
        p = conf.GetAtomPosition(a.GetIdx())
        atoms.append({
            "i": a.GetIdx(), "el": a.GetSymbol(),
            "x": round(p.x, 3), "y": round(p.y, 3),
            "arom": a.GetIsAromatic(), "charge": a.GetFormalCharge(),
            "label": _label(a),
        })
    bonds = []
    for b in mol.GetBonds():
        bt = b.GetBondType()
        order = 2 if bt == Chem.BondType.DOUBLE else (3 if bt == Chem.BondType.TRIPLE else 1)
        bonds.append({"a": b.GetBeginAtomIdx(), "b": b.GetEndAtomIdx(),
                      "order": order, "arom": b.GetIsAromatic()})
    rings = []
    for ring in mol.GetRingInfo().AtomRings():
        if all(mol.GetAtomWithIdx(i).GetIsAromatic() for i in ring):
            rings.append(list(ring))
    return {"atoms": atoms, "bonds": bonds, "rings": rings}


def _d(a, b):
    return math.sqrt((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2 + (a["z"] - b["z"]) ** 2)


def _detect(lig, R, max_items=14):
    found, seen = [], set()

    for a in lig:  # H-bonds
        if a["el"] not in ("N", "O"):
            continue
        for b in R:
            if b["elem"] not in ("N", "O"):
                continue
            d = _d({"x": a["x"], "y": a["y"], "z": a["z"]}, b)
            if 2.4 <= d <= 3.5:
                key = (b["resn"], b["resi"], "H-bond")
                if key in seen:
                    continue
                seen.add(key)
                found.append({"residue": b["resn"] + b["resi"], "chain": b["chain"],
                              "type": "H-bond", "distance": round(d, 1), "lig_atom": a["i"]})

    for a in lig:  # salt bridges
        for b in R:
            d = _d({"x": a["x"], "y": a["y"], "z": a["z"]}, b)
            if d > 4.0:
                continue
            sb = (a["el"] == "O" and b["resn"] in BASIC and b["elem"] == "N") or \
                 (a["el"] == "N" and b["resn"] in ACIDIC and b["elem"] == "O")
            if sb:
                key = (b["resn"], b["resi"], "Salt bridge")
                if key in seen:
                    continue
                seen.add(key)
                found.append({"residue": b["resn"] + b["resi"], "chain": b["chain"],
                              "type": "Salt bridge", "distance": round(d, 1), "lig_atom": a["i"]})

    polar_res = {(r, i) for (r, i, t) in seen}
    best = {}
    for a in lig:  # hydrophobic
        if a["el"] != "C":
            continue
        for b in R:
            if b["elem"] != "C":
                continue
            d = _d({"x": a["x"], "y": a["y"], "z": a["z"]}, b)
            if d <= 4.0:
                k = (b["resn"], b["resi"], b["chain"])
                if k not in best or d < best[k][0]:
                    best[k] = (d, a["i"])
    for (resn, resi, chain), (d, ai) in sorted(best.items(), key=lambda kv: kv[1][0]):
        if (resn, resi) in polar_res:
            continue
        found.append({"residue": resn + resi, "chain": chain, "type": "Hydrophobic",
                      "distance": round(d, 1), "lig_atom": ai})

    order = {"H-bond": 0, "Salt bridge": 1, "π-stacking": 2, "Hydrophobic": 3}
    found.sort(key=lambda x: (order.get(x["type"], 9), x["distance"]))
    return found[:max_items]


def analyze(receptor_pdbqt, pose_pdbqt):
    """Returns (ligand_2d, interactions) with exact ligand-atom indices."""
    mol = Chem.RemoveHs(pose_to_rdkit(pose_pdbqt))
    conf = mol.GetConformer()
    lig = []
    for a in mol.GetAtoms():
        p = conf.GetAtomPosition(a.GetIdx())
        lig.append({"i": a.GetIdx(), "el": a.GetSymbol(), "x": p.x, "y": p.y, "z": p.z})
    R = [a for a in parse_pdbqt_atoms(receptor_pdbqt) if a["elem"] != "H"]
    inter = _detect(lig, R)
    return _depiction(mol), inter
