#!/usr/bin/env python
"""Physics-based membrane-insertion energetics for the DDS 'Tissues' module.

For a molecule we compute, on a single 3D conformer (no MD):
  - G_pol_water : Generalized-Born electrostatic solvation free energy in water
                  (kcal/mol) — a proxy for the desolvation penalty a molecule
                  pays to leave water and enter the low-dielectric membrane core.
                  More polar/charged -> more negative -> harder to cross.
  - dG_transfer(tissue): water -> membrane-core electrostatic transfer energy at
                  a tissue-specific membrane dielectric (BBB tighter/lower eps
                  than gut), = -166.0 * S * (1/eps_water - 1/eps_mem).
  - nonpolar   : Labute accessible surface area (favours membrane partitioning).

GB uses HCT (Hawkins-Cramer-Truhlar) Born radii and RDKit Gasteiger charges.
All CPU, ~milliseconds per molecule after conformer generation.
"""
import numpy as np
from rdkit import Chem
from rdkit.Chem import AllChem, Descriptors, rdMolDescriptors
from rdkit import RDLogger
RDLogger.DisableLog('rdApp.*')

BONDI = {"H":1.20,"C":1.70,"N":1.55,"O":1.52,"F":1.47,"P":1.80,"S":1.80,
         "CL":1.75,"BR":1.85,"I":1.98,"NA":2.27,"K":2.75,"MG":1.73,"ZN":1.39,
         "B":1.92,"SI":2.10,"SE":1.90}
HCT = {"H":0.85,"C":0.72,"N":0.79,"O":0.85,"F":0.88,"P":0.86,"S":0.96,
       "CL":0.80,"BR":0.80,"I":0.80,"NA":0.80,"K":0.80,"MG":0.80,"ZN":0.80,
       "B":0.80,"SI":0.80,"SE":0.80}
OFFSET = 0.09
KE = 332.06  # kcal*Angstrom/(mol*e^2)
EPS_WATER = 78.5
# tissue-specific effective membrane-core dielectric (lower = tighter/more hydrophobic barrier)
TISSUE_EPS = {"generic":2.0, "gut":2.5, "bbb":2.0, "nasal":3.0, "placenta":3.0, "skin":1.8,
              "pampa":2.5, "mdck":2.5, "lung":2.5}
# tissue-specific hydrophobic-core half-thickness (Angstrom); larger/tighter = harder barrier
TISSUE_THICK = {"generic":13.0, "gut":13.0, "bbb":15.0, "nasal":12.0, "placenta":13.0,
                "skin":18.0, "pampa":13.0, "mdck":13.0, "lung":12.0}
GAMMA = 0.030          # nonpolar surface tension, kcal/mol/A^2
KT = 0.593             # kcal/mol at 310 K (body temperature)

def _born_radii(xyz, rho, scale):
    n = len(rho)
    rho_i = rho - OFFSET
    inv = 1.0 / rho_i.copy()
    for i in range(n):
        for j in range(n):
            if i == j: continue
            r = np.linalg.norm(xyz[i] - xyz[j])
            if r < 1e-3:
                continue  # coincident atoms — skip (avoids 1/r blow-up)
            sj = scale[j] * rho_i[j]
            if r + sj <= rho_i[i]:
                continue  # j fully inside i's intrinsic sphere
            L = max(rho_i[i], r - sj)
            U = r + sj
            if L <= 0 or U <= 0: continue
            term = (1.0/L - 1.0/U + 0.25*r*(1.0/(U*U) - 1.0/(L*L))
                    + (0.5/r)*np.log(L/U) + (sj*sj)/(4.0*r)*(1.0/(L*L) - 1.0/(U*U)))
            inv[i] -= 0.5 * term
    inv = np.clip(inv, 1.0/50.0, None)   # cap Born radius at 50 A
    return 1.0 / inv

def _gb_S(xyz, q, R):
    # S = sum_ij q_i q_j / f_GB ; G_pol(eps) = -166.03*(1-1/eps)*S  (eps_in=1)
    n = len(q)
    S = 0.0
    for i in range(n):
        S += q[i]*q[i] / R[i]                      # self term
        for j in range(i+1, n):
            r2 = float(np.sum((xyz[i]-xyz[j])**2))
            fgb = np.sqrt(r2 + R[i]*R[j]*np.exp(-r2/(4.0*R[i]*R[j])))
            S += 2.0 * q[i]*q[j] / fgb
    return S

