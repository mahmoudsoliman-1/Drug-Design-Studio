"""Run AutoDock Vina (bundled binary) and parse its output."""
import os
import subprocess
import tempfile

from .paths import vina_path

VINA = vina_path()


def run_vina(receptor_pdbqt, ligand_pdbqt, center, size,
             scoring="vina", exhaustiveness=16, num_modes=9, workdir=None):
    workdir = workdir or tempfile.mkdtemp(prefix="dds_")
    rpath = os.path.join(workdir, "receptor.pdbqt")
    lpath = os.path.join(workdir, "ligand.pdbqt")
    opath = os.path.join(workdir, "out.pdbqt")
    with open(rpath, "w") as f:
        f.write(receptor_pdbqt)
    with open(lpath, "w") as f:
        f.write(ligand_pdbqt)

    cmd = [
        VINA, "--receptor", rpath, "--ligand", lpath,
        "--center_x", str(center["x"]), "--center_y", str(center["y"]), "--center_z", str(center["z"]),
        "--size_x", str(size["x"]), "--size_y", str(size["y"]), "--size_z", str(size["z"]),
        "--exhaustiveness", str(int(exhaustiveness)), "--num_modes", str(int(num_modes)),
        "--out", opath, "--cpu", str(max(1, (os.cpu_count() or 2) - 1)),
    ]
    if scoring in ("vina", "vinardo"):
        cmd += ["--scoring", scoring]

    res = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if not os.path.exists(opath):
        raise RuntimeError("vina failed: %s" % ((res.stderr or res.stdout)[-600:]))

    poses = parse_out(opath)
    return {"poses": poses, "out_pdbqt_path": opath, "workdir": workdir, "log": res.stdout}


def parse_out(path):
    poses, cur, lines = [], None, []
    with open(path) as f:
        for line in f:
            if line.startswith("MODEL"):
                cur = {"pose": int(line.split()[1])}
                lines = []
            elif line.startswith("REMARK VINA RESULT:"):
                p = line.split()
                cur["affinity"] = float(p[3])
                cur["rmsd_lb"] = float(p[4])
                cur["rmsd_ub"] = float(p[5])
            elif line.startswith("ENDMDL"):
                cur["pdbqt"] = "".join(lines)
                poses.append(cur)
                cur = None
            elif cur is not None:
                lines.append(line)
    return poses
