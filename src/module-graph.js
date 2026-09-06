import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { compile, emitJavaScript } from './compiler.js';

export class CannonModuleGraphError extends Error {
  constructor(message, { code = 'CANNON_MODULE_GRAPH', file = null, specifier = null } = {}) {
    super(message);
    this.name = 'CannonModuleGraphError';
    this.code = code;
    this.file = file;
    this.specifier = specifier;
  }
}

export async function compileModuleGraph({ entry, root = process.cwd() } = {}) {
  if (!entry) throw new TypeError('compileModuleGraph requires entry');
  const rootReal = await fs.realpath(path.resolve(root));
  const entryReal = await resolveEntry(rootReal, entry);
  assertInsideRoot(rootReal, entryReal, 'entry');

  const modules = new Map();
  const visiting = new Set();
  const externals = new Set();

  const visit = async (absoluteFile) => {
    const realFile = await fs.realpath(absoluteFile);
    assertInsideRoot(rootReal, realFile, realFile);
    const id = toModuleId(rootReal, realFile);
    if (modules.has(id)) return modules.get(id);
    if (visiting.has(id)) return null;
    visiting.add(id);

    try {
      const source = await fs.readFile(realFile, 'utf8');
      const compiled = compile(source);
      const ast = structuredClone(compiled.ast);
      const dependencyRecords = [];

      for (const node of ast.body) {
        if (node.type !== 'ImportDeclaration' && !(node.type === 'ExportNamedDeclaration' && node.source)) continue;
        const specifier = node.source;
        if (typeof specifier !== 'string') continue;
        if (isBareSpecifier(specifier)) {
          externals.add(specifier);
          dependencyRecords.push({ specifier, kind: 'external', target: specifier });
          continue;
        }
        if (path.isAbsolute(specifier) || specifier.startsWith('file:')) {
          throw new CannonModuleGraphError(`absolute module specifier is not allowed: ${specifier}`, { code: 'CANNON_MODULE_ABSOLUTE_SPECIFIER', file: id, specifier });
        }
        const dependencyFile = await resolveLocalModule(realFile, specifier, rootReal);
        const dependencyId = toModuleId(rootReal, dependencyFile);
        const dependencyOutput = outputId(dependencyId);
        const currentOutput = outputId(id);
        let rewritten = path.posix.relative(path.posix.dirname(currentOutput), dependencyOutput);
        if (!rewritten.startsWith('.')) rewritten = `./${rewritten}`;
        node.source = rewritten;
        dependencyRecords.push({ specifier, kind: 'local', target: dependencyId, output: rewritten });
        await visit(dependencyFile);
      }

      const sourceDigest = sha256(source);
      const code = emitJavaScript(ast);
      const record = Object.freeze({
        id,
        file: realFile,
        output: outputId(id),
        sourceDigest,
        dependencies: dependencyRecords.map((entry) => Object.freeze({ ...entry })),
        code
      });
      modules.set(id, record);
      return record;
    } finally {
      visiting.delete(id);
    }
  };

  await visit(entryReal);
  const ordered = [...modules.values()].sort((a, b) => a.id.localeCompare(b.id));
  const manifest = {
    protocol: 'cannon-module-graph/1',
    root: rootReal,
    entry: toModuleId(rootReal, entryReal),
    modules: ordered.map((module) => ({
      id: module.id,
      output: module.output,
      sourceDigest: module.sourceDigest,
      dependencies: module.dependencies.map(({ specifier, kind, target }) => ({ specifier, kind, target }))
    })),
    externals: [...externals].sort()
  };
  const graphDigest = sha256(stableStringify(manifest));
  return Object.freeze({
    ...manifest,
    graphDigest,
    modules: ordered,
    externals: [...externals].sort()
  });
}

