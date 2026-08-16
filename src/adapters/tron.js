import { ChainAdapter } from './base.js';

export class TronNativeAdapter extends ChainAdapter {
  async instance(url, privateKey) {
    const { TronWeb } = await import('tronweb');
    const headers = this.chain.apiKey ? { 'TRON-PRO-API-KEY': this.chain.apiKey } : {};
    return new TronWeb({ fullHost: url, headers, privateKey });
  }
  async healthyTron(privateKey) {
    let last;
    for (const url of this.rpcUrls()) {
      try {
        const t = await this.instance(url, privateKey);
        await t.trx.getCurrentBlock();
        return t;
      } catch (e) { last = e; }
    }
    throw last || new Error('No healthy TRON RPC configured');
  }
  async allocate() {
    const { TronWeb } = await import('tronweb');
    const a = await TronWeb.createAccount();
    return { address: a.address.base58, walletSecretEnc: this.secrets.encrypt(a.privateKey) };
  }
  async getStartBlock() {
    const t = await this.healthyTron();
    const b = await t.trx.getCurrentBlock();
    return Number(b?.block_header?.raw_data?.number ?? 0);
  }
  async observe(invoice) {
    const t = await this.healthyTron();
    const current = await t.trx.getCurrentBlock();
    const latest = Number(current?.block_header?.raw_data?.number ?? 0);
    const start = invoice.scanCursor ?? invoice.startBlock ?? latest;
    const end = Math.min(latest, start + Number(this.chain.scanBatchBlocks ?? 80));
    const target = t.address.toHex(invoice.address).toLowerCase();
    const expected = BigInt(invoice.amountAtomic);
    for (let n = start; n <= end; n++) {
      const block = await t.trx.getBlockByNumber(n);
      for (const tx of block?.transactions ?? []) {
        const c = tx.raw_data?.contract?.[0];
        if (c?.type !== 'TransferContract') continue;
        const v = c.parameter?.value || {};
        if (String(v.to_address || '').toLowerCase() !== target) continue;
        const amount = BigInt(v.amount ?? 0);
        if (amount < expected) continue;
        return { found: true, txid: tx.txID, blockNumber: n, confirmations: latest - n + 1, amountAtomic: amount.toString() };
      }
    }
    return { found: false, nextCursor: end < latest ? end + 1 : end };
  }
  async sweep(invoice) {
    const owner = this.ownerAddress();
    if (!owner) throw new Error('tron: owner wallet is not configured');
    const key = this.secrets.decrypt(invoice.walletSecretEnc);
    const t = await this.healthyTron(key);
    const balance = BigInt(await t.trx.getBalance(invoice.address));
    const reserve = BigInt(this.chain.sweepReserveAtomic ?? 1500000);
    if (balance <= reserve) throw new Error('TRX balance is too small after fee/bandwidth reserve');
    const amount = balance - reserve;
    const result = await t.trx.sendTransaction(owner, Number(amount), key);
    if (result?.result === false) throw new Error(result?.message || 'TRON sweep failed');
    return { status: 'swept', txid: result?.txid || result?.transaction?.txID || null, feeAtomic: reserve.toString(), sentAtomic: amount.toString() };
  }
}
