// WP07 核心: 段落关键词检索 → 真实模型 → 结构化回答 → 引用校验
// 语料: data/sample-topic.json (WP03, v1n03+v1n04, 879 段)
// r2 (2026-10-15): ①证据=命中段±原文seq邻段扩展(连续性由数据seq证明,非检索顺序)
//                  ②三态结果 answered/partial/insufficient ③PROMPT_VERSION 冻结,重跑留全记录
export const PROMPT_VERSION = 'wp07-r2';
import { loadProviderConfig, callChat } from './_lib.js';

// ---------- 关键词检索 (字符 bigram 重叠, 无分词依赖) ----------
export function bigrams(s) {
  const t = String(s ?? '').toLowerCase().replace(/[\s，。？！、；：""''（）\[\]{}.,!?;:'"()]/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  if (t.length === 1) set.add(t);
  return set;
}

export function loadCorpus(data) {
  const paras = [];
  for (const art of Object.values(data.articles)) {
    // 节标题段落 id → label 映射, 按序传播: 每段携带其所属节标题的 bigram (检索上下文增强)
    const secOf = [];
    let curSec = '';
    const byId = new Map(art.paragraphs.map(p => [p.id, p]));
    for (const s of art.sections ?? []) {
      const lbl = byId.get(s.paragraphId)?.text ?? '';
      secOf.push([s.paragraphId, lbl]);
    }
    for (const p of art.paragraphs) {
      if (p.isHeadNote) continue;               // 题注不作为证据
      if (/^〔\d+[〕⑴]/.test(p.text) || /^注[\s　]*释/.test(p.text)) continue; // 尾注/注释段为编辑性文字
      for (const [pid, lbl] of secOf) if (pid === p.id) curSec = lbl;
      paras.push({ id: p.id, articleId: p.articleId, seq: p.seq, text: p.text,
        _g: bigrams(p.text + ' ' + curSec), _sec: curSec });
    }
  }
  return paras;
}

// 返回按分排序的 top 命中段; minScore 以下丢弃。
// expandNeighbors: 命中段 ±1 原文 seq 邻段补入证据 (连续性由数据 seq 证明), 标 _nb=true 供日志区分。
export function retrieve(question, corpus, { top = 8, minScore = 2, expandNeighbors = true } = {}) {
  const qg = bigrams(question);
  let best = 0;
  const scored = [];
  for (const p of corpus) {
    let score = 0;
    for (const g of qg) if (p._g.has(g)) score++;
    if (score > best) best = score;
    if (score >= minScore) scored.push({ ...p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.slice(0, top);
  if (!expandNeighbors || hits.length === 0) return { evidence: hits, bestScore: best, hits: hits.map(h => h.id) };

  // 原文 seq 邻段扩展: 按 articleId 分组, seq±1 找邻段 (被剔除的尾注/题注段不补)
  const byArt = new Map();
  for (const p of corpus) {
    if (!byArt.has(p.articleId)) byArt.set(p.articleId, []);
    byArt.get(p.articleId).push(p);
  }
  const inHits = new Set(hits.map(h => h.id));
  const evidence = [...hits];
  for (const h of hits) {
    const sibs = byArt.get(h.articleId);
    for (const p of sibs) {
      if (Math.abs((p.seq ?? 0) - (h.seq ?? 0)) === 1 && !inHits.has(p.id)) {
        inHits.add(p.id);
        evidence.push({ ...p, score: 0, _nb: true }); // 扩展段: 原文连续上下文
      }
    }
  }
  // 证据按 (articleId, seq) 排序 → 模型看到的是原文顺序, 连续性可由编号直接核对
  evidence.sort((a, b) => a.articleId === b.articleId
    ? (a.seq ?? 0) - (b.seq ?? 0) : (a.articleId < b.articleId ? -1 : 1));
  return { evidence, bestScore: best, hits: hits.map(h => h.id) };
}

// ---------- 提示词 (PROMPT_VERSION 冻结; 改动需 bump 版本并全量重跑 20 题) ----------
export function buildMessages(question, evidence) {
  const evText = evidence.map(e => `[${e.id}]${e._sec ? `（节：${e._sec}）` : ''} ${e.text}`).join('\n\n');
  const sys = '你是党史文献研究助手。只依据编号证据段落回答问题。'
    + '关于证据段落的重要说明：这些段落是从原文按固定字宽切分出来的，同篇文章内编号相邻的段落（如 033 与 034）文字是连续的，'
    + '段首或段尾出现半句话属于正常现象，应把相邻段落连起来读，不要因此认为资料残缺或不可用。'
    + '规则：'
    + '1) 每个实质性论断都要给出支撑它的证据段落编号；'
    + '2) citations 里的 id 必须原样复制证据段落的 id，禁止编造任何 id；'
    + '3) 判定 status 只有三档：'
    + '"answered"=证据足以支持问题核心结论的主要部分；'
    + '"partial"=证据能回答问题的一部分，但缺少回答核心结论所需的关键事实，此时正常作答已知的部分，'
    + '并在 answer 末尾另起一行以「按语：」开头明确写出缺失了什么信息；'
    + '"insufficient"=证据无法支持问题的核心结论，或与所问事项基本无关，此时 answer 写空字符串、citations 为空数组，不要猜测、不要编页码。'
    + '注意：证据不够详尽、需要综合多条段落归纳、答案分散在多个段落，都不是 insufficient 或 partial 的理由——'
    + '只要证据能支撑核心结论就应 answered 并综合归纳作答；检索得分高只说明相关，是否充分由你依据证据内容判断；'
    + '4) quote 是证据原文中不超过 20 字的连续片段。'
    + '输出严格 JSON（不要 markdown 代码块，不要多余文字）：'
    + '{"answer":"...","status":"answered|partial|insufficient","citations":[{"id":"pv1n03-001","quote":"..."}]}';
  const user = `证据段落：\n${evText}\n\n问题：${question}`;
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

// ---------- 解析模型输出 ----------
export function parseAnswer(content) {
  let t = String(content ?? '').trim()
    .replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  const slice = t.slice(i, j + 1);
  try { return JSON.parse(slice); } catch { /* try cleanup */ }
  try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
}

// ---------- 引用校验: 引用 ID 必须 100% 在本次检索证据中 ----------
export function validateCitations(parsed, evidence) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'unparsable' };
  const evIds = new Set(evidence.map(e => e.id));
  const cits = Array.isArray(parsed.citations) ? parsed.citations : [];
  const fabricated = [];
  const valid = [];
  const seen = new Set();
  for (const c of cits) {
    const id = String((c && c.id) ?? '');
    if (!id || !evIds.has(id)) { if (id) fabricated.push(id); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    valid.push({ id, quote: String(c.quote ?? '').slice(0, 30) });
  }
  // 三态归一: insufficient (含旧版 insufficient:true 兼容) → 拒答态
  let status = String(parsed.status ?? '').trim().toLowerCase();
  if (!['answered', 'partial', 'insufficient'].includes(status)) {
    status = parsed.insufficient === true ? 'insufficient' : (parsed.answer ? 'answered' : 'unparsable');
  }
  // 拒答态: 不得带引用, 不得编页码; partial 必须有按语标记的缺失说明
  if (status === 'insufficient' || !parsed.answer) {
    return { ok: true, status: 'insufficient', citations: [], answer: '', fabricated };
  }
  if (parsed.status === 'partial' && !/[　\s]按语：|按语：/.test(parsed.answer)) {
    // partial 缺按语 → 降级反馈重试 (不静默改判)
    return { ok: false, reason: 'partial_missing_note', fabricated };
  }
  if (cits.length === 0) return { ok: false, reason: 'no_citations', fabricated };
  return { ok: true, status, answer: parsed.answer, citations: valid, fabricated };
}

// ---------- 完整问答管线 (供 /api/ask 与 20 题脚本共用) ----------
// opts: { provider, corpus, articleMeta, top, timeoutMs, maxRetries }
export async function askPipeline(question, opts, log) {
  const { corpus } = opts;
  const ret = { question, promptVersion: PROMPT_VERSION };
  const t0 = Date.now();

  // 1) 检索 (命中段 + 原文 seq 邻段扩展)
  const { evidence, bestScore, hits } = retrieve(question, corpus, { top: opts.top ?? 8 });
  ret.evidenceIds = evidence.map(e => e.id);
  ret.hitIds = hits;
  ret.bestScore = bestScore;
  log && log({ t: 'retrieve', q: question.slice(0, 24), n: evidence.length, bestScore,
    ids: ret.evidenceIds });

  // 2) 无证据 → 资料不足状态, 不调模型 (杜绝无依据编造)
  if (evidence.length === 0) {
    ret.status = 'insufficient'; ret.answer = ''; ret.citations = [];
    ret.model = null; ret.ms = Date.now() - t0;
    return ret;
  }

  // 3) 真实模型调用 (不合规输出带反馈重试: 虚构id / 不可解析 / 空答案 / partial缺按语)
  const provider = opts.provider;
  let attempt = 0, last = null, lastParsed = null;
  const maxAttempts = (opts.maxRetries ?? 1) + 1;
  while (attempt < maxAttempts) {
    attempt++;
    let messages = buildMessages(question, evidence);
    if (last) {
      let fb;
      if (last.reason === 'fabricated') {
        fb = `你的上一条回复引用了不存在的段落 id：${last.fabricated.join('、')}。只能使用以下 id：${evidence.map(e => e.id).join('、')}。`;
      } else if (last.reason === 'partial_missing_note') {
        fb = '你的上一条回复 status 为 partial 但 answer 末尾缺少「按语：」开头的缺失信息说明。请补上按语后重新输出严格 JSON。';
      } else if (last.reason === 'no_citations') {
        fb = '你的上一条回复有答案但没有给出任何引用。每个实质性论断都要有证据段落编号，请重新输出；若证据确实无法支撑请输出 status=insufficient。';
      } else if (last.reason === 'unparsable') {
        fb = '你的上一条回复不是严格 JSON（含多余文字或格式错误）。只输出一个 JSON 对象，不要任何解释和代码围栏。';
      } else {
        fb = '你的上一条回复缺少 answer 字段或答案为空。若证据不足请输出 status=insufficient。';
      }
      messages.push({ role: 'user', content: fb + '请重新输出严格 JSON。' });
    }
    const r = await callChat(provider, messages,
      { timeoutMs: opts.timeoutMs ?? provider.timeoutMs, maxRetries: 0 });
    ret.model = r.model; ret.usage = r.usage;
    const parsed = parseAnswer(r.content);
    lastParsed = parsed;
    const v = validateCitations(parsed, evidence);
    if (v.ok) {
      ret.status = v.status; ret.answer = v.answer ?? '';
      ret.citations = v.citations; ret.fabricatedIntercepted = last && last.fabricated ? last.fabricated : [];
      ret.attempts = attempt;
      ret.ms = Date.now() - t0;
      return ret;
    }
    // 记录失败原因, 带反馈重试
    last = { reason: v.reason ?? (v.fabricated?.length ? 'fabricated' : 'unparsable'),
             fabricated: v.fabricated ?? [] };
  }
  // 重试仍不合规: 虚构引用一律拦截丢弃。
  if (lastParsed && typeof lastParsed === 'object' && (lastParsed.answer || lastParsed.insufficient)) {
    const v = validateCitations(lastParsed, evidence); // fabricated 已剔除
    if (v.ok && v.citations.length === 0 && v.status !== 'insufficient' && v.answer) {
      const err = new Error('all citations rejected after retries');
      err.code = 'citation_invalid';
      err.detail = { attempted: attempt, reason: last.reason, fabricated: last.fabricated };
      throw err; // 有答案但引用全被拒 = 不可信, 拦截
    }
  }
  const err = new Error('citation_validation_failed');
  err.code = 'citation_invalid';
  err.detail = last ?? {};
  throw err;
}
