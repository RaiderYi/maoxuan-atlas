
import { loadProviderConfig } from '../api/_lib.js';
import { loadCorpus, askPipeline, PROMPT_VERSION, PIPELINE_VERSION } from '../api/_ask.js';
import fs from 'node:fs';
const KEY = fs.readFileSync('D:/工作/maoxuan_viz/data/.key','utf8').trim();
process.env.PROVIDER_URL='https://open.bigmodel.cn/api/coding/paas/v4';
process.env.PROVIDER_KEY=KEY; process.env.MODEL_ID='glm-5.3';
process.env.PROVIDER_TIMEOUT_MS='90000';
const data = JSON.parse(fs.readFileSync('site/data/sample-topic.json','utf8'));
const corpus = loadCorpus(data);
const no = parseInt(process.argv[2]), q = process.argv[3], expect = process.argv[4]||'ANSWERABLE';
try {
  const r = await askPipeline(q, { provider: loadProviderConfig(), corpus, timeoutMs: 90000, maxRetries: 2 }, null);
  process.stdout.write(JSON.stringify({ no, question: q, expect,
    promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION,
    model: r.model, ms: r.ms, attempts: r.attempts ?? 1, attemptsLog: r.attemptsLog ?? [],
    status: r.status, answer: r.answer, citations: r.citations,
    evidenceIds: r.evidenceIds, hitIds: r.hitIds ?? [], bestScore: r.bestScore,
    fabricatedIntercepted: r.fabricatedIntercepted ?? [], badQuotesIntercepted: r.badQuotesIntercepted ?? [] }));
} catch (e) {
  process.stdout.write(JSON.stringify({ no, question: q, expect,
    promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION,
    error: String(e.message??e), code: e.code??null,
    attemptsLog: e.attemptsLog ?? [], detail: JSON.parse(JSON.stringify(e.detail??{})) }));
}
