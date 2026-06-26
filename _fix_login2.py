#!/usr/bin/env python3
import os
import re

site_dir = r'E:\项目开发区\嘉法狮网站重建\site'

count = 0
for root, dirs, files in os.walk(site_dir):
    for fname in files:
        if not fname.endswith('.html'):
            continue
        fpath = os.path.join(root, fname)
        # 用 latin-1 读取（永不失败）
        with open(fpath, 'r', encoding='latin-1') as f:
            content = f.read()
        
        original = content
        # 移除 <script>function checkLoginStatus() { return false; }</script>
        content = re.sub(
            r'<script>\s*function checkLoginStatus\(\)\s*\{\s*return false;\s*\}\s*</script>',
            '<script>/* checkLoginStatus 由 auth.js 统一管理 */</script>',
            content
        )
        # 移除多行版本
        content = re.sub(
            r'<script>\s*\n\s*function checkLoginStatus\(\)\s*\{\s*return false;\s*\}\s*\n\s*</script>',
            '<script>/* checkLoginStatus 由 auth.js 统一管理 */</script>',
            content
        )
        
        if content != original:
            with open(fpath, 'w', encoding='utf-8') as f:
                f.write(content)
            count += 1
            print('Fixed:', fpath.replace(site_dir, ''))

print(f'\n总共修复了 {count} 个文件')
