// R49: /api/solve 管线 —— 「带着问题读经典」两阶段问题解决
//   stage=decompose: 现实问题解构（理解 + 最多2个追问 + 高风险分流），不涉语料、不产生引用
//   stage=solve:     问题解决卡（判断/拆解/行动/模拟示例/经典依据），复用 retrieve + 引用逐字校验
// 语料: 与 /api/ask 同源 (sample-topic.json, v1n03+v1n04)；费用 attemptsLog 口径与 _ask.mjs 一致
export const SOLVE_PROMPT_VERSION = 'solve-r1';
import { loadProviderConfig, callChat } from './_lib.mjs';
import { retrieve, parseAnswer } from './_ask.mjs';

// ---------- 阶段一：问题解构提示词 ----------
export function buildDecomposeMessages(problem) {
  const sys = '你是现实问题分析助手。你的任务是把用户描述的现实困惑结构化，不给最终建议。'
    + '输出严格 JSON（不要 markdown 代码块，不要多余文字）：'
    + '{"understanding":{"goal":"","known":[],"unknown":[],"focus":""},'
    + '"followUps":[{"question":"","options":["","",""]}],"referral":null}'
    + '规则：'
    + '1) understanding.goal 概括用户想达到的结果；known 只写用户明确说过的事实；'
    + 'unknown 写"为了给出适用方案还需要确认的事"（2-3 条）；focus 写本次分析应重点处理什么；'
    + '2) followUps 最多 2 个，每个只问一个会影响方案的关键信息缺口；options 给 3-4 个常见情况供快速选择；'
    + '不确定该不该问时不问——用户已提供目标、关键事实和约束时 followUps 用空数组；'
    + '3) 若问题属于医疗诊断、法律结论、投资预测、紧急危机等应先寻求专业帮助的领域，'
    + 'referral 设为 {"domain":"医疗|法律|投资|危机|其他","message":"简短说明"}，此时 followUps 用空数组；'
    + '4) 不得虚构用户没有说过的事实；所有表述用简体中文。';
  return [
    { role: 'system', content: sys },
    { role: 'user', content: `用户的问题：${problem}` },
  ];
}

