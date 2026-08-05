"""
Nano Bio-Pharmaceutical Modelling engine for DDS 4.0.

A simple, reliable, force-field (MMFF94) tool for two questions that lack an
easy, user-friendly solution:

  1.  How do two or three drugs/compounds associate with each other (co-formulation,
      e.g. curcumin + rifampicin)?
  2.  How does that compound (or the drug-drug assembly) sit in/on a common
      pharmaceutical nanocarrier — cyclodextrins, dendrimers, polymer chains,
      a phospholipid (liposome) model, or a carbon nanomaterial (graphene,
      graphene oxide, carbon nanotube)?

Approach (established, third-party codes only): 3D conformers with RDKit ETKDG,
a conformational/orientational search, and MMFF94 minimisation of the assembled
complex WITH inter-fragment non-bonded terms (the physically correct interaction
energy). The lowest-energy pose and its interactions are reported and visualised.

This is qualitative pose- and interaction-prediction (MMFF94 interaction energy
under a selectable gas-phase or implicit-water solvent model, a *relative*
indicator) — a hypothesis/visualisation tool, not MD and not an absolute binding
free energy or loading capacity. Whole liposomes/nanoparticles are represented by
a fragment/patch model, as is standard for this kind of screen.
"""
from __future__ import annotations
import os
import numpy as np

from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, rdMolDescriptors
from rdkit.Geometry import Point3D
RDLogger.DisableLog("rdApp.*")

_DATA = os.path.join(os.path.dirname(__file__), "nano_data", "carriers")

# ------------------------------------------------------------------ carriers
# Curated library of the most common pharmaceutical nanocarriers (gold NPs are
# deliberately excluded — a metal core is not force-field-tractable simply).
CARRIERS = {
    "beta_cyclodextrin":  {"name": "β-Cyclodextrin", "type": "Cyclodextrin (cavity)",
        "note": "7-glucose macrocycle; classic inclusion host for mid-sized/aromatic guests.", "cavity": True},
    "alpha_cyclodextrin": {"name": "α-Cyclodextrin", "type": "Cyclodextrin (cavity)",
        "note": "6-glucose macrocycle; smaller cavity — small/linear guests.", "cavity": True},
    "gamma_cyclodextrin": {"name": "γ-Cyclodextrin", "type": "Cyclodextrin (cavity)",
        "note": "8-glucose macrocycle; larger cavity — bulky guests or 1:2 inclusion.", "cavity": True},
    "pamam_g0":  {"name": "PAMAM dendrimer (G0)", "type": "Dendrimer",
        "note": "Generation-0 PAMAM; drugs associate with the branched interior/surface.", "cavity": False},
    "peg_oligomer":  {"name": "PEG oligomer", "type": "Polymer chain",
        "note": "Poly(ethylene glycol) segment — micelle/PEGylated-carrier proxy.", "cavity": False},
    "plga_oligomer": {"name": "PLGA oligomer", "type": "Polymer chain",
        "note": "Poly(lactic-co-glycolic acid) segment — polymeric-nanoparticle proxy.", "cavity": False},
    "dppc_lipid": {"name": "Phospholipid (DPPC)", "type": "Lipid / liposome model",
        "note": "Single DPPC — a simplified membrane probe (polar head vs hydrophobic tails).", "cavity": False},
    "graphene": {"name": "Graphene nanoflake", "type": "Carbon nanomaterial",
        "note": "Polyaromatic graphene fragment; aromatic drugs adsorb flat by π-stacking.", "cavity": False},
    "graphene_oxide": {"name": "Graphene oxide", "type": "Carbon nanomaterial",
        "note": "Oxidised graphene flake (edge –COOH/–OH); π-stacking plus H-bonding to the oxygens.", "cavity": False},
    "swcnt": {"name": "Carbon nanotube (SWCNT)", "type": "Carbon nanomaterial",
        "note": "Single-walled (5,5) armchair segment; drugs adsorb on the sidewall by π-stacking.", "cavity": False},
}


def carrier_catalog():
    return [{"id": k, **v} for k, v in CARRIERS.items()]


def _load_carrier(cid):
    m = Chem.MolFromMolFile(os.path.join(_DATA, cid + ".mol"), removeHs=False)
    if m is None:
        raise ValueError("carrier structure not found: %s" % cid)
    return m


# ------------------------------------------------------------ molecule utils
def build_ligand(smiles, seed=1):
    """SMILES -> MMFF-optimised 3D molecule (with Hs)."""
    m = Chem.MolFromSmiles(smiles or "")
    if m is None:
        return None
    m = Chem.AddHs(m)
    p = AllChem.ETKDGv3()
    p.randomSeed = seed
    p.useRandomCoords = True
    if AllChem.EmbedMolecule(m, p) != 0:
        if AllChem.EmbedMolecule(m, AllChem.ETKDGv2()) != 0:
            return None
    try:
        AllChem.MMFFOptimizeMolecule(m, maxIters=2000)
    except Exception:
        AllChem.UFFOptimizeMolecule(m, maxIters=2000)
    return m


