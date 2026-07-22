# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Drug Design Studio (engine + bundled UI + Vina)."""
import sys
from PyInstaller.utils.hooks import collect_all, collect_submodules, collect_data_files

datas, binaries, hiddenimports = [], [], []

# scientific stack + pywebview — collect everything (submodules, data, compiled libs)
for pkg in ("rdkit", "meeko", "openbabel", "gemmi", "scipy", "numpy", "webview"):
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception as e:  # noqa
        print("collect_all skipped %s: %s" % (pkg, e))

# pywebview platform backend (not always auto-detected)
if sys.platform == "darwin":
    hiddenimports += ["webview.platforms.cocoa"]
elif sys.platform.startswith("win"):
    hiddenimports += ["webview.platforms.edgechromium", "webview.platforms.winforms", "clr"]

# OpenBabel native tree: collect_all misses the format plugins (.so/.dll) and
# side dylibs. Ship them as binaries preserving the version subdir. NOTE: the
# bundler mangles the dotted "3.1.0" dir to "3__dot__1__dot__0"; the packaging
# build script renames it back afterwards so __init__'s BABEL_LIBDIR resolves.
import glob, os as _os, openbabel as _ob
_OB = _os.path.dirname(_ob.__file__)
_OBVER = "3.1.0"
_is_win = sys.platform.startswith("win")
_pluginext = "*.dll" if _is_win else "*.so"
_libext = "*.dll" if _is_win else "*.dylib"
for _so in glob.glob(_os.path.join(_OB, "lib", "openbabel", _OBVER, _pluginext)):
    binaries.append((_so, "openbabel/lib/openbabel/%s" % _OBVER))
for _dy in glob.glob(_os.path.join(_OB, "lib", _libext)):
    binaries.append((_dy, "openbabel/lib"))
if not _is_win:
    for _dy in glob.glob(_os.path.join(_OB, ".dylibs", "*")):
        binaries.append((_dy, "openbabel/.dylibs"))
datas += [(f, "openbabel/share/openbabel/%s" % _OBVER)
          for f in glob.glob(_os.path.join(_OB, "share", "openbabel", _OBVER, "*"))]

hiddenimports += collect_submodules("uvicorn")
hiddenimports += [
    "app", "ddsengine", "ddsengine.prep", "ddsengine.dock",
    "ddsengine.interactions", "ddsengine.analysis", "ddsengine.minimize",
    "ddsengine.paths",
]

# app resources: built UI + the Vina binary for this OS
datas += [("webdist", "webdist")]
vina_name = "vina.exe" if sys.platform.startswith("win") else "vina"
binaries += [("bin/%s" % vina_name, "bin")]

# bundle the AI key (.env is gitignored — key is inside the app, not the public source)
if _os.path.exists(".env"):
    datas += [(".env", ".")]

import os
_icns = "packaging/icon.icns" if os.path.exists("packaging/icon.icns") else None
_ico = "packaging/icon.ico" if os.path.exists("packaging/icon.ico") else None
_icon = _icns if sys.platform == "darwin" else _ico

a = Analysis(
    ["desktop.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=["packaging/rthook_openbabel.py"],
    excludes=["tkinter", "matplotlib"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz, a.scripts, [], exclude_binaries=True,
    name="DrugDesignStudio",
    console=False, disable_windowed_traceback=False,
    icon=_icon,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="DrugDesignStudio")

if sys.platform == "darwin":
    app = BUNDLE(
        coll, name="Drug Design Studio.app",
        icon=_icns,
        bundle_identifier="za.ac.ukzn.drugdesignstudio",
        info_plist={
            "NSHighResolutionCapable": True,
            "CFBundleShortVersionString": "1.0.0",
            # WKWebView blocks the local http://127.0.0.1 UI without this → blank white window
            "NSAppTransportSecurity": {
                "NSAllowsArbitraryLoads": True,
                "NSAllowsLocalNetworking": True,
            },
        },
    )