def _prepare(smiles):
    """Embed one 3D conformer and compute per-atom charge q, Born radius R, vdW rho.
    Returns dict(m, xyz[centered], q, R, rho, sym, crippen_logp) or None."""
    m = Chem.MolFromSmiles(smiles)
    if m is None: return None
    m = Chem.AddHs(m)
    p = AllChem.ETKDGv3()
    p.randomSeed = 1
    if AllChem.EmbedMolecule(m, p) != 0:
        p.useRandomCoords = True
        if AllChem.EmbedMolecule(m, p) != 0:
            return None
    q = None
    try:
        mp_props = AllChem.MMFFGetMoleculeProperties(m)
        if mp_props is not None:
            q = np.array([mp_props.GetMMFFPartialCharge(i) for i in range(m.GetNumAtoms())])
    except Exception:
        q = None
    if q is None:
        try:
            AllChem.ComputeGasteigerCharges(m)
            q = np.array([float(a.GetPropsAsDict().get("_GasteigerCharge", 0.0)) for a in m.GetAtoms()])
        except Exception:
            return None
    conf = m.GetConformer()
    xyz = np.array([list(conf.GetAtomPosition(i)) for i in range(m.GetNumAtoms())])
    xyz = xyz - xyz.mean(0)                       # center at origin
    q = np.nan_to_num(q, nan=0.0, posinf=0.0, neginf=0.0)
    sym = [a.GetSymbol().upper() for a in m.GetAtoms()]
    rho = np.array([BONDI.get(s, 1.7) for s in sym])
    scale = np.array([HCT.get(s, 0.8) for s in sym])
    R = _born_radii(xyz, rho, scale)
    try:
        crip = np.array([c[0] for c in rdMolDescriptors._CalcCrippenContribs(m)])  # per-atom logP
    except Exception:
        crip = np.zeros(len(sym))
    return dict(m=m, xyz=xyz, q=q, R=R, rho=rho, sym=sym, crippen_logp=crip)

def core_terms(smiles):
    """Tissue-independent per-molecule terms: GB electrostatic sum S and nonpolar ASA.
    Returns (S, ASA) or None.  This is the expensive part (conformer + GB)."""
    d = _prepare(smiles)
    if d is None: return None
    S = _gb_S(d["xyz"], d["q"], d["R"])
    if not np.isfinite(S):
        return None
    ASA = float(Descriptors.LabuteASA(Chem.RemoveHs(d["m"])))
    return float(S), ASA

def features(smiles, tissue="generic"):
    """Return (G_pol_water, dG_transfer_tissue, nonpolar_asa, dG_elec) or None."""
    ct = core_terms(smiles)
    if ct is None: return None
    S, ASA = ct
    G_pol_water = -KE * 0.5 * (1.0 - 1.0/EPS_WATER) * S
    eps_m = TISSUE_EPS.get(tissue, 2.0)
    dG_elec = -KE * 0.5 * (1.0/EPS_WATER - 1.0/eps_m) * S     # electrostatic desolvation penalty (>0)
    dG_transfer = dG_elec - GAMMA * ASA                       # net (elec penalty - nonpolar gain)
    return (float(G_pol_water), float(dG_transfer), float(ASA), float(dG_elec))

def gz_profile(smiles, tissue="bbb", zmax=35.0, nz=71, terms=None):
    """Depth-resolved implicit-membrane free-energy profile G(z) (kcal/mol vs Angstrom).

    z=0 is the membrane mid-plane; |z|>~thickness is bulk water.  Two contributions:
      electrostatic desolvation  -> positive barrier peaking at the low-dielectric core
      nonpolar partitioning       -> favorable (negative) well where the solute is buried
    Returns dict with z, Gz, and summary barrier/well or None.
    """
    ct = terms if terms is not None else core_terms(smiles)
    if ct is None: return None
    S, ASA = ct
    eps_core = TISSUE_EPS.get(tissue, 2.0)
    z0 = TISSUE_THICK.get(tissue, 13.0)   # core half-thickness
    w = 4.0                               # water<->core interface width
    zs = np.linspace(-zmax, zmax, nz)
    f_core = 0.5 * (1.0 - np.tanh((np.abs(zs) - z0) / w))          # ~1 in core, ~0 in water
    eps_z = eps_core + (EPS_WATER - eps_core) * (1.0 - f_core)      # dielectric profile
    dG_elec_z = -KE * 0.5 * S * (1.0/EPS_WATER - 1.0/eps_z)         # 0 in water, peak in core
    dG_np_z = -GAMMA * ASA * f_core                                 # favorable burial in core
    Gz = dG_elec_z + dG_np_z
    Gz = Gz - Gz[0]                                                 # reference to bulk water = 0
    imax = int(np.argmax(Gz)); imin = int(np.argmin(Gz))
    return {"z": zs, "Gz": Gz, "eps_z": eps_z,
            "barrier": float(Gz[imax]), "z_barrier": float(zs[imax]),
            "well": float(Gz[imin]), "z_well": float(zs[imin]),
            "tissue": tissue}

