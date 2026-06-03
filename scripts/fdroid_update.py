#!/usr/bin/env python3
"""Fix androguard NoOverwriteDict bug, then run fdroid update."""
import os
import sys

try:
    import androguard.core.apk as apk_mod
    apk_file = apk_mod.__file__
    
    with open(apk_file, 'r') as f:
        content = f.read()
    
    old_line = 'self._v2_blocks.append(APKV2SignatureBlock(key, is_duplicate_id, value))'
    if old_line in content:
        lines = content.split('\n')
        new_lines = []
        for line in lines:
            if old_line in line:
                indent = len(line) - len(line.lstrip())
                sp = ' ' * indent
                # Use try/except instead of hasattr — handles weird __getattr__ implementations
                new_lines.append(f'{sp}try:')
                new_lines.append(f'{sp}    self._v2_blocks.append(APKV2SignatureBlock(key, is_duplicate_id, value))')
                new_lines.append(f'{sp}except (AttributeError, TypeError):')
                new_lines.append(f'{sp}    self._v2_blocks[key] = APKV2SignatureBlock(key, is_duplicate_id, value)')
            else:
                new_lines.append(line)
        
        with open(apk_file, 'w') as f:
            f.write('\n'.join(new_lines))
        print(f"Patched androguard: {apk_file}", file=sys.stderr)
except Exception as e:
    print(f"Warning: Could not patch androguard: {e}", file=sys.stderr)

fdroid_dir = os.path.join(os.getcwd(), 'fdroid')
if os.path.exists(fdroid_dir):
    os.chdir(fdroid_dir)

sys.argv = ['fdroid update', '--create-metadata']
import fdroidserver.update
fdroidserver.update.main()
