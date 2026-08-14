import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parse } from './parser.js';
import { compile } from './compiler.js';

export function format(source) {
  return printProgram(parse(source)) + '\n';
}

export function check(source, options = {}) {
  try {
    const ast = parse(source);
    return { ok: true, ast, diagnostics: [] };
  } catch (error) {
    return { ok: false, ast: null, diagnostics: [{ severity: 'error', message: error.message, line: error.line ?? null, column: error.column ?? null, file: options.file ?? null }] };
  }
}

export async function run(source, { globals = {}, filename = '<memory>' } = {}) {
  const { code, ast } = compile(source);
  const names = Object.keys(globals);
  const values = Object.values(globals);
  const wrapped = `${code}\n//# sourceURL=${filename.replace(/\s/g, '_')}`;
  const fn = new Function(...names, wrapped);
  return { value: await fn(...values), ast, code };
}

export async function addDependency(projectDir, spec, { registry = defaultRegistry } = {}) {
  const root = path.resolve(projectDir);
  const manifestPath = path.join(root, 'cannon.json');
  const manifest = await readJson(manifestPath, { name: path.basename(root), version: '0.1.0', dependencies: {} });
  const parsed = parsePackageSpec(spec);
  const resolved = await registry.resolve(parsed.name, parsed.range);
  manifest.dependencies ??= {};
  manifest.dependencies[parsed.name] = resolved.version;
  const lockPath = path.join(root, 'cannon.lock');
  const lock = await readJson(lockPath, { version: 1, packages: {} });
  lock.packages[parsed.name] = { version: resolved.version, source: resolved.source, integrity: resolved.integrity ?? sha256(JSON.stringify(resolved)) };
  await fs.writeFile(manifestPath, JSON.stringify(sortObject(manifest), null, 2) + '\n', 'utf8');
  await fs.writeFile(lockPath, JSON.stringify(sortObject(lock), null, 2) + '\n', 'utf8');
  return { manifest, lock, resolved };
}

export async function install(projectDir, { registry = defaultRegistry } = {}) {
  const root = path.resolve(projectDir);
  const manifest = await readJson(path.join(root, 'cannon.json'));
  const lock = { version: 1, packages: {} };
  const packageDir = path.join(root, '.cannon', 'packages');
  await fs.mkdir(packageDir, { recursive: true });
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    const resolved = await registry.resolve(name, range);
    const target = path.join(packageDir, safePackagePath(name), resolved.version);
    await fs.mkdir(target, { recursive: true });
    const metadata = { name, version: resolved.version, source: resolved.source, integrity: resolved.integrity ?? sha256(JSON.stringify(resolved)) };
    await fs.writeFile(path.join(target, 'package.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8');
    lock.packages[name] = metadata;
  }
  await fs.writeFile(path.join(root, 'cannon.lock'), JSON.stringify(sortObject(lock), null, 2) + '\n', 'utf8');
  return lock;
}

export async function discoverTests(root = process.cwd()) {
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.cannon') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(test|spec)\.cannon$/i.test(entry.name)) files.push(full);
    }
  }
  await walk(path.resolve(root));
  return files.sort();
}

