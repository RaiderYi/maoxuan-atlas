// H2(R56) 离线回归：语料产线与装载器（切块规则 / 加解密往返 / 完整性校验 / 检索可达）
// 运行: node tests/api/test-corpus.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { buildCorpusJson, encryptPack, decryptPack, mergeParagraphs } from '../../pipeline/build-corpus-217.mjs';
import { loadCorpusFull } from '../../site/api/_corpus.mjs';
import { retrieveHybrid } from '../../site/api/_retrieval.mjs';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 200) : '')); }
}

console.log('merge · 切块规则');
{
  const text = [
    '某篇文章标题',
    '（一九二八年十月五日）',
    '这是题注说明文字。',
    '一　国内的政治状况',
    '现在国民党新军阀的统治，依然是城市买办阶级和乡村豪绅阶级的统治，对外投降帝国主义，',
    '对内以新军阀代替旧军阀，对工农阶级进行经济剥削和政治压迫，武装镇压各地的革命运动，白色恐怖从此笼罩全国的城市和乡村，全国工农平民以至资产阶级依然没有得到丝毫政治上经济上的解放。',
  ].join('\n');
  const chunks = mergeParagraphs(text);
  ok('标题独立成块', chunks[0] === '某篇文章标题');
  ok('日期独立成块', chunks[1] === '（一九二八年十月五日）');
  ok('题注独立成块', chunks[2] === '这是题注说明文字。');
  ok('节标题独立成块', chunks[3] === '一　国内的政治状况');
  ok('正文合并到句末（多折行拼为一块，≥120字触发切分）', chunks[4].startsWith('现在国民党新军阀的统治') && chunks[4].endsWith('没有得到丝毫政治上经济上的解放。'), chunks[4]);
  ok('块数符合预期', chunks.length === 5, chunks.length);
  ok('空行被过滤', mergeParagraphs('a\n\n\nb').length === 2);
}

console.log('corpus · 构建与加解密往返');
const staged = {
  v9n01: '测试文章标题\n（一九四九年一月一日）\n' + '这是正文内容，讲述调查研究的方法与结论。'.repeat(4) + '\n二　另外一节\n' + '第二个自然段讲组织与群众。'.repeat(5),
  v9n02: '另一篇文章\n正文更短的一段话。',
};
const meta = [{ id: 'v9n01', title: '测试文章一', vol: 9, date: '（一九四九年一月一日）' }, { id: 'v9n02', title: '测试文章二', vol: 9, date: null }];
const json = buildCorpusJson(staged, meta);
ok('篇数与段数正确', json.articleCount === 2 && json.paragraphCount >= 4, { a: json.articleCount, p: json.paragraphCount });
ok('段落 id 兼容既有正则', json.paragraphs.every(p => /^p(v\d+n\d+)-\d{3}$/.test(p.id)));

const key = crypto.randomBytes(32).toString('base64');
const pack = encryptPack(json, key);
ok('包结构完整', pack.algo === 'aes-256-gcm+gzip' && pack.articleCount === 2 && typeof pack.sha256 === 'string');
const round = decryptPack(pack, key);
ok('解密往返一致（sha256 对齐）', round.sha256 === pack.sha256 && round.paragraphs.length === json.paragraphCount);

console.log('corpus · 装载器与完整性门');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpustest-'));
  const packPath = path.join(dir, 'corpus-full.pack.json');
  fs.writeFileSync(packPath, JSON.stringify(pack));
  const full = loadCorpusFull({ packPath, keyB64: key });
  ok('装载成功', full && full.corpus.length === json.paragraphCount);
  ok('articleMeta 可用（篇名供引用展示）', full.articleMeta.v9n01.title === '测试文章一');
  ok('avgParaChars 为正', full.avgParaChars > 0);
  const hit = retrieveHybrid('调查研究的方法', full.corpus, { top: 3 });
  ok('混合检索可在全量语料上命中目标篇', (hit.hits ?? []).length > 0 && hit.hits.some(id => id.startsWith('pv9n01-')), hit.hits?.slice(0, 3));

  // 篡改密文 → 完整性门拒绝装载
  const bad = JSON.parse(JSON.stringify(pack));
  bad.blob.z = Buffer.from('corrupted').toString('base64');
  const badPath = path.join(dir, 'bad.pack.json');
  fs.writeFileSync(badPath, JSON.stringify(bad));
  const refused = loadCorpusFull({ packPath: badPath, keyB64: key });
  ok('密文损坏 → 装载器拒绝（返回 null 回退）', refused === null);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('');
console.log(`结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
