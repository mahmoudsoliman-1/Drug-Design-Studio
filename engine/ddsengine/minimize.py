"""Simple geometry cleanup / energy minimization of a docked complex using
Open Babel force fields (UFF / MMFF94). Atom typing is automatic — no user
input on atom types. This is a light geometric relaxation to relieve clashes,
NOT a rigorous biomolecular minimization (use the MD-ready export for that)."""
from openbabel import openbabel as ob
from openbabel import pybel

LIG_RES = "LIG"


def _write_back_clean(original_pdb, obmol):
    """Return a clean PDB: the ORIGINAL file with only the x/y/z columns replaced
    by the minimized coordinates. Open Babel keeps the input (heavy) atoms as the
    first N atoms in file order, so they map 1:1 onto the original ATOM/HETATM
    lines. This preserves atom names, residues, chains, occupancies and B-factors,
    and drops Open Babel's cruft (COMPND/AUTHOR header, the thousands of CONECT
    records, MASTER) and the hydrogens added only for the force-field run — giving
    output identical in format to the clean exported structure."""
    atoms = list(ob.OBMolAtomIter(obmol))
    out, ai = [], 0
    for line in original_pdb.splitlines():
        rec = line[:6]
        if rec in ("ATOM  ", "HETATM"):
            if ai < len(atoms):
                a = atoms[ai]
                line = line[:30] + ("%8.3f%8.3f%8.3f" % (a.GetX(), a.GetY(), a.GetZ())) + line[54:]
                ai += 1
            out.append(line)
        elif rec in ("CONECT", "MASTER"):
            continue  # drop connectivity/bookkeeping noise
        else:
            out.append(line)  # keep HEADER/TITLE/CRYST1/TER/END and other metadata
    if not any(l.startswith("END") for l in out):
        out.append("END")
    return "\n".join(out) + "\n"


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
        "pdb": _write_back_clean(complex_pdb, obmol),
        "energy_before": round(e0, 1),
        "energy_after": round(e1, 1),
        "n_free_atoms": len(free) if mode != "complex" else obmol.NumAtoms(),
        "mode": mode,
        "forcefield": forcefield,
        "steps": int(steps),
    }
