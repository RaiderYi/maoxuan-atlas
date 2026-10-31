import { mergeParagraphs } from '../pipeline/build-corpus-217.mjs';
const lines = [
  '现在国民党新军阀的统治，依然是城市买办阶级和乡村豪绅阶级的统治，对外投降帝国主义，',
  '对内以新军阀代替旧军阀，对工农阶级进行经济剥削和政治压迫，武装镇压各地的革命运动，白色恐怖从此笼罩全国的城市和乡村，全国工农平民以至资产阶级依然没有得到丝毫政治上经济上的解放。',
  '全局充分论证之后到达句末结束了一个语义完整的自然段落。',
];
const nonEmpty = lines.map(s => s.trim());
let buf = [], bufLen = 0;
for (let i = 0; i < nonEmpty.length; i++) {
  const line = nonEmpty[i];
  buf.push(line); bufLen += line.length;
  const ends = /[。！？；：""』」]$/.test(line);
  console.log(i, 'len', line.length, 'bufLen', bufLen, 'endsSentence', ends, 'tail:', JSON.stringify(line.slice(-3)));
  if ((bufLen >= 120 && ends) || bufLen >= 400) { console.log('  -> FLUSH at', i); buf = []; bufLen = 0; }
}
console.log('chunks:', mergeParagraphs(lines.join('\n')).length);
