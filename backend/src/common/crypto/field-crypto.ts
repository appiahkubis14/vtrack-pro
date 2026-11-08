import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * AES-256-GCM field encryption for personal data (Ghana Card numbers, MoMo numbers).
 * Key comes from FIELD_ENCRYPTION_KEY (64 hex chars). In production a missing key is a hard error;
 * in development a fixed, clearly-labelled dev key is derived so local setups keep working.
 * Stored format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
function loadKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (raw) {
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error('FIELD_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    return Buffer.from(raw, 'hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FIELD_ENCRYPTION_KEY is required in production');
  }
  return scryptSync('vtrack-dev-only-key-do-not-use-in-production', 'vtrack-dev-salt', 32);
}

export function encryptField(plain: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decryptField(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised encrypted field format');
  const decipher = createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/** Show only the last 4 characters, e.g. for lists and logs. */
export function maskField(plain: string): string {
  return plain.length <= 4 ? '****' : `${'*'.repeat(plain.length - 4)}${plain.slice(-4)}`;
}
