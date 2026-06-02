#!/usr/bin/env python3
"""Monkey-patch androguard NoOverwriteDict bug before running fdroid update."""
import sys

# Patch androguard's NoOverwriteDict before fdroidserver imports it
try:
    import androguard.core.apk as apk_mod
    _orig = apk_mod.NoOverwriteDict
    
    class PatchedNoOverwriteDict(_orig):
        def append(self, item):
            if isinstance(item, tuple):
                key = item[0]
            else:
                key = getattr(item, 'id', len(self))
            self[key] = item
    
    apk_mod.NoOverwriteDict = PatchedNoOverwriteDict
except ImportError:
    pass

# Now run fdroid update
from fdroidserver.__main__ import main
sys.argv = ['fdroid', 'update', '--create-metadata']
main()
