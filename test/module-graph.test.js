import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModuleGraph, writeModuleGraph, CannonModuleGraphError } from '../src/index.js';

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-modules-'));
  const root = path.join(base, 'project');
  await fs.mkdir(path.join(root, 'lib'), { recursive: true });
  await fs.writeFile(path.join(root, 'main.cannon'), 'import { message } from "./lib/message"\nimport value from "./value.cannon"\nexport let result = message + value\n');
  await fs.writeFile(path.join(root, 'lib', 'message.cannon'), 'export let message = "answer:"\n');
  await fs.writeFile(path.join(root, 'value.cannon'), 'export default 42\n');
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, root };
}

test('Cannon compiles and executes a real multi-file module graph', async (t) => {
  const { base, root } = await fixture(t);
  const graph = await compileModuleGraph({ root, entry: 'main.cannon' });
  assert.equal(graph.protocol, 'cannon-module-graph/1');
  assert.equal(graph.entry, 'main.cannon');
  assert.deepEqual(graph.modules.map((module) => module.id), ['lib/message.cannon','main.cannon','value.cannon']);
  assert.match(graph.modules.find((module) => module.id === 'main.cannon').code, /from "\.\/lib\/message\.js"/);
  assert.match(graph.modules.find((module) => module.id === 'main.cannon').code, /from "\.\/value\.js"/);
  const out = path.join(base, 'out');
  const written = await writeModuleGraph(graph, out, { clean: true });
  const loaded = await import(`${pathToFileURL(written.entry).href}?digest=${graph.graphDigest}`);
  assert.equal(loaded.result, 'answer:42');
  const manifest = JSON.parse(await fs.readFile(written.manifest, 'utf8'));
  assert.equal(manifest.graphDigest, graph.graphDigest);
});

test('Cannon module graph digest is deterministic for unchanged source', async (t) => {
  const { root } = await fixture(t);
  const first = await compileModuleGraph({ root, entry: 'main.cannon' });
  const second = await compileModuleGraph({ root, entry: 'main.cannon' });
  assert.equal(first.graphDigest, second.graphDigest);
});

test('Cannon rejects local module paths that escape the project root', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-module-escape-'));
  const root = path.join(base, 'project');
  await fs.mkdir(root);
  await fs.writeFile(path.join(base, 'secret.cannon'), 'export default 1\n');
  await fs.writeFile(path.join(root, 'main.cannon'), 'import value from "../secret.cannon"\nprint(value)\n');
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await assert.rejects(() => compileModuleGraph({ root, entry: 'main.cannon' }), (error) => error instanceof CannonModuleGraphError && error.code === 'CANNON_MODULE_ROOT_ESCAPE');
});

test('Cannon rejects symlink module escapes after realpath resolution', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-module-symlink-'));
  const root = path.join(base, 'project');
  await fs.mkdir(root);
  await fs.writeFile(path.join(base, 'outside.cannon'), 'export default 1\n');
  await fs.symlink(path.join(base, 'outside.cannon'), path.join(root, 'linked.cannon'));
  await fs.writeFile(path.join(root, 'main.cannon'), 'import value from "./linked.cannon"\nprint(value)\n');
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await assert.rejects(() => compileModuleGraph({ root, entry: 'main.cannon' }), (error) => error instanceof CannonModuleGraphError && error.code === 'CANNON_MODULE_ROOT_ESCAPE');
});

test('Cannon rejects symlinked output parents instead of writing outside outDir', async (t) => {
  const { base, root } = await fixture(t);
  const graph = await compileModuleGraph({ root, entry: 'main.cannon' });
  const out = path.join(base, 'out');
  const outside = path.join(base, 'outside');
  await fs.mkdir(out);
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(out, 'lib'));

  await assert.rejects(() => writeModuleGraph(graph, out), (error) => error instanceof CannonModuleGraphError && error.code === 'CANNON_MODULE_OUTPUT_SYMLINK');
  await assert.rejects(() => fs.stat(path.join(outside, 'message.js')), /ENOENT/);
});

test('Cannon module graph compilation tolerates valid cyclic ESM dependencies', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-module-cycle-'));
  const root = path.join(base, 'project');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'a.cannon'), 'import { b } from "./b"\nexport let a = 1\nexport let fromB = b\n');
  await fs.writeFile(path.join(root, 'b.cannon'), 'import { a } from "./a"\nexport let b = 2\n');
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  const graph = await compileModuleGraph({ root, entry: 'a.cannon' });
  assert.deepEqual(graph.modules.map((module) => module.id), ['a.cannon', 'b.cannon']);
});