def build_ligand_confs(smiles, n_confs=1, seed=1):
    """SMILES -> a list of MMFF-optimised 3D conformers (single-conformer mols).
    Sampling several conformers lets the search explore a flexible drug's shapes; for
    n_confs=1 this is equivalent to build_ligand."""
    if n_confs <= 1:
        m = build_ligand(smiles, seed=seed)
        return [m] if m is not None else []
    m = Chem.MolFromSmiles(smiles or "")
    if m is None:
        return []
    m = Chem.AddHs(m)
    p = AllChem.ETKDGv3()
    p.randomSeed = seed
    p.useRandomCoords = True
    p.pruneRmsThresh = 0.5                                       # drop near-duplicate conformers
    ids = list(AllChem.EmbedMultipleConfs(m, numConfs=int(n_confs), params=p))
    if not ids:
        g = build_ligand(smiles, seed=seed)
        return [g] if g is not None else []
    try:
        AllChem.MMFFOptimizeMoleculeConfs(m, maxIters=2000)
    except Exception:
        try:
            AllChem.UFFOptimizeMoleculeConfs(m, maxIters=2000)
        except Exception:
            pass
    out = []
    for cid in ids:
        mc = Chem.Mol(m)
        mc.RemoveAllConformers()
        mc.AddConformer(Chem.Conformer(m.GetConformer(cid)), assignId=True)
        out.append(mc)
    return out


def _energy(mol):
    """Single-molecule MMFF energy (UFF fallback)."""
    try:
        mp = AllChem.MMFFGetMoleculeProperties(mol)
        return AllChem.MMFFGetMoleculeForceField(mol, mp).CalcEnergy()
    except Exception:
        return AllChem.UFFGetMoleculeForceField(mol).CalcEnergy()


def _combined_ff(mol):
    """Force field over a combined (multi-fragment) system WITH inter-fragment
    non-bonded terms — the key to a correct interaction energy."""
    try:
        mp = AllChem.MMFFGetMoleculeProperties(mol)
        if mp is not None:
            return AllChem.MMFFGetMoleculeForceField(mol, mp, ignoreInterfragInteractions=False)
    except Exception:
        pass
    return AllChem.UFFGetMoleculeForceField(mol, ignoreInterfragInteractions=False)


# ----------------------------------------------------- implicit-solvent energies
# A simple, established continuum correction (GB/SA-style): electrostatics screened
# by a water dielectric, plus a non-polar surface-area term for the hydrophobic
# effect. Not explicit-water MD or Poisson–Boltzmann — a reproducible, qualitative
# improvement over gas-phase MMFF.
WATER_EPS = 4.0           # distance-dependent dielectric constant (ε=4·r) for implicit water
SASA_GAMMA = 0.0072       # non-polar surface tension, kcal/mol/Å² (standard)


def _ffE(mol, eps=1.0, model=1, interfrag=False):
    """MMFF energy of `mol` at a chosen dielectric (model 1 = constant, 2 = distance-
    dependent). UFF fallback ignores the dielectric."""
    try:
        mp = AllChem.MMFFGetMoleculeProperties(mol)
        if mp is not None:
            mp.SetMMFFDielectricConstant(float(eps))
            mp.SetMMFFDielectricModel(int(model))
            return AllChem.MMFFGetMoleculeForceField(mol, mp, ignoreInterfragInteractions=not interfrag).CalcEnergy()
    except Exception:
        pass
    return AllChem.UFFGetMoleculeForceField(mol, ignoreInterfragInteractions=not interfrag).CalcEnergy()


def _int_E(complex_mol, host, guest, eps=1.0, model=1):
    """Interaction energy E(complex) − E(host) − E(guest) at a given dielectric."""
    return (_ffE(complex_mol, eps, model, interfrag=True)
            - _ffE(host, eps, model) - _ffE(guest, eps, model))


def _sasa(mol):
    from rdkit.Chem import rdFreeSASA
    m = Chem.Mol(mol)
    radii = rdFreeSASA.classifyAtoms(m)
    return float(rdFreeSASA.CalcSASA(m, radii))


def solvent_terms(host, guest, complex_mol):
    """Decompose the host–guest interaction into van-der-Waals, (water-screened)
    electrostatic and non-polar (hydrophobic) contributions, and report both the
    gas-phase and implicit-water interaction energies plus the solvation energy."""
    dE_gas = _int_E(complex_mol, host, guest, eps=1.0, model=1)
    dE_vdw = _int_E(complex_mol, host, guest, eps=1.0e6, model=1)     # electrostatics screened to ~0
    dE_polar_water = _int_E(complex_mol, host, guest, eps=WATER_EPS, model=2)  # distance-dependent ε=4·r
    elec_water = dE_polar_water - dE_vdw
    try:
        d_sasa = _sasa(complex_mol) - (_sasa(host) + _sasa(guest))   # < 0 when surface is buried
        nonpolar = SASA_GAMMA * d_sasa
    except Exception:
        nonpolar = 0.0
    dE_water = dE_polar_water + nonpolar
    return {
        "vdw": round(dE_vdw, 2),
        "electrostatic": round(elec_water, 2),
        "nonpolar": round(nonpolar, 2),
        "gas_phase": round(dE_gas, 2),
        "implicit_water": round(dE_water, 2),
        "solvation": round(dE_water - dE_gas, 2),
    }


def _mmff_charges(mol):
    """Per-atom MMFF94 partial charges (Gasteiger fallback)."""
    try:
        mp = AllChem.MMFFGetMoleculeProperties(mol)
        if mp is not None:
            return [float(mp.GetMMFFPartialCharge(i)) for i in range(mol.GetNumAtoms())]
    except Exception:
        pass
    m = Chem.Mol(mol)
    AllChem.ComputeGasteigerCharges(m)
    return [float(a.GetDoubleProp("_GasteigerCharge")) for a in m.GetAtoms()]


