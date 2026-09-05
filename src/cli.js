#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compile, parse, format, check, addDependency, install, runTests, createProject, buildTarget, benchmarkCompiler } from './index.js';

let args = process.argv.slice(2);
let command = args[0];
let input = args[1];

if (command?.endsWith('.cannon')) {
  input = command;
  command = 'run';
  args = ['run', input, ...args.slice(1)];
}

function usage(code = 0) {
  console.log(`cannon <file.cannon>\ncannon <command> [arguments]\n\nCommands:\n  run <file>                         Compile and execute a .cannon program\n  build <file> [-o file]             Compile a .cannon program to JavaScript\n  build <file> --target <name> [-o dir]\n                                     Build web, backend, or native target artifacts\n  bench <file> [--iterations N]      Measure compiler latency without asserting a claim\n  check <file>                       Parse and validate Cannon source\n  fmt <file> [--write]               Format Cannon source\n  test [directory]                   Discover and run *.test.cannon/*.spec.cannon\n  add <package[@version]>            Resolve and lock a dependency using CANNON_REGISTRY_URL\n  install [directory] [--frozen]     Install verified locked dependencies\n  create <directory>                 Create a Cannon project\n  ast <file>                         Print the parsed AST\n\nRegistry environment:\n  CANNON_REGISTRY_URL                Base URL for the Cannon package registry\n  CANNON_REGISTRY_TOKEN              Optional bearer token`);
  process.exit(code);
}

if (!command || command === '-h' || command === '--help') usage(0);

if (command === 'add') {
  if (!input) usage(1);
  try { const result = await addDependency(process.cwd(), input); console.log(`added ${input} -> ${result.resolved.version}`); process.exit(0); }
  catch (error) { console.error(`cannon: ${error.message}`); process.exit(1); }
}

if (command === 'install') {
  try { const lock = await install(input && !input.startsWith('--') ? input : process.cwd(), { frozen: args.includes('--frozen') }); console.log(`installed ${Object.keys(lock.packages ?? {}).length} dependencies`); process.exit(0); }
  catch (error) { console.error(`cannon: ${error.message}`); process.exit(1); }
}

if (command === 'test') {
  try { const result = await runTests(input ?? process.cwd()); for (const entry of result.results) console.log(`${entry.ok ? 'PASS' : 'FAIL'} ${entry.file}${entry.error ? ` — ${entry.error.message}` : ''}`); console.log(`${result.passed} passed, ${result.failed} failed`); process.exit(result.ok ? 0 : 1); }
  catch (error) { console.error(`cannon: ${error.message}`); process.exit(1); }
}

if (command === 'create') {
  if (!input) usage(1);
  try { const result = await createProject(input); console.log(`created ${result.root}`); process.exit(0); }
  catch (error) { console.error(`cannon: ${error.message}`); process.exit(1); }
}

if (!['run','build','bench','check','fmt','ast'].includes(command)) {
  console.error(`cannon: unknown command ${command}`);
  usage(1);
}
if (!input) usage(1);
if (path.extname(input) !== '.cannon') {
  console.error('cannon: source files must use the .cannon extension');
  process.exit(1);
}

let source;
try { source = fs.readFileSync(input, 'utf8'); }
catch (error) { console.error(`cannon: ${error.message}`); process.exit(2); }

try {
  if (command === 'check') {
    const result = check(source, { file: input });
    if (!result.ok) { for (const diagnostic of result.diagnostics) console.error(`${input}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column ?? 1}` : ''}: ${diagnostic.message}`); process.exit(1); }
    console.log(`${input}: valid Cannon`); process.exit(0);
  }

  if (command === 'fmt') {
    const formatted = format(source);
    if (args.includes('--write')) { await fsp.writeFile(input, formatted, 'utf8'); console.log(`formatted ${input}`); }
    else process.stdout.write(formatted);
    process.exit(0);
  }

  if (command === 'ast') { console.log(JSON.stringify(parse(source), null, 2)); process.exit(0); }

  if (command === 'bench') {
    const flag = args.indexOf('--iterations');
    const iterations = flag >= 0 ? Number(args[flag + 1]) : 100;
    const result = await benchmarkCompiler(source, { iterations });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (command === 'build') {
    const targetFlag = args.indexOf('--target');
    if (targetFlag >= 0) {
      const target = args[targetFlag + 1];
      if (!target) throw new Error('--target requires web, backend, or native');
      const outputFlag = args.indexOf('-o');
      const outDir = outputFlag >= 0 ? args[outputFlag + 1] : path.join(path.dirname(input), 'dist', target);
      if (!outDir) throw new Error('-o requires an output directory');
      const result = await buildTarget(source, target, { outDir, appName: path.basename(input, '.cannon') });
      console.log(`${input} -> ${result.root} (${target}, ${result.manifest.digest})`);
      process.exit(0);
    }
    const { code } = compile(source);
    const outputFlag = args.indexOf('-o');
    const output = outputFlag >= 0 ? args[outputFlag + 1] : input.replace(/\.cannon$/i, '.mjs');
    if (!output) { console.error('cannon: -o requires an output filename'); process.exit(1); }
    fs.writeFileSync(output, code, 'utf8'); console.log(`${input} -> ${output}`); process.exit(0);
  }

  const { code } = compile(source);
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(`cannon: ${error.message}`);
  process.exit(1);
}
