import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expandEnv } from './lib/env.js';

const adapters = new Set(['evm-native','evm-token','bitcoin-rpc','solana-native','solana-token','tron-native','tron-token','lnd']);
const tokenAdapters = new Set(['evm-token','solana-token','tron-token']);
const addressModes = new Set(['generated-local','rpc-wallet','pool','fixed','lightning']);

export function loadConfig() {
  const path = resolve(process.env.CHAINS_CONFIG ?? './config/chains.json');
  const config = JSON.parse(expandEnv(readFileSync(path,'utf8')));
  if (!config || !Array.isArray(config.chains) || config.chains.length === 0) throw new Error('chains.json must contain chains');
  const ids = new Set();
  const byId = new Map();
  for (const c of config.chains) {
    for (const key of ['id','name','symbol','adapter']) if (!c[key]) throw new Error(`Chain missing ${key}`);
    if (ids.has(c.id)) throw new Error(`Duplicate chain id: ${c.id}`); ids.add(c.id); byId.set(c.id,c);
    if (!adapters.has(c.adapter)) throw new Error(`${c.id}: unsupported adapter ${c.adapter}`);
    c.rpcUrls = (Array.isArray(c.rpcUrls) ? c.rpcUrls : c.rpcUrl ? [c.rpcUrl] : []).filter(Boolean);
    c.rpcHeaders = Object.fromEntries(Object.entries(c.rpcHeaders || {}).filter(([,v])=>v!==undefined&&v!==null&&String(v)!==''));
    c.addressMode ??= c.adapter === 'bitcoin-rpc' ? 'rpc-wallet' : c.adapter === 'lnd' ? 'lightning' : 'generated-local';
    if (!addressModes.has(c.addressMode)) throw new Error(`${c.id}: invalid addressMode`);
    c.decimals = Number.isInteger(c.decimals) ? c.decimals : 8;
    c.confirmations = Number.isInteger(c.confirmations) ? c.confirmations : 1;
    if (c.decimals < 0 || c.decimals > 36) throw new Error(`${c.id}: invalid decimals`);
    if (c.confirmations < 1) throw new Error(`${c.id}: invalid confirmations`);
    if (c.addressMode === 'pool' && (!Array.isArray(c.addressPool) || !c.addressPool.length)) throw new Error(`${c.id}: pool needs addressPool`);
    if (c.addressMode === 'fixed' && !c.depositAddress) throw new Error(`${c.id}: fixed needs depositAddress`);
  }

  for (const c of config.chains) {
    if (!tokenAdapters.has(c.adapter)) continue;
    if (!c.networkId) throw new Error(`${c.id}: token adapter requires networkId`);
    const parent=byId.get(c.networkId);
    if (!parent) throw new Error(`${c.id}: unknown parent network ${c.networkId}`);
    const expectedParent = c.adapter === 'evm-token' ? 'evm-native' : c.adapter === 'tron-token' ? 'tron-native' : 'solana-native';
    if(parent.adapter!==expectedParent) throw new Error(`${c.id}: ${c.adapter} requires ${expectedParent} parent`);
    if(c.adapter==='solana-token' && !c.mintAddress) throw new Error(`${c.id}: solana-token requires mintAddress`);
    if(c.adapter!=='solana-token' && !c.contractAddress) throw new Error(`${c.id}: token adapter requires contractAddress`);
    c.rpcSourceId ??= c.networkId;
    c.ownerSourceId ??= c.networkId;
    if(!c.rpcUrls.length)c.rpcUrls=[...(parent.rpcUrls||[])];
    c.rpcHeaders={...(parent.rpcHeaders||{}),...(c.rpcHeaders||{})};
    c.rpcUser ??= parent.rpcUser;
    c.rpcPassword ??= parent.rpcPassword;
    c.apiKey ??= parent.apiKey;
    c.gasSponsorPrivateKey ??= parent.gasSponsorPrivateKey;
    c.gasSponsorSecretKey ??= parent.gasSponsorSecretKey;
    c.feeSymbol ??= parent.symbol;
    c.nativeDecimals ??= parent.decimals;
    c.sweepGasMultiplierBps ??= parent.sweepGasMultiplierBps;
  }
  return config;
}
