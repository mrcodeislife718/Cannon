import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { format, check, createProject, addDependency, install, discoverTests, moduleResolver } from '../src/index.js';

test('formatter is stable and checker returns diagnostics instead of crashing', () => {
  const source = 'let   x=1\nprint(x)\n';
  const formatted = format(source);
  assert.equal(format(formatted), formatted);
  assert.equal(check(formatted).ok, true);
  assert.equal(check('let =').ok, false);
});

test('project creation produces executable Cannon structure and test discovery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-project-'));
  await createProject(root, { name:'demo' });
  const manifest = JSON.parse(await fs.readFile(path.join(root,'cannon.json'),'utf8'));
  assert.equal(manifest.entry, 'src/main.cannon');
  const tests = await discoverTests(root);
  assert.equal(tests.length, 1);
});

test('dependency add/install creates deterministic manifest and lock state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-deps-'));
  await fs.writeFile(path.join(root,'cannon.json'), JSON.stringify({name:'demo',version:'1',dependencies:{}}));
  const registry = { resolve: async (name, range) => ({ name, version: range === 'latest' ? '1.0.0' : range.replace(/^\^/,'') , source:`test:${name}`, integrity:'abc' }) };
  const added = await addDependency(root, 'math@^2.0.0', { registry });
  assert.equal(added.manifest.dependencies.math, '2.0.0');
  const lock = await install(root, { registry });
  assert.equal(lock.packages.math.version, '2.0.0');
});

test('module resolver handles relative modules and locked dependencies', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-modules-'));
  await fs.mkdir(path.join(root,'src')); await fs.writeFile(path.join(root,'src','main.cannon'),''); await fs.writeFile(path.join(root,'src','util.cannon'),'');
  await fs.writeFile(path.join(root,'cannon.lock'), JSON.stringify({packages:{math:{version:'1.0.0'}}}));
  const resolver = moduleResolver({projectRoot:root});
  assert.equal(await resolver.resolve('./util',path.join(root,'src','main.cannon')), path.join(root,'src','util.cannon'));
  assert.match(await resolver.resolve('math',path.join(root,'src','main.cannon')), /math[\\/]1\.0\.0$/);
});