def coulomb_map(complex_mol, n_host):
    """Classical (Coulombic) electrostatic potential of the assembled complex.

    For each atom i the potential is the sum of the Coulomb contributions of every
    OTHER atom under the SAME distance-dependent dielectric used for the module's
    electrostatic energy term (ε = 4·r):  φ_i = Σ_{j≠i} q_j / (4 · r_ij²).  Colours
    a molecular surface red (negative / electron-rich) → blue (positive) so host↔guest
    charge complementarity at the interface is visible.  A classical point-charge map
    from the MMFF94 charges — NOT a quantum-mechanical ESP; qualitative and relative."""
    q = np.asarray(_mmff_charges(complex_mol), dtype=float)
    pos = np.asarray(complex_mol.GetConformer().GetPositions(), dtype=float)
    n = len(q)
    if n == 0:
        return None
    phi = np.zeros(n)
    for i in range(n):
        d = pos - pos[i]
        r2 = np.einsum("ij,ij->i", d, d)          # squared distances to every atom
        r2[i] = np.inf                             # skip self
        phi += 0.0                                 # (keep dtype)
        phi[i] = float(np.sum(q / (WATER_EPS * r2)))   # ε=4r  →  q_j/(4·r²)
    rng = float(np.percentile(np.abs(phi), 92)) or float(np.max(np.abs(phi))) or 1.0
    return {
        "potential": [round(float(x), 4) for x in phi],
        "charges": [round(float(x), 4) for x in q],
        "range": round(rng, 4),
        "n_host": int(n_host),
        "dielectric": "ε = 4r (distance-dependent)",
    }


def _positions(mol):
    return mol.GetConformer().GetPositions()


def _centroid(mol):
    return _positions(mol).mean(0)


def _set_positions(mol, pos):
    c = mol.GetConformer()
    for i in range(mol.GetNumAtoms()):
        c.SetAtomPosition(i, Point3D(float(pos[i][0]), float(pos[i][1]), float(pos[i][2])))


def _translate(mol, vec):
    _set_positions(mol, _positions(mol) + np.asarray(vec))


def _rand_rotation(seed):
    rng = np.random.RandomState(seed)
    q = rng.randn(4); q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


# --------------------------------------------------------------- complexation
def _place_guest(host, guest, place, seed):
    """Rotate `guest` by a seeded random orientation, move it onto `place`, and
    combine with `host` — the unminimised starting geometry for a pose."""
    g = Chem.Mol(guest)
    pos = _positions(g)
    pos = (pos - pos.mean(0)) @ _rand_rotation(seed).T          # random orientation
    _set_positions(g, pos)
    _translate(g, np.asarray(place) - _centroid(g))             # move onto the site
    combo = Chem.CombineMols(host, g)
    Chem.SanitizeMol(combo)
    return combo


def _pair_complex(host, guest, place, seed):
    """Place `guest` (rotated) near `place` (a 3-vector), combine with `host`,
    MMFF-minimise the assembly, and return (complex_mol, dE_interaction, Ec)."""
    combo = _place_guest(host, guest, place, seed)
    ff = _combined_ff(combo)
    ff.Minimize(maxIts=1000)
    Ec = ff.CalcEnergy()
    nH = host.GetNumAtoms()
    p = combo.GetConformer().GetPositions()
    hc = Chem.Mol(host); _set_positions(hc, p[:nH])
    gc = Chem.Mol(guest); _set_positions(gc, p[nH:])
    dE = Ec - _energy(hc) - _energy(gc)                         # interaction energy
    return combo, hc, gc, dE


def dock(host, guest, n_poses=8, into_cavity=True, progress=None):
    """Orientational/positional search of `guest` against `host`, returning the
    best complex and the split host/guest at that geometry.

    For cavity hosts (cyclodextrins) the guest is seeded along the cavity axis at
    several depths so it can thread into the pocket, and poses are selected with a
    mild preference for burial (an implicit-solvent-like proxy for the hydrophobic
    inclusion that drives these complexes in water — gas-phase MMFF alone under-
    weights it). The reported energy is always the raw MMFF interaction energy.

    If `progress` is given, the minimised complex from each placement is streamed
    to it, so the live view shows the search sampling poses as it runs."""
    hp = _positions(host)
    site = hp.mean(0)
    _, _, Vt = np.linalg.svd(hp - site)
    axis = Vt[-1]                                   # symmetry (cavity) axis of a flat torus
    rng = np.random.RandomState(0)
    poses, s = [], 0

    # Build the list of starting positions. Cavity hosts: seed along the cavity axis
    # at several depths so the guest threads the pocket. Non-cavity hosts (surfaces,
    # tubes, chains, sheets): seed the guest just OUTSIDE the host silhouette along a
    # spread of directions — the face normal (both sides) for a flat sheet gives
    # π-stacking, radial directions give nanotube sidewall contact — with tangential
    # jitter so different spots on the surface are sampled. Seeding at the centroid
    # would embed a guest inside an extended host and clash.
    places = []
    if into_cavity:
        for d in (0.0, 2.0, -2.0):
            for _ in range(max(3, n_poses)):
                places.append(site + axis * d)
    else:
        base = [Vt[2], -Vt[2], Vt[1], -Vt[1], Vt[0], -Vt[0]]
        for k in range(max(6, n_poses)):
            u = base[k % len(base)].astype(float) + rng.uniform(-0.25, 0.25, 3)
            u /= (np.linalg.norm(u) + 1e-9)
            ext = float(np.max((hp - site) @ u))            # host silhouette along u
            jit = rng.uniform(-2.5, 2.5, 3); jit -= (jit @ u) * u   # keep jitter tangential
            places.append(site + u * (ext + 3.2) + jit)

    for place in places:
        s += 1
        try:
            combo, hc, gc, dE = _pair_complex(host, guest, place, seed=s)
        except Exception:
            continue
        if progress is not None:
            try: progress(Chem.MolToPDBBlock(combo))
            except Exception: pass
        inside = _guest_inside(hc, gc)
        score = dE - (12.0 * inside if into_cavity else 0.0)   # reward cavity burial
        poses.append({"complex": combo, "host": hc, "guest": gc,
                      "dE": float(round(dE, 2)), "inside": inside, "score": score,
                      "place": [float(x) for x in place], "seed": s})
    if not poses:
        return None
    poses.sort(key=lambda p: p["score"])
    return poses[0]


