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
# standard polymer residues, for classifying chains as protein vs nucleic acid
_AA = {"ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE",
       "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
       "MSE", "SEC", "PYL", "HID", "HIE", "HIP", "CYX", "ASH", "GLH", "LYN"}
_NUC = {"DA", "DC", "DG", "DT", "DU", "DI", "A", "C", "G", "U", "I"}


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


def _het_key(k):
    return "het:%s:%s:%s" % k  # (resn, chain, resi)


def prepare_receptor(pdb_text, ph=7.4, keep_waters=False, keep_ions=False, remove=None):
    """Prepare a rigid receptor PDBQT from the loaded structure, honouring a set
    of removed components (protein/nucleic chains, cofactors, the co-crystal
    ligand). Also extracts the bound ligand (for the box + auto-SMILES). Returns
    (receptor_pdbqt, protein_pdb, display_pdb, ligand_pdb, meta); meta carries a
    'components' inventory for the structure editor."""
    remove = set(remove or [])
    lines = pdb_text.splitlines()

    # ---- parse into chains (ATOM) and heteroatom groups (HETATM) ----
    chain_lines, chain_res = {}, {}          # chain -> [lines] ; chain -> {resi: resn}
    het_groups = {}                          # (resn,chain,resi) -> [lines]
    water_lines, ion_lines = [], []
    for l in lines:
        if l.startswith("ATOM") or l.startswith("TER"):
            ch = l[21] if len(l) > 21 else " "
            chain_lines.setdefault(ch, []).append(l)
            if l.startswith("ATOM"):
                chain_res.setdefault(ch, {})[l[22:26].strip()] = l[17:20].strip()
        elif l.startswith("HETATM"):
            resn = l[17:20].strip()
            if resn in _WATER:
                water_lines.append(l)
            elif resn in _IONS:
                ion_lines.append(l)
            elif resn not in _SKIP_HET:
                het_groups.setdefault((resn, l[21], l[22:26].strip()), []).append(l)
    if not chain_lines and not het_groups:
        raise ValueError("no ATOM/HETATM records found")

    # largest heteroatom group = bound ligand; the rest are cofactors
    ligand_key = None
    if het_groups:
        (lresn, lchain, lresi), _ = max(het_groups.items(), key=lambda kv: len(kv[1]))
        ligand_key = _het_key((lresn, lchain, lresi))

    # ---- assemble kept lines ----
    kept_chain = [l for ch, lns in chain_lines.items()
                  if ("chain:" + ch) not in remove for l in lns]
    kept_cofactor, lig_lines = [], []
    for k, lns in het_groups.items():
        key = _het_key(k)
        if key == ligand_key:
            lig_lines = lns
        elif key not in remove:
            kept_cofactor += lns
    keep_lig = ligand_key is not None and ligand_key not in remove
    kept_wat = water_lines if (keep_waters and "waters" not in remove) else []
    kept_ion = ion_lines if (keep_ions and "ions" not in remove) else []

    # receptor for docking = kept polymer + cofactors + optional waters/ions (never the ligand)
    receptor_src = kept_chain + kept_cofactor + kept_wat + kept_ion
    if not any(l.startswith("ATOM") or l.startswith("HETATM") for l in receptor_src):
        raise ValueError("nothing left in the receptor — undo a deletion")
    protein_pdb = "\n".join(receptor_src) + "\nEND\n"
    mol = pybel.readstring("pdb", "\n".join(receptor_src))
    mol.OBMol.AddHydrogens(False, True, ph)  # polar-aware, correct for pH
    receptor_pdbqt = mol.write("pdbqt", opt={"r": True})  # -xr rigid receptor

    coords = [(float(l[30:38]), float(l[38:46]), float(l[46:54]))
              for l in kept_chain if l.startswith("ATOM")]
    resset = {(l[21], l[22:26].strip()) for l in kept_chain if l.startswith("ATOM")}

    # box centres on the bound ligand if present, else the receptor centroid
    ligand_resn = native_smiles = ligand_pdb = None
    if lig_lines:
        ligand_resn = lresn
        ligand_pdb = "\n".join(lig_lines) + "\nEND\n"
        native_smiles = _het_to_smiles(lig_lines)
        lc = [(float(l[30:38]), float(l[38:46]), float(l[46:54])) for l in lig_lines]
        center, box = _centroid(lc), {"x": 22.0, "y": 22.0, "z": 22.0}
    elif coords:
        center, box = _centroid(coords), {"x": 26.0, "y": 26.0, "z": 26.0}
    else:
        center, box = {"x": 0.0, "y": 0.0, "z": 0.0}, {"x": 26.0, "y": 26.0, "z": 26.0}

    display_pdb = "\n".join(kept_chain + kept_cofactor + kept_wat + kept_ion +
                            (lig_lines if keep_lig else [])) + "\nEND\n"

    # ---- component inventory for the structure editor ----
    components = []
    for ch, lns in chain_lines.items():
        names = list(chain_res.get(ch, {}).values())
        kind = "nucleic" if names and sum(n in _NUC for n in names) > len(names) / 2 else "protein"
        components.append({
            "key": "chain:" + ch, "kind": kind,
            "label": ("Chain %s" % ch) if ch.strip() else "Chain",
            "detail": "%d residues" % len(chain_res.get(ch, {})),
            "removed": ("chain:" + ch) in remove,
        })
    for k, lns in het_groups.items():
        key = _het_key(k)
        is_lig = key == ligand_key
        components.append({
            "key": key, "kind": "ligand" if is_lig else "cofactor",
            "label": ("%s · %s" % (k[0], k[1])) if k[1].strip() else k[0],
            "detail": "bound ligand" if is_lig else "cofactor / heteroatom",
            "removed": key in remove,
        })

    meta = {
        "n_atoms": len(coords),
        "n_residues": len(resset),
        "center": center,
        "box": box,
        "detected_ligands": [k[0] for k in het_groups.keys()],
        "ligand_resn": ligand_resn,
        "native_ligand_smiles": native_smiles,
        "n_waters": len(water_lines),
        "n_ions": len(ion_lines),
        "kept_waters": bool(keep_waters and water_lines and "waters" not in remove),
        "kept_ions": bool(keep_ions and ion_lines and "ions" not in remove),
        "ph": ph,
        "components": components,
    }
    return receptor_pdbqt, protein_pdb, display_pdb, ligand_pdb, meta
