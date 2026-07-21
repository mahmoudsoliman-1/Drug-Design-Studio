"""Simple geometry cleanup / energy minimization of a docked complex using
Open Babel force fields (UFF / MMFF94). Atom typing is automatic — no user
input on atom types. This is a light geometric relaxation to relieve clashes,
NOT a rigorous biomolecular minimization (use the MD-ready export for that)."""
from openbabel import openbabel as ob
from openbabel import pybel

LIG_RES = "LIG"


def minimize_complex(complex_pdb, mode="pocket", forcefield="uff", steps=500, pocket_radius=6.0):
    """mode: 'ligand' (only the ligand moves), 'pocket' (ligand + residues within
    pocket_radius Å), or 'complex' (everything moves). Returns the minimized PDB."""
    mol = pybel.readstring("pdb", complex_pdb)
    obmol = mol.OBMol
    obmol.AddHydrogens()

    # ligand atoms + their coordinates
    lig_ids, lig_xyz = set(), []
    for atom in ob.OBMolAtomIter(obmol):
        res = atom.GetResidue()
        if res and res.GetName().strip() == LIG_RES:
            lig_ids.add(atom.GetIdx())
            lig_xyz.append((atom.GetX(), atom.GetY(), atom.GetZ()))

    if not lig_xyz:
        mode = "complex"  # nothing to key a pocket on

    free = set(lig_ids)
    if mode == "pocket":
        r2 = pocket_radius * pocket_radius
        pocket_res = set()
        for atom in ob.OBMolAtomIter(obmol):
            res = atom.GetResidue()
            if not res or res.GetName().strip() == LIG_RES:
                continue
            x, y, z = atom.GetX(), atom.GetY(), atom.GetZ()
            if any((x - lx) ** 2 + (y - ly) ** 2 + (z - lz) ** 2 <= r2 for lx, ly, lz in lig_xyz):
                pocket_res.add((res.GetChainNum(), res.GetNum()))
        for atom in ob.OBMolAtomIter(obmol):
            res = atom.GetResidue()
            if res and (res.GetChainNum(), res.GetNum()) in pocket_res:
                free.add(atom.GetIdx())

    ff = ob.OBForceField.FindForceField(forcefield)
    if ff is None:
        raise RuntimeError("force field '%s' not available" % forcefield)

    constraints = ob.OBFFConstraints()
    if mode != "complex":
        for atom in ob.OBMolAtomIter(obmol):
            if atom.GetIdx() not in free:
                constraints.AddAtomConstraint(atom.GetIdx())  # freeze (1-based idx)

    if not ff.Setup(obmol, constraints):
        # fall back to MMFF94 if UFF setup fails, else unconstrained
        ff = ob.OBForceField.FindForceField("mmff94")
        if ff is None or not ff.Setup(obmol, constraints):
            raise RuntimeError("force field setup failed")

    e0 = ff.Energy()
    ff.ConjugateGradients(int(steps))
    ff.GetCoordinates(obmol)
    e1 = ff.Energy()

    return {
        "pdb": mol.write("pdb"),
        "energy_before": round(e0, 1),
        "energy_after": round(e1, 1),
        "n_free_atoms": len(free) if mode != "complex" else obmol.NumAtoms(),
        "mode": mode,
        "forcefield": forcefield,
        "steps": int(steps),
    }
