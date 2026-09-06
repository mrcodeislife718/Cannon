import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/compiler.js';
import { format } from '../src/formatter.js';
import { analyze } from '../src/semantic.js';
import { parse } from '../src/parser.js';

function execute(source, resultName = 'result') {
  const { code } = compile(source);
  return new Function(`${code}\nreturn ${resultName};`)();
}

test('Cannon variables are dynamic by default without annotations', () => {
  const source = `
value = 7
value = "seven"
value = { answer: 42 }
result = value.answer
`;
  assert.equal(execute(source), 42);
});

test('Cannon supports Python-style for item in iterable syntax', () => {
  const source = `
total = 0
for item in [1, 2, 3, 4] {
  total = total + item
}
result = total
`;
  assert.equal(execute(source), 10);

  const { code } = compile(source);
  assert.match(code, /for \(const item of \[1, 2, 3, 4\]\)/);
  assert.doesNotMatch(code, /CannonIterator|runtimeIter|__iterate/);
});

test('for-in bindings are scoped to the loop', () => {
  const ast = parse(`for item in [1] { print(item) }\nprint(item)`);
  assert.throws(() => analyze(ast), /Undefined identifier: item/);
});

test('formatter preserves Cannon simple iteration syntax', () => {
  assert.equal(
    format('for item in [1,2] { print(item) }'),
    'for item in [1, 2] {\n  print(item)\n}\n'
  );
});
