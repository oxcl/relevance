#!/usr/bin/env python3
"""Monkey-patch androguard NoOverwriteDict bug, then run fdroid update."""
import os
import sys

# Monkey-patch androguard BEFORE importing fdroidserver
try:
    import androguard.core.apk as apk_mod

    # Debug: check what NoOverwriteDict is
    if hasattr(apk_mod, 'NoOverwriteDict'):
        _orig = apk_mod.NoOverwriteDict
        print(f"Found NoOverwriteDict: {_orig}", file=sys.stderr)
    else:
        # Search for it
        _orig = None
        for name in dir(apk_mod):
            obj = getattr(apk_mod, name)
            if isinstance(obj, type) and 'NoOverwrite' in name:
                _orig = obj
                print(f"Found {name}: {_orig}", file=sys.stderr)
                break
        if _orig is None:
            _orig = dict
            print("NoOverwriteDict not found, using dict", file=sys.stderr)

    # Add append method directly to the class
    def _append(self, item):
        key = item[0] if isinstance(item, tuple) else getattr(item, 'id', len(self))
        self[key] = item

    _orig.append = _append
    print(f"Patched {_orig} with append method", file=sys.stderr)

    # Also patch APK.__init__ to fix existing instances
    _orig_init = apk_mod.APK.__init__

    def _patched_init(self, *args, **kwargs):
        _orig_init(self, *args, **kwargs)
        if hasattr(self, '_v2_blocks') and not hasattr(self._v2_blocks, 'append'):
            self._v2_blocks.__class__ = _orig  # Force class change
            print(f"Patched _v2_blocks instance: {type(self._v2_blocks)}", file=sys.stderr)

    apk_mod.APK.__init__ = _patched_init
except Exception as e:
    print(f"Warning: Could not patch androguard: {e}", file=sys.stderr)

# Change to fdroid directory if it exists
fdroid_dir = os.path.join(os.getcwd(), 'fdroid')
if os.path.exists(fdroid_dir):
    os.chdir(fdroid_dir)

# Set up argv for fdroidserver
sys.argv = ['fdroid update', '--create-metadata']

# Import and run fdroidserver update directly
import fdroidserver.update
fdroidserver.update.main()
