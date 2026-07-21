"""Receptor and ligand preparation for AutoDock Vina."""
from rdkit import Chem
from rdkit.Chem import AllChem, Descriptors, QED, Crippen, Lipinski, rdMolDescriptors
from openbabel import pybel

from meeko import MoleculePreparation, PDBQTWriterLegacy

_WATER = {"HOH", "WAT", "DOD", "H2O"}
_IONS = {"NA", "CL", "K", "MG", "CA", "ZN", "MN", "FE", "CU", "CO", "NI",
         "CD", "BR", "IOD", "SO4", "PO4"}
# heteroatoms never treated as the bound ligand (waters, ions, buffers, cryo-agents)
_SKIP_HET = _WATER | _IONS | {"GOL", "EDO", "ACT", "DMS", "PEG", "MPD", "FMT", "TRS"}


def ligand_props(mol):
    return {
        "mw": round(Descriptors.MolWt(mol), 1),
        "logp": round(Crippen.MolLogP(mol), 2),
        "hbd": Lipinski.NumHDonors(mol),
        "hba": Lipinski.NumHAcceptors(mol),
        "qed": round(QED.qed(mol), 2),
        "tpsa": round(Descriptors.TPSA(mol), 1),
        "rotatable": Lipinski.NumRotatableBonds(mol),
        "formula": rdMolDescriptors.CalcMolFormula(mol),
    }


def lipinski_pass(p):
    v = 0
    v += p["mw"] > 500
    v += p["logp"] > 5
    v += p["hbd"] > 5
    v += p["hba"] > 10
    return v <= 1


def _read_ligand_any(smiles=None, molblock=None, text=None, fmt=None):
    """Parse a ligand from SMILES, a MOL block, or a structure file
    (PDB/SDF/MOL2/MOL) via Open Babel. Returns an RDKit Mol (no explicit Hs)."""
    if smiles:
        return Chem.MolFromSmiles(smiles)
    if molblock:
        return Chem.MolFromMolBlock(molblock, sanitize=True)
    if text and fmt:
        fmt = fmt.lower().lstrip(".")
        if fmt in ("mol", "sdf"):
            m = Chem.MolFromMolBlock(text, sanitize=True)
            if m is not None:
                return m
        try:
            ob = pybel.readstring(fmt, text)
            return Chem.MolFromMolBlock(ob.write("mol"), sanitize=True)
        except Exception:
            return None
    return None


def _protonate(mol, ph=7.4):
    """Assign protonation state at the given pH (Open Babel pKa model) and
    return an RDKit Mol with explicit hydrogens."""
    try:
        smi = Chem.MolToSmiles(Chem.RemoveHs(mol))
        ob = pybel.readstring("smi", smi)
        ob.OBMol.AddHydrogens(False, True, ph)  # correctForPH
        rd = Chem.MolFromMolBlock(ob.write("mol"), removeHs=False, sanitize=True)
        if rd is not None and rd.GetNumAtoms() > 0:
            return rd
    except Exception:
        pass
    return Chem.AddHs(mol)


def prepare_ligand(smiles=None, molblock=None, text=None, fmt=None, ph=7.4, protonate=True, seed=0xF00D):
    mol = _read_ligand_any(smiles=smiles, molblock=molblock, text=text, fmt=fmt)
    if mol is None:
        raise ValueError("could not parse ligand structure")
    props = ligand_props(Chem.RemoveHs(mol))

    mol_h = _protonate(mol, ph) if protonate else Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = seed
    if AllChem.EmbedMolecule(mol_h, params) != 0:
        AllChem.EmbedMolecule(mol_h, useRandomCoords=True)
    try:
        AllChem.MMFFOptimizeMolecule(mol_h)
    except Exception:
        pass

    prep = MoleculePreparation()
    setups = prep.prepare(mol_h)
    pdbqt, ok, err = PDBQTWriterLegacy.write_string(setups[0])
    if not ok:
        raise RuntimeError("meeko PDBQT write failed: %s" % err)
    return pdbqt, props


