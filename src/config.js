import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expandEnv } from './lib/env.js';

const adapters = new Set(['evm-native','bitcoin-rpc','solana-native','tron-native','lnd']);
const addressModes = new Set(['generated-local','rpc-wallet','pool','fixed','lightning']);

export function loadConfig() {
  const path = resolve(process.env.CHAINS_CONFIG ?? './config/chains.json');
  const config = JSON.parse(expandEnv(readFileSync(path,'utf8')));
  if (!config || !Array.isArray(config.chains) || config.chains.length === 0) throw new Error('chains.json must contain chains');
  const ids = new Set();
  for (const c of config.chains) {
    for (const key of ['id','name','symbol','adapter']) if (!c[key]) throw new Error(`Chain missing ${key}`);
    if (ids.has(c.id)) throw new Error(`Duplicate chain id: ${c.id}`); ids.add(c.id);
    if (!adapters.has(c.adapter)) throw new Error(`${c.id}: unsupported adapter ${c.adapter}`);
    c.rpcUrls = (Array.isArray(c.rpcUrls) ? c.rpcUrls : c.rpcUrl ? [c.rpcUrl] : []).filter(Boolean);
    c.addressMode ??= c.adapter === 'bitcoin-rpc' ? 'rpc-wallet' : c.adapter === 'lnd' ? 'lightning' : 'generated-local';
    if (!addressModes.has(c.addressMode)) throw new Error(`${c.id}: invalid addressMode`);
    c.decimals = Number.isInteger(c.decimals) ? c.decimals : 8;
    c.confirmations = Number.isInteger(c.confirmations) ? c.confirmations : 1;
    if (c.decimals < 0 || c.decimals > 36) throw new Error(`${c.id}: invalid decimals`);
    if (c.confirmations < 1) throw new Error(`${c.id}: invalid confirmations`);
    if (c.addressMode === 'pool' && (!Array.isArray(c.addressPool) || !c.addressPool.length)) throw new Error(`${c.id}: pool needs addressPool`);
    if (c.addressMode === 'fixed' && !c.depositAddress) throw new Error(`${c.id}: fixed needs depositAddress`);
  }
  return config;
}
