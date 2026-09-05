import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { format, check, createProject, HttpRegistryClient, addDependency, install, discoverTests, moduleResolver } from '../src/index.js';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

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

test('HTTP registry installs real verified package files and frozen mode preserves lock state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-deps-'));
  await fs.writeFile(path.join(root,'cannon.json'), JSON.stringify({name:'demo',version:'1',dependencies:{}}));

  const source = Buffer.from('export fn add(a, b) { return a + b }\n');
  const sourceDigest = sha256(source);
  const integrity = sha256(JSON.stringify({ 'src/index.cannon': sourceDigest }));
  let origin;
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/v1/packages/math/resolve')) {
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({ name:'math', version:'2.0.0', source:`${origin}/packages/math/2.0.0`, integrity, files:[{ path:'src/index.cannon', url:'/artifacts/math-2.0.0-index.cannon', sha256:sourceDigest }] }));
      return;
    }
    if (req.url === '/artifacts/math-2.0.0-index.cannon') { res.setHeader('content-type','application/octet-stream'); res.end(source); return; }
    res.statusCode = 404; res.end('not found');
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const registry = new HttpRegistryClient({ baseUrl:origin });
    const added = await addDependency(root, 'math@^2.0.0', { registry });
    assert.equal(added.manifest.dependencies.math, '^2.0.0');
    assert.equal(added.lock.packages.math.version, '2.0.0');
    const lock = await install(root, { registry });
    assert.equal(lock.packages.math.version, '2.0.0');
    assert.equal(lock.packages.math.integrity, integrity);
    assert.equal(await fs.readFile(path.join(root,'.cannon','packages','math','2.0.0','src','index.cannon'),'utf8'), source.toString('utf8'));
    const before = await fs.readFile(path.join(root,'cannon.lock'),'utf8');
    await install(root, { registry, frozen:true });
    assert.equal(await fs.readFile(path.join(root,'cannon.lock'),'utf8'), before);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('registry rejects package path traversal and integrity mismatches', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-registry-security-'));
  const client = new HttpRegistryClient({ baseUrl:'https://registry.example.test/', fetchImpl: async (url) => {
    if (String(url).includes('/resolve')) return new Response(JSON.stringify({ name:'bad', version:'1.0.0', source:'registry:bad', integrity:'0'.repeat(64), files:[{ path:'../escape', url:'/artifact', sha256:'0'.repeat(64) }] }), { status:200, headers:{'content-type':'application/json'} });
    return new Response(Buffer.from('x'), { status:200 });
  }});
  const descriptor = await client.resolve('bad','1.0.0');
  await assert.rejects(client.fetchPackage(descriptor, root), /invalid package file path/);
});

test('module resolver handles real relative modules, blocks symlink escape, and verifies locked dependency metadata', async (t) => {
  if (process.platform === 'win32') t.skip('symlink privilege varies on Windows runners');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-modules-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-outside-'));
  await fs.mkdir(path.join(root,'src'), {recursive:true});
  await fs.writeFile(path.join(root,'src','main.cannon'),'');
  await fs.writeFile(path.join(root,'src','util.cannon'),'');
  await fs.writeFile(path.join(outside,'escape.cannon'),'');
  await fs.symlink(path.join(outside,'escape.cannon'), path.join(root,'src','escape.cannon'));
  const integrity = 'a'.repeat(64);
  const packageRoot = path.join(root,'.cannon','packages','math','1.0.0');
  await fs.mkdir(packageRoot, {recursive:true});
  await fs.writeFile(path.join(packageRoot,'package.json'), JSON.stringify({name:'math',version:'1.0.0',integrity}));
  await fs.writeFile(path.join(root,'cannon.lock'), JSON.stringify({version:1,packages:{math:{version:'1.0.0',integrity}}}));
  const resolver = moduleResolver({projectRoot:root});
  assert.equal(await resolver.resolve('./util',path.join(root,'src','main.cannon')), await fs.realpath(path.join(root,'src','util.cannon')));
  await assert.rejects(resolver.resolve('./escape',path.join(root,'src','main.cannon')), /escapes Cannon project root/);
  assert.equal(await resolver.resolve('math',path.join(root,'src','main.cannon')), packageRoot);
});