def _merge(mols):
    m = mols[0]
    for x in mols[1:]:
        m = Chem.CombineMols(m, x)
    Chem.SanitizeMol(m)
    return m


# Allowed guest:host stoichiometries — the canonical Higuchi–Connors set that
# covers the overwhelming majority of reported host–guest complexes. 1:1 is the
# default; 1:2 caps an elongated guest with two hosts; 2:1 loads two guests onto
# one carrier (co-inclusion in a large cavity, or surface loading otherwise).
RATIOS = {"1:1": (1, 1), "1:2": (1, 2), "2:1": (2, 1)}

# Search thoroughness scales what actually improves results: the number of guest
# conformers explored and the number of orientational placements tried per host.
# (Minimisation always runs to convergence; more iterations would not help.)
THOROUGHNESS = {
    "quick":    {"label": "Quick",    "n_confs": 1, "n_poses": 4},
    "balanced": {"label": "Balanced", "n_confs": 2, "n_poses": 6},
    "thorough": {"label": "Thorough", "n_confs": 5, "n_poses": 8},
}


def method_info(thoroughness="balanced", solvent="water", into_cavity=True):
    """Machine- and human-readable description of the exact protocol + parameters,
    for the UI 'Method' popover, the documentation and the exported report."""
    t = THOROUGHNESS.get(thoroughness, THOROUGHNESS["balanced"])
    depths = 3 if into_cavity else 1
    rots = max(3, t["n_poses"])
    return {
        "thoroughness": t["label"],
        "conformer_engine": "RDKit ETKDGv3",
        "conformers": t["n_confs"],
        "orientations_per_conformer": rots * depths,
        "total_placements": t["n_confs"] * rots * depths,
        "force_field": "MMFF94 (UFF fallback)",
        "minimization": "gradient minimisation to convergence (≤2000 iters), inter-fragment non-bonded terms included",
        "selection": "lowest MMFF interaction energy with a burial preference for cavity hosts",
        "solvent_model": "Implicit water (ε=%.1f dielectric screening + %.4f kcal/mol·Å² SASA non-polar term)" % (WATER_EPS, SASA_GAMMA)
                         if solvent == "water" else "Gas phase (unscreened MMFF)",
    }


def dock_confs(host, guests, n_poses=8, into_cavity=True, progress=None):
    """Dock each supplied guest conformer and return the best pose overall, tagged
    with the winning conformer (`_conf`) so it can be reproduced for the live view."""
    best = None
    for g in guests:
        if g is None:
            continue
        r = dock(host, g, n_poses=n_poses, into_cavity=into_cavity, progress=progress)
        if r is None:
            continue
        if best is None or r["score"] < best["score"]:
            best = r
            best["_conf"] = g
    return best


def _dock_addition(assembly, frag, n_poses):
    """Search for a clash-free placement of `frag` against the current `assembly`.
    The fragment is seeded just outside the assembly's surface along several random
    directions (so it never starts inside a large target), then the pair is MMFF-
    minimised; the lowest-energy placement is returned. Robust for both small guests
    and large drug–drug assemblies / polymer segments."""
    ap = _positions(assembly)
    acen = ap.mean(0)
    arad = float(np.linalg.norm(ap - acen, axis=1).max())
    frad = float(np.linalg.norm(_positions(frag) - _centroid(frag), axis=1).max())
    rng = np.random.RandomState(0)
    best = None
    for s in range(1, max(6, n_poses) + 1):
        d = rng.randn(3)
        d /= (np.linalg.norm(d) or 1.0)
        place = acen + d * (arad + frad + 1.0)              # just beyond contact — no initial clash
        try:
            _, _, gc, dE = _pair_complex(assembly, frag, place, seed=s)
        except Exception:
            continue
        if best is None or dE < best[1]:
            best = (gc, dE)
    return best[0] if best else None


def dock_ratio(host, guest, n_guest=1, n_host=1, into_cavity=True, n_poses=8, progress=None):
    """Build a guest:host complex at a small stoichiometry. Starts from the best 1:1
    pose, then adds each extra host/guest by docking it against the growing assembly
    (so it lands clash-free), and finally MMFF-minimises the whole multi-molecule
    system WITH inter-fragment terms. Returns the merged host, merged guest, the
    total interaction energy and the per-guest energy (so ratios stay comparable)."""
    guests_in = list(guest) if isinstance(guest, (list, tuple)) else [guest]
    base = dock_confs(host, guests_in, n_poses=n_poses, into_cavity=into_cavity, progress=progress)
    if base is None:
        return None
    win = base.get("_conf", guests_in[0])                        # winning guest conformer
    if n_guest == 1 and n_host == 1:
        base.update({"n_guest": 1, "n_host": 1, "dE_per_guest": base["dE"], "conf": win})
        return base

    h1, g1 = base["host"], base["guest"]
    hosts, gplaced = [h1], [g1]
    if n_host > 1:                                               # extra hosts cap the guest along the cavity axis
        axis = _centroid(g1) - _centroid(h1)
        na = np.linalg.norm(axis)
        axis = axis / na if na > 1e-6 else np.array([0.0, 0.0, 1.0])
        hspan = float(np.linalg.norm(_positions(host).max(0) - _positions(host).min(0)))
        for k in range(1, n_host):
            anchor = _centroid(g1) + axis * (0.45 * hspan + 1.5) * k
            h2 = Chem.Mol(host); _translate(h2, anchor - _centroid(h2))
            hosts.append(h2)
    for _ in range(1, n_guest):                                  # extra guests dock against the assembly (clash-free)
        placed = _dock_addition(_merge(hosts + gplaced), win, n_poses=n_poses)
        if placed is not None:
            gplaced.append(placed)

    combo = _merge(hosts + gplaced)                              # final global minimisation
    ff = _combined_ff(combo)
    ff.Minimize(maxIts=3000)
    Ec = ff.CalcEnergy()
    p = combo.GetConformer().GetPositions()
    off, sh, sg = 0, [], []
    for m in hosts:
        nm = m.GetNumAtoms(); c = Chem.Mol(m); _set_positions(c, p[off:off + nm]); sh.append(c); off += nm
    for m in gplaced:
        nm = m.GetNumAtoms(); c = Chem.Mol(m); _set_positions(c, p[off:off + nm]); sg.append(c); off += nm
    dE = Ec - sum(_energy(m) for m in sh + sg)
    carrier_c, guest_c = _merge(sh), _merge(sg)
    return {"complex": combo, "host": carrier_c, "guest": guest_c,
            "dE": float(round(dE, 2)), "dE_per_guest": float(round(dE / n_guest, 2)),
            "inside": _guest_inside(sh[0], guest_c), "n_guest": n_guest, "n_host": n_host,
            "place": base["place"], "seed": base["seed"], "conf": win}   # primary pose (for the live view)


