import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { compile, lex, parse } from '../src/index.js';

function run(source) {
  const { code } = compile(source);
  return spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8' });
}

test('lexer recognizes Cannon declarations and operators', () => {
  const tokens = lex('let x = 2 + 3 * 4');
  assert.deepEqual(tokens.map((token) => token.type), ['let','identifier','=','number','+','number','*','number','eof']);
});

test('parser builds function and call AST', () => {
  const ast = parse('fn add(a, b) { return a + b } print(add(2, 3))');
  assert.equal(ast.body[0].type, 'FunctionDeclaration');
  assert.equal(ast.body[1].type, 'ExpressionStatement');
});

test('compiler executes arithmetic and print', () => {
  const result = run('x = 2 + 3 * 4\nprint(x)');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '14');
});

test('compiler executes functions and return values', () => {
  const result = run(`
    fn add(a, b) {
      return a + b
    }
    print(add(7, 5))
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '12');
});

test('compiler executes if else and while', () => {
  const result = run(`
    i = 0
    total = 0
    while (i < 4) {
      total = total + i
      i = i + 1
    }
    if (total == 6) {
      print("ok")
    } else {
      print("bad")
    }
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
});

test('comments are ignored without changing execution', () => {
  const result = run(`
    // line comment
    x = 10
    /* block comment */
    print(x)
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '10');
});
