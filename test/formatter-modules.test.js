import test from 'node:test';
import assert from 'node:assert/strict';
import { format, parse } from '../src/index.js';

test('Cannon formatter supports the complete existing module syntax', () => {
  const source = `
import './boot.cannon'
import main, { add as sum, subtract } from './math.cannon'
import * as values from './values.cannon'
export const version = '1.0'
export { sum as plus, subtract }
export { external as renamed } from './external.cannon'
export default main
`;
  const formatted = format(source);
  assert.equal(formatted, [
    'import "./boot.cannon"',
    'import main, { add as sum, subtract } from "./math.cannon"',
    'import * as values from "./values.cannon"',
    'export const version = "1.0"',
    'export { sum as plus, subtract }',
    'export { external as renamed } from "./external.cannon"',
    'export default main',
    ''
  ].join('\n'));
  assert.doesNotThrow(() => parse(formatted));
});

test('Cannon formatter preserves function exports and control-flow grammar', () => {
  const source = `export default async fn main(value) { if (value > 1) { return value } else { while (value < 1) { value = value + 1 } return value } }`;
  const formatted = format(source);
  assert.match(formatted, /^export default async fn main\(value\) \{/);
  assert.match(formatted, /if \(value > 1\)/);
  assert.match(formatted, /while \(value < 1\)/);
  assert.doesNotThrow(() => parse(formatted));
});

test('Cannon formatter preserves member assignment targets', () => {
  const formatted = format(`let state = { count: 0 }\nstate.count = state.count + 1`);
  assert.match(formatted, /state\.count = state\.count \+ 1/);
  assert.doesNotThrow(() => parse(formatted));
});