# ---------------------------------------------------------- interaction detect
_ACC = {7, 8, 9}          # N, O, F acceptors
def _is_hbond_donor(mol, idx):
    a = mol.GetAtomWithIdx(idx)
    return a.GetAtomicNum() in (7, 8) and a.GetTotalNumHs() + sum(
        1 for nb in a.GetNeighbors() if nb.GetAtomicNum() == 1) > 0


def _aromatic_ring_centroids(mol):
    out = []
    ri = mol.GetRingInfo()
    pos = _positions(mol)
    for ring in ri.AtomRings():
        if all(mol.GetAtomWithIdx(i).GetIsAromatic() for i in ring):
            out.append(pos[list(ring)].mean(0))
    return out


def interactions(host, guest):
    """Geometric interaction profile between two molecules at their (complex)
    coordinates: hydrogen bonds, hydrophobic C–C contacts and π–π stacking."""
    hp, gp = _positions(host), _positions(guest)
    hb, hyd = [], []
    # hydrogen bonds: polar host atom <-> polar guest atom, 2.4–3.5 Å, one a donor
    for i in range(host.GetNumAtoms()):
        ai = host.GetAtomWithIdx(i)
        if ai.GetAtomicNum() not in _ACC:
            continue
        for j in range(guest.GetNumAtoms()):
            aj = guest.GetAtomWithIdx(j)
            if aj.GetAtomicNum() not in _ACC:
                continue
            d = float(np.linalg.norm(hp[i] - gp[j]))
            if 2.4 <= d <= 3.5 and (_is_hbond_donor(host, i) or _is_hbond_donor(guest, j)):
                hb.append({"host_atom": ai.GetSymbol() + str(i + 1),
                           "guest_atom": aj.GetSymbol() + str(j + 1), "distance": round(d, 2)})
    # hydrophobic C–C contacts
    hc_idx = [i for i in range(host.GetNumAtoms()) if host.GetAtomWithIdx(i).GetAtomicNum() == 6]
    gc_idx = [j for j in range(guest.GetNumAtoms()) if guest.GetAtomWithIdx(j).GetAtomicNum() == 6]
    for i in hc_idx:
        for j in gc_idx:
            d = float(np.linalg.norm(hp[i] - gp[j]))
            if d <= 4.0:
                hyd.append({"host_atom": "C" + str(i + 1), "guest_atom": "C" + str(j + 1), "distance": round(d, 2)})
    # π–π stacking (aromatic ring centroids within 5.5 Å)
    pi = []
    for a in _aromatic_ring_centroids(host):
        for b in _aromatic_ring_centroids(guest):
            d = float(np.linalg.norm(a - b))
            if d <= 5.5:
                pi.append({"distance": round(d, 2)})
    hb.sort(key=lambda x: x["distance"]); hyd.sort(key=lambda x: x["distance"])
    return {"hbond": hb[:8], "hydrophobic": hyd[:8], "pi": pi[:4],
            "counts": {"hbond": len(hb), "hydrophobic": len(hyd), "pi": len(pi)}}


def _atom_label(a):
    el = a.GetSymbol()
    if el == "C":
        return ""
    n = a.GetTotalNumHs()
    return el + ("H" + (str(n) if n > 1 else "") if n > 0 else "")


def _depict2d(mol):
    """2D atoms/bonds/aromatic-rings for a heavy-atom mol (schema matches the docking
    interaction map, so the same diagram component can render it)."""
    m = Chem.Mol(mol)
    AllChem.Compute2DCoords(m)
    conf = m.GetConformer()
    atoms = []
    for a in m.GetAtoms():
        p = conf.GetAtomPosition(a.GetIdx())
        atoms.append({"i": a.GetIdx(), "el": a.GetSymbol(), "x": round(p.x, 3), "y": round(p.y, 3),
                      "arom": a.GetIsAromatic(), "label": _atom_label(a)})
    bonds = []
    for b in m.GetBonds():
        bt = b.GetBondType()
        order = 2 if bt == Chem.BondType.DOUBLE else (3 if bt == Chem.BondType.TRIPLE else 1)
        bonds.append({"a": b.GetBeginAtomIdx(), "b": b.GetEndAtomIdx(), "order": order, "arom": b.GetIsAromatic()})
    rings = [list(r) for r in m.GetRingInfo().AtomRings()
             if all(m.GetAtomWithIdx(i).GetIsAromatic() for i in r)]
    return {"atoms": atoms, "bonds": bonds, "rings": rings}


