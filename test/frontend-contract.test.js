import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrontendArtifact, verifyFrontendArtifact, serializeFrontendArtifact, parseFrontendArtifact } from '../src/index.js';

test('frontend artifact preserves the full canonical Cannon AST', () => {
  const source = `fn classify(value) {
  if (value > 10) { return { kind: "large", values: [value, 10] } }
  while (value < 10) { value = value + 1 }
  return { kind: "small", values: [value] }
}
result = classify(2)
print(result.kind)`;
  const artifact = createFrontendArtifact(source, { file: 'main.cannon' });
  assert.equal(artifact.protocol, 'cannon-frontend/1');
  assert.equal(artifact.ast.type, 'Program');
  assert.ok(artifact.ast.body.some((node) => node.type === 'FunctionDeclaration'));
  assert.equal(verifyFrontendArtifact(artifact).ok, true);
});

test('frontend artifact serialization is deterministic and verifiable', () => {
  const artifact = createFrontendArtifact('value = 1\nprint(value)', { file: 'main.cannon' });
  const serialized = serializeFrontendArtifact(artifact);
  const recovered = parseFrontendArtifact(serialized);
  assert.deepEqual(recovered, JSON.parse(serialized));
  assert.equal(verifyFrontendArtifact(recovered).ok, true);
});

test('frontend artifact detects AST tampering', () => {
  const artifact = structuredClone(createFrontendArtifact('value = 1'));
  artifact.ast.body[0].value.value = 999;
  assert.equal(verifyFrontendArtifact(artifact).ok, false);
  assert.match(verifyFrontendArtifact(artifact).reason, /digest mismatch/);
});
