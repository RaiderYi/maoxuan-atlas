
import { loadProviderConfig } from '../site/api/_lib.mjs';
import { loadCorpus, askPipeline, PROMPT_VERSION, PIPELINE_VERSION } from '../site/api/_ask.mjs';
import { costOfUsage } from '../site/api/_govern.mjs';
import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync('site/data/sample-topic.json','utf8'));
const corpus = loadCorpus(data);
const no = parseInt(process.argv[2]), q = process.argv[3], expect = process.argv[4]||'ANSWERABLE';
try {
  const r = await askPipeline(q, { provider: loadProviderConfig(), corpus,
    timeoutMs: 120000, maxRetries: 2 }, null);
  process.stdout.write(JSON.stringify({ no, question: q, expect,
    promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION,
    model: r.model, ms: r.ms, attempts: r.attempts ?? 1, attemptsLog: r.attemptsLog ?? [],
    usage: r.usage ?? null, cost: r.usage ? costOfUsage(r.usage) : null,
    status: r.status, answer: r.answer, citations: r.citations,
    evidenceIds: r.evidenceIds, hitIds: r.hitIds ?? [], bestScore: r.bestScore,
    fabricatedIntercepted: r.fabricatedIntercepted ?? [],
    badQuotesIntercepted: r.badQuotesIntercepted ?? [] }));
} catch (e) {
  const al = e.attemptsLog ?? [];
  let cost = null;
  try {
    const agg = al.reduce((a, x) => {
      const u = x.usage || {};
      a.prompt_tokens += Number(u.prompt_tokens || 0);
      a.completion_tokens += Number(u.completion_tokens || 0);
      a.prompt_cache_hit_tokens += Number(u.prompt_cache_hit_tokens || 0);
      a.prompt_cache_miss_tokens += Number(u.prompt_cache_miss_tokens ||
        (Number(u.prompt_tokens || 0) - Number(u.prompt_cache_hit_tokens || 0)));
      return a;
    }, { prompt_tokens:0, completion_tokens:0, prompt_cache_hit_tokens:0, prompt_cache_miss_tokens:0 });
    if (agg.prompt_tokens || agg.completion_tokens) cost = costOfUsage(agg);
  } catch (_) {}
  process.stdout.write(JSON.stringify({ no, question: q, expect,
    promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION,
    error: String(e.message ?? e), code: e.code ?? null,
    attemptsLog: al, cost,
    detail: JSON.parse(JSON.stringify(e.detail ?? {})) }));
}
