import {EvmNativeAdapter} from './evm.js';
import {EvmTokenAdapter} from './evmToken.js';
import {BitcoinRpcAdapter} from './bitcoinRpc.js';
import {SolanaNativeAdapter} from './solana.js';
import {SolanaTokenAdapter} from './solanaToken.js';
import {TronNativeAdapter} from './tron.js';
import {TronTokenAdapter} from './tronToken.js';
import {LndAdapter} from './lnd.js';

const classes={
  'evm-native':EvmNativeAdapter,
  'evm-token':EvmTokenAdapter,
  'bitcoin-rpc':BitcoinRpcAdapter,
  'solana-native':SolanaNativeAdapter,
  'solana-token':SolanaTokenAdapter,
  'tron-native':TronNativeAdapter,
  'tron-token':TronTokenAdapter,
  'lnd':LndAdapter
};

export function buildAdapter(chain,db,secrets){
  const Adapter=classes[chain.adapter];
  if(!Adapter)throw new Error(`Unsupported adapter: ${chain.adapter}`);
  return new Adapter(chain,db,secrets);
}
export function buildAdapters(chains,db,secrets){ return new Map(chains.map((chain)=>[chain.id,buildAdapter(chain,db,secrets)])); }
