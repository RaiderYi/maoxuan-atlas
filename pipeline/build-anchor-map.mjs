#!/usr/bin/env node
/* R13: 锚点映射与版本 — 让"编号相同"不再被当成"文本相同"
 *
 * 复审指出的问题（F06）：
 *   阅读器的行级锚点是 pa-<art>-<NNN>（渲染时按非空行顺序生成），
 *   AI 语料的段片 id 是 pv<art>-<NNN>，两者靠"序号相同就换算"关联；
 *   但文章清洗、换行或版本变化会让同一个编号指向不同文字，而当前代码不会发现。
 *
 * 本脚本产出 site/data/anchor-map.json：
 *   · 每条锚点的行号、字符数、正文前缀指纹（可用于校验"这个编号现在还是不是这段话"）
 *   · 人物卡锚点附带其 quote，供前端在编号失配时按原文文本回找
 *   · 每篇文章正文的 sha256（正文一变，映射版本就要重建）
 *   · 逐条校验结果：ok / span2（跨行拼接才命中）/ mismatch（对不上，必须人工处理）
 *
 * 用法:
 *   node pipeline/build-anchor-map.mjs            # 生成映射；有 mismatch 即失败
 *   node pipeline/build-anchor-map.mjs --allow-mismatch
 *   node pipeline/build-anchor-map.mjs --check    # 只校验不写文件（CI 用）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const DATA = path.join(SITE, 'data');
const OUT = path.join(DATA, 'anchor-map.json');
const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const ALLOW_MISMATCH = args.includes('--allow-mismatch');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* 2026-10-19 锚点校正记录（旧编号 → 正确编号）。
   目的：旧的分享链接/书签仍在用旧编号，映射里保留别名，前端按 correctedAnchor 走并明确提示，
   而不是让用户静默落到错误段落。新增校正时在这里补一行，并在 docs 里记下依据。 */
const LEGACY_ANCHOR_FIXES = {
  'pa-v1n07-006': 'pa-v1n07-003',   // 毛泽东卡：引文实际在第 3 行
  'pa-v1n17-133': 'pa-v1n17-131',   // 邓小平卡
  'pa-v3n02-142': 'pa-v3n02-140',   // 陈云卡（标点版本差异，去标点后命中）
  'pa-v4n59-044': 'pa-v4n59-042',   // 周恩来卡
  'pa-v4n59-017': 'pa-v4n59-015',   // 刘少奇卡
  'pa-v1n11-049': null,             // 朱德卡：引文不在当前正文本中 → 取消锚点，不用别名掩盖
};
const norm = (s) => String(s ?? '').replace(/[\s　]/g, '');
/* 指纹：去掉空白后的前 24 字。用途是"同一编号现在是否还是这段话", 不是密码学完整性 */
const fp = (s) => norm(s).slice(0, 24);
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** 与 app.js fmtText 完全一致的行切分：正文首行标题之后，每个非空行生成一个 pa 锚点 */
function splitAnchors(raw) {
  const idx = raw.indexOf('\n\n');
  const body = idx > 0 ? raw.slice(idx + 2) : raw;
  const lines = body.split(/\n+/).map(s => s.trim()).filter(Boolean);
  return { body, lines };
}

const quiz = readJson(path.join(DATA, 'quiz.json'));
const cards = Object.entries(quiz.cards || {}).map(([k, v]) => ({ themeId: k, ...v }));

const articleIds = new Set();
for (const c of cards) if (c.readingTask && c.readingTask.articleId) articleIds.add(c.readingTask.articleId);
let sample = null;
try { sample = readJson(path.join(DATA, 'sample-topic.json')); } catch { /* optional */ }
if (sample && sample.articles) for (const id of Object.keys(sample.articles)) articleIds.add(id);

const entries = [];
const articles = {};
const mismatches = [];
const warnings = [];

