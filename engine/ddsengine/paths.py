"""Resource-path resolution that works both in dev and inside a PyInstaller
bundle (where data files live under sys._MEIPASS)."""
import os
import sys


def resource_dir():
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return sys._MEIPASS
    # dev: the engine directory (parent of this ddsengine package)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def vina_path():
    override = os.environ.get("DDS_VINA")
    if override:
        return override
    name = "vina.exe" if sys.platform.startswith("win") else "vina"
    return os.path.join(resource_dir(), "bin", name)


def webdist_dir():
    return os.path.join(resource_dir(), "webdist")


def data_dir():
    """Writable location for jobs/complexes. Next to the engine in dev; a proper
    per-user app-data folder when packaged (the bundle itself is read-only)."""
    if getattr(sys, "frozen", False):
        if sys.platform == "darwin":
            base = os.path.expanduser("~/Library/Application Support/DrugDesignStudio")
        elif sys.platform.startswith("win"):
            base = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "DrugDesignStudio")
        else:
            base = os.path.expanduser("~/.drugdesignstudio")
    else:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(base, exist_ok=True)
    return base
