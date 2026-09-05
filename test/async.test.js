import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compile, parse, analyze, CannonSemanticError } from '../src/index.js';

test('Cannon parses async functions and await expressions into the canonical AST', () => {
  const ast = parse('async fn double(value) { return await value }');
  const fn = ast.body[0];
  assert.equal(fn.type, 'FunctionDeclaration');
  assert.equal(fn.async, true);
  assert.equal(fn.body.body[0].value.type, 'AwaitExpression');
});

test('Cannon rejects await outside an async function', () => {
  const ast = parse('fn broken(value) { return await value }');
  assert.throws(() => analyze(ast), (error) => error instanceof CannonSemanticError && /await can only/.test(error.message));
});

test('Cannon async functions compile and execute through the JavaScript backend', async () => {
  const source = `
async fn resolve(value) { return await value }
async fn main() {
  let first = resolve(20)
  let second = resolve(22)
  return (await first) + (await second)
}
result = main()
`;
  const { code } = compile(source);
  assert.match(code, /async function resolve/);
  assert.match(code, /await first/);
  const context = { Promise };
  vm.createContext(context);
  vm.runInContext(`${code}\nglobalThis.__result = result;`, context);
  assert.equal(await context.__result, 42);
});

test('nested synchronous functions cannot inherit an outer async permission', () => {
  const ast = parse('async fn outer(value) { fn inner() { return await value } return value }');
  assert.throws(() => analyze(ast), /await can only be used inside an async function/);
});