for (const aid of [...articleIds].sort()) {
  const tp = path.join(DATA, 'texts', aid + '.txt');
  if (!fs.existsSync(tp)) { warnings.push(`${aid}: 缺少正文文件，无法建立锚点映射`); continue; }
  const raw = fs.readFileSync(tp, 'utf8');
  const { lines } = splitAnchors(raw);
  articles[aid] = {
    textSha256: sha256(raw), chars: raw.length,
    anchorCount: lines.length, mappedAt: new Date().toISOString(),
  };

  /* 1) AI 语料段落（若该篇在语料里）：把 pv 段落按文本对齐到锚点行 */
  const corpus = sample?.articles?.[aid];
  if (corpus) {
    const paraEntries = [];
    (corpus.paragraphs || []).forEach(p => {
      const key = norm(p.text);
      if (!key) return;
      let hit = -1, hits = 0;
      for (let i = 0; i < lines.length; i++) {
        if (norm(lines[i]) === key) { hit = i; hits++; }
      }
      if (hits === 1) {
        paraEntries.push({ id: p.id, seq: p.seq, line: hit + 1, chars: p.text.length, fp: fp(p.text), aligned: 'exact' });
      } else {
        paraEntries.push({ id: p.id, seq: p.seq, line: null, chars: p.text.length, fp: fp(p.text), aligned: hits ? 'ambiguous' : 'not-found' });
        if (!hits) mismatches.push({ articleId: aid, anchor: p.id, reason: 'corpus_paragraph_not_in_text' });
      }
    });
    articles[aid].corpusParagraphs = paraEntries;
  }

  /* 2) 人物卡锚点：pa-<aid>-<NNN> → 行号 → 该行是否真的包含卡里的 quote */
  for (const c of cards) {
    const rt = c.readingTask || {};
    if (rt.articleId !== aid || !rt.paragraphId) continue;
    const m = /^pa-v\d+n\d+-(\d+)$/.exec(String(rt.paragraphId));
    if (!m) {
      warnings.push(`${c.cardId}: 锚点格式不是 pa-<art>-<NNN>（${rt.paragraphId}）`);
      continue;
    }
    const n = parseInt(m[1], 10);
    const line = lines[n - 1];
    const quote = String(rt.quote || '');
    const q = norm(quote);

    /* 引文可能因为换行被切成 1—4 行；先按"最多 4 行拼接"找出它真正所在的起始行。
       这一步的目的不是替用户改卡，而是回答"这个编号现在是不是还指向这段话"。 */
    let foundLine = null, windowLen = 0, matchKind = null;
    const loose = (s) => String(s ?? '').replace(/[^\w\u4e00-\u9fff]/g, '');
    const scan = (target, normalizer = norm) => {
      for (let i = 0; i < lines.length; i++) {
        let acc = '';
        for (let k = 0; k < 4 && i + k < lines.length; k++) {
          acc += normalizer(lines[i + k]);
          if (acc.includes(target)) return { line: i + 1, span: k + 1 };
          if (acc.length > target.length + 200) break;
        }
      }
      return null;
    };
    if (q) {
      let hit = scan(q);
      if (hit) { foundLine = hit.line; windowLen = hit.span; matchKind = 'exact'; }
      else {
        /* 标点/引号在不同版本间会变（例如“实事”与实事），这不等于原文不同。
           退一步做"去标点"匹配，并明确标成 ok-punct，供编辑复核而不是当失败。 */
        hit = scan(loose(quote), loose);
        if (hit) { foundLine = hit.line; windowLen = hit.span; matchKind = 'punct'; }
      }
    }

    let status;
    if (!line) status = 'anchor-out-of-range';
    else if (!q) status = 'no-quote';
    else if (foundLine === null) status = 'quote-not-in-text';
    else if (foundLine === n) status = (matchKind === 'punct' ? 'ok-punct' : (windowLen === 1 ? 'ok' : 'ok-span' + windowLen));
    else status = (matchKind === 'punct' ? 'reflow-punct' : 'reflow');   // 引文在，但行号不对 → 锚点需修正

    const corrected = (status === 'reflow' || status === 'reflow-punct')
      ? 'pa-' + aid + '-' + String(foundLine).padStart(3, '0') : null;
    if (status === 'reflow' || status === 'reflow-punct' || status === 'quote-not-in-text' || status === 'anchor-out-of-range') {
      mismatches.push({
        articleId: aid, cardId: c.cardId, anchor: rt.paragraphId, reason: status,
        quote: quote.slice(0, 24), foundLine, correctedAnchor: corrected, matchKind,
      });
    }
    entries.push({
      articleId: aid, anchor: rt.paragraphId, line: n, cardId: c.cardId,
      chars: (line || '').length, fp: fp(line || ''), quote, status,
      foundLine, correctedAnchor: corrected,
    });
  }
}

const doc = {
  schema: 'anchor-map@1',
  builtAt: new Date().toISOString(),
  note: 'fp = 去空白后前 24 字，用于判断同一编号当前是否仍指向同一段文字；正文变化后请重建本文件',
  articles, entries,
  aliases: Object.entries(LEGACY_ANCHOR_FIXES).map(([from, to]) => ({ anchor: from, correctedAnchor: to, since: '2026-10-19' })),
  warnings, mismatches,
};

if (!CHECK_ONLY) fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');

console.log(`已建立锚点映射：${Object.keys(articles).length} 篇 / ${entries.length} 条卡片锚点`);
if (Object.keys(articles).length === 0) {
  /* 公开仓库不含正文本（著作权），CI 里必然拿不到 texts/。
     这时要明确说"跳过"，而不是输出一个空的"校验通过"冒充验证。 */
  console.log('SKIP: 当前环境没有 site/data/texts/*.txt（仓库不分发正文本），锚点校验需在有正文的环境执行。');
  console.log('      已提交的 site/data/anchor-map.json 由 verify-deploy-assets 校验（含 mismatches 检查）。');
  process.exit(0);
}
for (const [aid, a] of Object.entries(articles)) {
  console.log(`  ${aid}: ${a.anchorCount} 行, ${a.chars} 字, corpus 段落 ${a.corpusParagraphs ? a.corpusParagraphs.length : 0}`);
}
for (const e of entries) console.log(`  · ${e.cardId} ${e.anchor} → 第 ${e.line} 行 [${e.status}]`);
if (warnings.length) { console.log('\n警告:'); warnings.forEach(w => console.log('  ! ' + w)); }
if (mismatches.length) {
  console.log('\n锚点失配（必须人工处理）:');
  mismatches.forEach(m => console.log(`  ✗ ${m.articleId} ${m.anchor} ${m.reason}${m.cardId ? ' (card ' + m.cardId + ')' : ''}`));
  if (!ALLOW_MISMATCH) process.exit(1);
}
console.log(CHECK_ONLY ? '\n✓ 锚点校验通过（未写文件）' : '\n✓ 锚点映射已写入 site/data/anchor-map.json');
