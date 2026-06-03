#!/usr/bin/env python3
"""Monkey-patch androguard _v2_blocks bug, then run fdroid update."""
import os
import sys

try:
    import androguard.core.apk as apk_mod

    # Patch __init__ to find and fix NoOverwriteDict on the instance
    _orig_init = apk_mod.APK.__init__

    def _patched_init(self, *args, **kwargs):
        _orig_init(self, *args, **kwargs)
        blocks = self._v2_blocks
        # Add append method to the class if missing
        cls = type(blocks)
        if not hasattr(cls, 'append'):
            def _append(self_dict, item):
                key = item[0] if isinstance(item, tuple) else getattr(item, 'id', len(self_dict))
                self_dict[key] = item
            cls.append = _append

    apk_mod.APK.__init__ = _patched_init
except Exception as e:
    print(f"Warning: Could not patch androguard: {e}", file=sys.stderr)

fdroid_dir = os.path.join(os.getcwd(), 'fdroid')
if os.path.exists(fdroid_dir):
    os.chdir(fdroid_dir)

sys.argv = ['fdroid update', '--create-metadata']
import fdroidserver.update
fdroidserver.update.main()