// ---------- 阶段二：问题解决卡提示词 ----------
export function buildSolveMessages(brief, evidence) {
  const evText = evidence.map(e => `[${e.id}]${e._sec ? `（节：${e._sec}）` : ''} ${e.text}`).join('\n\n');
  const known = (brief.answers ?? [])
    .map((a, i) => `追问${i + 1}：${a.question}\n用户回答：${a.answer}`)
    .join('\n');
  const sys = '你是问题解决助手。基于用户确认的问题结构与编号证据段落，生成一份帮助用户行动的解决方案。'
    + '证据段落说明：段落按固定字宽切分，同篇编号相邻段落文字连续，半句开头/结尾属正常，应连起来读。'
    + '输出严格 JSON（不要 markdown 代码块，不要多余文字）：'
    + '{"basis":"corpus|general","judgment":"","breakdown":[{"item":"","now":"","check":""}],"actions":[{"step":"","how":"","watch":""}],"example":{"story":"","point":""},"classics":[{"id":"","quote":"","relevance":"","interpretation":"","boundary":""}]}'
    + '规则：'
    + '1) judgment 写"当前最值得先处理什么"，用"更值得先处理"这类表述，不宣称唯一根因；'
    + '2) breakdown 2-4 行：item 是要素名，now 是当前判断，check 是还需向用户或相关方核实什么；'
    + '3) actions 2-4 条：step 是动作名，how 是具体做法（可执行），watch 是执行后观察什么；不得承诺确定结果；'
    + '4) example 是为说明方法构造的情境，story 不得写成真实事件，point 一句话说明这个例子演示了什么方法；'
    + '5) classics 只能引用编号证据段落：id 必须原样复制证据段落的 id，禁止编造；'
    + 'quote 必须是所引段落原文中不超过 20 字的连续片段；relevance 说明这段原文与用户问题的关系；'
    + 'interpretation 是你对该原文含义的解释（属 AI 理解，不是原文原句）；boundary 说明历史情境与当前问题的差异；'
    + '6) 若证据与问题不相关或不足以支撑经典参考，classics 输出空数组且 basis 设为 "general"，不得编造引用；'
    + '有相关证据时 basis 设为 "corpus" 并给出 1-3 条 classics；'
    + '7) 行动建议本身可以是一般性方法，不必每条都有引用，但不得把一般性建议说成原文结论；'
    + '8) 全程简体中文。';
  const user = `证据段落：\n${evText || '（本次未检索到语料段落）'}\n\n`
    + `用户的原始问题：${brief.problem}\n\n`
    + `问题结构（AI 解构，用户已确认或跳过追问）：\n`
    + `目标：${brief.understanding?.goal ?? ''}\n`
    + `已知事实：${(brief.understanding?.known ?? []).join('；')}\n`
    + `还需核实：${(brief.understanding?.unknown ?? []).join('；')}\n`
    + `本次重点：${brief.understanding?.focus ?? ''}\n`
    + (known ? `\n追问与回答：\n${known}\n` : '')
    + '\n请生成解决方案 JSON。';
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

// ---------- 引用校验（solve 版）：id 必须在证据内；quote 必须逐字存在于所引段或相邻 seq 拼接 ----------
function normRef(s) {
  return String(s ?? '').replace(/[\s\u3000⑴-⑿]/g, '');
}
export function validateSolveCitations(parsed, evidence) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'unparsable' };
  const evIds = new Set(evidence.map(e => e.id));
  const byId = new Map(evidence.map(e => [e.id, e]));
  const classics = Array.isArray(parsed.classics) ? parsed.classics : [];
  const fabricated = [];
  const badQuotes = [];
  const valid = [];
  const seen = new Set();
  for (const c of classics) {
    const id = String((c && c.id) ?? '');
    if (!id || !evIds.has(id)) { if (id) fabricated.push(id); continue; }
    if (seen.has(id)) continue;
    const q = normRef(c.quote);
    if (q) {
      const p = byId.get(id);
      const seq = p.seq ?? 0, aid = p.articleId;
      const cands = [normRef(p.text)];
      for (const o of evidence) {
        if (o.articleId !== aid || Math.abs((o.seq ?? 0) - seq) !== 1) continue;
        if (o.seq === seq + 1) cands.push(normRef(p.text + o.text));
        else cands.push(normRef(o.text + p.text));
      }
      if (!cands.some(t => t.includes(q))) { badQuotes.push(id); continue; }
    }
    seen.add(id);
    valid.push({
      id, quote: String(c.quote ?? '').slice(0, 30),
      relevance: String(c.relevance ?? '').slice(0, 300),
      interpretation: String(c.interpretation ?? '').slice(0, 500),
      boundary: String(c.boundary ?? '').slice(0, 300),
    });
  }
  // 无有效经典引用 → 诚实降级为 general（不得保留空壳 corpus 标签）
  if (!valid.length && fabricated.length === 0 && badQuotes.length === 0) {
    return { ok: true, basis: 'general', classics: [], fabricated, badQuotes };
  }
  if (fabricated.length) return { ok: false, reason: 'fabricated', fabricated, badQuotes };
  if (badQuotes.length) return { ok: false, reason: 'bad_quotes', fabricated, badQuotes };
  return { ok: true, basis: 'corpus', classics: valid, fabricated, badQuotes };
}

// ---------- 阶段一管线：解构（无检索，1-2 次尝试，attemptsLog 供费用结算） ----------
export async function decomposePipeline(problem, opts, log) {
  const ret = { stage: 'decompose', promptVersion: SOLVE_PROMPT_VERSION, problemLen: problem.length };
  const t0 = Date.now();
  const provider = opts.provider;
  let attempt = 0, last = null;
  ret.attemptsLog = [];
  const maxAttempts = (opts.maxRetries ?? 1) + 1;
  while (attempt < maxAttempts) {
    attempt++;
    const messages = buildDecomposeMessages(problem);
    if (last) {
      messages.push({ role: 'user', content: '你的上一条回复不是严格 JSON 或字段结构不符。只输出一个符合规则的 JSON 对象，不要任何解释和代码围栏。' });
    }
    const tCall = Date.now();
    if (opts.budget && !(await opts.budget.reserve(1))) {
      const err = new Error('budget exhausted (pre-reserve)');
      err.code = 'BUDGET_EXHAUSTED'; err.status = 402; err.attemptsLog = ret.attemptsLog;
      throw err;
    }
    let r;
    try {
      r = await callChat(provider, messages,
        { timeoutMs: opts.timeoutMs ?? provider.timeoutMs, maxRetries: 0, maxTokens: opts.maxTokens ?? 1500 });
    } catch (e) {
      ret.attemptsLog.push({ attempt, ms: Date.now() - tCall, error: String(e.message ?? e),
        code: e.code ?? null, status: e.status ?? null, cost: null });
      e.attemptsLog = ret.attemptsLog;
      throw e;
    }
    ret.model = r.model;
    accumulateUsage(ret, r.usage);
    ret.attemptsLog.push({ attempt, ms: Date.now() - tCall,
      promptTokens: Number(r.usage?.prompt_tokens || 0),
      completionTokens: Number(r.usage?.completion_tokens || 0),
      cacheHitTokens: Number(r.usage?.prompt_cache_hit_tokens || 0),
      cacheMissTokens: Number(r.usage?.prompt_cache_miss_tokens != null
        ? r.usage.prompt_cache_miss_tokens
        : Math.max(0, Number(r.usage?.prompt_tokens || 0) - Number(r.usage?.prompt_cache_hit_tokens || 0))),
      cost: r.usage?.cost?.amount ?? r.usage?.total_cost ?? null,
      tokens: r.usage?.total_tokens ?? null });
    const parsed = parseAnswer(r.content);
    const v = validateDecompose(parsed);
    if (v.ok) {
      ret.understanding = v.understanding;
      ret.followUps = v.followUps;
      ret.referral = v.referral;
      ret.attempts = attempt;
      ret.ms = Date.now() - t0;
      log && log({ t: 'decompose_ok', attempts: attempt, followUps: v.followUps.length, referral: !!v.referral });
      return ret;
    }
    last = v;
  }
  const err = new Error('decompose_validation_failed');
  err.code = 'decompose_invalid';
  err.attemptsLog = ret.attemptsLog;
  throw err;
}

