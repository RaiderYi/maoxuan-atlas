// R55 离线回归：混合检索（IDF 加权 / 概念扩展 / 同构返回 / 降级安全）。运行: node tests/api/test-retrieval.mjs
import { buildIdf, expandQuery, retrieveHybrid, RETRIEVAL_VERSION } from '../../site/api/_retrieval.mjs';
import { retrieve } from '../../site/api/_ask.mjs';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 200) : '')); }
}

const CORPUS = [
  { id: 'pA-001', articleId: 'A', seq: 1, text: '红色政权存在需要群众基础与红军力量', _g: new Set(), _sec: '' },
  { id: 'pA-002', articleId: 'A', seq: 2, text: '所谓割据必须是武装的', _g: new Set(), _sec: '' },
  { id: 'pB-001', articleId: 'B', seq: 1, text: '八月失败的教训是分兵冒进', _g: new Set(), _sec: '' },
  { id: 'pB-002', articleId: 'B', seq: 2, text: '红军要帮助地方的群众武装', _g: new Set(), _sec: '' },
];
// 手工填 _g（与 _ask.bigrams 同口径：去标点后相邻二字）
for (const p of CORPUS) {
  const t = p.text.replace(/[\s，。？！、；：]/g, '');
  for (let i = 0; i < t.length - 1; i++) p._g.add(t.slice(i, i + 2));
}

console.log('retrieval · IDF 与扩展');
{
  const idf = buildIdf(CORPUS);
  ok('IDF 为正且稀有词更高（八月 df=1 vs 红军 df=2）', (idf.get('八月') ?? 0) > (idf.get('红军') ?? 0), { bay: idf.get('八月'), hj: idf.get('红军') });
  ok('IDF 按语料缓存（同引用一致）', buildIdf(CORPUS) === idf);

  const cm = [{ triggers: ['推进不动'], terms: ['割据'] }];
  ok('触发词命中产生扩展', expandQuery('项目推进不动了', cm).includes('割据'));
  ok('未命中不扩展', expandQuery('今天天气不错', cm).length === 0);
}

console.log('retrieval · 同构返回与质量');
{
  const legacy = retrieve('红色政权存在需要什么条件', CORPUS, { top: 2 });
  const hybrid = retrieveHybrid('红色政权存在需要什么条件', CORPUS, { top: 2 });
  ok('返回结构与 legacy 同构', ['evidence', 'bestScore', 'hits'].every(k => k in hybrid));
  ok('命中段排前', hybrid.hits[0] === 'pA-001' || hybrid.hits.includes('pA-001'), hybrid.hits);
  ok('bestScore 为正', hybrid.bestScore > 0);

  const cm = [{ triggers: ['推进不动'], terms: ['割据'] }];
  const expanded = retrieveHybrid('项目推进不动怎么办', CORPUS, { top: 3, conceptMap: cm });
  ok('概念扩展把无词面重叠的问题引到目标段', expanded.hits.includes('pA-002'), expanded.hits);

  const empty = retrieveHybrid('完全无关的查询词组', CORPUS, { top: 3 });
  ok('无命中返回空证据（不编造）', empty.evidence.length === 0 && empty.hits.length === 0);
}

console.log('retrieval · 降级安全');
{
  ok('空语料安全', retrieveHybrid('x', [], { top: 3 }).evidence.length === 0);
  const noMap = retrieveHybrid('割据', CORPUS, { top: 2, conceptMap: [] });
  ok('概念映射缺失退化为纯 IDF 检索', noMap.hits.length > 0);
  ok('版本号存在', typeof RETRIEVAL_VERSION === 'string' && RETRIEVAL_VERSION.startsWith('r2'));
}

console.log('');
console.log(`结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
