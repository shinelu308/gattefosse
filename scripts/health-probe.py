#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""嘉法狮站点体检：绕过系统代理，逐接口报告数据量"""
import json
import urllib.request

BASE = "http://127.0.0.1:3000"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

EPS = ["pc-ingredients", "formulations", "pharma-products", "news",
       "authors", "careers", "tags", "settings", "documents"]

print(f"{'接口':<22}{'HTTP':<7}{'条数':<10}说明")
print("-" * 62)
for ep in EPS:
    url = f"{BASE}/api/{ep}"
    try:
        with opener.open(url, timeout=15) as r:
            code = r.status
            body = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"{'/api/'+ep:<22}{'ERR':<7}{'-':<10}{e}")
        continue

    data = body.get("data") if isinstance(body, dict) else body
    n = "-"
    note = ""
    if isinstance(data, dict):
        if isinstance(data.get("list"), list):
            n = len(data["list"])
            pg = data.get("pagination") or {}
            total = pg.get("total")
            note = f"本页 {n}，总计 {total}" if total is not None else f"本页 {n}"
        elif isinstance(data.get("items"), list):
            n = len(data["items"]); note = f"{n} 条"
        else:
            note = "keys=" + ",".join(list(data.keys())[:5])
    elif isinstance(data, list):
        n = len(data); note = f"{n} 条"
    print(f"{'/api/'+ep:<22}{code:<7}{str(n):<10}{note}")

print("-" * 62)
