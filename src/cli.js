#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compile, parse } from './index.js';

const args = process.argv.slice(2);
const command = args[0];
const input = args[1];

function usage(code = 0) {
  console.log(`cannon <command> <file> [options]\n\nCommands:\n  run <file>              Compile and execute a .cannon program\n  build <file> [-o file]  Compile a .cannon program to JavaScript\n  check <file>             Parse and validate Cannon source\n  ast <file>               Print the parsed AST`);
  process.exit(code);
}

if (!command || command === '-h' || command === '--help') usage(0);
if (!['run','build','check','ast'].includes(command)) {
  console.error(`cannon: unknown command ${command}`);
  usage(1);
}
if (!input) usage(1);
if (path.extname(input) !== '.cannon') {
  console.error('cannon: source files must use the .cannon extension');
  process.exit(1);
}

let source;
try {
  source = fs.readFileSync(input, 'utf8');
} catch (error) {
  console.error(`cannon: ${error.message}`);
  process.exit(2);
}

try {
  if (command === 'check') {
    parse(source);
    console.log(`${input}: valid Cannon`);
    process.exit(0);
  }

  if (command === 'ast') {
    console.log(JSON.stringify(parse(source), null, 2));
    process.exit(0);
  }

  const { code } = compile(source);

  if (command === 'build') {
    const outputFlag = args.indexOf('-o');
    const output = outputFlag >= 0
      ? args[outputFlag + 1]
      : input.replace(/\.cannon$/i, '.mjs');
    if (!output) {
      console.error('cannon: -o requires an output filename');
      process.exit(1);
    }
    fs.writeFileSync(output, code, 'utf8');
    console.log(`${input} -> ${output}`);
    process.exit(0);
  }

  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(`cannon: ${error.message}`);
  process.exit(1);
}
