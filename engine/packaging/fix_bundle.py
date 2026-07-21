"""Post-build fixup: PyInstaller mangles the dotted OpenBabel version dir
(3.1.0 -> 3__dot__1__dot__0), but OpenBabel's __init__ looks up the dotted name
via BABEL_LIBDIR/BABEL_DATADIR. Rename it back and make the data dir resolvable.

Usage: python fix_bundle.py <path-to-.app or dist dir>
"""
import os
import sys

OBVER = "3.1.0"
MANGLED = "3__dot__1__dot__0"


def fix_macos_app(app):
    contents = os.path.join(app, "Contents")
    fw = os.path.join(contents, "Frameworks")
    res = os.path.join(contents, "Resources")

    mang = os.path.join(fw, "openbabel/lib/openbabel", MANGLED)
    good = os.path.join(fw, "openbabel/lib/openbabel", OBVER)
    if os.path.isdir(mang) and not os.path.exists(good):
        os.rename(mang, good)
        print("renamed plugin dir ->", good)

    fw_share = os.path.join(fw, "openbabel/share/openbabel", OBVER)
    res_share = os.path.join(res, "openbabel/share/openbabel", OBVER)
    if not os.path.exists(fw_share) and os.path.isdir(res_share):
        os.makedirs(os.path.dirname(fw_share), exist_ok=True)
        os.symlink(os.path.relpath(res_share, os.path.dirname(fw_share)), fw_share)
        print("linked data dir ->", fw_share)


def fix_windows_dir(root):
    # onedir layout: <root>/_internal/openbabel/lib/openbabel/<mangled>
    base = os.path.join(root, "_internal", "openbabel", "lib", "openbabel")
    mang, good = os.path.join(base, MANGLED), os.path.join(base, OBVER)
    if os.path.isdir(mang) and not os.path.exists(good):
        os.rename(mang, good)
        print("renamed plugin dir ->", good)


def main():
    target = sys.argv[1]
    if target.endswith(".app") or sys.platform == "darwin":
        fix_macos_app(target)
    else:
        fix_windows_dir(target)


if __name__ == "__main__":
    main()