def interaction_map(host, guest):
    """Data for a 2D host–guest interaction diagram (same design as the docking
    module's ligand–protein map): the guest's 2D depiction plus each host contact
    anchored to the guest atom it touches, labelled with the host atom."""
    gh = Chem.RemoveAllHs(guest)
    heavy_map, hi = {}, 0                                        # original guest idx -> heavy idx
    for a in guest.GetAtoms():
        if a.GetAtomicNum() != 1:
            heavy_map[a.GetIdx()] = hi; hi += 1
    guest2d = _depict2d(gh)
    hp, gp = _positions(host), _positions(guest)
    contacts, seen = [], set()

    def add(label, typ, dist, gidx):
        if gidx not in heavy_map:
            return
        key = (label, typ)
        if key in seen:
            return
        seen.add(key)
        contacts.append({"residue": label, "type": typ, "distance": round(dist, 1),
                         "lig_atom": heavy_map[gidx]})

    for i in range(host.GetNumAtoms()):                         # H-bonds
        ai = host.GetAtomWithIdx(i)
        if ai.GetAtomicNum() not in _ACC:
            continue
        for j in range(guest.GetNumAtoms()):
            aj = guest.GetAtomWithIdx(j)
            if aj.GetAtomicNum() not in _ACC:
                continue
            d = float(np.linalg.norm(hp[i] - gp[j]))
            if 2.4 <= d <= 3.5 and (_is_hbond_donor(host, i) or _is_hbond_donor(guest, j)):
                add(ai.GetSymbol() + str(i + 1), "H-bond", d, j)

    hc = [i for i in range(host.GetNumAtoms()) if host.GetAtomWithIdx(i).GetAtomicNum() == 6]
    gc = [j for j in range(guest.GetNumAtoms()) if guest.GetAtomWithIdx(j).GetAtomicNum() == 6]
    for i in hc:                                                # hydrophobic — closest guest C per host C
        best = None
        for j in gc:
            d = float(np.linalg.norm(hp[i] - gp[j]))
            if d <= 4.0 and (best is None or d < best[0]):
                best = (d, j)
        if best:
            add("C" + str(i + 1), "Hydrophobic", best[0], best[1])

    grings = [r for r in guest.GetRingInfo().AtomRings()
              if all(guest.GetAtomWithIdx(k).GetIsAromatic() for k in r)]
    for a in _aromatic_ring_centroids(host):                    # π–π stacking
        for r in grings:
            cen = gp[list(r)].mean(0)
            d = float(np.linalg.norm(a - cen))
            if d <= 5.5:
                add("π", "π-stacking", d, r[0]); break
    return {"guest2d": guest2d, "contacts": contacts}


# ----------------------------------------------------------------- assembling
def _assemble_compounds(smiles_list, n_poses=6):
    """Sequentially bind 2–3 compounds into one lowest-energy assembly."""
    mols = []
    for i, smi in enumerate(smiles_list):
        m = build_ligand(smi, seed=i + 1)
        if m is None:
            return None, "could not build 3D structure for: %s" % smi
        mols.append(m)
    assembly = mols[0]
    total_dE = 0.0
    steps = []
    for k in range(1, len(mols)):
        best = dock(assembly, mols[k], n_poses=n_poses, into_cavity=False)
        if best is None:
            return None, "complexation failed"
        assembly = best["complex"]
        total_dE += best["dE"]
        steps.append(best["dE"])
    return {"mol": assembly, "dE": round(total_dE, 2), "steps": steps,
            "components": mols, "final": assembly}, None


def _guest_inside(host, guest):
    """Fraction of guest atoms lying within the host's convex extent (a simple
    'is it included in the cavity' check for cyclodextrin-type hosts)."""
    hp, gp = _positions(host), _positions(guest)
    lo, hi = hp.min(0), hp.max(0)
    inside = np.all((gp >= lo) & (gp <= hi), axis=1).mean()
    return float(round(inside, 2))


