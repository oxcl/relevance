#!/usr/bin/env python3
"""Fix androguard NoOverwriteDict bug, then run fdroid update."""
import os
import subprocess
import sys

# Fix androguard source code directly
try:
    import androguard.core.apk as apk_mod
    apk_file = apk_mod.__file__
    
    with open(apk_file, 'r') as f:
        content = f.read()
    
    # Replace self._v2_blocks.append(...) with a try/except that handles dict
    if 'self._v2_blocks.append(' in content:
        # Replace the problematic line with one that handles both list and dict
        content = content.replace(
            'self._v2_blocks.append(APKV2SignatureBlock(key, is_duplicate_id, value))',
            '''try:
                    self._v2_blocks.append(APKV2SignatureBlock(key, is_duplicate_id, value))
                except AttributeError:
                    self._v2_blocks[key] = APKV2SignatureBlock(key, is_duplicate_id, value)'''
        )
        with open(apk_file, 'w') as f:
            f.write(content)
        print(f"Patched androguard: {apk_file}", file=sys.stderr)
except Exception as e:
    print(f"Warning: Could not patch androguard source: {e}", file=sys.stderr)

fdroid_dir = os.path.join(os.getcwd(), 'fdroid')
if os.path.exists(fdroid_dir):
    os.chdir(fdroid_dir)

sys.argv = ['fdroid update', '--create-metadata']
import fdroidserver.update
fdroidserver.update.main()
