
import { loadProviderConfig } from '../api/_lib.js';
import { loadCorpus, askPipeline } from '../api/_ask.js';
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
  process.stdout.write(JSON.stringify({ no, question: q, expect, model: r.model, ms: r.ms,
    insufficient: !!r.insufficient, answer: r.answer, citations: r.citations,
    evidenceIds: r.evidenceIds, bestScore: r.bestScore, fabricatedIntercepted: r.fabricatedIntercepted ?? [] }));
} catch (e) {
  process.stdout.write(JSON.stringify({ no, question: q, expect, error: String(e.message??e), code: e.code??null, detail: JSON.parse(JSON.stringify(e.detail??{})) }));
}
