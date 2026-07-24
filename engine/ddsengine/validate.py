"""Re-docking validation: RMSD of a docked pose against the co-crystallised
(native) ligand, plus an overlay structure for 3D display.

This is only meaningful for cognate re-docking — i.e. when the receptor carries
a co-crystal ligand and the docked ligand is that same molecule. For a blind
dock of a novel ligand there is no experimental pose to validate against.
RMSD is symmetry-corrected and superposition-free (both structures share the
receptor coordinate frame); for covalent cases (parent docked vs reacted crystal
ligand) a maximum-common-substructure match is used.
"""
import math
from rdkit import Chem
from rdkit.Chem import AllChem, rdFMCS


def _mol_from_block(block, smiles):
    raw = Chem.MolFromPDBBlock(block, removeHs=True, sanitize=False)
    if raw is None:
        return None
    if smiles:
        tmpl = Chem.MolFromSmiles(smiles)
        if tmpl is not None:
            try:
                return Chem.RemoveHs(AllChem.AssignBondOrdersFromTemplate(tmpl, raw))
            except Exception:
                pass
    try:
        m = Chem.Mol(raw)
        Chem.SanitizeMol(m)
        return Chem.RemoveHs(m)
    except Exception:
        return raw


def _lig_block(complex_pdb, resn):
    return "\n".join(l for l in complex_pdb.splitlines()
                     if l.startswith(("ATOM", "HETATM")) and l[17:20].strip() == resn)


def _rmsd_over(ca, cb, mapping):
    s = 0.0
    for ia, ib in mapping:
        pa, pb = ca.GetAtomPosition(ia), cb.GetAtomPosition(ib)
        s += (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2 + (pa.z - pb.z) ** 2
    return math.sqrt(s / len(mapping))


def _symmetry_rmsd(docked, native):
    """Exact same-molecule RMSD, minimised over symmetric atom mappings."""
    matches = docked.GetSubstructMatches(native, uniquify=False, maxMatches=10000)
    if not matches:
        return None, 0
    dc, nc = docked.GetConformer(), native.GetConformer()
    best = None
    for m in matches:
        r = _rmsd_over(dc, nc, [(m[i], i) for i in range(native.GetNumAtoms())])
        if best is None or r < best:
            best = r
    return best, native.GetNumAtoms()


def _mcs_rmsd(docked, native):
    """RMSD over the maximum common heavy-atom substructure (element match, any
    bond order) — robust to the parent→product warhead change in covalent cases."""
    res = rdFMCS.FindMCS([docked, native], atomCompare=rdFMCS.AtomCompare.CompareElements,
                         bondCompare=rdFMCS.BondCompare.CompareAny, ringMatchesRingOnly=True,
                         completeRingsOnly=False, timeout=20, matchValences=False)
    q = Chem.MolFromSmarts(res.smartsString) if res.numAtoms else None
    if q is None:
        return None, 0
    nm = native.GetSubstructMatch(q)
    dms = docked.GetSubstructMatches(q, uniquify=False, maxMatches=5000)
    if not nm or not dms:
        return None, res.numAtoms
    dc, nc = docked.GetConformer(), native.GetConformer()
    best = None
    for dm in dms:
        r = _rmsd_over(dc, nc, [(dm[k], nm[k]) for k in range(len(nm))])
        if best is None or r < best:
            best = r
    return best, res.numAtoms


def _overlay(complex_pdb, native_pdb):
    """protein + docked ligand (resn LIG) + native ligand renamed to resn NAT."""
    nat = []
    for l in native_pdb.splitlines():
        if l.startswith(("ATOM", "HETATM")):
            l2 = "HETATM" + l[6:]
            nat.append(l2[:17] + "NAT" + l2[20:])
    body = complex_pdb.replace("END\n", "").rstrip()
    return body + "\n" + "\n".join(nat) + "\nEND\n"


def build_native(native_pdb, native_smiles):
    """Build the reference (co-crystal) ligand mol once, for reuse across poses."""
    return _mol_from_block(native_pdb, native_smiles)


def pose_rmsd(native, complex_pdb, docked_smiles, lig_resn="LIG"):
    """RMSD (Å) of one docked pose vs the pre-built native mol, or None if the
    docked ligand does not match the co-crystal ligand (i.e. not cognate)."""
    if native is None:
        return None
    docked = _mol_from_block(_lig_block(complex_pdb, lig_resn), docked_smiles)
    if docked is None:
        return None
    n = native.GetNumAtoms()
    r, matched = _symmetry_rmsd(docked, native)
    if r is None:
        r, matched = _mcs_rmsd(docked, native)
    if r is None or matched < max(4, int(0.4 * n)):
        return None
    return round(r, 2)


def validate(native_pdb, native_smiles, complex_pdb, docked_smiles, lig_resn="LIG"):
    native = _mol_from_block(native_pdb, native_smiles)
    docked = _mol_from_block(_lig_block(complex_pdb, lig_resn), docked_smiles or native_smiles)
    if native is None or docked is None:
        raise ValueError("could not build the reference and/or docked ligand for comparison")
    n_native = native.GetNumAtoms()

    rmsd, matched = _symmetry_rmsd(docked, native)
    method = "exact"
    if rmsd is None:
        rmsd, matched = _mcs_rmsd(docked, native)
        method = "common-substructure"
    if rmsd is None or matched < max(4, int(0.4 * n_native)):
        raise ValueError("the docked ligand does not match the co-crystallised ligand — "
                         "validation requires re-docking the co-crystal ligand")

    return {
        "rmsd": round(rmsd, 2),
        "matched_atoms": int(matched),
        "n_atoms": int(n_native),
        "method": method,
        "overlay_pdb": _overlay(complex_pdb, native_pdb),
    }
