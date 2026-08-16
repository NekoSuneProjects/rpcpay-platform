import {EvmNativeAdapter} from './evm.js';
import {BitcoinRpcAdapter} from './bitcoinRpc.js';
import {SolanaNativeAdapter} from './solana.js';
import {TronNativeAdapter} from './tron.js';
import {LndAdapter} from './lnd.js';

const classes={'evm-native':EvmNativeAdapter,'bitcoin-rpc':BitcoinRpcAdapter,'solana-native':SolanaNativeAdapter,'tron-native':TronNativeAdapter,'lnd':LndAdapter};
export function buildAdapters(chains,db,secrets){ return new Map(chains.map((chain)=>[chain.id,new classes[chain.adapter](chain,db,secrets)])); }