def permeability_from_gz(prof):
    """Solubility-diffusion effective permeability from G(z): log10 P (arbitrary D=1).
       P = 1 / integral( exp(G(z)/kT) dz ).  Barrier-dominated, physically-grounded."""
    z, Gz = prof["z"], prof["Gz"]
    integ = np.trapz(np.exp(Gz / KT), z)      # resistance integral (Angstrom)
    return float(-np.log10(integ)) if integ > 0 else None

def _fib_sphere(n):
    """n roughly-uniform unit vectors on a sphere (candidate membrane-normal directions)."""
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2*i/n)
    gold = np.pi * (1 + 5**0.5)
    theta = gold * i
    return np.column_stack([np.sin(phi)*np.cos(theta), np.sin(phi)*np.sin(theta), np.cos(phi)])

def _insertion_energy(zi, q, R, area, eps_core, z0, w):
    """Per-atom implicit-membrane insertion energy given each atom's depth zi (IMM1/OPM-style)."""
    f_core = 0.5 * (1.0 - np.tanh((np.abs(zi) - z0) / w))          # burial fraction per atom
    eps_z = eps_core + (EPS_WATER - eps_core) * (1.0 - f_core)
    dG_elec = -KE * 0.5 * (q*q / R) * (1.0/EPS_WATER - 1.0/eps_z)  # self-energy desolvation penalty
    dG_np = -GAMMA * area * f_core                                 # nonpolar burial gain
    return float(np.sum(dG_elec + dG_np))

def place_in_membrane(smiles, tissue="bbb", n_dirs=200, terms=None):
    """Find the rigid-body orientation + insertion depth that MINIMIZES the molecule's
    implicit-membrane insertion energy (the OPM/PPM small-molecule analogue — no MD, no
    lipid docking).  Returns the oriented coordinates, optimal depth, tilt and energy so a
    3D scene can place the molecule on a physical basis.  Returns dict or None.
    """
    d = terms if terms is not None else _prepare(smiles)
    if d is None: return None
    xyz, q, R, rho = d["xyz"], d["q"], d["R"], d["rho"]
    asa_total = float(Descriptors.LabuteASA(Chem.RemoveHs(d["m"])))
    area = rho*rho / float(np.sum(rho*rho)) * asa_total
    eps_core = TISSUE_EPS.get(tissue, 2.0); z0 = TISSUE_THICK.get(tissue, 13.0); w = 4.0
    # DEPTH: use the calibrated whole-molecule G(z) adsorption-well minimum (the "adsorbed" state)
    S = _gb_S(xyz, q, R)
    prof = gz_profile(None, tissue, terms=(S, asa_total))
    z_place = abs(prof["z_well"])                       # place COM at the surface adsorption well (+z entry side)
    # ORIENTATION: minimise per-atom insertion energy at that fixed depth
    best = None
    for nrm in _fib_sphere(n_dirs):
        proj = xyz @ nrm; proj = proj - proj.mean()     # atom depths about COM along this normal
        E = _insertion_energy(proj + z_place, q, R, area, eps_core, z0, w)
        if best is None or E < best[0]:
            best = (E, nrm.copy())
    E, nrm = best
    zaxis = np.array([0.0, 0.0, 1.0])
    v = np.cross(nrm, zaxis); s = np.linalg.norm(v); c = float(nrm @ zaxis)
    if s < 1e-8:
        Rot = np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    else:
        vx = np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
        Rot = np.eye(3) + vx + vx @ vx * ((1 - c) / (s*s))
    oriented = xyz @ Rot.T
    oriented[:, 2] += (z_place - oriented[:, 2].mean())  # translate COM to adsorption depth
    tilt = float(np.degrees(np.arccos(abs(c))))
    return {"coords": oriented, "energy": float(E), "z_com": z_place, "tilt_deg": tilt,
            "sym": d["sym"], "crippen_logp": d["crippen_logp"], "tissue": tissue,
            "core_halfwidth": z0, "barrier": prof["barrier"]}

if __name__ == "__main__":
    # sanity check on a few molecules of increasing polarity
    tests = [("hexane","CCCCCC"), ("benzene","c1ccccc1"), ("aspirin","CC(=O)Oc1ccccc1C(=O)O"),
             ("caffeine","Cn1cnc2c1c(=O)n(C)c(=O)n2C"), ("glucose","OCC1OC(O)C(O)C(O)C1O"),
             ("arginine","N[C@@H](CCCNC(=N)N)C(=O)O")]
    print("%-10s %10s %12s %10s %10s" % ("mol","Gpol_water","dGtrans_bbb","nonpolASA","dGelec"))
    for name, smi in tests:
        f = features(smi, "bbb")
        if f: print("%-10s %10.1f %12.1f %10.1f %10.1f" % (name, f[0], f[1], f[2], f[3]))