export function validateDecompose(parsed) {
  if (!parsed || typeof parsed !== 'object') return { ok: false };
  const u = parsed.understanding;
  if (!u || typeof u !== 'object' || !String(u.goal ?? '').trim()) return { ok: false };
  const fups = Array.isArray(parsed.followUps) ? parsed.followUps.slice(0, 2) : [];
  const followUps = [];
  for (const f of fups) {
    const q = String(f?.question ?? '').trim();
    if (!q) continue;
    followUps.push({ question: q.slice(0, 120),
      options: (Array.isArray(f.options) ? f.options : []).slice(0, 4).map(o => String(o).slice(0, 40)) });
  }
  let referral = null;
  const rf = parsed.referral;
  if (rf && typeof rf === 'object' && String(rf.message ?? '').trim()) {
    referral = { domain: String(rf.domain ?? '其他').slice(0, 12), message: String(rf.message).slice(0, 200) };
  }
  return { ok: true,
    understanding: {
      goal: String(u.goal ?? '').slice(0, 200),
      known: (Array.isArray(u.known) ? u.known : []).slice(0, 6).map(x => String(x).slice(0, 120)),
      unknown: (Array.isArray(u.unknown) ? u.unknown : []).slice(0, 4).map(x => String(x).slice(0, 120)),
      focus: String(u.focus ?? '').slice(0, 200),
    },
    followUps, referral };
}

