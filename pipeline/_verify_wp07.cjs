// WP07 验收辅助: research.html 内联 JS 语法检查 + 深链格式核对
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const root = 'D:/工作/maoxuan_viz/repo_stage';
const html = fs.readFileSync(path.join(root, 'site/research.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no inline script found'); process.exit(1); }
new vm.Script(m[1]); // throws on syntax error
console.log('research.html inline JS: syntax OK');

// 深链格式 index.html#/art/<articleId> — app.js 是否支持 #/art/ 路由
const app = fs.readFileSync(path.join(root, 'site/app.js'), 'utf8');
const ok = /#\/art\//.test(app) || /['"]\/art\/['"]/.test(app) || app.includes('art/');
console.log('app.js deep-link route (/art/):', ok ? 'FOUND' : 'NOT FOUND');

// dev-server 路由: /api/ask 是否映射到 api/ask.js
const ds = fs.readFileSync(path.join(root, 'pipeline/dev-server.js'), 'utf8');
console.log('dev-server maps /api/*:', ds.includes('/api/') && ds.includes('api/') ? 'yes' : 'no');
