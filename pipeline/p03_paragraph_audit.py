# -*- coding: utf-8 -*-
"""P03.1 paragraph audit: sample-topic slices <-> rendered natural paragraphs.

Mirrors app.js fmtText(): raw.split(/\\n+/) -> trim -> drop empty.
For each sample paragraph id, compute its char offset range in the concatenated
slice text, then map that range onto rendered paragraphs (whitespace-normalised).
Outputs a reviewable report; never renumbers sample ids.
"""
import json, os, sys, re

BASE = os.path.join(os.path.dirname(__file__), "..", "site")
SAMPLE = os.path.join(BASE, "data", "sample-topic.json")
TEXTS = os.path.join(BASE, "data", "texts")

def norm(s):
    return re.sub(r"\s+", "", s or "")

def render_paras(raw):
    """Same rule as app.js fmtText(): split on newlines, trim, drop empty."""
    out = []
    for t in re.split(r"\n+", raw):
        t = t.strip()
        if t:
            out.append(t)
    return out

def main():
    d = json.load(open(SAMPLE, encoding="utf-8"))
    arts = d.get("articles", {})
    report = []
    total_ok = 0
    total_fail = 0
    for aid, art in arts.items():
        txt_path = os.path.join(TEXTS, aid + ".txt")
        if not os.path.isfile(txt_path):
            report.append((aid, "NO_TEXT_FILE", 0, 0, []))
            continue
        raw = open(txt_path, encoding="utf-8", errors="replace").read()
        dom = render_paras(raw)
        dom_norm = [norm(x) for x in dom]
        # cumulative offsets of rendered paragraphs
        offs = []
        acc = 0
        for s in dom_norm:
            offs.append((acc, acc + len(s)))
            acc += len(s)
        total_chars = acc

        slices = art.get("paragraphs", [])
        sample_full = "".join(norm(p.get("text", "")) for p in slices)
        mismatches = []
        ok = 0
        cur = 0
        for p in slices:
            t = norm(p.get("text", ""))
            start, end = cur, cur + len(t)
            cur = end
            # locate rendered paragraph(s) covering [start, end)
            hit = [i for i, (a, b) in enumerate(offs) if a < end and b > start]
            if hit:
                ok += 1
            else:
                mismatches.append((p.get("id"), t[:24], start, end))
        # text equality between sample-concat and rendered-concat (whitespace-free)
        dom_full = "".join(dom_norm)
        identical = (sample_full == dom_full)
        report.append((aid, "OK" if identical else "TEXT_DIFF", len(slices), ok, mismatches[:5] + [("identical", identical), ("sample_chars", len(sample_full)), ("dom_chars", len(dom_full)), ("dom_paras", len(dom))]))
        total_ok += ok
        total_fail += (len(slices) - ok)

    print("=== P03.1 段落对账报告 ===")
    for r in report:
        print(json.dumps(r, ensure_ascii=False))
    print("样本段落总数:", total_ok + total_fail, "可定位:", total_ok, "不可定位:", total_fail)

if __name__ == "__main__":
    main()
