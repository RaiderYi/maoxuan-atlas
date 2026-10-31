// R55: 混合检索 r2 —— IDF 加权 bigram + 概念映射查询扩展（纯本地，无外部 API，零调用成本）
// 设计:
//   · legacy (wp07-bigram): 原始 bigram 重叠计数 —— 保留为可回滚基线（RETRIEVAL_MODE=legacy）
//   · hybrid (r2-hybrid):   每个 query bigram 按 IDF 加权（罕见词权重大），概念映射把现代问题词汇
//                           扩展到语料词汇（降权 0.5），显著降低"词面不匹配 → 漏召回"的假阴性
//   · 返回结构与 _ask.retrieve 完全一致（{evidence, bestScore, hits}），可 drop-in 替换；
//     邻段扩展/节标题增强语义不变；语料为空时安全退化
export const RETRIEVAL_VERSION = 'r2-hybrid';
export const EXPANSION_WEIGHT = 0.5;

const idfCache = new WeakMap();

/** 语料级 IDF：ln(1 + N/(1+df))。按语料数组引用缓存（WeakMap，冷启动后每请求零重算） */
export function buildIdf(corpus) {
  if (!Array.isArray(corpus) || corpus.length === 0) return new Map();
  const cached = idfCache.get(corpus);
  if (cached) return cached;
  const df = new Map();
  for (const p of corpus) {
    for (const g of (p._g ?? new Set())) df.set(g, (df.get(g) ?? 0) + 1);
  }
  const N = corpus.length;
  const idf = new Map();
  for (const [g, d] of df) idf.set(g, Math.log(1 + N / (1 + d)));
  idfCache.set(corpus, idf);
  return idf;
}

/** 概念映射触发匹配：任一 trigger 是查询串子串 → 该组的 terms 参与扩展（降权） */
export function expandQuery(query, conceptMap) {
  const q = String(query ?? '');
  const expanded = [];
  for (const grp of (conceptMap ?? [])) {
    const hit = (grp.triggers ?? []).some(t => q.includes(String(t)));
    if (hit) for (const term of (grp.terms ?? [])) expanded.push(String(term));
  }
  return [...new Set(expanded)];
}

function bigramsOf(s) {
  const t = String(s ?? '').toLowerCase().replace(/[\s，。？！、；：""''（）\[\]{}.,!?;:'"()]/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 1) + t.slice(i + 1, i + 2));
  if (t.length === 1) set.add(t);
  return set;
}

/**
 * 混合检索。opts: {top=8, minScore=0.4, expandNeighbors=true, conceptMap}
 * minScore 语义（权重制）：0.4 = 单个罕见扩展命中可入池（0.5×idf(df=1)≈0.46），
 * 单个常见词命中（idf≈0.69）也可入池但会在排序中被压后 —— 纯噪声（df≈N 的常见词）被过滤。
 * 返回 {evidence, bestScore, hits} —— 与 _ask.retrieve 同构。
 */
export function retrieveHybrid(query, corpus, opts = {}) {
  const top = opts.top ?? 8;
  if (!Array.isArray(corpus) || corpus.length === 0) return { evidence: [], bestScore: 0, hits: [] };
  const idf = buildIdf(corpus);
  const qg = [...bigramsOf(query)];
  const exTerms = expandQuery(query, opts.conceptMap);
  const exg = new Set();
  for (const t of exTerms) for (const g of bigramsOf(t)) exg.add(g);

  const scored = [];
  let best = 0;
  for (const p of corpus) {
    let score = 0;
    for (const g of qg) if (p._g.has(g)) score += (idf.get(g) ?? 1);
    for (const g of exg) if (p._g.has(g)) score += (idf.get(g) ?? 1) * EXPANSION_WEIGHT;
    if (score > best) best = score;
    if (score >= (opts.minScore ?? 0.4)) scored.push({ ...p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.slice(0, top);
  if (opts.expandNeighbors === false || hits.length === 0) return { evidence: hits, bestScore: best, hits: hits.map(h => h.id) };

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
        evidence.push({ ...p, score: 0, _nb: true });
      }
    }
  }
  evidence.sort((a, b) => a.articleId === b.articleId
    ? (a.seq ?? 0) - (b.seq ?? 0) : (a.articleId < b.articleId ? -1 : 1));
  return { evidence, bestScore: best, hits: hits.map(h => h.id) };
}
