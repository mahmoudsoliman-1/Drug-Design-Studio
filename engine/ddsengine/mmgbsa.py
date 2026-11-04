"""In-app interface to the ssMM/GBSA binding-energy engine.

The binding-energy calculation (OpenMM + GBn2 + Amber ff14SB/GAFF2, MMFF94 or
AM1-BCC ligand charges) runs in a separate, self-contained Python environment
rather than inside the light DDS application, so the app itself stays small and
free of heavy scientific dependencies. This module locates that engine
environment, hands it the docked (or loaded) complex, and returns the parsed
binding free energy and its component decomposition.

If the engine environment is not present, `engine_available()` returns False and
`run()` returns {"error": "engine_not_installed"}, so the interface can offer a
one-time engine setup rather than failing.
"""
import os
import sys
import json
import shutil
import platform
import tarfile
import zipfile
import tempfile
import subprocess
import urllib.request

from . import paths

ENGINE_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mmgbsa_engine.py")

# ---------------------------------------------------------------------------
# One-time engine setup (fetch-on-first-use).
#
# The binding-energy engine (OpenMM + AmberTools + RDKit) is NOT bundled with
# the app. On first use it is downloaded as a single self-contained archive and
# unpacked into the app's own data folder, so the app installer stays small and
# only users who want ΔG pay the one-time cost. Fill in the per-platform URLs
# below once the bundles are hosted (or set DDS_MMGBSA_BUNDLE_URL to override).
#
# Bundle = a relocatable conda environment archive (e.g. built with conda-pack)
# named engine.tar.gz / engine.zip, whose interpreter lives at bin/python
# (Scripts\\python.exe on Windows). If it contains bin/conda-unpack it is run
# after extraction to fix up absolute paths.
# ---------------------------------------------------------------------------
BUNDLE_URLS = {
    "darwin-arm64": "",
    "darwin-x86_64": "",
    "win-amd64": "",
    "linux-x86_64": "",
}


def _platform_key():
    mach = platform.machine().lower()
    if sys.platform == "darwin":
        return "darwin-arm64" if mach in ("arm64", "aarch64") else "darwin-x86_64"
    if sys.platform.startswith("win"):
        return "win-amd64"
    return "linux-x86_64"


def bundle_url():
    """URL of the engine bundle for this platform, or None if not configured."""
    return os.environ.get("DDS_MMGBSA_BUNDLE_URL") or BUNDLE_URLS.get(_platform_key()) or None


def installable():
    """True when an engine bundle is configured for this platform (so the app
    can offer a one-time download) and the engine is not already present."""
    return bundle_url() is not None and engine_python() is None


def engine_dir():
    return os.path.join(paths.data_dir(), "mmgbsa-engine")


