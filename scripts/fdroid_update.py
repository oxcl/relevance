#!/usr/bin/env python3
"""Monkey-patch androguard _v2_blocks bug, then run fdroid update."""
import os
import sys

try:
    import androguard.core.apk as apk_mod

    # Create a patched APK.__init__ that adds append to NoOverwriteDict
    _orig_init = apk_mod.APK.__init__
    _patched_classes = set()

    def _patched_init(self, *args, **kwargs):
        _orig_init(self, *args, **kwargs)
        # Get the actual class of _v2_blocks and add append to it
        blocks = self._v2_blocks
        cls = type(blocks)
        cls_id = id(cls)
        if cls_id not in _patched_classes:
            _patched_classes.add(cls_id)
            # Add append as a bound method to the class
            def _append(instance, item):
                key = getattr(item, 'id', len(instance))
                instance[key] = item
            try:
                cls.append = _append
            except TypeError:
                pass  # immutable type, can't patch

    apk_mod.APK.__init__ = _patched_init
except Exception as e:
    print(f"Warning: Could not patch androguard: {e}", file=sys.stderr)

fdroid_dir = os.path.join(os.getcwd(), 'fdroid')
if os.path.exists(fdroid_dir):
    os.chdir(fdroid_dir)

sys.argv = ['fdroid update', '--create-metadata']
import fdroidserver.update
fdroidserver.update.main()
