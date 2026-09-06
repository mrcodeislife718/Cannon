import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const FORMAT = 'cannon-recovery/1';

export class RecoveryCorruptionError extends Error {
  constructor(message, cause) { super(message, cause ? { cause } : undefined); this.name = 'RecoveryCorruptionError'; this.code = 'CANNON_RECOVERY_CORRUPT'; }
}

export class RecoveryStore {
  constructor(root, { maxGenerations = 8 } = {}) {
    if (!root) throw new TypeError('recovery root is required');
    if (!Number.isInteger(maxGenerations) || maxGenerations < 2) throw new TypeError('maxGenerations must be an integer >= 2');
    this.root = path.resolve(root); this.maxGenerations = maxGenerations;
  }
  async checkpoint(state, { label = null } = {}) {
    await fs.mkdir(this.root, { recursive: true });
    const body = { format: FORMAT, createdAt: new Date().toISOString(), label, payload: state };
    const envelope = { ...body, sha256: digest(body) };
    const name = `${Date.now()}-${crypto.randomUUID()}.checkpoint.json`;
    const target = path.join(this.root, name); const temp = `${target}.tmp-${crypto.randomUUID()}`;
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(envelope)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, target); await syncDir(this.root); await this.prune();
    return Object.freeze({ name, path: target, sha256: envelope.sha256, createdAt: envelope.createdAt, label });
  }
  async list() { try { return (await fs.readdir(this.root)).filter((n) => n.endsWith('.checkpoint.json')).sort().reverse(); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } }
  async restoreLatest() {
    const names = await this.list(); let lastError = null;
    for (const name of names) { try { const envelope = await this.verify(name); return { state: envelope.payload, metadata: { name, createdAt: envelope.createdAt, label: envelope.label, sha256: envelope.sha256 } }; } catch (e) { lastError = e; } }
    if (names.length) throw new RecoveryCorruptionError('no valid Cannon recovery checkpoint remains', lastError);
    return null;
  }
  async verify(name) {
    const safe = path.basename(name); if (safe !== name || !safe.endsWith('.checkpoint.json')) throw new TypeError('invalid checkpoint name');
    let envelope; try { envelope = JSON.parse(await fs.readFile(path.join(this.root, safe), 'utf8')); } catch (e) { throw new RecoveryCorruptionError(`cannot read checkpoint ${safe}`, e); }
    if (envelope?.format !== FORMAT || typeof envelope.sha256 !== 'string') throw new RecoveryCorruptionError(`invalid checkpoint envelope ${safe}`);
    const { sha256, ...body } = envelope; if (!safeEqual(sha256, digest(body))) throw new RecoveryCorruptionError(`checkpoint checksum mismatch ${safe}`);
    return envelope;
  }
  async prune() { const names = await this.list(); await Promise.all(names.slice(this.maxGenerations).map((n) => fs.rm(path.join(this.root, n), { force: true }))); }
}

function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function safeEqual(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }
async function syncDir(dir) { try { const h = await fs.open(dir, 'r'); try { await h.sync(); } finally { await h.close(); } } catch (e) { if (!['EINVAL','ENOTSUP','EISDIR'].includes(e.code)) throw e; } }
