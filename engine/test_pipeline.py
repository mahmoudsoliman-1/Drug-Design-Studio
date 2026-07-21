"""End-to-end: prepare 1HSG receptor + a ligand, run real Vina, parse, analyse."""
import os, time, urllib.request
from ddsengine import prep, dock, interactions

t0 = time.time()
pdb = (open("/tmp/1hsg.pdb").read() if os.path.exists("/tmp/1hsg.pdb")
       else urllib.request.urlopen("https://files.rcsb.org/download/1HSG.pdb").read().decode())

print("1) preparing receptor (1HSG)...")
rec_pdbqt, prot_pdb, meta = prep.prepare_receptor(pdb)
print("   atoms=%d residues=%d center=%s ligands=%s" %
      (meta["n_atoms"], meta["n_residues"], meta["center"], meta["detected_ligands"]))

print("2) preparing ligand (SMILES)...")
smiles = "CC(C)Cc1ccc(cc1)C(C)C(=O)Nc1ncccn1"  # a drug-like test compound
lig_pdbqt, props = prep.prepare_ligand(smiles=smiles)
print("   props=%s" % props)

print("3) running AutoDock Vina (exhaustiveness=8)...")
res = dock.run_vina(rec_pdbqt, lig_pdbqt, meta["center"], meta["box"],
                    scoring="vina", exhaustiveness=8, num_modes=9)
print("   %d poses:" % len(res["poses"]))
for p in res["poses"][:5]:
    print("     pose %d  affinity %.1f kcal/mol  rmsd_ub %.2f" % (p["pose"], p["affinity"], p["rmsd_ub"]))

print("4) interaction analysis on top pose...")
top = res["poses"][0]
inter = interactions.detect(rec_pdbqt, top["pdbqt"])
for it in inter:
    print("     %-8s %-12s %.1f A" % (it["residue"], it["type"], it["distance"]))

print("done in %.1fs" % (time.time() - t0))