def _post_extract_fixup(root):
    """Run conda-unpack if present so a relocated conda env fixes its own paths;
    return the interpreter path inside `root`, or None."""
    win = sys.platform.startswith("win")
    unpack = os.path.join(root, "Scripts", "conda-unpack.exe") if win else os.path.join(root, "bin", "conda-unpack")
    if os.path.exists(unpack):
        try:
            subprocess.run([unpack], cwd=root, check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
    exe = os.path.join(root, "Scripts", "python.exe") if win else os.path.join(root, "bin", "python")
    return exe if os.path.exists(exe) else None


def install_engine(progress=None):
    """Download and unpack the engine bundle into the app data folder.
    `progress(done_bytes, total_bytes)` is called during download. Returns
    {"ok": True} on success or {"error": ...} otherwise."""
    url = bundle_url()
    if not url:
        return {"error": "no_bundle",
                "message": "No binding-energy engine is available for this platform yet."}
    dest = engine_dir()
    work = tempfile.mkdtemp(prefix="dds_engine_dl_")
    archive = os.path.join(work, "engine" + (".zip" if url.lower().endswith(".zip") else ".tar.gz"))
    try:
        # 1) stream the download with progress
        req = urllib.request.Request(url, headers={"User-Agent": "DrugDesignStudio"})
        with urllib.request.urlopen(req, timeout=60) as r:
            total = int(r.headers.get("Content-Length") or 0)
            done = 0
            with open(archive, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk); done += len(chunk)
                    if progress:
                        progress(done, total)
        # 2) extract into a fresh folder next to the final location, then swap
        staging = os.path.join(work, "extract")
        os.makedirs(staging, exist_ok=True)
        if archive.endswith(".zip"):
            with zipfile.ZipFile(archive) as z:
                z.extractall(staging)
        else:
            with tarfile.open(archive, "r:*") as t:
                t.extractall(staging)
        # a bundle may extract directly, or into a single top-level folder
        entries = [os.path.join(staging, e) for e in os.listdir(staging)]
        root = entries[0] if len(entries) == 1 and os.path.isdir(entries[0]) else staging
        if _post_extract_fixup(root) is None:
            return {"error": "bad_bundle", "message": "Downloaded engine is missing its interpreter."}
        # 3) atomically replace any existing engine
        os.makedirs(paths.data_dir(), exist_ok=True)
        if os.path.exists(dest):
            shutil.rmtree(dest, ignore_errors=True)
        shutil.move(root, dest)
        if engine_python() is None:
            return {"error": "verify_failed", "message": "Engine installed but could not be located."}
        return {"ok": True, "path": dest}
    except Exception as e:
        return {"error": "install_failed", "detail": str(e)[:200]}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _candidate_pythons():
    """Ordered locations to look for the engine interpreter."""
    # 1) explicit override
    env = os.environ.get("DDS_MMGBSA_PY")
    if env:
        yield env
    # 2) engine fetched into the per-user app-data folder (the one-time setup target)
    base = os.path.join(paths.data_dir(), "mmgbsa-engine")
    exe = "python.exe" if sys.platform.startswith("win") else "python"
    yield os.path.join(base, "bin", exe)
    yield os.path.join(base, exe)
    # 3) development fallback (the environment used to build/validate the method)
    yield os.path.expanduser("~/Desktop/DDS_MMGBSA/tools/mm_root/envs/mmgbsa/bin/python")


def engine_python():
    """Return the path to a usable engine interpreter, or None if not installed."""
    for p in _candidate_pythons():
        if p and os.path.exists(p):
            return p
    return None


def engine_available():
    return engine_python() is not None


def run(complex_pdb, ligand_smiles=None, charges="mmff94", steps=1000, entropy_c=0.0, timeout=1800):
    """Compute the single-structure MM-GBSA binding free energy for a complex.

    complex_pdb   : PDB text of the protein-ligand complex (docked pose or loaded).
    ligand_smiles : ligand SMILES, used to assign correct bond orders (recommended).
    charges       : 'mmff94' (fast, classical, default) or 'am1bcc' (higher cost).
    steps         : safety ceiling on minimisation steps (convergence stops earlier).
    entropy_c     : rotatable-bond entropy coefficient (kcal/mol per bond; 0 = off).

    Returns the engine result dict (binding energy, component decomposition,
    minimised complex PDB), or {"error": ...} on failure.
    """
    py = engine_python()
    if py is None:
        return {"error": "engine_not_installed",
                "message": "The binding-energy engine is not installed. Run the one-time setup to enable ssMM/GBSA."}
    if not complex_pdb or not complex_pdb.strip():
        return {"error": "no complex provided"}

    wd = tempfile.mkdtemp(prefix="dds_mmgbsa_")
    try:
        cpath = os.path.join(wd, "complex.pdb")
        opath = os.path.join(wd, "result.json")
        with open(cpath, "w") as f:
            f.write(complex_pdb)
        cmd = [py, ENGINE_SCRIPT, cpath, (ligand_smiles or "-"),
               str(charges), str(int(steps)), str(float(entropy_c)), opath]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if os.path.exists(opath):
            res = json.load(open(opath))
        else:
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-3:]
            res = {"error": "engine failed", "detail": " | ".join(tail)}
        return res
    except subprocess.TimeoutExpired:
        return {"error": "timeout", "message": "The binding-energy calculation exceeded the time limit."}
    except Exception as e:
        return {"error": "engine failed", "detail": str(e)[:200]}
    finally:
        shutil.rmtree(wd, ignore_errors=True)
