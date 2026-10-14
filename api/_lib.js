// WP05 共用库: 错误码 / IP / 会话 / 供应商适配 / 预算
import crypto from 'node:crypto';

export function jsonError(res, status, code, message) {
  return res.status(status).json({ schemaVersion: '0.1', ok: false, error: { code, message } });
}

export function getClientIp(req) {
  const h = req.headers ?? {};
  return (h['x-forwarded-for'] ?? '').split(',')[0].trim() || h['x-real-ip'] || 'unknown';
}

// —— 匿名会话: HttpOnly cookie sid ——
export function sessionOf(req, res) {
  const cookies = (req.headers?.cookie ?? '');
  let sid = /(?:^|;\s*)mx_sid=([A-Za-z0-9]{16})/.exec(cookies)?.[1];
  if (!sid) {
    sid = crypto.randomBytes(8).toString('hex');
    res.setHeader('Set-Cookie',
      `mx_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1296000`);
  }
  return { sid, setCookie: !cookies.includes('mx_sid=') };
}

// —— 供应商适配层: OpenAI 兼容协议, 环境变量切换 ——
// PROVIDER_URL / PROVIDER_KEY / MODEL_ID / PROVIDER_TIMEOUT_MS / MAX_RETRIES
// 例: GLM= https://open.bigmodel.cn/api/paas/v4  (bigmodel 兼容 OpenAI 格式)
//     AceData= https://api.acedata.cloud/v1
export function loadProviderConfig() {
  const url = process.env.PROVIDER_URL;
  const key = process.env.PROVIDER_KEY;
  const model = process.env.MODEL_ID;
  if (!url || !key || !model) {
    throw new Error('模型供应商未配置 (需 PROVIDER_URL / PROVIDER_KEY / MODEL_ID 环境变量)。已阻断生成, 阅读不受影响。');
  }
  return {
    url: url.replace(/\/+$/, '') + '/chat/completions',
    key, model,
    timeoutMs: parseInt(process.env.PROVIDER_TIMEOUT_MS ?? '60000', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES ?? '1', 10), // 有界重试, 总尝试 ≤2
  };
}

// —— 真实调用 (fetch + AbortController 超时 + 有界重试) ——
export async function callModel(provider, { question, scope }, { timeoutMs, maxRetries }) {
  const messages = [
    { role: 'system', content: '你是党史文献研究助手。只依据给定研究范围中的原文回答; 资料不足时明确说明, 不得虚构。回答用简体中文。' },
    { role: 'user', content: scope.length
      ? `研究范围: ${scope.join('、')}\n\n问题: ${question}`
      : `问题: ${question}` },
  ];
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetch(provider.url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: provider.model, messages, max_tokens: 4096, temperature: 0.3 }),
        signal: ac.signal,
      });
      if (resp.status === 429) {
        lastErr = Object.assign(new Error('upstream 429'), { status: 429, retryAfter: resp.headers.get('retry-after') });
        continue; // 重试一次
      }
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        // 余额/配额类错误不重试
        if (resp.status === 402 || /insufficient|quota|balance/i.test(t)) {
          throw Object.assign(new Error('insufficient quota'), { status: 402, code: 'insufficient_quota' });
        }
        // invalid_token 类瞬时错误可重试 (acedata skill 实证)
        if (resp.status >= 500 || /invalid_token/i.test(t)) {
          lastErr = Object.assign(new Error(`upstream ${resp.status}`), { status: resp.status });
          continue;
        }
        throw Object.assign(new Error(`upstream ${resp.status}: ${t.slice(0, 120)}`), { status: resp.status });
      }
      const data = await resp.json();
      const msg = data?.choices?.[0]?.message ?? {};
      // 推理型模型 (如 GLM): 思考消耗 max_tokens 时 content 可能为空 → 回退 reasoning_content
      const content = msg.content || msg.reasoning_content;
      if (!content) throw Object.assign(new Error('empty completion'), { status: 502 });
      return { model: data.model ?? provider.model, content, usage: data.usage };
    } catch (e) {
      if (e.name === 'AbortError') { const te = new Error('upstream timeout'); te.code = 'TIMEOUT'; lastErr = te; continue; }
      if (e.status) throw e; // 已分类错误直接抛出
      lastErr = e;
      continue;
    } finally { clearTimeout(timer); }
  }
  throw lastErr ?? new Error('model call failed');
}

// —— 预算 (环境变量: BUDGET_LIMIT_CREDIT, 非空才允许调用; 内存累计, 区域级) ——
export class Budget {
  constructor(limit, spent) { this.limit = limit; this.spent = spent; }
  static load() {
    const raw = process.env.BUDGET_LIMIT_CREDIT;
    if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return new Budget(null, 0); // 未配置 → 阻断
    return new Budget(parseFloat(raw), Budget._spent);
  }
  get configured() { return this.limit !== null; }
  exhausted() { return this.configured && this.spent >= this.limit; }
  left() { return this.configured ? Math.max(0, this.limit - this.spent) : null; }
  spend(cost) {
    if (typeof cost === 'number' && cost > 0) { this.spent += cost; Budget._spent = this.spent; }
    return this.spent;
  }
  markExhausted() { this.spent = this.limit; Budget._spent = this.limit; }
}
Budget._spent = 0;

// —— 脱敏调用日志 (stdout → Vercel 日志; 不含密钥与完整问题) ——
export function logCall(entry) {
  console.log(JSON.stringify({ t: 'ai_call', ...entry }));
}
