// 验证 buildCorpusVersion 的 hash 属性: 改任一篇内容/段落 → 变化; 相同内容重复构建 → 不变
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const raw = JSON.parse(fs.readFileSync(path.resolve('site/data/sample-topic.json'), 'utf8'));

function buildCorpusVersion(raw) {
  const hash = crypto.createHash('sha256');
  const aids = Object.keys(raw.articles ?? {}).sort();
  for (const aid of aids) {
    const a = raw.articles[aid];
    hash.update(aid).update('\u0000');
    hash.update(String(a.title ?? '')).update('\u0000');
    const paras = [...(a.paragraphs ?? [])].sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0));
    for (const para of paras) {
      hash.update(String(para.id ?? '')).update('\u0000');
      hash.update(String(para.text ?? '')).update('\u0000');
    }
    hash.update('\u0001');
  }
  return hash.digest('hex');
}

let failed = 0;
const ok = (c, n) => { console.log(c ? 'PASS' : 'FAIL', n); if (!c) failed++; };

const v0 = buildCorpusVersion(raw);
const v0again = buildCorpusVersion(JSON.parse(JSON.stringify(raw)));
ok(v0 === v0again, 'same content rebuild -> same hash');

// 改第二篇某段落内容 (保持段数不变)
const raw2 = JSON.parse(JSON.stringify(raw));
const aid2 = Object.keys(raw2.articles).sort()[1];
raw2.articles[aid2].paragraphs[10].text += 'X';
const v1 = buildCorpusVersion(raw2);
ok(v1 !== v0, 'modify 2nd article paragraph -> hash changes');

// 改第二篇标题
const raw3 = JSON.parse(JSON.stringify(raw));
raw3.articles[aid2].title += '改';
const v2 = buildCorpusVersion(raw3);
ok(v2 !== v0, 'modify 2nd article title -> hash changes');

// 改第二篇段落 ID (seq 不变)
const raw4 = JSON.parse(JSON.stringify(raw));
raw4.articles[aid2].paragraphs[10].id += '-x';
const v3 = buildCorpusVersion(raw4);
ok(v3 !== v0, 'modify 2nd article paragraph id -> hash changes');

console.log(failed ? `\n${failed} FAILED` : '\nALL CORPUS-HASH TESTS PASS');
process.exit(failed ? 1 : 0);
