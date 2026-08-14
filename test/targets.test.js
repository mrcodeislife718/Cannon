import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildTarget, executeTarget, reproducibleTargetBuild, benchmarkCompiler } from '../src/index.js';

const source = `
fn add(a, b) {
  return a + b
}
value = add(20, 22)
print(value)
`;

for (const target of ['web', 'backend', 'native']) {
  test(`Cannon ${target} target builds and executes a real program`, async (t) => {
    if (target === 'native' && process.platform === 'win32') t.skip('native proof currently expects a POSIX C compiler');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `cannon-${target}-`));
    const build = await buildTarget(source, target, { outDir: path.join(root, 'dist'), appName: 'proof' });
    assert.equal(build.manifest.protocol, 'cannon-target/1');
    assert.equal(build.manifest.target, target);
    assert.ok(build.manifest.files.length >= 1);
    const result = await executeTarget(build);
    assert.equal(result.ok, true, result.stderr ?? result.compile?.stderr);
    assert.equal(result.stdout.trim(), '42');
  });
}

test('Cannon target manifests are reproducible across clean output roots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-repro-'));
  for (const target of ['web', 'backend', 'native']) {
    const proof = await reproducibleTargetBuild(source, target, { root, appName: 'proof' });
    assert.equal(proof.reproducible, true, `${target} manifest changed across identical builds`);
  }
});

test('Cannon benchmark harness produces reproducible measurement fields without making claims', async () => {
  const result = await benchmarkCompiler('x = 1 + 2\nprint(x)', { iterations: 20, warmup: 2 });
  assert.equal(result.iterations, 20);
  assert.ok(result.meanMs >= 0);
  assert.ok(result.p95Ms >= result.minMs);
  assert.ok(result.sourceBytes > 0);
});
