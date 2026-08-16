import { Interface, Wallet, getAddress, formatUnits } from 'ethers';

const erc20 = new Interface(['function balanceOf(address owner) view returns (uint256)']);

function money(value) {
  return Number.isFinite(value) ? value.toFixed(2) : null;
}

export class EvmHotWalletService {
  constructor({ chains, adapters, priceService, address = '', privateKey = '' }) {
    this.chains = chains;
    this.adapters = adapters;
    this.priceService = priceService;
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

  async snapshot({ currency = 'USD', maxAgeMs = 10000 } = {}) {
    const fiat = String(currency || 'USD').toUpperCase();
    const cacheKey = fiat;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;

    if (this.configError) return { configured: false, error: this.configError, address: null, mode: this.mode, currency: fiat, networks: [], totalFiat: null };
    if (!this.address) return { configured: false, error: null, address: null, mode: this.mode, currency: fiat, networks: [], totalFiat: null };

    const networks = this.chains.filter((c) => c.adapter === 'evm-native');
    const tokens = this.chains.filter((c) => c.adapter === 'evm-token' && c.contractAddress);
    const output = [];
    let totalFiat = 0;
    let pricedAny = false;

    for (const network of networks) {
      const adapter = this.adapters.get(network.id);
      const row = { id: network.id, name: network.name, symbol: network.symbol, native: null, tokens: [], error: null };
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
        if (value !== null && Number.isFinite(value)) { totalFiat += value; pricedAny = true; }
        row.native = { assetId: network.id, symbol: network.symbol, balance, balanceAtomic: atomic.toString(), price: rate, fiatValue: money(value) };
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
      }

      for (const token of tokens.filter((t) => t.networkId === network.id)) {
        try {
          const data = erc20.encodeFunctionData('balanceOf', [this.address]);
          const raw = await adapter.rpcPool().jsonRpc('eth_call', [{ to: token.contractAddress, data }, 'latest']);
          const atomic = BigInt(raw || '0x0');
          const balance = formatUnits(atomic, token.decimals ?? 18);
          const rate = await this.assetPrice(token, fiat);
          const value = rate === null ? null : Number(balance) * rate;
          if (value !== null && Number.isFinite(value)) { totalFiat += value; pricedAny = true; }
          row.tokens.push({
            assetId: token.id,
            name: token.name,
            symbol: token.symbol,
            contractAddress: token.contractAddress,
            enabled: adapter.isEnabled() && this.adapters.get(token.id)?.isEnabled() !== false,
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
      tokenDiscovery: 'configured-assets',
      updatedAt: new Date().toISOString(),
    };
    this.cache.set(cacheKey, { value, expires: Date.now() + maxAgeMs });
    return value;
  }
}
