import { createHmac, timingSafeEqual } from 'node:crypto';

const b64 = (v) => Buffer.from(v).toString('base64url');
const unb64 = (v) => Buffer.from(v, 'base64url').toString('utf8');

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export class AdminAuth {
  constructor(password, secret, ttlSeconds = 43200) {
    this.password = password || '';
    this.secret = secret || '';
    this.ttlSeconds = ttlSeconds;
  }
  verifyPassword(value) { return Boolean(this.password) && safeEqual(value ?? '', this.password); }
  sign(payload) { return createHmac('sha256', this.secret).update(payload).digest('base64url'); }
  createSession() {
    const payload = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + this.ttlSeconds });
    const encoded = b64(payload);
    return `${encoded}.${this.sign(encoded)}`;
  }
  verifySession(token) {
    try {
      const [encoded, sig] = String(token || '').split('.');
      if (!encoded || !sig || !safeEqual(sig, this.sign(encoded))) return false;
      const data = JSON.parse(unb64(encoded));
      return Number(data.exp) > Math.floor(Date.now() / 1000);
    } catch { return false; }
  }
}

export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return i < 0 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
  }));
}
