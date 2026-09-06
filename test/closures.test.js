import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/compiler.js';
import { format } from '../src/formatter.js';
import { CannonSemanticError } from '../src/semantic.js';

test('Cannon anonymous functions capture lexical values', () => {
  const { code } = compile(`
fn makeAdder(base) {
  return fn(value) {
    return base + value
  }
}
result = makeAdder(10)(5)
`);
  const result = new Function(`${code}\nreturn result;`)();
  assert.equal(result, 15);
});

test('Cannon anonymous functions support default and variadic parameters', () => {
  const { code } = compile(`
combine = fn(value = 2, ...rest) {
  return value + rest.length
}
result = [combine(), combine(5, 1, 2)]
`);
  const result = new Function(`${code}\nreturn result;`)();
  assert.deepEqual(result, [2, 7]);
});

test('Cannon async anonymous functions preserve await boundaries', async () => {
  const { code } = compile(`
work = async fn(value) {
  return await value
}
result = work(42)
`);
  const result = new Function(`${code}\nreturn result;`)();
  assert.equal(await result, 42);
});

test('Cannon closures do not inherit loop or catch control authority', () => {
  assert.throws(() => compile('while (true) { callback = fn() { break } break }'), CannonSemanticError);
  assert.throws(() => compile('try { raise "x" } catch error { callback = fn() { raise } }'), CannonSemanticError);
});

test('Cannon formatter preserves anonymous function syntax', () => {
  const formatted = format('factory=fn(x=1,...rest){return x+rest.length}');
  assert.match(formatted, /fn\(x = 1, \.\.\.rest\)/);
});
