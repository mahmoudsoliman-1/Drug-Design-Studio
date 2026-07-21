"""Runtime hook: point OpenBabel at its bundled data/plugin dirs before import."""
import os
import sys

_base = getattr(sys, "_MEIPASS", None)
if _base:
    _ver = "3.1.0"
    _data = os.path.join(_base, "openbabel", "share", "openbabel", _ver)
    _lib = os.path.join(_base, "openbabel", "lib", "openbabel", _ver)
    if os.path.isdir(_data):
        os.environ["BABEL_DATADIR"] = _data
    if os.path.isdir(_lib):
        os.environ["BABEL_LIBDIR"] = _lib
