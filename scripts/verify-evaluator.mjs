// 临时验证脚本：code_repair_v3 评分器功能验证
import { codeRepairEvaluator } from '../packages/core/dist/index.js';

const meta = {};

// 场景1：JS 修复题，沙箱执行
const scenario1 = {
  id: 'CR2-JS-002', language: 'javascript', functionName: 'delayedLoggers',
  sourceCode: 'function delayedLoggers(n) { const fns = []; for (var i = 0; i < n; i++) { fns.push(() => i); } return fns; }',
  hiddenTests: [{ id: 't1', type: 'hidden', testCode: "console.log(delayedLoggers(3).map(f => f()).join(','))", expectedOutput: '0,1,2' }],
  requirements: ['let'],
};
const goodOutput = '有 bug。var 没有块级作用域。\n\n```javascript\nfunction delayedLoggers(n) {\n  const fns = [];\n  for (let i = 0; i < n; i++) {\n    fns.push(() => i);\n  }\n  return fns;\n}\n```';
const badOutput = '有 bug。\n\n```javascript\nfunction delayedLoggers(n) {\n  const fns = [];\n  for (var i = 0; i < n; i++) {\n    fns.push(() => i);\n  }\n  return fns;\n}\n```';

const r1 = await codeRepairEvaluator.evaluate(scenario1, goodOutput, meta);
const r2 = await codeRepairEvaluator.evaluate(scenario1, badOutput, meta);
console.log('[1] JS修复-正确修复得分:', r1.totalScore, '|', r1.evidence.find((e) => e.includes('Sandbox')));
console.log('[1] JS修复-错误修复得分:', r2.totalScore, '|', r2.evidence.find((e) => e.includes('Sandbox')));

// 场景2：陷阱题（no_bug）
const scenario2 = {
  id: 'CR2-JS-008', language: 'javascript', expectedVerdict: 'no_bug', functionName: 'formatPrice',
  sourceCode: 'function formatPrice(cents) { return cents; }',
  requirements: ['整数', '浮点', 'padStart'],
};
const trapGood = '无 bug。该实现用整数 cents 运算规避了浮点误差，padStart 保证两位小数。';
const trapBad = '存在 bug，修复如下：\n```javascript\nfunction formatPrice(c) { return c.toFixed(2); }\n```';
const r3 = await codeRepairEvaluator.evaluate(scenario2, trapGood, meta);
const r4 = await codeRepairEvaluator.evaluate(scenario2, trapBad, meta);
console.log('[2] 陷阱题-正确识别无bug:', r3.totalScore);
console.log('[2] 陷阱题-误判为有bug:', r4.totalScore);

// 场景3：非 JS 静态模式
const scenario3 = {
  id: 'CR2-PY-002', language: 'python', functionName: 'add_item',
  sourceCode: 'def add_item(item, cart=[]):\n    cart.append(item)\n    return cart',
  requirements: ['cart is None', 'None'],
};
const pyOutput = '有 bug。可变默认参数共享。\n```python\ndef add_item(item, cart=None):\n    if cart is None:\n        cart = []\n    cart.append(item)\n    return cart\n```';
const r5 = await codeRepairEvaluator.evaluate(scenario3, pyOutput, meta);
console.log('[3] Python静态模式得分:', r5.totalScore, '|', r5.evidence.find((e) => e.includes('Static signals')));

// 判定区分度
const pass = r1.totalScore > r2.totalScore && r3.totalScore > r4.totalScore;
console.log('\n区分度验证:', pass ? 'PASS ✓' : 'FAIL ✗');
process.exit(pass ? 0 : 1);
