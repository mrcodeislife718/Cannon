import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/compiler.js';
import { format } from '../src/formatter.js';
import { CannonSemanticError } from '../src/semantic.js';
import { CannonSyntaxError } from '../src/lexer.js';

function execute(source, resultName = 'result') {
  const { code } = compile(source);
  return new Function(`${code}\nreturn ${resultName};`)();
}

test('Cannon catches dynamic raised values and always executes finally', () => {
  const result = execute(`
result = "start"
try {
  raise "boom"
} catch error {
  result = error
} finally {
  result = result + "!"
}
`);
  assert.equal(result, 'boom!');
});

test('Cannon bare raise rethrows the active caught value', () => {
  const result = execute(`
result = null
try {
  try {
    raise "original"
  } catch inner {
    raise
  }
} catch outer {
  result = outer
}
`);
  assert.equal(result, 'original');
});

test('Cannon finally executes when a function returns', () => {
  const result = execute(`
fn compute(state) {
  try {
    return 7
  } finally {
    state[0] = state[0] + 1
  }
}
state = [0]
value = compute(state)
result = [value, state[0]]
`);
  assert.deepEqual(result, [7, 1]);
});

test('Cannon try-finally propagates unhandled raises after cleanup', () => {
  const { code } = compile(`
state = [0]
try {
  raise "failure"
} finally {
  state[0] = 1
}
`);
  assert.throws(() => new Function(code)(), (error) => error === 'failure');
});

test('Cannon catch bindings are lexical and bare raise is catch-only', () => {
  assert.throws(() => compile('raise'), CannonSemanticError);
  assert.throws(() => compile('try { raise "x" } catch error {}\nprint(error)'), /Undefined identifier: error/);
});

test('Cannon requires try to have catch or finally', () => {
  assert.throws(() => compile('try {}'), CannonSyntaxError);
});

test('Cannon formats try catch finally and raise canonically', () => {
  const formatted = format('try{raise "x"}catch error{raise}finally{print("done")}');
  assert.match(formatted, /try \{/);
  assert.match(formatted, /raise "x"/);
  assert.match(formatted, /catch error \{/);
  assert.match(formatted, /\n    raise\n/);
  assert.match(formatted, /finally \{/);
});
