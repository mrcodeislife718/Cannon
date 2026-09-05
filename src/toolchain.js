import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
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

export class HttpRegistryClient {
  constructor({ baseUrl, token = null, fetchImpl = globalThis.fetch, allowExternalArtifacts = false, timeoutMs = 30_000 } = {}) {
    if (!baseUrl) throw new Error('Cannon registry baseUrl is required');
    if (typeof fetchImpl !== 'function') throw new Error('Cannon registry requires a fetch implementation');
    this.baseUrl = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.allowExternalArtifacts = Boolean(allowExternalArtifacts);
    this.timeoutMs = positiveInteger(timeoutMs, 'timeoutMs');
  }

  async resolve(name, range = 'latest') {
    validatePackageName(name);
    const url = new URL(`v1/packages/${encodeURIComponent(name)}/resolve`, this.baseUrl);
    url.searchParams.set('range', range);
    const descriptor = await this.#json(url);
    validateResolvedDescriptor(descriptor, name);
    return descriptor;
  }

  async fetchPackage(descriptor, targetDir) {
    validateResolvedDescriptor(descriptor, descriptor.name);
    if (!Array.isArray(descriptor.files) || descriptor.files.length === 0) throw new Error(`registry package ${descriptor.name}@${descriptor.version} has no files`);
    const normalized = descriptor.files.map((file) => normalizePackageFile(file, this.baseUrl, this.allowExternalArtifacts));
    const seen = new Set();
    const fileDigests = {};
    for (const file of normalized) {
      if (seen.has(file.path)) throw new Error(`duplicate package file: ${file.path}`);
      seen.add(file.path);
      const bytes = await this.#bytes(file.url);
      const digest = sha256(bytes);
      if (digest !== file.sha256) throw new Error(`package file integrity mismatch: ${file.path}`);
      const destination = safeJoin(targetDir, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes, { mode: 0o644 });
      fileDigests[file.path] = digest;
    }
    const packageIntegrity = packageIntegrityFor(fileDigests);
    if (descriptor.integrity && descriptor.integrity !== packageIntegrity) throw new Error(`package integrity mismatch for ${descriptor.name}@${descriptor.version}`);
    return { files: Object.keys(fileDigests).sort(), fileDigests: sortObject(fileDigests), integrity: packageIntegrity };
  }

