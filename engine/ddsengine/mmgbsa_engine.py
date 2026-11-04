#!/usr/bin/env python
"""ssMM/GBSA engine (runs in the separate OpenMM/AmberTools engine environment).

Computes a single-structure MM-GBSA binding free energy for a protein-ligand
complex, following the benchmarked protocol:

  protein  : Amber ff14SB
  ligand   : GAFF2 (bonded + van der Waals) with a selectable partial-charge model
             - 'mmff94'  : classical MMFF94 charges (fast, no QM)  [default]
             - 'am1bcc'  : semi-empirical AM1-BCC charges (higher cost)
  solvent  : GBn2 Generalised-Born implicit solvent (igb=8 equivalent), 0.15 M salt
  geometry : single implicit-solvent energy minimisation (no MD, no sampling)

Returns the minimised complex, the component decomposition
(van der Waals / electrostatic / solvation), the binding free energy, and an
optional rotatable-bond configurational-entropy penalty.

Invoked as a subprocess by ddsengine/mmgbsa.py:
    python mmgbsa_engine.py <complex_pdb> <ligand_smiles> <charges> <steps> <entropy_c> <out_json>
"""
import os, sys, json, subprocess, tempfile
import numpy as np

# Make the engine environment's AmberTools binaries (antechamber, tleap,
# pdb4amber, parmchk2) and AMBERHOME available to the subprocesses below,
# regardless of the PATH inherited from the caller.
_BIN = os.path.dirname(os.path.abspath(sys.executable))
os.environ["PATH"] = _BIN + os.pathsep + os.environ.get("PATH", "")
os.environ["AMBERHOME"] = os.path.dirname(_BIN)


def _run(cmd, cwd, log):
    with open(log, "w") as f:
        return subprocess.run(cmd, cwd=cwd, stdout=f, stderr=subprocess.STDOUT).returncode


def _have(wd, *n):
    return all(os.path.exists(os.path.join(wd, x)) for x in n)


AA = set("ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR "
         "TRP TYR VAL HID HIE HIP CYX CYM ASH GLH LYN".split())
E2A = 18.2223   # elementary charge -> Amber internal charge unit


def _prep(complex_pdb, smiles, wd):
    """Split a protein-ligand complex PDB into an Amber-ready receptor and a
    bond-order-correct ligand SDF."""
    from rdkit import Chem
    from rdkit.Chem import AllChem
    lines = complex_pdb.splitlines()

    def _real_atom(l):
        # exclude water/ions and meeko macrocycle "glue" pseudo-atoms (element/name 'G')
        if l[17:20].strip() in ("HOH", "WAT", "NA", "CL", "K", "MG", "ZN"):
            return False
        if l[76:78].strip().upper() == "G" or l[12:16].strip().upper() == "G":
            return False
        return True

    # ligand = HETATM records that are not water/ions (largest non-AA het group)
    het = [l for l in lines if l.startswith("HETATM") and _real_atom(l)]
    if not het:
        # some docked complexes label the ligand as ATOM with a non-AA resname
        het = [l for l in lines if l.startswith(("ATOM", "HETATM")) and l[17:20].strip() not in AA and _real_atom(l)]
    if not het:
        raise RuntimeError("no ligand found in complex (expected a non-protein residue)")
    # keep a single residue (chain+resseq of the first ligand atom)
    ch, ri = het[0][21], het[0][22:26]
    het = [l for l in het if l[21] == ch and l[22:26] == ri]

    pose = Chem.MolFromPDBBlock("\n".join(het) + "\nEND\n", removeHs=False, sanitize=False)
    if pose is None:
        raise RuntimeError("could not read ligand coordinates")
    templ = Chem.MolFromSmiles(smiles) if smiles else None
    if templ is not None:
        try:
            pose = AllChem.AssignBondOrdersFromTemplate(templ, pose)
        except Exception:
            pass  # fall back to perceived bonds
    m = Chem.AddHs(pose, addCoords=True)
    Chem.SDWriter(os.path.join(wd, "lig.sdf")).write(m)
    json.dump({"nc": Chem.GetFormalCharge(m)}, open(os.path.join(wd, "nc.json"), "w"))

    # receptor = protein ATOM records only -> pdbfixer -> pdb4amber (tleap adds H)
    prot = [l for l in lines if l.startswith(("ATOM", "TER")) and l[17:20].strip() in AA]
    open(os.path.join(wd, "protein.pdb"), "w").write("\n".join(prot) + "\nEND\n")
    from pdbfixer import PDBFixer
    from openmm.app import PDBFile
    fx = PDBFixer(filename=os.path.join(wd, "protein.pdb"))
    fx.findMissingResidues(); fx.missingResidues = {}
    fx.findNonstandardResidues(); fx.replaceNonstandardResidues(); fx.removeHeterogens(False)
    fx.findMissingAtoms(); fx.addMissingAtoms()
    with open(os.path.join(wd, "receptor_fixed.pdb"), "w") as f:
        PDBFile.writeFile(fx.topology, fx.positions, f)
    _run(["pdb4amber", "-i", "receptor_fixed.pdb", "-o", "receptor.pdb", "-y", "--dry"],
         wd, os.path.join(wd, "pdb4amber.log"))