def ligand_3d_pdb(mol, seed=0xF00D):
    """Generate a clean 3D conformer (ETKDG + MMFF) and return it as a PDB block
    with residue name LIG — for live 3D display of a ligand from SMILES/file."""
    mh = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = seed
    if AllChem.EmbedMolecule(mh, params) != 0:
        AllChem.EmbedMolecule(mh, useRandomCoords=True)
    try:
        AllChem.MMFFOptimizeMolecule(mh)
    except Exception:
        pass
    m = Chem.RemoveHs(mh)
    for atom in m.GetAtoms():
        info = Chem.AtomPDBResidueInfo()
        info.SetResidueName("LIG")
        info.SetResidueNumber(1)
        info.SetIsHeteroAtom(True)
        atom.SetMonomerInfo(info)
    return Chem.MolToPDBBlock(m)


def _centroid(coords):
    n = float(len(coords))
    return {axis: round(sum(c[i] for c in coords) / n, 2) for i, axis in enumerate("xyz")}


def _het_to_smiles(het_lines):
    """Perceive bonds from the crystal ligand coordinates and derive a SMILES."""
    try:
        m = pybel.readstring("pdb", "\n".join(het_lines))
        smi = m.write("smi").split()[0].strip()
        return smi or None
    except Exception:
        return None


def prepare_receptor(pdb_text, ph=7.4, keep_waters=False, keep_ions=False):
    """Prepare a rigid receptor PDBQT, and also extract the co-crystallised
    ligand (kept for display + auto-recognised as a ligand). Crystallographic
    waters and/or ions may optionally be retained in the receptor.
    Returns (receptor_pdbqt, protein_pdb, display_pdb, ligand_pdb, meta)."""
    prot_lines = [l for l in pdb_text.splitlines() if l.startswith("ATOM") or l.startswith("TER")]
    if not prot_lines:
        raise ValueError("no protein ATOM records found")

    # group heteroatoms (candidate ligands) by residue, and collect waters/ions
    het = {}
    kept_het = []
    n_waters = n_ions = 0
    for l in pdb_text.splitlines():
        if l.startswith("HETATM"):
            resn = l[17:20].strip()
            if resn in _WATER:
                n_waters += 1
                if keep_waters:
                    kept_het.append(l)
                continue
            if resn in _IONS:
                n_ions += 1
                if keep_ions:
                    kept_het.append(l)
                continue
            if resn in _SKIP_HET:
                continue
            key = (resn, l[21], l[22:26].strip())
            het.setdefault(key, []).append(l)

    protein_pdb = "\n".join(prot_lines) + "\nEND\n"
    receptor_src = prot_lines + kept_het   # protein (+ optional waters/ions) for docking
    mol = pybel.readstring("pdb", "\n".join(receptor_src))
    mol.OBMol.AddHydrogens(False, True, ph)  # polar-aware, correct for pH
    receptor_pdbqt = mol.write("pdbqt", opt={"r": True})  # -xr rigid receptor

    resset, coords = set(), []
    for l in prot_lines:
        if l.startswith("ATOM"):
            resset.add((l[21], l[22:26].strip()))
            coords.append((float(l[30:38]), float(l[38:46]), float(l[46:54])))

    # pick the largest non-water heteroatom group as the bound ligand
    ligand_resn = native_smiles = ligand_pdb = None
    lig_lines = []
    if het:
        (resn, chain, resi), lig_lines = max(het.items(), key=lambda kv: len(kv[1]))
        ligand_resn = resn
        ligand_pdb = "\n".join(lig_lines) + "\nEND\n"
        native_smiles = _het_to_smiles(lig_lines)
        lig_coords = [(float(l[30:38]), float(l[38:46]), float(l[46:54])) for l in lig_lines]
        center, box = _centroid(lig_coords), {"x": 22.0, "y": 22.0, "z": 22.0}
    else:
        center, box = _centroid(coords), {"x": 26.0, "y": 26.0, "z": 26.0}

    # display structure keeps the native ligand (+ retained waters/ions) for the viewer
    display_pdb = "\n".join(prot_lines + lig_lines + kept_het) + "\nEND\n"

    meta = {
        "n_atoms": len(coords),
        "n_residues": len(resset),
        "center": center,
        "box": box,
        "detected_ligands": [k[0] for k in het.keys()],
        "ligand_resn": ligand_resn,
        "native_ligand_smiles": native_smiles,
        "n_waters": n_waters,
        "n_ions": n_ions,
        "kept_waters": bool(keep_waters and n_waters),
        "kept_ions": bool(keep_ions and n_ions),
    }
    return receptor_pdbqt, protein_pdb, display_pdb, ligand_pdb, meta
