#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""检查页面引用的静态资源是否 404"""
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "http://127.0.0.1:3000"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

PAGES = sys.argv[1:] or ["/", "/admin/"]


def fetch(path):
    try:
        with opener.open(BASE + path, timeout=20) as r:
            return r.status, r.read()
    except Exception as e:
        return getattr(e, "code", 0), str(e).encode()


def collect(html, page):
    txt = html.decode("utf-8", "ignore")
    urls = set()
    for m in re.finditer(r'<script[^>]+src=["\']([^"\']+)', txt, re.I):
        urls.add(m.group(1))
    for m in re.finditer(r'<link[^>]+href=["\']([^"\']+)', txt, re.I):
        if re.search(r'\.(css|ico|png|svg|woff2?)(\?|$)', m.group(1), re.I):
            urls.add(m.group(1))
    for m in re.finditer(r'<img[^>]+src=["\']([^"\']+)', txt, re.I):
        urls.add(m.group(1))
    out = []
    for u in urls:
        if u.startswith(("data:", "http://", "https://", "//", "javascript:", "#")):
            continue
        out.append(urllib.parse.urljoin(page, u))
    return out


VALID_EXT = (".css", ".js", ".mjs", ".png", ".jpg", ".jpeg", ".webp",
             ".gif", ".svg", ".ico", ".woff2", ".woff", ".ttf", ".mp4", ".json")
# Vue 绑定表达式 / 模板占位符的特征，这些不是真实路径
TPL_HINT = re.compile(r"[{}\[\]|+`$]|^\s*\w+\.\w+\s*$|\|\|")


def check(u):
    """只对真正的静态文件发请求；模板表达式直接跳过（返回 None）"""
    path = u.split("?")[0].split("#")[0]
    if TPL_HINT.search(path):
        return None
    if not path.lower().endswith(VALID_EXT):
        return None
    try:
        req = urllib.request.Request(BASE + u, method="HEAD")
        with opener.open(req, timeout=15) as r:
            return u, r.status
    except Exception as e:
        code = getattr(e, "code", 0)
        if code in (403, 405):
            return u, code
        return u, code or "ERR"


for page in PAGES:
    st, body = fetch(page)
    if st != 200:
        print(f"\n[{page}] 页面本身异常: {st}")
        continue
    refs = collect(body, page)
    print(f"\n[{page}] 页面 {st}，引用本地资源 {len(refs)} 个（过滤模板表达式后）")
    bad = []
    skipped = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for res in ex.map(check, refs):
            if res is None:
                skipped += 1
                continue
            u, code = res
            ok = code == 200 or code in (304, 403)
            if not ok:
                bad.append((u, code))
    print(f"  实际探测 {len(refs)-skipped} 个，跳过模板表达式 {skipped} 个")
    if bad:
        print(f"  404/异常 {len(bad)} 个：")
        for u, c in sorted(bad)[:25]:
            print(f"    {c}  {u}")
    else:
        print("  全部可访问 ✅")
