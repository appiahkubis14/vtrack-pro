import * as crypto from 'crypto';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

const AES_ALGO = 'aes-256-gcm';

/** AES-256-GCM encrypt, for at-rest fields like driver medical notes or API secrets. */
export function encrypt(plainText: string, keyHex: string): { iv: string; tag: string; data: string } {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(AES_ALGO, key, iv);
  const data = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') };
}

export function decrypt(payload: { iv: string; tag: string; data: string }, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const decipher = crypto.createDecipheriv(AES_ALGO, key, Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
  const data = Buffer.concat([decipher.update(Buffer.from(payload.data, 'hex')), decipher.final()]);
  return data.toString('utf8');
}
