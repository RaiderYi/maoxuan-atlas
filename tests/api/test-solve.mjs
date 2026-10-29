// R49/R50 离线回归：solve 管线的解构校验 / 解决卡校验 / 引用逐字校验 / 诚实降级
// 无网络依赖（不调用模型）。运行: node tests/api/test-solve.mjs
import { buildDecomposeMessages, buildSolveMessages, validateSolveCitations, validateDecompose } from '../../site/api/_solve.mjs';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 200) : '')); }
}

// ---------- 1. decompose 提示词 ----------
console.log('decompose · 提示词结构');
{
  const m = buildDecomposeMessages('跨部门项目推进不动');
  ok('system 指令在首位', m[0].role === 'system' && m[0].content.includes('严格 JSON'));
  ok('包含用户问题', m[1].content.includes('跨部门项目推进不动'));
  ok('包含高风险分流规则', m[0].content.includes('医疗') && m[0].content.includes('referral'));
  ok('追问数量上界为 2', m[0].content.includes('最多 2 个'));
}

// ---------- 2. decompose 输出校验 ----------
console.log('decompose · 输出校验');
{
  ok('合法输出通过', validateDecompose({
    understanding: { goal: '推进项目', known: ['开会支持'], unknown: ['资源情况'], focus: '优先级' },
    followUps: [{ question: '责任明确吗？', options: ['明确', '不明确'] }],
    referral: null,
  }).ok === true);
  const noGoal = validateDecompose({ understanding: { known: [] }, followUps: [] });
  ok('缺 goal 判为不合规', noGoal.ok === false);
  const v = validateDecompose({
    understanding: { goal: 'g', known: [], unknown: [], focus: '' },
    followUps: [{ question: 'q', options: [1, 2, 3, 4, 5] }],
    referral: { domain: '医疗', message: '需要专业帮助' },
  });
  ok('options 截到 4 个', v.ok && v.followUps[0].options.length === 4, v.followUps);
  ok('referral 被结构化收下', v.ok && v.referral && v.referral.domain === '医疗');
  ok('referral 为空对象时归 null', validateDecompose({
    understanding: { goal: 'g' }, followUps: [], referral: {},
  }).referral === null);
}

// ---------- 3. solve 提示词 ----------
console.log('solve · 提示词结构');
{
  const brief = { problem: '项目推进不动', understanding: { goal: '落地' }, answers: [{ question: '责任明确吗', answer: '明确' }] };
  const m = buildSolveMessages(brief, [
    { id: 'pv1n03-001', articleId: 'v1n03', seq: 1, text: '证据一', _g: new Set(), _sec: '' },
  ]);
  ok('证据带编号进入提示词', m[1].content.includes('[pv1n03-001]'));
  ok('追问与回答进入提示词', m[1].content.includes('责任明确吗') && m[1].content.includes('明确'));
  ok('空引用降级规则存在（不得编造）', m[0].content.includes('classics 输出空数组'));
}

// ---------- 4. 引用逐字校验 ----------
console.log('solve · 引用校验');
const EVIDENCE = [
  { id: 'pv1n03-010', articleId: 'v1n03', seq: 10, text: '工农武装割据的思想是发展的条件。' },
  { id: 'pv1n03-011', articleId: 'v1n03', seq: 11, text: '所谓割据，必须是武装的。' },
];
{
  const good = validateSolveCitations({
    basis: 'corpus',
    classics: [{ id: 'pv1n03-010', quote: '工农武装割据', relevance: 'r', interpretation: 'i', boundary: 'b' }],
  }, EVIDENCE);
  ok('真实引文通过且 basis=corpus', good.ok && good.basis === 'corpus' && good.classics.length === 1);

  const fab = validateSolveCitations({
    classics: [{ id: 'pv1n03-999', quote: '不存在', relevance: '', interpretation: '', boundary: '' }],
  }, EVIDENCE);
  ok('虚构 id 被拦截', fab.ok === false && fab.reason === 'fabricated');

  const badq = validateSolveCitations({
    classics: [{ id: 'pv1n03-010', quote: '引文不在段中', relevance: '', interpretation: '', boundary: '' }],
  }, EVIDENCE);
  ok('伪造引文被拦截', badq.ok === false && badq.reason === 'bad_quotes');

  // 切段边界：本段结尾 + 下一段开头的连续片段（正序拼接）合法
  const cross = validateSolveCitations({
    classics: [{ id: 'pv1n03-010', quote: '发展的条件。所谓割据', relevance: '', interpretation: '', boundary: '' }],
  }, EVIDENCE);
  ok('相邻 seq 正序拼接引文通过', cross.ok && cross.basis === 'corpus', cross);

  const empty = validateSolveCitations({ basis: 'corpus', classics: [] }, EVIDENCE);
  ok('空引用诚实降级为 general', empty.ok && empty.basis === 'general' && empty.classics.length === 0);

  const unfound = validateSolveCitations(null, EVIDENCE);
  ok('不可解析判为不合规', unfound.ok === false);
}

// ---------- 5. 脚本入口（供 run-all 汇总） ----------
console.log('');
console.log(`结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
