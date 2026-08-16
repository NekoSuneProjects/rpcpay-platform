export class PriceService {
  constructor({ baseUrl = 'https://api.coingecko.com/api/v3', apiKey = '' } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.cache = new Map();
  }

  async price(chain, currency) {
    if (!chain.priceId) throw new Error(`${chain.id}: no priceId configured`);
    const vs = String(currency || 'usd').toLowerCase();
    const key = `${chain.priceId}:${vs}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const url = `${this.baseUrl}/simple/price?ids=${encodeURIComponent(chain.priceId)}&vs_currencies=${encodeURIComponent(vs)}`;
    const headers = {};
    if (this.apiKey) headers['x-cg-demo-api-key'] = this.apiKey;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Price provider HTTP ${response.status}`);
    const data = await response.json();
    const value = Number(data?.[chain.priceId]?.[vs]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`No ${vs.toUpperCase()} price for ${chain.symbol}`);
    this.cache.set(key, { value, expires: Date.now() + 30000 });
    return value;
  }

  async fiatToCrypto(chain, fiatAmount, currency) {
    const fiat = Number(fiatAmount);
    if (!Number.isFinite(fiat) || fiat <= 0) throw new Error('Invalid donation amount');
    const rate = await this.price(chain, currency);
    const places = Math.min(Number(chain.decimals ?? 8), 12);
    const scale = 10 ** places;
    const amount = Math.ceil((fiat / rate) * scale) / scale;
    return { amount: amount.toFixed(places).replace(/\.?0+$/, ''), rate: String(rate) };
  }
}
