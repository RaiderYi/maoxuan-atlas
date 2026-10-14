// WP05 真实调用验收: 本地开发环境, GLM (bigmodel.cn) 真实 key + 真实额度
// 运行: node api/real-call-check.js   (key 从 D:/工作/maoxuan_viz/data/.key 读取, 不入仓)
import { loadProviderConfig, callModel } from './_lib.js';
import fs from 'node:fs';

const KEY = fs.readFileSync('D:/工作/maoxuan_viz/data/.key', 'utf8').trim();
process.env.PROVIDER_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
process.env.PROVIDER_KEY = KEY;
process.env.MODEL_ID = 'glm-5.3';
process.env.PROVIDER_TIMEOUT_MS = '60000';
process.env.MAX_RETRIES = '1';

const provider = loadProviderConfig();
console.log('provider url:', provider.url, '| model:', provider.model);
const t0 = Date.now();
const r = await callModel(provider, {
  question: '《井冈山的斗争》一文的核心问题是什么? 用两句话回答。',
  scope: ['v1n03', 'v1n04'],
}, { timeoutMs: provider.timeoutMs, maxRetries: provider.maxRetries });
console.log('wall ms:', Date.now() - t0);
console.log('model:', r.model);
console.log('answer:', r.content);
console.log('usage:', JSON.stringify(r.usage));
