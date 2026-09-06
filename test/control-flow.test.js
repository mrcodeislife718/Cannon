import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/compiler.js';
import { format } from '../src/formatter.js';
import { CannonSemanticError } from '../src/semantic.js';

test('Cannon executes for loops with break and continue', async () => {
  const source = `
let total = 0
for (let i = 0; i < 10; i = i + 1) {
  if (i == 2) { continue }
  if (i == 6) { break }
  total = total + i
}
returnValue = total
`;
  const { code } = compile(source);
  const fn = new Function(`${code}\nreturn returnValue;`);
  assert.equal(fn(), 0 + 1 + 3 + 4 + 5);
});

test('Cannon rejects break and continue outside loops', () => {
  assert.throws(() => compile('break'), CannonSemanticError);
  assert.throws(() => compile('continue'), CannonSemanticError);
});

test('Cannon loop variables remain scoped to the loop', () => {
  assert.throws(() => compile(`for (let i = 0; i < 1; i = i + 1) {}\nprint(i)`), /Undefined identifier: i/);
});

test('Cannon formatter supports for break and continue', () => {
  const formatted = format(`for(let i=0;i<3;i=i+1){if(i==1){continue}break}`);
  assert.match(formatted, /for \(let i = 0; i < 3; i = i \+ 1\)/);
  assert.match(formatted, /continue/);
  assert.match(formatted, /break/);
});
