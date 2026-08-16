import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

function keyFromInput(input) {
  if (!input) throw new Error('WALLET_ENCRYPTION_KEY is required for generated deposit wallets');
  const value = String(input).trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  try {
    const b = Buffer.from(value, 'base64');
    if (b.length === 32) return b;
  } catch {}
  return createHash('sha256').update(value).digest();
}

export class SecretBox {
  constructor(keyInput) { this.key = keyFromInput(keyInput); }
  encrypt(plain) {
    if (plain === null || plain === undefined) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }
  decrypt(box) {
    if (!box) return null;
    const [version, iv, tag, payload] = String(box).split('.');
    if (version !== 'v1' || !iv || !tag || !payload) throw new Error('Invalid encrypted secret');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
  }
}