  async #json(url) {
    const response = await this.#request(url);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) throw new Error(`Cannon registry returned non-JSON response for ${url.pathname}`);
    return response.json();
  }

  async #bytes(url) {
    const response = await this.#request(url);
    return Buffer.from(await response.arrayBuffer());
  }

  async #request(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Cannon registry request timed out')), this.timeoutMs);
    timer.unref?.();
    try {
      const headers = { accept: 'application/json, application/octet-stream;q=0.9' };
      if (this.token) headers.authorization = `Bearer ${this.token}`;
      const response = await this.fetchImpl(url, { headers, signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error(`Cannon registry request failed (${response.status}) for ${url.pathname}`);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function registryFromEnvironment(env = process.env) {
  const baseUrl = env.CANNON_REGISTRY_URL;
  if (!baseUrl) return null;
  return new HttpRegistryClient({ baseUrl, token: env.CANNON_REGISTRY_TOKEN ?? null });
}

export async function addDependency(projectDir, spec, { registry = registryFromEnvironment() } = {}) {
  if (!registry) throw new Error('No Cannon registry configured. Set CANNON_REGISTRY_URL or pass an explicit registry client.');
  const root = path.resolve(projectDir);
  const manifestPath = path.join(root, 'cannon.json');
  const manifest = await readJson(manifestPath, { name: path.basename(root), version: '0.1.0', dependencies: {} });
  const parsed = parsePackageSpec(spec);
  const resolved = await registry.resolve(parsed.name, parsed.range);
  validateResolvedDescriptor(resolved, parsed.name);
  manifest.dependencies ??= {};
  manifest.dependencies[parsed.name] = parsed.range === 'latest' ? resolved.version : parsed.range;
  const lockPath = path.join(root, 'cannon.lock');
  const lock = await readJson(lockPath, { version: 1, packages: {} });
  lock.version = 1;
  lock.packages ??= {};
  lock.packages[parsed.name] = lockEntry(resolved);
  await atomicWriteJson(manifestPath, sortObject(manifest));
  await atomicWriteJson(lockPath, sortObject(lock));
  return { manifest, lock, resolved };
}

export async function install(projectDir, { registry = registryFromEnvironment(), frozen = false } = {}) {
  if (!registry) throw new Error('No Cannon registry configured. Set CANNON_REGISTRY_URL or pass an explicit registry client.');
  if (typeof registry.fetchPackage !== 'function') throw new Error('Cannon registry client must implement fetchPackage(descriptor, targetDir)');
  const root = path.resolve(projectDir);
  const manifest = await readJson(path.join(root, 'cannon.json'));
  const lockPath = path.join(root, 'cannon.lock');
  const existingLock = await readJson(lockPath, { version: 1, packages: {} });
  const lock = { version: 1, packages: {} };
  const packageDir = path.join(root, '.cannon', 'packages');
  await fs.mkdir(packageDir, { recursive: true });

  for (const [name, range] of Object.entries(manifest.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    validatePackageName(name);
    let resolved;
    const locked = existingLock.packages?.[name];
    if (locked) {
      resolved = await registry.resolve(name, locked.version);
      if (resolved.version !== locked.version) throw new Error(`registry did not resolve locked version ${name}@${locked.version}`);
      if (locked.integrity && resolved.integrity && locked.integrity !== resolved.integrity) throw new Error(`registry integrity changed for locked dependency ${name}@${locked.version}`);
    } else {
      if (frozen) throw new Error(`frozen install requires lock entry for ${name}`);
      resolved = await registry.resolve(name, range);
    }
    validateResolvedDescriptor(resolved, name);

    const versionRoot = path.join(packageDir, safePackagePath(name), safeSegment(resolved.version));
    const staging = `${versionRoot}.staging-${crypto.randomUUID()}`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    try {
      const fetched = await registry.fetchPackage(resolved, staging);
      if (!fetched?.integrity) throw new Error(`registry did not return package integrity for ${name}@${resolved.version}`);
      if (resolved.integrity && fetched.integrity !== resolved.integrity) throw new Error(`installed package integrity mismatch for ${name}@${resolved.version}`);
      const metadata = { name, version: resolved.version, source: resolved.source, integrity: fetched.integrity, files: fetched.files ?? [] };
      await atomicWriteJson(path.join(staging, 'package.json'), metadata);
      await fs.mkdir(path.dirname(versionRoot), { recursive: true });
      await fs.rm(versionRoot, { recursive: true, force: true });
      await fs.rename(staging, versionRoot);
      lock.packages[name] = metadata;
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  if (frozen && JSON.stringify(sortObject(existingLock)) !== JSON.stringify(sortObject(lock))) throw new Error('frozen install would change cannon.lock');
  await atomicWriteJson(lockPath, sortObject(lock));
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
          const resolved = await existingRealFile(candidate);
          if (resolved) {
            if (!isWithin(root, resolved)) throw new Error(`Module '${specifier}' escapes Cannon project root`);
            return resolved;
          }
        }
        throw new Error(`Cannot resolve module '${specifier}' from ${fromFile}`);
      }
      const lock = await readJson(path.join(root, 'cannon.lock'), { packages: {} });
      const pkg = lock.packages?.[specifier];
      if (!pkg) throw new Error(`Dependency '${specifier}' is not locked`);
      const packageRoot = path.join(root, '.cannon', 'packages', safePackagePath(specifier), safeSegment(pkg.version));
      const metadata = await readJson(path.join(packageRoot, 'package.json'));
      if (metadata.integrity !== pkg.integrity) throw new Error(`Installed dependency metadata does not match lockfile: ${specifier}`);
      return packageRoot;
    }
  };
}

function lockEntry(resolved) {
  return { version: resolved.version, source: resolved.source, integrity: resolved.integrity ?? null };
}
function validateResolvedDescriptor(descriptor, expectedName) {
  if (!descriptor || descriptor.name !== expectedName) throw new Error(`registry returned invalid package descriptor for ${expectedName}`);
  validatePackageName(descriptor.name);
  validateVersion(descriptor.version);
  if (!descriptor.source || typeof descriptor.source !== 'string') throw new Error(`registry package ${expectedName} is missing source`);
  if (descriptor.integrity != null && !/^[a-f0-9]{64}$/i.test(descriptor.integrity)) throw new Error(`registry package ${expectedName} has invalid integrity`);
}
function normalizePackageFile(file, registryBase, allowExternalArtifacts) {
  if (!file || typeof file.path !== 'string' || typeof file.url !== 'string' || !/^[a-f0-9]{64}$/i.test(file.sha256 ?? '')) throw new Error('registry returned invalid package file descriptor');
  validateRelativePackagePath(file.path);
  const url = new URL(file.url, registryBase);
  if (!allowExternalArtifacts && url.origin !== registryBase.origin) throw new Error(`external package artifact origin is not allowed: ${url.origin}`);
  return { path: file.path.replace(/\\/g, '/'), url, sha256: file.sha256.toLowerCase() };
}
function validateRelativePackagePath(value) {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => part === '..' || part === '' || part === '.')) throw new Error(`invalid package file path: ${value}`);
}
function safeJoin(root, relative) {
  validateRelativePackagePath(relative);
  const destination = path.resolve(root, relative);
  if (!isWithin(path.resolve(root), destination)) throw new Error(`package file escapes install root: ${relative}`);
  return destination;
}
function isWithin(root, target) { return target === root || target.startsWith(`${root}${path.sep}`); }
async function existingRealFile(candidate) {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) return null;
    return await fs.realpath(candidate);
  } catch { return null; }
}
function validatePackageName(name) { if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name ?? '')) throw new Error(`invalid Cannon package name: ${name}`); }
function validateVersion(version) { if (!/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(version ?? '')) throw new Error(`invalid Cannon package version: ${version}`); }
function safePackagePath(name) { validatePackageName(name); return name.replace(/^@/, '').replace(/\//g, '__'); }
function safeSegment(value) { validateVersion(value); return value; }
function packageIntegrityFor(fileDigests) { return sha256(JSON.stringify(sortObject(fileDigests))); }
function positiveInteger(value, name) { if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`); return value; }
function printProgram(ast) { return ast.body.map((node) => printStatement(node, 0)).join('\n'); }
function printStatement(node, level) {
  const pad = '  '.repeat(level);
  switch (node.type) {
    case 'VariableDeclaration': return `${pad}${node.kind} ${node.name} = ${printExpression(node.value)}`;
    case 'AssignmentStatement': return `${pad}${node.name} = ${printExpression(node.value)}`;
    case 'ExpressionStatement': return `${pad}${printExpression(node.expression)}`;
    case 'ReturnStatement': return `${pad}return${node.value ? ` ${printExpression(node.value)}` : ''}`;
    case 'FunctionDeclaration': return `${pad}${node.async ? 'async ' : ''}fn ${node.name}(${node.params.join(', ')}) ${printBlock(node.body, level)}`;
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
    case 'ArrayExpression': return `[${node.elements.map(printExpression).join(', ')}]`;
    case 'ObjectExpression': return `{ ${node.properties.map((property) => `${JSON.stringify(property.key)}: ${printExpression(property.value)}`).join(', ')} }`;
    case 'MemberExpression': return node.computed ? `${printExpression(node.object)}[${printExpression(node.property)}]` : `${printExpression(node.object)}.${node.property.name}`;
    case 'UnaryExpression': return `${node.operator}${printExpression(node.argument)}`;
    case 'AwaitExpression': return `await ${printExpression(node.argument)}`;
    case 'BinaryExpression': return `${printExpression(node.left)} ${node.operator} ${printExpression(node.right)}`;
    case 'CallExpression': return `${printExpression(node.callee)}(${node.arguments.map(printExpression).join(', ')})`;
    default: throw new Error(`Unsupported Cannon expression for formatting: ${node.type}`);
  }
}
function testGlobals(file) { return { assert(condition, message = 'assertion failed') { if (!condition) throw new Error(`${file}: ${message}`); }, equal(actual, expected, message = 'values are not equal') { if (!Object.is(actual, expected)) throw new Error(`${file}: ${message}: ${actual} !== ${expected}`); } }; }
function parsePackageSpec(spec) { const index = spec.lastIndexOf('@'); if (index > 0) return { name: spec.slice(0, index), range: spec.slice(index + 1) || 'latest' }; return { name: spec, range: 'latest' }; }
async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw error; } }
async function atomicWriteJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${crypto.randomUUID()}.tmp`; await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 }); await fs.rename(temp, file); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sortObject(value) { if (Array.isArray(value)) return value.map(sortObject); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])])); return value; }
