#!/usr/bin/env python3
"""Monkey-patch androguard _v2_blocks bug, then run fdroid update."""
import os
import sys

# Monkey-patch androguard BEFORE importing fdroidserver
try:
    import androguard.core.apk as apk_mod

    # Patch APK.__init__ to convert _v2_blocks from dict to list
    _orig_init = apk_mod.APK.__init__

    def _patched_init(self, *args, **kwargs):
        _orig_init(self, *args, **kwargs)
        # If _v2_blocks is a dict (older androguard), convert to list
        if isinstance(self._v2_blocks, dict):
            self._v2_blocks = list(self._v2_blocks.values())

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
