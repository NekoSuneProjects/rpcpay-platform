import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EvmNativeAdapter } from '../src/adapters/evm.js';
import { BitcoinRpcAdapter } from '../src/adapters/bitcoinRpc.js';
import { SecretBox } from '../src/lib/secrets.js';

const dbFor = (urls) => ({
  getChainSetting: () => ({ enabled: true, ownerAddress: null, autoSweep: false, rpcUrls: urls }),
  isAddressUsed: () => false,
});
const secrets = new SecretBox('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

async function mockRpc(handler) {
  const server = createServer(async (req, res) => {
    const chunks=[]; for await (const c of req) chunks.push(c); const body=JSON.parse(Buffer.concat(chunks).toString());
    const result=await handler(body); res.setHeader('content-type','application/json'); res.end(JSON.stringify({jsonrpc:body.jsonrpc,id:body.id,result,error:null}));
  });
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve)); const {port}=server.address();
  return {url:`http://127.0.0.1:${port}`,close:()=>new Promise((resolve)=>server.close(resolve))};
}

test('EVM adapter detects a native transfer',async()=>{
  const rpc=await mockRpc(({method,params})=>{if(method==='eth_blockNumber')return'0x64';if(method==='eth_getBlockByNumber'&&params[0]==='0x64')return{number:'0x64',transactions:[{hash:'0xtx',to:'0x1111111111111111111111111111111111111111',value:'0xde0b6b3a7640000'}]};return{transactions:[]};});
  try{const chain={id:'eth',name:'Ethereum',symbol:'ETH',adapter:'evm-native',rpcUrls:[rpc.url],decimals:18,confirmations:1,addressMode:'pool',addressPool:['0x1111111111111111111111111111111111111111']};const adapter=new EvmNativeAdapter(chain,dbFor([rpc.url]),secrets);const obs=await adapter.observe({address:'0x1111111111111111111111111111111111111111',amountAtomic:'1000000000000000000',txid:null,scanCursor:100,startBlock:100});assert.equal(obs.found,true);assert.equal(obs.txid,'0xtx');assert.equal(obs.confirmations,1);}finally{await rpc.close();}
});

test('Bitcoin/PIVX RPC adapter allocates and detects payment',async()=>{
  const rpc=await mockRpc(({method})=>{if(method==='getnewaddress')return'DMockAddress';if(method==='getblockcount')return 123;if(method==='listreceivedbyaddress')return[{address:'DMockAddress',amount:25.5,confirmations:6,txids:['pivx-tx']}];return null;});
  try{const chain={id:'pivx',name:'PIVX',symbol:'PIVX',adapter:'bitcoin-rpc',rpcUrls:[rpc.url],rpcUser:'u',rpcPassword:'p',decimals:8,confirmations:6,addressMode:'rpc-wallet',wallet:{legacyLabelArgument:true}};const adapter=new BitcoinRpcAdapter(chain,dbFor([rpc.url]),secrets);assert.equal((await adapter.allocate({invoiceId:'inv1'})).address,'DMockAddress');const obs=await adapter.observe({address:'DMockAddress',amountAtomic:'2550000000'});assert.equal(obs.found,true);assert.equal(obs.txid,'pivx-tx');assert.equal(obs.confirmations,6);}finally{await rpc.close();}
});

test('Bitcoin-family adapter sweeps confirmed amount to owner wallet', async () => {
  let sendParams;
  const rpc = await mockRpc(({ method, params }) => {
    if (method === 'sendtoaddress') { sendParams = params; return 'sweep-tx'; }
    return null;
  });
  try {
    const db = {
      getChainSetting: () => ({ enabled: true, ownerAddress: 'DOwnerWallet', autoSweep: true, rpcUrls: [rpc.url] }),
      isAddressUsed: () => false,
    };
    const chain = { id:'doge',name:'Dogecoin',symbol:'DOGE',adapter:'bitcoin-rpc',rpcUrls:[rpc.url],rpcUser:'u',rpcPassword:'p',decimals:8,confirmations:6,addressMode:'rpc-wallet' };
    const adapter = new BitcoinRpcAdapter(chain, db, secrets);
    const result = await adapter.sweep({ id:'inv1', amountAtomic:'1000000000', receivedAmountAtomic:'1000000000' });
    assert.equal(result.status, 'swept');
    assert.equal(result.txid, 'sweep-tx');
    assert.equal(sendParams[0], 'DOwnerWallet');
    assert.equal(sendParams[1], '10');
    assert.equal(sendParams[4], true);
  } finally { await rpc.close(); }
});
