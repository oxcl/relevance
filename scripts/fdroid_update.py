#!/usr/bin/env python3
"""Monkey-patch androguard NoOverwriteDict bug, then run fdroid update."""
import os
import sys

# Find and patch NoOverwriteDict in any androguard module
try:
    import androguard
    
    # Search all androguard submodules for NoOverwriteDict
    _orig = None
    _module = None
    
    for mod_name in ['androguard.core.apk', 'androguard.core.dex', 'androguard.core.bytecode', 'androguard.util']:
        try:
            mod = __import__(mod_name, fromlist=[''])
            if hasattr(mod, 'NoOverwriteDict'):
                _orig = mod.NoOverwriteDict
                _module = mod
                break
        except ImportError:
            pass
    
    if _orig is None:
        # Search all attributes of androguard.core.apk
        import androguard.core.apk as apk_mod
        for name in dir(apk_mod):
            obj = getattr(apk_mod, name)
            if isinstance(obj, type) and 'NoOverwrite' in name:
                _orig = obj
                _module = apk_mod
                break
    
    if _orig is not None:
        # Add append method directly to the class
        def _append(self, item):
            key = item[0] if isinstance(item, tuple) else getattr(item, 'id', len(self))
            self[key] = item
        
        _orig.append = _append
        
        # Also patch APK.__init__ to fix existing instances
        import androguard.core.apk as apk_mod
        _orig_init = apk_mod.APK.__init__
        
        def _patched_init(self, *args, **kwargs):
            _orig_init(self, *args, **kwargs)
            if hasattr(self, '_v2_blocks') and not hasattr(self._v2_blocks, 'append'):
                self._v2_blocks.__class__ = _orig
        
        apk_mod.APK.__init__ = _patched_init
    else:
        print("Warning: NoOverwriteDict not found in androguard", file=sys.stderr)
        
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
