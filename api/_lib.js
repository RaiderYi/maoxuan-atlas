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
// callChat: 任意 messages 的通用调用 (WP07 ask 管线等)
export async function callChat(provider, messages, { timeoutMs, maxRetries = 0, maxTokens = 4096, temperature = 0.3 }) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetch(provider.url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: provider.model, messages, max_tokens: maxTokens, temperature }),
        signal: ac.signal,
      });
      if (resp.status === 429) {
        lastErr = Object.assign(new Error('upstream 429'), { status: 429, retryAfter: resp.headers.get('retry-after') });
        continue;
      }
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        if (resp.status === 402 || /insufficient|quota|balance/i.test(t)) {
          throw Object.assign(new Error('insufficient quota'), { status: 402, code: 'insufficient_quota' });
        }
        if (resp.status >= 500 || /invalid_token/i.test(t)) {
          lastErr = Object.assign(new Error(`upstream ${resp.status}`), { status: resp.status });
          continue;
        }
        throw Object.assign(new Error(`upstream ${resp.status}: ${t.slice(0, 120)}`), { status: resp.status });
      }
      const data = await resp.json();
      const msg = data?.choices?.[0]?.message ?? {};
      const content = msg.content || msg.reasoning_content; // 推理模型 content 可能被 reasoning 吃掉
      if (!content) throw Object.assign(new Error('empty completion'), { status: 502 });
      return { model: data.model ?? provider.model, content, usage: data.usage };
    } catch (e) {
      if (e.name === 'AbortError') { const te = new Error('upstream timeout'); te.code = 'TIMEOUT'; lastErr = te; continue; }
      if (e.status) throw e;
      lastErr = e;
      continue;
    } finally { clearTimeout(timer); }
  }
  throw lastErr ?? new Error('model call failed');
}

export async function callModel(provider, { question, scope }, { timeoutMs, maxRetries }) {
  const messages = [
    { role: 'system', content: '你是党史文献研究助手。只依据给定研究范围中的原文回答; 资料不足时明确说明, 不得虚构。回答用简体中文。' },
    { role: 'user', content: scope.length
      ? `研究范围: ${scope.join('、')}\n\n问题: ${question}`
      : `问题: ${question}` },
  ];
  return callChat(provider, messages, { timeoutMs, maxRetries });
}

// —— 预算 (环境变量: BUDGET_LIMIT_CREDIT, 非空才允许调用) ——
// P0 修复: ①spend 返回值必须回写共享累计(此前各请求读旧值回写, 并发丢账)
//          ②费用未知(cost null)不默认零成本放行 → 记为 pendingUnknown 待结算, 保守预留
//          ③跨实例持久化钩子: 生产部署注入 KV 适配器 (get/set), 未注入时退化为实例内存级(诚实在文档标注)
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
    if (typeof cost === 'number' && cost > 0) {
      this.spent += cost;
    } else if (cost === null || cost === undefined || Number.isNaN(cost)) {
      // 费用未知: 按 1 credit 保守预留 (不默认零成本), 结算时冲销
      this.spent += 1;
      this._pendingUnknown = (this._pendingUnknown ?? 0) + 1;
    }
    Budget._spent = this.spent;   // P0: 回写共享累计 — 后续请求读到的是最新值
    return this.spent;
  }
  settle(cost) {  // 上游返回实际费用后冲销预留
    if (this._pendingUnknown && typeof cost === 'number' && cost >= 0) {
      this.spent -= this._pendingUnknown;       // 先撤销全部保守预留
      this.spent += cost;                        // 再记实际
      this._pendingUnknown = 0;
      Budget._spent = this.spent;
    }
    return this.spent;
  }
  markExhausted() { this.spent = this.limit; Budget._spent = this.limit; }
  static resetForTest() { Budget._spent = 0; }   // 测试隔离用
}
Budget._spent = 0;

// —— 脱敏调用日志 (stdout → Vercel 日志; 不含密钥与完整问题) ——
export function logCall(entry) {
  console.log(JSON.stringify({ t: 'ai_call', ...entry }));
}
