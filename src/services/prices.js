export class PriceService {
  constructor({
    provider = 'auto',
    baseUrl = 'https://api.coingecko.com/api/v3',
    apiKey = '',
    nowNodesBaseUrl = 'https://market-data.nownodes.io/api/v1',
    nowNodesApiKey = '',
  } = {}) {
    this.provider = String(provider || 'auto').toLowerCase();
    this.baseUrl = String(baseUrl || 'https://api.coingecko.com/api/v3').replace(/\/$/, '');
    this.apiKey = apiKey;
    this.nowNodesBaseUrl = String(nowNodesBaseUrl || 'https://market-data.nownodes.io/api/v1').replace(/\/$/, '');
    this.nowNodesApiKey = nowNodesApiKey;
    this.cache = new Map();
  }

  async priceFromNowNodes(chain, currency) {
    if (!this.nowNodesApiKey) throw new Error('NOWNodes Market Data API key is not configured');
    const from = String(chain.marketSymbol || chain.symbol || '').trim().toLowerCase();
    if (!from) throw new Error(`${chain.id}: no market symbol configured`);
    const to = String(currency || 'usd').trim().toLowerCase();
    const url = new URL(`${this.nowNodesBaseUrl}/price`);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    const response = await fetch(url, {
      headers: { 'api-key': this.nowNodesApiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`NOWNodes Market Data HTTP ${response.status}`);
    const data = await response.json();
    if (data?.error) throw new Error(`NOWNodes Market Data: ${data.error}`);
    const rows = Array.isArray(data?.result) ? data.result : [];
    const row = rows.find((x) => String(x?.from_currency || '').toLowerCase() === from) || rows[0];
    const quote = Array.isArray(row?.quotes)
      ? row.quotes.find((x) => String(x?.to_currency || '').toLowerCase() === to) || row.quotes[0]
      : row?.quotes;
    const value = Number(quote?.rate);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`No ${to.toUpperCase()} NOWNodes price for ${chain.symbol}`);
    return value;
  }

  async priceFromCoinGecko(chain, currency) {
    if (!chain.priceId) throw new Error(`${chain.id}: no CoinGecko priceId configured`);
    const vs = String(currency || 'usd').toLowerCase();
    const url = `${this.baseUrl}/simple/price?ids=${encodeURIComponent(chain.priceId)}&vs_currencies=${encodeURIComponent(vs)}`;
    const headers = {};
    if (this.apiKey) headers['x-cg-demo-api-key'] = this.apiKey;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
    const data = await response.json();
    const value = Number(data?.[chain.priceId]?.[vs]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`No ${vs.toUpperCase()} CoinGecko price for ${chain.symbol}`);
    return value;
  }

  async price(chain, currency) {
    const vs = String(currency || 'usd').toLowerCase();
    const key = `${chain.id}:${vs}:${this.provider}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;

    const errors = [];
    let value;
    const tryNowNodes = this.provider === 'nownodes' || (this.provider === 'auto' && Boolean(this.nowNodesApiKey));
    const tryCoinGecko = this.provider === 'coingecko' || this.provider === 'auto';

    if (tryNowNodes) {
      try { value = await this.priceFromNowNodes(chain, vs); }
      catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (value === undefined && tryCoinGecko) {
      try { value = await this.priceFromCoinGecko(chain, vs); }
      catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (value === undefined) throw new Error(errors.join(' | ') || `No price provider available for ${chain.symbol}`);

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
