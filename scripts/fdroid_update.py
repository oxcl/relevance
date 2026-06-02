#!/usr/bin/env python3
"""Monkey-patch androguard NoOverwriteDict bug, then run fdroid update."""
import subprocess
import sys

try:
    import androguard.core.apk as apk_mod

    _orig = getattr(apk_mod, 'NoOverwriteDict', dict)

    class PatchedDict(_orig):
        def append(self, item):
            key = item[0] if isinstance(item, tuple) else getattr(item, 'id', len(self))
            self[key] = item

    if hasattr(apk_mod, 'NoOverwriteDict'):
        apk_mod.NoOverwriteDict = PatchedDict

    _orig_init = apk_mod.APK.__init__

    def _patched_init(self, *args, **kwargs):
        _orig_init(self, *args, **kwargs)
        if hasattr(self, '_v2_blocks') and not hasattr(self._v2_blocks, 'append'):
            self._v2_blocks = PatchedDict(self._v2_blocks)

    apk_mod.APK.__init__ = _patched_init
except Exception as e:
    print(f"Warning: Could not patch androguard: {e}", file=sys.stderr)

r = subprocess.run(['fdroid', 'update', '--create-metadata'])
sys.exit(r.returncode)
