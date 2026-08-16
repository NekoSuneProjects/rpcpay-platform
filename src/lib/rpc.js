let rpcId = 1;

export class RpcPool {
  constructor(urls = [], { auth, headers = {}, timeoutMs = 15000 } = {}) {
    this.urls = [...new Set((urls || []).filter(Boolean))];
    this.auth = auth;
    this.headers = headers;
    this.timeoutMs = timeoutMs;
    this.cursor = 0;
    this.health = new Map();
  }

  setUrls(urls = []) {
    this.urls = [...new Set((urls || []).filter(Boolean))];
    if (this.cursor >= this.urls.length) this.cursor = 0;
  }

  orderedUrls() {
    if (!this.urls.length) return [];
    const now = Date.now();
    const rotated = [...this.urls.slice(this.cursor), ...this.urls.slice(0, this.cursor)];
    return rotated.sort((a, b) => {
      const ah = this.health.get(a) || {};
      const bh = this.health.get(b) || {};
      const ac = ah.cooldownUntil > now ? 1 : 0;
      const bc = bh.cooldownUntil > now ? 1 : 0;
      return ac - bc || (ah.failures || 0) - (bh.failures || 0);
    });
  }

  markSuccess(url) {
    this.health.set(url, { failures: 0, cooldownUntil: 0, lastSuccess: Date.now() });
    const i = this.urls.indexOf(url);
    if (i >= 0) this.cursor = (i + 1) % Math.max(1, this.urls.length);
  }

  markFailure(url) {
    const old = this.health.get(url) || { failures: 0 };
    const failures = Math.min(10, (old.failures || 0) + 1);
    const cooldownMs = Math.min(60000, 500 * 2 ** failures);
    this.health.set(url, { ...old, failures, cooldownUntil: Date.now() + cooldownMs, lastFailure: Date.now() });
  }

  async jsonRpc(method, params = [], { version = '2.0', auth = this.auth, headers = this.headers } = {}) {
    if (!this.urls.length) throw new Error(`No RPC endpoints configured for ${method}`);
    const errors = [];
    for (const url of this.orderedUrls()) {
      try {
        const out = await jsonRpc(url, method, params, auth, version, headers, this.timeoutMs);
        this.markSuccess(url);
        return out;
      } catch (error) {
        this.markFailure(url);
        errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`All RPC endpoints failed for ${method}: ${errors.join(' | ')}`);
  }

  async firstHealthy(testMethod, params = [], options = {}) {
    for (const url of this.orderedUrls()) {
      try {
        await jsonRpc(url, testMethod, params, options.auth ?? this.auth, options.version ?? '2.0', options.headers ?? this.headers, this.timeoutMs);
        this.markSuccess(url);
        return url;
      } catch {
        this.markFailure(url);
      }
    }
    throw new Error('No healthy RPC endpoint available');
  }
}

export async function jsonRpc(url, method, params = [], auth, version = '2.0', extraHeaders = {}, timeoutMs = 15000) {
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (auth?.user) headers.authorization = `Basic ${Buffer.from(`${auth.user}:${auth.password ?? ''}`).toString('base64')}`;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: version, id: rpcId++, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status} ${response.statusText}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC ${method} failed (${body.error.code ?? 'error'}): ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}
