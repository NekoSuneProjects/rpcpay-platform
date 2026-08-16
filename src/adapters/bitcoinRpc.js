import { ChainAdapter } from './base.js';
import { allocateConfiguredAddress } from './address.js';
import { rpcAmountToAtomic, atomicToDecimal } from '../lib/amount.js';

export class BitcoinRpcAdapter extends ChainAdapter {
  async call(method,params=[]) { return this.rpcPool('1.0').jsonRpc(method,params,{version:'1.0',auth:this.rpcAuth()}); }
  async allocate({invoiceId}) {
    if(this.chain.addressMode!=='rpc-wallet') return {address:allocateConfiguredAddress(this.chain,this.db)};
    const method=this.chain.wallet?.getNewAddressMethod??'getnewaddress'; const label=`rpcpay-${invoiceId}`;
    try { return {address:await this.call(method,[label])}; } catch { return {address:await this.call(method,[])}; }
  }
  async getStartBlock(){ try{return Number(await this.call('getblockcount'));}catch{return null;} }
  async observe(invoice){
    const method=this.chain.wallet?.listReceivedMethod??'listreceivedbyaddress';
    let rows;
    try { rows=await this.call(method,[0,true]); }
    catch { rows=await this.call(method,[0]); }
    const row=Array.isArray(rows)?rows.find((x)=>x.address===invoice.address):null;
    if(!row||row.amount===undefined) return {found:false};
    const received=rpcAmountToAtomic(row.amount,this.chain.decimals); if(received<BigInt(invoice.amountAtomic)) return {found:false};
    return {found:true,txid:Array.isArray(row.txids)?row.txids[0]:invoice.txid,confirmations:Number(row.confirmations??0),amountAtomic:received.toString()};
  }
  async sweep(invoice){
    const owner=this.ownerAddress(); if(!owner) throw new Error(`${this.chain.id}: owner wallet is not configured`);
    const received=BigInt(invoice.receivedAmountAtomic||invoice.amountAtomic); const amount=atomicToDecimal(received,this.chain.decimals);
    try {
      const txid=await this.call('sendtoaddress',[owner,amount,`RPCPay ${invoice.id}`,'',true]);
      return {status:'swept',txid:String(txid),feeAtomic:null};
    } catch(first){
      const reserve=BigInt(this.chain.sweepReserveAtomic??0); if(received<=reserve) throw first;
      const txid=await this.call('sendtoaddress',[owner,atomicToDecimal(received-reserve,this.chain.decimals)]);
      return {status:'swept',txid:String(txid),feeAtomic:reserve?reserve.toString():null};
    }
  }
}