export async function writeModuleGraph(graph, outDir, { clean = false } = {}) {
  if (graph?.protocol !== 'cannon-module-graph/1' || !Array.isArray(graph.modules)) throw new TypeError('valid Cannon module graph required');
  let targetRoot = path.resolve(outDir);
  if (clean) await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });
  targetRoot = await fs.realpath(targetRoot);

  for (const module of graph.modules) {
    const target = path.resolve(targetRoot, module.output);
    if (target !== targetRoot && !target.startsWith(targetRoot + path.sep)) throw new CannonModuleGraphError(`output escapes target directory: ${module.output}`, { code: 'CANNON_MODULE_OUTPUT_ESCAPE', file: module.id });
    await ensureSafeParentDirectory(targetRoot, path.dirname(target));
    await atomicWrite(target, module.code);
  }
  const manifestPath = path.join(targetRoot, 'cannon-module-graph.json');
  await atomicWrite(manifestPath, JSON.stringify({
    protocol: graph.protocol,
    entry: graph.entry,
    graphDigest: graph.graphDigest,
    modules: graph.modules.map(({ id, output, sourceDigest, dependencies }) => ({ id, output, sourceDigest, dependencies })),
    externals: graph.externals
  }, null, 2) + '\n');
  return { root: targetRoot, manifest: manifestPath, entry: path.join(targetRoot, outputId(graph.entry)) };
}

async function resolveEntry(rootReal, entry) {
  const lexical = path.resolve(rootReal, entry);
  const candidates = candidatePaths(lexical);
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return await fs.realpath(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  throw new CannonModuleGraphError(`entry module not found: ${entry}`, { code: 'CANNON_MODULE_NOT_FOUND', specifier: entry });
}

async function resolveLocalModule(importer, specifier, rootReal) {
  const lexical = path.resolve(path.dirname(importer), specifier);
  assertInsideRoot(rootReal, lexical, specifier);
  for (const candidate of candidatePaths(lexical)) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) continue;
      const real = await fs.realpath(candidate);
      assertInsideRoot(rootReal, real, specifier);
      return real;
    } catch (error) {
      if (error instanceof CannonModuleGraphError) throw error;
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  throw new CannonModuleGraphError(`module '${specifier}' imported by '${toModuleId(rootReal, importer)}' was not found`, { code: 'CANNON_MODULE_NOT_FOUND', file: toModuleId(rootReal, importer), specifier });
}

function candidatePaths(lexical) {
  const extension = path.extname(lexical);
  if (extension) return [lexical];
  return [lexical, `${lexical}.cannon`, path.join(lexical, 'index.cannon')];
}

function assertInsideRoot(rootReal, candidate, label) {
  const resolved = path.resolve(candidate);
  if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) {
    throw new CannonModuleGraphError(`module path escapes project root: ${label}`, { code: 'CANNON_MODULE_ROOT_ESCAPE', specifier: String(label) });
  }
}

function isBareSpecifier(specifier) {
  return !specifier.startsWith('./') && !specifier.startsWith('../');
}

function toModuleId(rootReal, file) {
  return path.relative(rootReal, file).split(path.sep).join('/');
}

function outputId(id) {
  return id.endsWith('.cannon') ? `${id.slice(0, -'.cannon'.length)}.js` : `${id}.js`;
}

async function ensureSafeParentDirectory(root, directory) {
  const relative = path.relative(root, directory);
  if (!relative) return;
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new CannonModuleGraphError(`output directory escapes target root: ${directory}`, { code: 'CANNON_MODULE_OUTPUT_ESCAPE' });
  let current = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new CannonModuleGraphError(`output path contains symlink: ${current}`, { code: 'CANNON_MODULE_OUTPUT_SYMLINK' });
      if (!stat.isDirectory()) throw new CannonModuleGraphError(`output parent is not a directory: ${current}`, { code: 'CANNON_MODULE_OUTPUT_PARENT' });
    } catch (error) {
      if (error instanceof CannonModuleGraphError) throw error;
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(current, { mode: 0o755 });
    }
  }
}

async function atomicWrite(file, content) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle = null;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch {}
    }
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
