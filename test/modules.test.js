import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, analyze, compile, CannonSemanticError } from '../src/index.js';

test('Cannon parses named, default, namespace and side-effect imports', () => {
  const ast = parse(`
import './boot.cannon'
import main from './main.cannon'
import * as math from './math.cannon'
import { add, subtract as sub } from './ops.cannon'
print(main, math.pi, add(1, 2), sub(4, 1))
`);
  assert.equal(ast.body.filter((node) => node.type === 'ImportDeclaration').length, 4);
  assert.deepEqual(ast.body[3].specifiers.map(({ imported, local }) => [imported, local]), [['add','add'],['subtract','sub']]);
});

test('Cannon module imports create immutable module-scope bindings', () => {
  assert.throws(
    () => analyze(parse(`import { value } from './dep.cannon'\nvalue = 2`)),
    (error) => error instanceof CannonSemanticError && /Cannot reassign import binding: value/.test(error.message)
  );
});

test('Cannon validates local exports and records deterministic export names', () => {
  const ast = parse(`
const version = '1.0'
fn add(a, b) { return a + b }
export { add, version as release }
`);
  analyze(ast);
  assert.deepEqual(ast.exports, ['add','release']);
  assert.throws(() => analyze(parse('export { missing }')), /Cannot export undefined binding: missing/);
});

test('Cannon compiles modules to standards-compatible ESM', () => {
  const { code, ast } = compile(`
import base, { add as sum } from './math.mjs'
export const answer = sum(base, 2)
export default answer
`);
  assert.match(code, /import base, \{ add as sum \} from "\.\/math\.mjs";/);
  assert.match(code, /export const answer = sum\(base, 2\);/);
  assert.match(code, /export default answer;/);
  assert.deepEqual(ast.exports, ['answer','default']);
});

test('Cannon re-exports symbols without introducing local bindings', () => {
  const { code, ast } = compile(`export { add as plus } from './math.mjs'`);
  assert.equal(code.trim(), `export { add as plus } from "./math.mjs";`);
  assert.deepEqual(ast.exports, ['plus']);
});
