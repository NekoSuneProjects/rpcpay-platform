import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Interface, Wallet, getAddress, formatUnits } from 'ethers';

const erc20 = new Interface(['function balanceOf(address owner) view returns (uint256)']);

function money(value) {
  return Number.isFinite(value) ? value.toFixed(2) : null;
}

export function loadHotWalletPortfolio(path = process.env.HOT_WALLET_CONFIG ?? './config/hot-wallet.json') {
  const file = resolve(path);
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!parsed || !Array.isArray(parsed.networks) || parsed.networks.length === 0) throw new Error('hot-wallet.json must contain networks');

  const seenNetworks = new Set();
  const seenAssets = new Set();
  for (const network of parsed.networks) {
    if (!network?.id) throw new Error('Hot wallet network missing id');
    if (seenNetworks.has(network.id)) throw new Error(`Duplicate hot wallet network: ${network.id}`);
    seenNetworks.add(network.id);
    if (!Array.isArray(network.tokens)) network.tokens = [];

    for (const token of network.tokens) {
      for (const key of ['id', 'name', 'symbol', 'contractAddress']) if (!token?.[key]) throw new Error(`${network.id}: hot wallet token missing ${key}`);
      if (seenAssets.has(token.id)) throw new Error(`Duplicate hot wallet asset: ${token.id}`);
      seenAssets.add(token.id);
      token.networkId = network.id;
      token.adapter = 'evm-token';
      token.contractAddress = getAddress(token.contractAddress);
      token.decimals = Number.isInteger(token.decimals) ? token.decimals : 18;
      if (token.decimals < 0 || token.decimals > 36) throw new Error(`${token.id}: invalid decimals`);
    }
  }
  return parsed;
}

export class EvmHotWalletService {
  constructor({ chains, adapters, priceService, address = '', privateKey = '', portfolio = null }) {
    this.chains = chains;
    this.adapters = adapters;
    this.priceService = priceService;
    this.portfolio = portfolio;
    this.address = null;
    this.mode = 'watch-only';
    this.configError = null;
    this.cache = new Map();

    try {
      const configuredAddress = address ? getAddress(String(address).trim()) : null;
      if (privateKey) {
        const derived = new Wallet(String(privateKey).trim()).address;
        if (configuredAddress && configuredAddress !== derived) throw new Error('EVM_HOT_WALLET_ADDRESS does not match EVM_HOT_WALLET_PRIVATE_KEY');
        this.address = derived;
        this.mode = 'signing';
      } else {
        this.address = configuredAddress;
      }
    } catch (error) {
      this.configError = error instanceof Error ? error.message : String(error);
    }
  }

  async assetPrice(asset, currency) {
    try { return await this.priceService.price(asset, currency); }
    catch { return null; }
  }

  trackedNetworks() {
    const nativeById = new Map(this.chains.filter((c) => c.adapter === 'evm-native').map((c) => [c.id, c]));
    const configuredTokens = new Map(this.chains.filter((c) => c.adapter === 'evm-token' && c.contractAddress).map((c) => [c.id, c]));

    if (!this.portfolio?.networks?.length) {
      return [...nativeById.values()].map((network) => ({
        network,
        tokens: [...configuredTokens.values()].filter((token) => token.networkId === network.id),
      }));
    }

    return this.portfolio.networks.map((spec) => ({
      network: nativeById.get(spec.id) || { id: spec.id, name: spec.name || spec.id, symbol: spec.symbol || '', adapter: 'evm-native', decimals: 18 },
      tokens: (spec.tokens || []).map((token) => ({ ...configuredTokens.get(token.id), ...token, networkId: spec.id, adapter: 'evm-token' })),
    }));
  }

  async snapshot({ currency = 'USD', maxAgeMs = 10000 } = {}) {
    const fiat = String(currency || 'USD').toUpperCase();
    const cacheKey = fiat;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;

    if (this.configError) return { configured: false, error: this.configError, address: null, mode: this.mode, currency: fiat, networks: [], totalFiat: null };
    if (!this.address) return { configured: false, error: null, address: null, mode: this.mode, currency: fiat, networks: [], totalFiat: null };

    const output = [];
    let totalFiat = 0;
    let pricedAny = false;

    for (const tracked of this.trackedNetworks()) {
      const network = tracked.network;
      const adapter = this.adapters.get(network.id);
      const row = { id: network.id, name: network.name, symbol: network.symbol, native: null, tokens: [], error: null, nonZeroAssets: 0, assetCount: 1 + tracked.tokens.length };
      if (!adapter) {
        row.error = 'Adapter not available';
        output.push(row);
        continue;
      }

      try {
        const raw = await adapter.rpcPool().jsonRpc('eth_getBalance', [this.address, 'latest']);
        const atomic = BigInt(raw || '0x0');
        const balance = formatUnits(atomic, network.decimals ?? 18);
        const rate = await this.assetPrice(network, fiat);
        const value = rate === null ? null : Number(balance) * rate;
        if (atomic > 0n) row.nonZeroAssets++;
        if (value !== null && Number.isFinite(value)) { totalFiat += value; pricedAny = true; }
        row.native = { assetId: network.id, symbol: network.symbol, balance, balanceAtomic: atomic.toString(), price: rate, fiatValue: money(value) };
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
      }

      for (const token of tracked.tokens) {
        try {
          const data = erc20.encodeFunctionData('balanceOf', [this.address]);
          const raw = await adapter.rpcPool().jsonRpc('eth_call', [{ to: token.contractAddress, data }, 'latest']);
          const atomic = BigInt(raw || '0x0');
          const balance = formatUnits(atomic, token.decimals ?? 18);
          const rate = await this.assetPrice(token, fiat);
          const value = rate === null ? null : Number(balance) * rate;
          if (atomic > 0n) row.nonZeroAssets++;
          if (value !== null && Number.isFinite(value)) { totalFiat += value; pricedAny = true; }
          const configuredAdapter = this.adapters.get(token.id);
          row.tokens.push({
            assetId: token.id,
            name: token.name,
            symbol: token.symbol,
            contractAddress: token.contractAddress,
            enabled: configuredAdapter ? configuredAdapter.isEnabled() : null,
            balance,
            balanceAtomic: atomic.toString(),
            price: rate,
            fiatValue: money(value),
          });
        } catch (error) {
          row.tokens.push({ assetId: token.id, name: token.name, symbol: token.symbol, contractAddress: token.contractAddress, balance: null, error: error instanceof Error ? error.message : String(error) });
        }
      }
      output.push(row);
    }

    const value = {
      configured: true,
      error: null,
      address: this.address,
      mode: this.mode,
      currency: fiat,
      networks: output,
      totalFiat: pricedAny ? money(totalFiat) : null,
      tokenDiscovery: this.portfolio?.networks?.length ? 'hot-wallet-config' : 'configured-assets',
      updatedAt: new Date().toISOString(),
    };
    this.cache.set(cacheKey, { value, expires: Date.now() + maxAgeMs });
    return value;
  }
}