def _param(wd, charges):
    """antechamber (GAFF2) + tleap (ff14SB + gaff2) -> com/rec/lig prmtop.
    charges='am1bcc' runs the semi-empirical charge step; otherwise a fast
    charge method is used and the ligand charges are overridden downstream."""
    nc = json.load(open(os.path.join(wd, "nc.json")))["nc"]
    cmethod = "bcc" if charges == "am1bcc" else "gas"   # 'gas' is fast; overridden by MMFF94 later
    if not _have(wd, "lig.mol2"):
        rc = _run(["antechamber", "-i", "lig.sdf", "-fi", "sdf", "-o", "lig.mol2", "-fo", "mol2",
                   "-c", cmethod, "-s", "2", "-at", "gaff2", "-nc", str(nc)], wd, os.path.join(wd, "antechamber.log"))
        if rc or not _have(wd, "lig.mol2"):
            raise RuntimeError("ligand parameterisation (antechamber) failed")
        _run(["parmchk2", "-i", "lig.mol2", "-f", "mol2", "-o", "lig.frcmod", "-s", "gaff2"],
             wd, os.path.join(wd, "parmchk2.log"))
    leap = ("source leaprc.protein.ff14SB\nsource leaprc.gaff2\nset default PBRadii mbondi3\n"
            "LIG = loadmol2 lig.mol2\nloadamberparams lig.frcmod\nREC = loadpdb receptor.pdb\n"
            "COM = combine { REC LIG }\nsaveamberparm LIG lig.prmtop lig.inpcrd\n"
            "saveamberparm REC rec.prmtop rec.inpcrd\nsaveamberparm COM com.prmtop com.inpcrd\nquit\n")
    open(os.path.join(wd, "tleap.in"), "w").write(leap)
    _run(["tleap", "-f", "tleap.in"], wd, os.path.join(wd, "tleap.log"))
    if not _have(wd, "com.prmtop"):
        raise RuntimeError("topology build (tleap) failed")


def _mmff_charges(wd):
    """MMFF94 partial charges for the ligand, in ligand-atom order (matches the
    prmtop MOL residue order). Returns None if MMFF typing fails."""
    from rdkit import Chem
    from rdkit.Chem import AllChem
    m = Chem.SDMolSupplier(os.path.join(wd, "lig.sdf"), removeHs=False)[0]
    mp = AllChem.MMFFGetMoleculeProperties(m)
    if mp is None:
        return None
    return [mp.GetMMFFPartialCharge(i) for i in range(m.GetNumAtoms())]


def _energy(struct, gb, CPU):
    from openmm import app, unit, LangevinIntegrator, Context
    system = struct.createSystem(nonbondedMethod=app.NoCutoff,
                                 implicitSolvent=(app.GBn2 if gb else None))
    ig = LangevinIntegrator(300, 1, 0.002)
    c = Context(system, ig, CPU)
    c.setPositions(struct.positions)
    e = c.getState(getEnergy=True).getPotentialEnergy().value_in_unit(unit.kilocalorie_per_mole)
    del c, ig
    return e


