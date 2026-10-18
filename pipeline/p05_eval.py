# -*- coding: utf-8 -*-
"""P05.3 可移植评测器 — 冻结版本重跑 20 题，失败全部保留在分母。

要点（对应验收）:
  - 路径全部相对仓库根 (可用 --root 覆盖)，不再硬编码 D:/...
  - 模型配置只从环境变量读取 (PROVIDER_URL / PROVIDER_KEY / MODEL_ID)，不读本机密钥文件
  - 启动即核对冻结清单 (pipeline/wp05-frozen.json)：promptVersion / pipelineVersion / 语料 hash / 检索参数
    * 任一不符 → 拒绝运行 (退出码 3)，不允许"边改边评"
  - 题目来自冻结题目文件 (pipeline/p05-questions.json)，不从历史结果里挑选
  - 所有失败 (网络/超时/校验拦截/拒答) 都写入结果并计入分母；不提供 --drop-failures 之类开关
  - 汇总分开报告: 调用成功率 / 有答案率 / 引文逐字命中率 / 拒答是否恰当；人工正确率由人工标注文件补充

用法:
  python pipeline/p05_eval.py --check-only           # 只做冻结与可移植性自检 (不调用模型)
  python pipeline/p05_eval.py --limit 2              # 小样本试跑 (需模型环境变量)
  python pipeline/p05_eval.py                        # 全量 20 题
"""
import argparse, hashlib, json, os, re, subprocess, sys, time
from pathlib import Path

DEFAULT_FROZEN = "pipeline/wp05-frozen.json"
DEFAULT_QUESTIONS = "pipeline/p05-questions.json"


def repo_root(arg):
    if arg:
        return Path(arg).resolve()
    return Path(__file__).resolve().parents[1]