export async function runTests(root = process.cwd()) {
  const files = await discoverTests(root);
  const results = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    const start = performance.now();
    try {
      await run(source, { filename: file, globals: testGlobals(file) });
      results.push({ file, ok: true, durationMs: performance.now() - start });
    } catch (error) {
      results.push({ file, ok: false, durationMs: performance.now() - start, error: { name: error.name, message: error.message, stack: error.stack } });
    }
  }
  return { ok: results.every((result) => result.ok), count: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

export async function createProject(target, { name = path.basename(path.resolve(target)), force = false } = {}) {
  const root = path.resolve(target);
  await fs.mkdir(root, { recursive: true });
  const files = {
    'cannon.json': JSON.stringify({ name, version: '0.1.0', entry: 'src/main.cannon', dependencies: {} }, null, 2) + '\n',
    'src/main.cannon': `print("Hello from ${name}")\n`,
    'test/main.test.cannon': `assert(true, "example test")\n`
  };
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    try { if (!force) await fs.access(full).then(() => { throw new Error(`file already exists: ${full}`); }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.writeFile(full, content, 'utf8');
  }
  return { root, files: Object.keys(files) };
}

export function moduleResolver({ projectRoot = process.cwd(), extensions = ['.cannon'] } = {}) {
  const root = path.resolve(projectRoot);
  return {
    async resolve(specifier, fromFile) {
      if (specifier.startsWith('.')) {
        const base = path.resolve(path.dirname(fromFile), specifier);
        for (const candidate of [base, ...extensions.map((ext) => base + ext), ...extensions.map((ext) => path.join(base, `index${ext}`))]) {
          try { await fs.access(candidate); return candidate; } catch {}
        }
        throw new Error(`Cannot resolve module '${specifier}' from ${fromFile}`);
      }
      const lock = await readJson(path.join(root, 'cannon.lock'), { packages: {} });
      const pkg = lock.packages?.[specifier];
      if (!pkg) throw new Error(`Dependency '${specifier}' is not locked`);
      return path.join(root, '.cannon', 'packages', safePackagePath(specifier), pkg.version);
    }
  };
}

const defaultRegistry = {
  async resolve(name, range = 'latest') { return { name, version: range === 'latest' ? '0.0.0' : range.replace(/^[~^]/, ''), source: `registry:${name}` }; }
};

function printProgram(ast) { return ast.body.map((node) => printStatement(node, 0)).join('\n'); }
function printStatement(node, level) {
  const pad = '  '.repeat(level);
  switch (node.type) {
    case 'VariableDeclaration': return `${pad}${node.kind} ${node.name} = ${printExpression(node.value)}`;
    case 'AssignmentStatement': return `${pad}${node.name} = ${printExpression(node.value)}`;
    case 'ExpressionStatement': return `${pad}${printExpression(node.expression)}`;
    case 'ReturnStatement': return `${pad}return${node.value ? ` ${printExpression(node.value)}` : ''}`;
    case 'FunctionDeclaration': return `${pad}fn ${node.name}(${node.params.join(', ')}) ${printBlock(node.body, level)}`;
    case 'IfStatement': return `${pad}if ${printExpression(node.test)} ${printBlock(node.consequent, level)}${node.alternate ? ` else ${node.alternate.type === 'IfStatement' ? printStatement(node.alternate, level).trimStart() : printBlock(node.alternate, level)}` : ''}`;
    case 'WhileStatement': return `${pad}while ${printExpression(node.test)} ${printBlock(node.body, level)}`;
    case 'BlockStatement': return `${pad}${printBlock(node, level)}`;
    default: throw new Error(`Unsupported Cannon statement for formatting: ${node.type}`);
  }
}
function printBlock(node, level) { return `{\n${node.body.map((statement) => printStatement(statement, level + 1)).join('\n')}\n${'  '.repeat(level)}}`; }
function printExpression(node) {
  switch (node.type) {
    case 'Literal': return JSON.stringify(node.value);
    case 'Identifier': return node.name;
    case 'UnaryExpression': return `${node.operator}${printExpression(node.argument)}`;
    case 'BinaryExpression': return `${printExpression(node.left)} ${node.operator} ${printExpression(node.right)}`;
    case 'CallExpression': return `${printExpression(node.callee)}(${node.arguments.map(printExpression).join(', ')})`;
    default: throw new Error(`Unsupported Cannon expression for formatting: ${node.type}`);
  }
}
function testGlobals(file) { return { assert(condition, message = 'assertion failed') { if (!condition) throw new Error(`${file}: ${message}`); }, equal(actual, expected, message = 'values are not equal') { if (!Object.is(actual, expected)) throw new Error(`${file}: ${message}: ${actual} !== ${expected}`); } }; }
function parsePackageSpec(spec) { const index = spec.lastIndexOf('@'); if (index > 0) return { name: spec.slice(0, index), range: spec.slice(index + 1) || 'latest' }; return { name: spec, range: 'latest' }; }
async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw error; } }
function safePackagePath(name) { return name.replace(/^@/, '').replace(/\//g, '__'); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sortObject(value) { if (Array.isArray(value)) return value.map(sortObject); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])])); return value; }
