import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/compiler.js';
import { format } from '../src/formatter.js';
import { CannonSemanticError } from '../src/semantic.js';
import { CannonSyntaxError } from '../src/lexer.js';

function execute(source) {
  const { code } = compile(source);
  return new Function(`${code}\nreturn result;`)();
}

test('Cannon default parameters make ordinary calls concise', () => {
  const result = execute(`
fn greet(name, punctuation = "!") {
  return "Hello " + name + punctuation
}
result = [greet("Ada"), greet("Grace", "?")]
`);
  assert.deepEqual(result, ['Hello Ada!', 'Hello Grace?']);
});

test('Cannon mutable defaults are fresh per call', () => {
  const result = execute(`
fn collect(value, items = []) {
  items.push(value)
  return items.length
}
result = [collect(1), collect(2)]
`);
  assert.deepEqual(result, [1, 1]);
});

test('Cannon variadic parameters collect extra positional arguments directly', () => {
  const result = execute(`
fn summarize(first, ...rest) {
  return first + rest.length
}
result = summarize(10, 1, 2, 3)
`);
  assert.equal(result, 13);
});

test('Cannon validates known function arity with defaults and variadics', () => {
  assert.throws(() => compile('fn f(a, b = 2) { return a + b }\nresult = f()'), CannonSemanticError);
  assert.throws(() => compile('fn f(a, b = 2) { return a + b }\nresult = f(1, 2, 3)'), CannonSemanticError);
  assert.doesNotThrow(() => compile('fn f(a, ...rest) { return a }\nresult = f(1, 2, 3)'));
  assert.throws(() => compile('fn f(a, ...rest) { return a }\nresult = f()'), CannonSemanticError);
});

test('Cannon rejects required parameters after default parameters', () => {
  assert.throws(() => compile('fn invalid(a = 1, b) { return b }'), CannonSyntaxError);
});

test('Cannon formatter preserves default and variadic parameter intent', () => {
  const formatted = format('fn f(a,b=2,...rest){return b}');
  assert.match(formatted, /fn f\(a, b = 2, \.\.\.rest\)/);
});