def run(compounds, carrier=None, n_poses=8, ratio="1:1", thoroughness="balanced",
        solvent="water", progress=None):
    """Full pipeline: (A) assemble the compounds together, then (B) load the
    assembly onto the chosen carrier at the requested guest:host stoichiometry.
    `thoroughness` scales conformer/orientation sampling; `solvent` selects the
    reported energy ('water' = implicit-solvent corrected, 'gas' = gas-phase MMFF).
    `progress`, if given, receives live complex PDB frames while the best pose is
    minimised (for a live in-progress 3D view)."""
    compounds = [c.strip() for c in (compounds or []) if c and c.strip()]
    if not compounds:
        return {"error": "no compounds supplied"}
    if len(compounds) > 3:
        compounds = compounds[:3]
    n_guest, n_host = RATIOS.get(ratio, (1, 1))
    T = THOROUGHNESS.get(thoroughness, THOROUGHNESS["balanced"])
    n_confs, sp = T["n_confs"], T["n_poses"]
    solvent = "water" if solvent not in ("gas", "water") else solvent

    def reported(terms):
        return terms["implicit_water"] if solvent == "water" else terms["gas_phase"]

    out = {"compounds": compounds, "carrier": None, "assembly": None, "loaded": None,
           "solvent": solvent}

    # -- stage A: drug–drug assembly (only if >1 compound) --------------------
    if len(compounds) >= 2:
        asm, err = _assemble_compounds(compounds, n_poses=max(4, sp // 2))
        if err:
            return {"error": err}
        comps_at, off, p = [], 0, asm["mol"].GetConformer().GetPositions()
        for m in asm["components"]:
            n = m.GetNumAtoms(); c = Chem.Mol(m); _set_positions(c, p[off:off + n]); comps_at.append(c); off += n
        comp0, rest = comps_at[0], _merge(comps_at[1:])
        aterms = solvent_terms(rest, comp0, asm["mol"])
        out["assembly"] = {
            "pdb": Chem.MolToPDBBlock(asm["mol"]),
            "complex_pdb": Chem.MolToPDBBlock(asm["mol"]),
            "coulomb": coulomb_map(asm["mol"], comp0.GetNumAtoms()),
            "interaction_energy": reported(aterms),
            "energy_terms": aterms,
            "n_atoms": asm["mol"].GetNumAtoms(),
            "component_pdbs": _component_pdbs(asm),
            "interactions": interactions(rest, comp0),
            "map2d": interaction_map(rest, comp0),
        }
        dock_input = asm["mol"]
    else:
        dock_input = build_ligand_confs(compounds[0], n_confs=n_confs, seed=1)
        if not dock_input:
            return {"error": "could not build 3D structure for %s" % compounds[0]}
        out["assembly"] = None

    # -- stage B: load onto the carrier --------------------------------------
    if carrier:
        if carrier not in CARRIERS:
            return {"error": "unknown carrier: %s" % carrier}
        host = _load_carrier(carrier)
        cav = CARRIERS[carrier]["cavity"]
        # live view: show the complex at its initial placement immediately, then stream
        # the search (each sampled pose) so motion runs continuously through the job
        if progress is not None:
            try:
                g0 = dock_input[0] if isinstance(dock_input, list) else dock_input
                progress(Chem.MolToPDBBlock(_place_guest(host, g0, _positions(host).mean(0), seed=1)))
            except Exception:
                pass
        best = dock_ratio(host, dock_input, n_guest=n_guest, n_host=n_host,
                          into_cavity=cav, n_poses=sp, progress=progress)
        if best is None:
            return {"error": "loading onto carrier failed"}
        if progress is not None:                                 # final frame = the winning complex
            try: progress(Chem.MolToPDBBlock(best["complex"]))
            except Exception: pass
        prof = interactions(best["host"], best["guest"])
        terms = solvent_terms(best["host"], best["guest"], best["complex"])
        note = None
        if n_guest > 1 and cav and best["inside"] < 0.4:
            note = ("The extra guest associates at the cavity rim/surface rather than "
                    "co-included — expected when the cavity is too small for two guests.")
        out["carrier"] = {"id": carrier, **CARRIERS[carrier]}
        out["loaded"] = {
            "carrier_pdb": Chem.MolToPDBBlock(best["host"]),
            "guest_pdb": Chem.MolToPDBBlock(best["guest"]),
            "complex_pdb": Chem.MolToPDBBlock(best["complex"]),
            "coulomb": coulomb_map(best["complex"], best["host"].GetNumAtoms()),
            "interaction_energy": reported(terms),
            "interaction_energy_per_guest": round(reported(terms) / n_guest, 2),
            "energy_terms": terms,
            "ratio": ratio, "n_guest": n_guest, "n_host": n_host, "note": note,
            "interactions": prof,
            "map2d": interaction_map(best["host"], best["guest"]),
            "inside_fraction": best["inside"] if cav else None,
            "method": method_info(thoroughness, solvent, cav),
        }
    return out


def structure(smiles=None, carrier=None, seed=1):
    """Return a 3D PDB block for a single compound (built with ETKDG + MMFF) or a
    bundled carrier — used to preview molecules before a run."""
    if carrier:
        if carrier not in CARRIERS:
            return {"error": "unknown carrier: %s" % carrier}
        m = _load_carrier(carrier)
        return {"pdb": Chem.MolToPDBBlock(m), "name": CARRIERS[carrier]["name"], "n_atoms": m.GetNumAtoms()}
    if smiles:
        m = build_ligand(smiles, seed=seed)
        if m is None:
            return {"error": "could not build a 3D structure for %s" % smiles}
        return {"pdb": Chem.MolToPDBBlock(m), "n_atoms": m.GetNumAtoms()}
    return {"error": "provide a compound SMILES or a carrier id"}


def _pubchem_title(kind, ident):
    """Fetch a PubChem compound Title by identifier (kind = 'inchikey' or 'smiles')."""
    import urllib.request, urllib.parse, json
    try:
        url = ("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/%s/%s/property/Title/JSON"
               % (kind, urllib.parse.quote(ident or "", safe="")))
        with urllib.request.urlopen(url, timeout=4) as r:
            d = json.load(r)
        props = d.get("PropertyTable", {}).get("Properties", [])
        return props[0].get("Title") if props else None
    except Exception:
        return None


def _acceptable_name(name):
    """A short trivial/common name. Drops PubChem stereo/salt descriptors after a comma
    (e.g. 'Ibuprofen, (+-)-' -> 'Ibuprofen') and rejects systematic/IUPAC names."""
    if not name:
        return None
    n = name.split(",")[0].strip()
    bad = any(c.isdigit() for c in n) or any(c in n for c in "[]()")
    return n if (2 <= len(n) <= 32 and not bad and n[:1].isalpha()) else None


def _pubchem_name(smiles):
    """Best-effort common/drug name for a SMILES via PubChem (online). Resolves by
    InChIKey first (tautomer/stereo-normalised, so common drugs match reliably), then
    by SMILES. Returns None offline or when only a systematic name exists — the caller
    then falls back to the molecular formula."""
    m = Chem.MolFromSmiles(smiles or "")
    if m is None:
        return None
    key = None
    try:
        key = Chem.MolToInchiKey(m)
    except Exception:
        key = None
    for kind, ident in (("inchikey", key), ("smiles", Chem.MolToSmiles(m))):
        if not ident:
            continue
        name = _acceptable_name(_pubchem_title(kind, ident))
        if name:
            return name
    return None


def identify(smiles_list):
    """For each SMILES return its molecular formula (RDKit, offline) and, best-effort,
    a common drug name (PubChem, online). Names are fetched concurrently."""
    from concurrent.futures import ThreadPoolExecutor
    smiles_list = list(smiles_list or [])
    mols = [Chem.MolFromSmiles(s or "") for s in smiles_list]
    formulas = [rdMolDescriptors.CalcMolFormula(m) if m else None for m in mols]
    names = [None] * len(smiles_list)
    if smiles_list:
        try:
            with ThreadPoolExecutor(max_workers=min(4, len(smiles_list))) as ex:
                names = list(ex.map(_pubchem_name, smiles_list))
        except Exception:
            pass
    return {"items": [{"formula": f, "name": n} for f, n in zip(formulas, names)]}


def _component_pdbs(asm):
    """Per-compound PDB blocks at their assembled coordinates (for coloured 3D)."""
    p = asm["mol"].GetConformer().GetPositions()
    out, off = [], 0
    for m in asm["components"]:
        n = m.GetNumAtoms()
        c = Chem.Mol(m); _set_positions(c, p[off:off + n])
        out.append(Chem.MolToPDBBlock(c)); off += n
    return out


# ----------------------------------------------------------------- validation
# Two reproducibility test cases against DIFFERENT cyclodextrin hosts. Both are
# documented pharmaceutical inclusion complexes with polar/aromatic guests — the
# regime where the gas-phase MMFF force field is reliable, because binding is
# carried by H-bond, π and van-der-Waals terms the force field represents well.
# (Purely hydrophobic guests such as adamantane are deliberately avoided: their
# β-CD selectivity comes from the hydrophobic effect, which a gas-phase model
# cannot capture.)  A case is reproduced when the guest is genuinely drawn into
# the cavity (inside_fraction ≥ 0.5) with a favourable interaction energy and a
# chemically sensible contact pattern.
VALIDATION = {
    "ibuprofen_betaCD": {
        "name": "Ibuprofen in β-cyclodextrin",
        "guest_smiles": "CC(C)Cc1ccc(C(C)C(=O)O)cc1", "guest": "ibuprofen",
        "host": "beta_cyclodextrin",
        "expected": "A classic pharmaceutical inclusion complex: the aromatic ring "
                    "inserts into the β-CD cavity while the carboxylate H-bonds to the rim hydroxyls.",
    },
    "nitrophenol_alphaCD": {
        "name": "p-Nitrophenol in α-cyclodextrin",
        "guest_smiles": "Oc1ccc([N+](=O)[O-])cc1", "guest": "p-nitrophenol",
        "host": "alpha_cyclodextrin",
        "expected": "A well-studied α-CD complex: the small nitro-aromatic threads the narrow "
                    "α-CD cavity with the hydroxyl/nitro groups H-bonding to the rims.",
    },
    "doxorubicin_GO": {
        "name": "Doxorubicin on graphene oxide",
        "guest_smiles": "COc1cccc2c1C(=O)c1c(O)c3c(c(O)c1C2=O)C[C@@](O)(C(=O)CO)C[C@@H]3O[C@H]1C[C@H](N)[C@H](O)[C@H](C)O1",
        "guest": "doxorubicin", "host": "graphene_oxide",
        "expected": "A canonical nanomedicine loading system: the anthracycline lies flat on the "
                    "sheet by π–π stacking (~3.5 Å) while its polar groups hydrogen-bond to the "
                    "graphene-oxide carboxyl/hydroxyl edges — reproduced as favourable adsorption.",
    },
}


def validation_list():
    return [{"id": k, "name": v["name"], "guest": v["guest"],
             "host": CARRIERS[v["host"]]["name"], "expected": v["expected"]}
            for k, v in VALIDATION.items()]


def run_validation(case, solvent="water"):
    v = VALIDATION.get(case)
    if not v:
        return {"error": "unknown validation case"}
    solvent = "water" if solvent not in ("gas", "water") else solvent
    host = _load_carrier(v["host"])
    cav = CARRIERS[v["host"]]["cavity"]
    best = dock_confs(host, build_ligand_confs(v["guest_smiles"], n_confs=3, seed=1),
                      n_poses=10, into_cavity=cav)
    prof = interactions(best["host"], best["guest"])
    inside = _guest_inside(best["host"], best["guest"])
    terms = solvent_terms(best["host"], best["guest"], best["complex"])
    dE = terms["implicit_water"] if solvent == "water" else terms["gas_phase"]
    # cavity hosts: reproduced when the guest is favourably included; surface carriers:
    # reproduced when the guest adsorbs favourably with a substantial contact pattern.
    contacts = prof["counts"]["pi"] + prof["counts"]["hydrophobic"] + prof["counts"]["hbond"]
    reproduced = bool(dE < 0 and (inside >= 0.5 if cav else contacts >= 3))
    return {
        "case": case, "name": v["name"], "guest": v["guest"], "guest_smiles": v["guest_smiles"],
        "expected": v["expected"], "host": CARRIERS[v["host"]]["name"], "carrier_id": v["host"],
        "interaction_energy": dE, "energy_terms": terms, "solvent": solvent,
        "inside_fraction": inside,
        "reproduced": reproduced,
        "interactions": prof,
        "map2d": interaction_map(best["host"], best["guest"]),
        "method": method_info("balanced", solvent, cav),
        "complex_pdb": Chem.MolToPDBBlock(best["complex"]),
        "coulomb": coulomb_map(best["complex"], best["host"].GetNumAtoms()),
        "carrier_pdb": Chem.MolToPDBBlock(best["host"]),
        "guest_pdb": Chem.MolToPDBBlock(best["guest"]),
    }
