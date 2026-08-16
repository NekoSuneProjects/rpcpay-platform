import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceService } from '../src/services/prices.js';
import { EvmHotWalletService, loadHotWalletPortfolio } from '../src/services/hotWallet.js';

const walletAddress='0x000000000000000000000000000000000000dEaD';

test('PriceService can quote from NOWNodes Market Data', async () => {
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async (url,options)=>{
    assert.match(String(url),/market-data\.nownodes\.io\/api\/v1\/price/);
    assert.equal(options.headers['api-key'],'test-key');
    return {ok:true,json:async()=>({result:[{from_currency:'eth',quotes:{to_currency:'usd',rate:2345.67}}],error:null})};
  };
  try {
    const prices=new PriceService({provider:'nownodes',nowNodesApiKey:'test-key'});
    assert.equal(await prices.price({id:'ethereum',symbol:'ETH'},'USD'),2345.67);
  } finally { globalThis.fetch=oldFetch; }
});

test('PriceService auto mode falls back to CoinGecko', async () => {
  const oldFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async (url)=>{
    calls++;
    if(String(url).includes('market-data.nownodes.io')) return {ok:false,status:503,json:async()=>({})};
    return {ok:true,json:async()=>({ethereum:{usd:2000}})};
  };
  try {
    const prices=new PriceService({provider:'auto',nowNodesApiKey:'test-key'});
    assert.equal(await prices.price({id:'ethereum',symbol:'ETH',priceId:'ethereum'},'USD'),2000);
    assert.equal(calls,2);
  } finally { globalThis.fetch=oldFetch; }
});

test('EVM hot wallet reports native and configured token balances', async () => {
  const network={id:'ethereum',name:'Ethereum',symbol:'ETH',adapter:'evm-native',decimals:18,priceId:'ethereum'};
  const token={id:'ethereum-usdc',name:'USD Coin on Ethereum',symbol:'USDC',adapter:'evm-token',networkId:'ethereum',contractAddress:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',decimals:6,priceId:'usd-coin'};
  const nativeAdapter={
    isEnabled:()=>true,
    rpcPool:()=>({jsonRpc:async(method)=>method==='eth_getBalance'?'0xde0b6b3a7640000':'0x2625a0'}),
  };
  const tokenAdapter={isEnabled:()=>true};
  const adapters=new Map([['ethereum',nativeAdapter],['ethereum-usdc',tokenAdapter]]);
  const priceService={price:async(asset)=>asset.symbol==='ETH'?2000:1};
  const service=new EvmHotWalletService({chains:[network,token],adapters,priceService,address:walletAddress});
  const snapshot=await service.snapshot({currency:'USD',maxAgeMs:0});
  assert.equal(snapshot.configured,true);
  assert.equal(snapshot.address,walletAddress);
  assert.equal(snapshot.networks[0].native.balance,'1.0');
  assert.equal(snapshot.networks[0].tokens[0].balance,'2.5');
  assert.equal(snapshot.networks[0].nonZeroAssets,2);
  assert.equal(snapshot.networks[0].assetCount,2);
  assert.equal(snapshot.totalFiat,'2002.50');
});

test('default hot wallet portfolio tracks Base 3, Ethereum 5 and Polygon 3 assets', () => {
  const portfolio=loadHotWalletPortfolio('./config/hot-wallet.json');
  assert.deepEqual(portfolio.networks.map((network)=>network.id),['base','ethereum','polygon']);
  const counts=Object.fromEntries(portfolio.networks.map((network)=>[network.id,1+network.tokens.length]));
  assert.deepEqual(counts,{base:3,ethereum:5,polygon:3});

  const base=portfolio.networks.find((network)=>network.id==='base');
  const ethereum=portfolio.networks.find((network)=>network.id==='ethereum');
  const polygon=portfolio.networks.find((network)=>network.id==='polygon');
  assert.deepEqual(base.tokens.map((token)=>token.symbol),['cbBTC','USDC']);
  assert.deepEqual(ethereum.tokens.map((token)=>token.symbol),['cbBTC','PYUSD','USDC','USDT']);
  assert.deepEqual(polygon.tokens.map((token)=>token.symbol),['USDC','USDT0']);
  assert.equal(base.tokens[0].contractAddress,'0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf');
  assert.equal(ethereum.tokens[1].contractAddress,'0x6c3ea9036406852006290770BEdFcAbA0e23A0e8');
  assert.equal(polygon.tokens[1].contractAddress,'0xc2132D05D31c914a87C6611C10748AEb04B58e8F');
});
