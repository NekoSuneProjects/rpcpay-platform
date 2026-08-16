import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('token adapters inherit their parent RPC network', () => {
  const old=process.env.CHAINS_CONFIG;
  process.env.CHAINS_CONFIG='./config/chains.example.json';
  try{
    const config=loadConfig();
    const base=config.chains.find(c=>c.id==='base');
    const usdc=config.chains.find(c=>c.id==='base-usdc');
    const tronUsdt=config.chains.find(c=>c.id==='tron-usdt');
    const solUsdc=config.chains.find(c=>c.id==='solana-usdc');
    assert.equal(usdc.adapter,'evm-token');
    assert.equal(usdc.networkId,'base');
    assert.equal(usdc.feeSymbol,'ETH');
    assert.deepEqual(usdc.rpcUrls,base.rpcUrls);
    assert.equal(tronUsdt.adapter,'tron-token');
    assert.equal(solUsdc.adapter,'solana-token');
  }finally{
    if(old===undefined)delete process.env.CHAINS_CONFIG; else process.env.CHAINS_CONFIG=old;
  }
});
