import crypto from 'node:crypto';
import { parse } from './parser.js';
import { analyze } from './semantic.js';

export const CANNON_FRONTEND_PROTOCOL = 'cannon-frontend/1';

export function createFrontendArtifact(source, { file = '<memory>', frontendVersion = 'cannon/0.1' } = {}) {
  if (typeof source !== 'string') throw new TypeError('Cannon source must be a string');
  const ast = analyze(parse(source));
  const sourceDigest = crypto.createHash('sha256').update(source).digest('hex');
  const body = {
    protocol: CANNON_FRONTEND_PROTOCOL,
    frontendVersion,
    file,
    sourceDigest,
    ast: structuredClone(ast)
  };
  return Object.freeze({ ...body, artifactDigest: digestCanonical(body) });
}

export function verifyFrontendArtifact(artifact) {
  if (!artifact || artifact.protocol !== CANNON_FRONTEND_PROTOCOL) return { ok: false, reason: 'unsupported Cannon frontend protocol' };
  if (!artifact.frontendVersion || !artifact.file || !artifact.sourceDigest || !artifact.ast) return { ok: false, reason: 'incomplete Cannon frontend artifact' };
  if (artifact.ast.type !== 'Program' || !Array.isArray(artifact.ast.body)) return { ok: false, reason: 'invalid Cannon Program AST' };
  const { artifactDigest, ...body } = artifact;
  const expected = digestCanonical(body);
  return { ok: expected === artifactDigest, reason: expected === artifactDigest ? null : 'frontend artifact digest mismatch', expectedDigest: expected };
}

export function serializeFrontendArtifact(artifact) {
  const verification = verifyFrontendArtifact(artifact);
  if (!verification.ok) throw new Error(`cannot serialize invalid Cannon frontend artifact: ${verification.reason}`);
  return JSON.stringify(canonicalize(artifact));
}

export function parseFrontendArtifact(serialized) {
  const artifact = typeof serialized === 'string' ? JSON.parse(serialized) : structuredClone(serialized);
  const verification = verifyFrontendArtifact(artifact);
  if (!verification.ok) throw new Error(`invalid Cannon frontend artifact: ${verification.reason}`);
  return artifact;
}

function digestCanonical(value) { return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex'); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]));
  return value;
}
