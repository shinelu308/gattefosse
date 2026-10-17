#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
清理嘉法狮项目里残留的旧机器绝对路径

背景：项目从 E:\项目开发区\嘉法狮网站重建 迁到 D:\workbuddy\gattefosse，
      部分开发脚本与交付文档仍写着旧路径，换机后失效。

规则：
  - 交付文档（docs/ 下的 .html）→ 改成相对路径，方便对外发给员工
  - 其余 .js/.py/.bat/.ps1    → 旧绝对路径换成新绝对路径，保持斜杠风格
"""
import io
import os
import re

ROOT = r"D:\workbuddy\gattefosse"
OLD = re.compile(r"[Ee]:[\\/]{1,2}项目开发区[\\/]{1,2}嘉法狮网站重建")

TARGETS = [
    r"backend\scripts\audit-page-blocks.js",
    r"backend\scripts\check-career-admin.js",
    r"backend\scripts\e2e-career-save.js",
    r"backend\scripts\e2e-job-form.js",
    r"backend\scripts\extract-robot-poster.js",
    r"backend\scripts\verify-admin-mobile-robots.js",
    r"backend\scripts\shot-career-admin.js",
    r"scripts\verify-pub-pages.js",
    r"scripts\verify-pub-admin.js",
    r"scripts\match_formulation_tags.py",
    r"scripts\match_formulation_tags_v2.py",
    r"_fix_login.py",
    r"_fix_login2.py",
]


def new_abs(sep, depth):
    """按原分隔符风格与转义层数生成新绝对路径"""
    return "D:" + sep + "workbuddy" + sep + "gattefosse"


def sub_abs(text):
    def rep(m):
        s = m.group(0)
        sep = "\\" if "\\" in s else "/"
        cnt = s.count(sep)
        return new_abs(sep * cnt, 1)
    return OLD.subn(rep, text)


def main():
    total = 0
    for rel in TARGETS:
        fp = os.path.join(ROOT, rel)
        if not os.path.exists(fp):
            print(f"  跳过（不存在）{rel}")
            continue
        with io.open(fp, "r", encoding="utf-8", errors="surrogateescape") as f:
            raw = f.read()
        out, n = sub_abs(raw)
        if n:
            with io.open(fp, "w", encoding="utf-8", errors="surrogateescape", newline="") as f:
                f.write(out)
            print(f"  {rel}: {n} 处 → D:\\workbuddy\\gattefosse")
            total += n
        else:
            print(f"  {rel}: 无命中")
    print(f"\n合计替换 {total} 处")

    # 交付文档单独处理：图片改相对路径
    doc = os.path.join(ROOT, "docs", "账号交付", "Gattefosse-员工账号使用说明.html")
    if os.path.exists(doc):
        with io.open(doc, "r", encoding="utf-8", errors="surrogateescape") as f:
            raw = f.read()
        # E:/.../嘉法狮网站重建/admin/outputs/x.png -> ../../admin/outputs/x.png
        pat = re.compile(r"[Ee]:[\\/]{1,2}项目开发区[\\/]{1,2}嘉法狮网站重建[\\/]{1,2}")
        out, n = pat.subn("../../", raw)
        if n:
            with io.open(doc, "w", encoding="utf-8", errors="surrogateescape", newline="") as f:
                f.write(out)
            print(f"  docs/账号交付/Gattefosse-员工账号使用说明.html: {n} 处 → ../../ 相对路径")
        else:
            print("  交付文档: 无命中")


if __name__ == "__main__":
    main()
