import { readFileSync, writeFileSync } from 'fs';
const source = readFileSync('static/app.jsx', 'utf8');
const transpiler = new Bun.Transpiler({
  loader: 'jsx',
  target: 'browser',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment'
});
const result = transpiler.transformSync(source);
writeFileSync('static/app.js', result);
