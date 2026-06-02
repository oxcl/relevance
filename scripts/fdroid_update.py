#!/usr/bin/env python3
"""Monkey-patch androguard NoOverwriteDict bug before running fdroid update."""
import sys

# Find and patch NoOverwriteDict wherever it's defined
try:
    import androguard.core.apk as apk_mod
    
    # Find the class used for _v2_blocks
    if hasattr(apk_mod, 'NoOverwriteDict'):
        _orig = apk_mod.NoOverwriteDict
    else:
        # Search for it in the module's namespace
        for name in dir(apk_mod):
            obj = getattr(apk_mod, name)
            if isinstance(obj, type) and 'NoOverwrite' in name:
                _orig = obj
                break
        else:
            # If not found, create a simple dict subclass that supports append
            _orig = dict
    
    class PatchedDict(_orig):
        def append(self, item):
            if isinstance(item, tuple):
                key = item[0]
            else:
                key = getattr(item, 'id', len(self))
            self[key] = item
    
    # Patch it wherever it's referenced
    if hasattr(apk_mod, 'NoOverwriteDict'):
        apk_mod.NoOverwriteDict = PatchedDict
    
    # Also patch the APK class's _v2_blocks initialization
    _orig_init = apk_mod.APK.__init__
    def _patched_init(self, *args, **kwargs):
        _orig_init(self, *args, **kwargs)
        if hasattr(self, '_v2_blocks') and not hasattr(self._v2_blocks, 'append'):
            # Convert to our patched dict
            old = self._v2_blocks
            new = PatchedDict(old)
            self._v2_blocks = new
    apk_mod.APK.__init__ = _patched_init
    
except Exception as e:
    print(f"Warning: Could not patch androguard: {e}", file=sys.stderr)

# Now run fdroid update
from fdroidserver.__main__ import main
sys.argv = ['fdroid', 'update', '--create-metadata']
main()
