#!/usr/bin/env python3
"""Monkey-patch androguard _v2_blocks bug, then run fdroid update."""
import os
import sys

try:
    import androguard.core.apk as apk_mod

    class AppendableDict(dict):
        """Dict that also supports .append() like a list."""
        def append(self, item):
            key = getattr(item, 'id', len(self))
            self[key] = item

    _orig_init = apk_mod.APK.__init__

    def _patched_init(self, *args, **kwargs):
        _orig_init(self, *args, **kwargs)
        if isinstance(self._v2_blocks, dict) and not hasattr(self._v2_blocks, 'append'):
            self._v2_blocks = AppendableDict(self._v2_blocks)

    apk_mod.APK.__init__ = _patched_init
except Exception as e:
    print(f"Warning: Could not patch androguard: {e}", file=sys.stderr)

fdroid_dir = os.path.join(os.getcwd(), 'fdroid')
if os.path.exists(fdroid_dir):
    os.chdir(fdroid_dir)

sys.argv = ['fdroid update', '--create-metadata']
import fdroidserver.update
fdroidserver.update.main()