def compute(complex_pdb, smiles, charges="mmff94", steps=500, entropy_c=0.0):
    import parmed as pmd
    from openmm import app, unit, LangevinMiddleIntegrator, Platform
    from rdkit import Chem
    from rdkit.Chem import Lipinski

    wd = tempfile.mkdtemp(prefix="ssmmgbsa_")
    _prep(complex_pdb, smiles, wd)
    _param(wd, charges)
    CPU = Platform.getPlatformByName("CPU")

    # --- minimise the complex in GBn2 implicit solvent (no MD) ---
    prm = app.AmberPrmtopFile(os.path.join(wd, "com.prmtop"))
    crd = app.AmberInpcrdFile(os.path.join(wd, "com.inpcrd"))
    system = prm.createSystem(implicitSolvent=app.GBn2, nonbondedMethod=app.NoCutoff, constraints=app.HBonds)
    integ = LangevinMiddleIntegrator(300 * unit.kelvin, 1 / unit.picosecond, 0.002 * unit.picoseconds)
    sim = app.Simulation(prm.topology, system, integ, CPU)
    sim.context.setPositions(crd.positions)

    # Convergence-based minimisation. The number of steps needed to relax a
    # complex is system-dependent, so rather than impose a single fixed cut we
    # minimise in chunks and stop once the potential energy stops changing
    # (|ΔE| below a tolerance between successive chunks). `steps` acts only as a
    # safety ceiling so a pathological case cannot run unbounded.
    def _pe():
        return sim.context.getState(getEnergy=True).getPotentialEnergy().value_in_unit(unit.kilocalorie_per_mole)
    ceiling = max(200, int(steps) if steps else 1000)
    CHUNK, ETOL = 100, 0.5      # kcal/mol convergence tolerance on the total energy
    done, prev, converged = 0, None, False
    while done < ceiling:
        sim.minimizeEnergy(tolerance=10 * unit.kilojoule_per_mole / unit.nanometer, maxIterations=CHUNK)
        done += CHUNK
        e = _pe()
        if prev is not None and abs(e - prev) < ETOL:
            converged = True
            break
        prev = e
    minpos = sim.context.getState(getPositions=True).getPositions(asNumpy=True).value_in_unit(unit.angstrom)

    # --- load into ParmEd, apply the chosen charge model, decompose ---
    parm = pmd.load_file(os.path.join(wd, "com.prmtop"))
    parm.coordinates = minpos
    lig_idx = [i for i, a in enumerate(parm.atoms) if a.residue.name == "MOL"]
    used_charges = charges
    if charges != "am1bcc":
        q = _mmff_charges(wd)
        if q and len(q) == len(lig_idx):
            for k, i in enumerate(lig_idx):
                parm.parm_data['CHARGE'][i] = q[k] * E2A
                parm.atoms[i].charge = q[k]
            used_charges = "mmff94"
        else:
            used_charges = "gasteiger-fallback"

    def d(fn):
        return fn(parm) - fn(parm['!:MOL']) - fn(parm[':MOL'])
    E_MM = d(lambda s: _energy(s, False, CPU))
    E_GB = d(lambda s: _energy(s, True, CPU))
    # van der Waals via zeroed charges (Lennard-Jones only)
    pz = pmd.load_file(os.path.join(wd, "com.prmtop")); pz.coordinates = minpos
    for i in range(len(pz.atoms)):
        pz.parm_data['CHARGE'][i] = 0.0; pz.atoms[i].charge = 0.0
    vdw = _energy(pz, False, CPU) - _energy(pz['!:MOL'], False, CPU) - _energy(pz[':MOL'], False, CPU)
    eel = E_MM - vdw
    solv = E_GB - E_MM
    dG = E_GB

    # rotatable-bond configurational-entropy penalty (optional)
    lig_mol = Chem.SDMolSupplier(os.path.join(wd, "lig.sdf"), removeHs=False)[0]
    nrot = Lipinski.NumRotatableBonds(lig_mol) if lig_mol else None
    ts = (float(entropy_c) * nrot) if (entropy_c and nrot is not None) else 0.0

    # --- minimised complex PDB for the viewer (ligand residue renamed MOL->LIG) ---
    for r in parm.residues:
        if r.name == "MOL":
            r.name = "LIG"
    minpdb = os.path.join(wd, "complex_min.pdb")
    parm.save(minpdb, format="pdb", overwrite=True)
    min_pdb_text = open(minpdb).read()

    return {
        "pdb": min_pdb_text,
        "vdw": round(vdw, 2),
        "electrostatic": round(eel, 2),
        "solvation": round(solv, 2),
        "dG_bind": round(dG, 2),
        "n_rot": nrot,
        "entropy_penalty": round(ts, 2),
        "dG_corrected": round(dG + ts, 2),
        "charges": used_charges,
        "solvent_model": "GBn2",
        "protein_ff": "ff14SB",
        "ligand_ff": "GAFF2",
        "min_steps": done,
        "min_converged": bool(converged),
        "workdir": wd,
    }


if __name__ == "__main__":
    cpdb = open(sys.argv[1]).read()
    smiles = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "-" else None
    charges = sys.argv[3] if len(sys.argv) > 3 else "mmff94"
    steps = int(sys.argv[4]) if len(sys.argv) > 4 else 500
    entropy_c = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
    out = sys.argv[6] if len(sys.argv) > 6 else None
    try:
        res = compute(cpdb, smiles, charges=charges, steps=steps, entropy_c=entropy_c)
    except Exception as e:
        res = {"error": str(e)}
    txt = json.dumps(res)
    if out:
        open(out, "w").write(txt)
    else:
        print(txt)