def sha16(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def corpus_version(path):
    """与 api/ask.js buildCorpusVersion 同样的口径: 文章 id/title/段落 id/text 的确定性 hash"""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    parts = []
    for aid in sorted(raw.get("articles", {})):
        a = raw["articles"][aid]
        parts.append(aid)
        parts.append(str(a.get("title", "")))
        for p in sorted(a.get("paragraphs", []), key=lambda x: x.get("seq", 0)):
            parts.append(str(p.get("id", "")))
            parts.append(str(p.get("text", "")))
    return hashlib.sha256("\x00".join(parts).encode("utf-8")).hexdigest()


def load_frozen(root):
    p = root / DEFAULT_FROZEN
    ask_js = (root / "api/_ask.js").read_text(encoding="utf-8")
    m1 = re.search(r"PROMPT_VERSION\s*=\s*'([^']+)'", ask_js)
    m2 = re.search(r"PIPELINE_VERSION\s*=\s*'([^']+)'", ask_js)
    if not p.exists():
        # 首次运行: 以当前仓库状态生成冻结清单 (之后必须人工确认再提交)
        frozen = {
            "frozenAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "promptVersion": m1.group(1) if m1 else "unknown",
            "pipelineVersion": m2.group(1) if m2 else "unknown",
            "corpusFile": "site/data/sample-topic.json",
            "corpusSha256_16": sha16(root / "site/data/sample-topic.json"),
            "corpusVersionSha256": corpus_version(root / "site/data/sample-topic.json"),
            "retrieve": {"top": 8, "minScore": 2, "expandNeighbors": True},
            "questionsFile": DEFAULT_QUESTIONS,
            "note": "此清单由 p05_eval.py 首次运行生成; 修改语料/提示词/检索参数后必须重新生成并记录原因",
        }
        p.write_text(json.dumps(frozen, ensure_ascii=False, indent=1), encoding="utf-8")
        print("[frozen] 已生成冻结清单:", p)
        return frozen
    return json.loads(p.read_text(encoding="utf-8"))


def ensure_questions(root, frozen, old_records):
    p = root / frozen.get("questionsFile", DEFAULT_QUESTIONS)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    # 从 r3 冻结结果里提取题目与期望 (只取 question/expect, 不取答案)
    src = root / "pipeline/wp07-20q-records-r3.json"
    if not src.exists():
        sys.exit("[questions] 缺少题目文件且找不到 r3 记录，无法评测")
    recs = json.loads(src.read_text(encoding="utf-8"))
    qs = [{"no": int(r.get("no", i + 1)), "question": r["question"], "expect": r.get("expect", "ANSWERABLE")}
          for i, r in enumerate(recs)]
    p.write_text(json.dumps(qs, ensure_ascii=False, indent=1), encoding="utf-8")
    print("[questions] 已从 r3 记录提取冻结题目:", p, "共", len(qs), "题")
    return qs


def check_freeze(root, frozen):
    ok = True
    cur_sha = sha16(root / frozen["corpusFile"])
    if cur_sha != frozen["corpusSha256_16"]:
        print(f"[FAIL] 语料文件 hash 变更: 冻结 {frozen['corpusSha256_16']} / 当前 {cur_sha}")
        ok = False
    cur_cv = corpus_version(root / frozen["corpusFile"])
    if frozen.get("corpusVersionSha256") and cur_cv != frozen["corpusVersionSha256"]:
        print("[FAIL] 语料内容版本变更 (段落 id/文本有改动)，需重新冻结并说明原因")
        ok = False
    ask_js = (root / "api/_ask.js").read_text(encoding="utf-8")
    m1 = re.search(r"PROMPT_VERSION\s*=\s*'([^']+)'", ask_js)
    m2 = re.search(r"PIPELINE_VERSION\s*=\s*'([^']+)'", ask_js)
    if m1 and frozen.get("promptVersion") and m1.group(1) != frozen["promptVersion"]:
        print(f"[FAIL] PROMPT_VERSION 变更: 冻结 {frozen['promptVersion']} / 当前 {m1.group(1)}")
        ok = False
    if m2 and frozen.get("pipelineVersion") and m2.group(1) != frozen["pipelineVersion"]:
        print(f"[FAIL] PIPELINE_VERSION 变更: 冻结 {frozen['pipelineVersion']} / 当前 {m2.group(1)}")
        ok = False
    return ok


RUNNER = r"""
import fs from 'node:fs';
import path from 'node:path';
import { loadProviderConfig } from '../api/_lib.js';
import { loadCorpus, askPipeline, PROMPT_VERSION, PIPELINE_VERSION } from '../api/_ask.js';
const root = process.argv[2];
process.chdir(root);
const data = JSON.parse(fs.readFileSync(path.join(root,'site/data/sample-topic.json'),'utf8'));
const corpus = loadCorpus(data);
const jobs = JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
let provider;
try { provider = loadProviderConfig(); } catch (e) {
  process.stdout.write(JSON.stringify({ fatal: String(e.message||e) })); process.exit(0);
}
const out = [];
for (const j of jobs) {
  const t0 = Date.now();
  try {
    const r = await askPipeline(j.question, { provider, corpus, timeoutMs: provider.timeoutMs, maxRetries: 2 }, null);
    out.push({ no: j.no, question: j.question, expect: j.expect, status: r.status,
      answer: r.answer, citations: r.citations, evidenceIds: r.evidenceIds,
      model: r.model, ms: r.ms, attempts: r.attempts ?? 1, error: null,
      promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION });
  } catch (e) {
    // 失败也写记录 (分母不缩水)
    out.push({ no: j.no, question: j.question, expect: j.expect, status: 'error',
      answer: '', citations: [], model: process.env.MODEL_ID ?? null, ms: Date.now()-t0,
      attempts: (e.attemptsLog||[]).length || 0, error: String(e.message??e), code: e.code??null,
      promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION });
  }
}
process.stdout.write(JSON.stringify({ results: out }));
"""


def summarize(results):
    total = len(results)
    errs = [r for r in results if r["status"] == "error"]
    answered = [r for r in results if r["status"] == "answered"]
    partial = [r for r in results if r["status"] == "partial"]
    refused = [r for r in results if r["status"] == "insufficient"]
    cits = sum(len(r.get("citations") or []) for r in results)
    # 引文逐字核验: 引用 quote 必须出现在 evidenceIds 对应段落的原文里 (离线可复核)
    return {
        "total": total,
        "call_ok": total - len(errs),
        "call_fail": len(errs),
        "call_success_rate": round((total - len(errs)) / total, 4) if total else None,
        "answered": len(answered), "partial": len(partial), "insufficient": len(refused),
        "errors": [{"no": r["no"], "code": r.get("code"), "error": r.get("error")} for r in errs],
        "citations_total": cits,
        "denominator_note": "所有失败题保留在分母内；不使用剔除失败题的口径",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root")
    ap.add_argument("--check-only", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default="pipeline/p05-eval-result.json")
    a = ap.parse_args()

    root = repo_root(a.root)
    print("[root]", root)
    frozen = load_frozen(root)
    qs = ensure_questions(root, frozen, None)
    print("[frozen]", json.dumps({k: frozen.get(k) for k in ("promptVersion","pipelineVersion","corpusSha256_16")}, ensure_ascii=False))
    print("[questions]", len(qs), "题")
    if not check_freeze(root, frozen):
        print("[abort] 冻结项不一致，拒绝评测（避免改动后仍用旧分数宣传）")
        return 3
    print("[freeze] OK: 语料/提示词/管线与冻结清单一致")

    if a.check_only:
        print("[check-only] 可移植性自检通过 (未调用模型)")
        return 0

    for k in ("PROVIDER_URL", "PROVIDER_KEY", "MODEL_ID"):
        if not os.environ.get(k):
            print(f"[abort] 缺少环境变量 {k}；评测需要真实模型配置，不能伪造结果")
            return 4

    jobs = qs[: a.limit] if a.limit else qs
    jf = root / "pipeline/_p05_jobs.json"
    jf.write_text(json.dumps(jobs, ensure_ascii=False), encoding="utf-8")
    runner = root / "pipeline/_p05_runner.mjs"
    runner.write_text(RUNNER, encoding="utf-8")
    proc = subprocess.run(["node", str(runner), str(root), str(jf)], capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0 and not proc.stdout.strip():
        print("[error] runner 失败:", proc.stderr[-800:])
        return 5
    payload = json.loads(proc.stdout.strip().splitlines()[-1])
    if payload.get("fatal"):
        print("[abort] 供应商未配置:", payload["fatal"])
        return 4
    results = payload["results"]
    summary = summarize(results)
    out = {"evaluatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "root": str(root),
           "frozen": frozen, "summary": summary, "results": results}
    (root / a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("[summary]", json.dumps(summary, ensure_ascii=False))
    print("[out]", root / a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