// ---------- 阶段二管线：解决卡（检索 + 模型 + 引用校验，重试带反馈） ----------
// brief: { problem, understanding, answers: [{question, answer}] }
export async function solvePipeline(brief, opts, log) {
  const ret = { stage: 'solve', promptVersion: SOLVE_PROMPT_VERSION };
  const t0 = Date.now();
  // 检索查询 = 原问题 + 用户回答（提高召回）
  const query = [brief.problem].concat((brief.answers ?? []).map(a => a.question + ' ' + a.answer)).join(' ');
  // R55: 检索器可注入（缺省 legacy bigram；handler 按 RETRIEVAL_MODE 传入 hybrid）
  const retrieveFn = opts.retrieveFn ?? retrieve;
  const { evidence, bestScore, hits } = retrieveFn(query, opts.corpus, { top: opts.top ?? 8 });
  ret.evidenceIds = evidence.map(e => e.id);
  ret.hitIds = hits;
  ret.bestScore = bestScore;
  log && log({ t: 'solve_retrieve', n: evidence.length, bestScore, ids: ret.evidenceIds });

  const provider = opts.provider;
  let attempt = 0, last = null;
  ret.attemptsLog = [];
  const maxAttempts = (opts.maxRetries ?? 1) + 1;
  while (attempt < maxAttempts) {
    attempt++;
    const messages = buildSolveMessages(brief, evidence);
    if (last) {
      let fb;
      if (last.reason === 'fabricated') {
        fb = `你的上一条回复引用了不存在的段落 id：${last.fabricated.join('、')}。只能使用以下 id：${evidence.map(e => e.id).join('、')}。`;
      } else if (last.reason === 'bad_quotes') {
        fb = `你的上一条回复中段落 ${last.badQuotes.join('、')} 的 quote 与该段落原文不符。quote 必须是所引段落原文中不超过 20 字的连续片段，请逐字复制后重新输出。`;
      } else {
        fb = '你的上一条回复不是严格 JSON 或字段结构不符。只输出一个符合规则的 JSON 对象。';
      }
      messages.push({ role: 'user', content: fb + '请重新输出严格 JSON。' });
    }
    const tCall = Date.now();
    if (opts.budget && !(await opts.budget.reserve(1))) {
      const err = new Error('budget exhausted (pre-reserve)');
      err.code = 'BUDGET_EXHAUSTED'; err.status = 402; err.attemptsLog = ret.attemptsLog;
      throw err;
    }
    let r;
    try {
      r = await callChat(provider, messages,
        { timeoutMs: opts.timeoutMs ?? provider.timeoutMs, maxRetries: 0, maxTokens: opts.maxTokens ?? 3000 });
    } catch (e) {
      ret.attemptsLog.push({ attempt, ms: Date.now() - tCall, error: String(e.message ?? e),
        code: e.code ?? null, status: e.status ?? null, cost: null });
      e.attemptsLog = ret.attemptsLog;
      throw e;
    }
    ret.model = r.model;
    accumulateUsage(ret, r.usage);
    ret.attemptsLog.push({ attempt, ms: Date.now() - tCall,
      promptTokens: Number(r.usage?.prompt_tokens || 0),
      completionTokens: Number(r.usage?.completion_tokens || 0),
      cacheHitTokens: Number(r.usage?.prompt_cache_hit_tokens || 0),
      cacheMissTokens: Number(r.usage?.prompt_cache_miss_tokens != null
        ? r.usage.prompt_cache_miss_tokens
        : Math.max(0, Number(r.usage?.prompt_tokens || 0) - Number(r.usage?.prompt_cache_hit_tokens || 0))),
      cost: r.usage?.cost?.amount ?? r.usage?.total_cost ?? null,
      tokens: r.usage?.total_tokens ?? null });
    const parsed = parseAnswer(r.content);
    const v = validateSolveCitations(parsed, evidence);
    if (v.ok && validateCard(parsed)) {
      ret.basis = v.basis;
      ret.judgment = String(parsed.judgment ?? '').slice(0, 300);
      ret.breakdown = (Array.isArray(parsed.breakdown) ? parsed.breakdown : []).slice(0, 4).map(b => ({
        item: String(b?.item ?? '').slice(0, 60), now: String(b?.now ?? '').slice(0, 200), check: String(b?.check ?? '').slice(0, 200) }));
      ret.actions = (Array.isArray(parsed.actions) ? parsed.actions : []).slice(0, 4).map(a => ({
        step: String(a?.step ?? '').slice(0, 80), how: String(a?.how ?? '').slice(0, 400), watch: String(a?.watch ?? '').slice(0, 200) }));
      ret.example = {
        story: String(parsed.example?.story ?? '').slice(0, 800),
        point: String(parsed.example?.point ?? '').slice(0, 200),
      };
      ret.classics = v.classics;
      ret.fabricatedIntercepted = last && last.fabricated ? last.fabricated : [];
      ret.badQuotesIntercepted = v.badQuotes ?? [];
      ret.attempts = attempt;
      ret.ms = Date.now() - t0;
      log && log({ t: 'solve_ok', attempts: attempt, basis: v.basis, classics: v.classics.length });
      return ret;
    }
    last = v.ok ? { reason: 'unparsable' } : v;
  }
  const err = new Error('solution_validation_failed');
  err.code = 'solution_invalid';
  err.attemptsLog = ret.attemptsLog;
  throw err;
}

function validateCard(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (!String(parsed.judgment ?? '').trim()) return false;
  const acts = Array.isArray(parsed.actions) ? parsed.actions : [];
  if (!acts.length || !String(acts[0]?.step ?? '').trim()) return false;
  const ex = parsed.example;
  if (!ex || !String(ex.story ?? '').trim() || !String(ex.point ?? '').trim()) return false;
  return true;
}

function accumulateUsage(ret, u) {
  if (!ret.usage) ret.usage = { prompt_tokens: 0, completion_tokens: 0,
    prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0, calls: 0 };
  const x = u || {};
  ret.usage.calls += 1;
  ret.usage.prompt_tokens += Number(x.prompt_tokens || 0);
  ret.usage.completion_tokens += Number(x.completion_tokens || 0);
  ret.usage.prompt_cache_hit_tokens += Number(x.prompt_cache_hit_tokens || 0);
  ret.usage.prompt_cache_miss_tokens += Number(
    x.prompt_cache_miss_tokens != null ? x.prompt_cache_miss_tokens
      : Math.max(0, Number(x.prompt_tokens || 0) - Number(x.prompt_cache_hit_tokens || 0)));
}

export { loadProviderConfig };
