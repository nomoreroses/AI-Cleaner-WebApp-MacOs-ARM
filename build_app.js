import { readFileSync, writeFileSync } from 'fs';

const source = readFileSync('static/app.jsx', 'utf8');

const transpiler = new Bun.Transpiler({
  loader: 'jsx',
  target: 'browser',
  development: false
});

let result = transpiler.transformSync(source);

const hashMatch = result.match(/jsxDEV_[a-zA-Z0-9]+/);
if (!hashMatch) {
  throw new Error('Unable to locate jsxDEV helper in the compiled bundle.');
}

const helperName = hashMatch[0];
const helperBlock = `const _jsxDEV = (type, config, maybeKey, ...rest) => {\n  let props = config == null ? config : { ...config };\n  if (maybeKey !== undefined && maybeKey !== null) {\n    if (props == null) {\n      props = { key: maybeKey };\n    } else {\n      props = { ...props, key: maybeKey };\n    }\n  }\n  return React.createElement(type, props);\n};`;

if (helperName !== '_jsxDEV') {
  const hookDecl = 'const { useState, useEffect, useRef } = React;';
  result = result.replace(new RegExp(helperName, 'g'), '_jsxDEV');
  result = result.replace(hookDecl, `${hookDecl}\n\n${helperBlock}`);
}

writeFileSync('static/app.js', result);
