import { TronNativeAdapter } from './tron.js';

const TRANSFER_TOPIC='ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const normHex=(value)=>{
  let s=String(value||'').toLowerCase().replace(/^0x/,'');
  if(s.startsWith('41')&&s.length===42)s=s.slice(2);
  return s.slice(-40).padStart(40,'0');
};
const topicFor=(tronWeb,address)=>normHex(tronWeb.address.toHex(address)).padStart(64,'0');
const toBigInt=(v)=>BigInt(typeof v==='object'&&v!==null&&'toString' in v?v.toString():String(v||0));

export class TronTokenAdapter extends TronNativeAdapter {
  async instance(url,privateKey){
    const {TronWeb}=await import('tronweb');
    const headers={...this.rpcHeaders()};
    if(this.chain.apiKey)headers['TRON-PRO-API-KEY']=this.chain.apiKey;
    return new TronWeb({fullHost:url,headers,privateKey});
  }

  transferFromInfo(t,info,invoice){
    const contractHex=normHex(t.address.toHex(this.chain.contractAddress));
    const toTopic=topicFor(t,invoice.address);
    const expected=BigInt(invoice.amountAtomic);
    for(const log of info?.log||[]){
      if(normHex(log.address)!==contractHex)continue;
      const topics=(log.topics||[]).map(x=>String(x||'').toLowerCase().replace(/^0x/,''));
      if(topics[0]!==TRANSFER_TOPIC||topics[2]!==toTopic)continue;
      const amount=BigInt(`0x${String(log.data||'0').replace(/^0x/,'')}`);
      if(amount>=expected)return amount;
    }
    return null;
  }

  async observe(invoice){
    const t=await this.healthyTron();
    const current=await t.trx.getCurrentBlock();
    const latest=Number(current?.block_header?.raw_data?.number??0);
    if(invoice.txid){
      const info=await t.trx.getTransactionInfo(invoice.txid);
      if(!info?.id&&!info?.txID)return {found:false,invalidated:true};
      const amount=this.transferFromInfo(t,info,invoice);
      if(amount===null)return {found:false,invalidated:true};
      const blockNumber=Number(info.blockNumber??invoice.detectedBlock??latest);
      return {found:true,txid:invoice.txid,blockNumber,confirmations:Math.max(0,latest-blockNumber+1),amountAtomic:amount.toString()};
    }
    const start=invoice.scanCursor??invoice.startBlock??latest;
    const end=Math.min(latest,start+Number(this.chain.scanBatchBlocks??80));
    const contractHex=normHex(t.address.toHex(this.chain.contractAddress));
    for(let n=start;n<=end;n++){
      const block=await t.trx.getBlockByNumber(n);
      for(const tx of block?.transactions??[]){
        const c=tx.raw_data?.contract?.[0];
        if(c?.type!=='TriggerSmartContract')continue;
        const called=normHex(c.parameter?.value?.contract_address);
        if(called!==contractHex)continue;
        const info=await t.trx.getTransactionInfo(tx.txID);
        const amount=this.transferFromInfo(t,info,invoice);
        if(amount===null)continue;
        return {found:true,txid:tx.txID,blockNumber:n,confirmations:Math.max(0,latest-n+1),amountAtomic:amount.toString()};
      }
    }
    return {found:false,nextCursor:end<latest?end+1:end};
  }

  async sweep(invoice){
    const owner=this.ownerAddress();
    if(!owner)throw new Error(`${this.chain.id}: owner wallet is not configured`);
    if(!invoice.walletSecretEnc)throw new Error(`${this.chain.id}: invoice has no local wallet secret`);
    const key=this.secrets.decrypt(invoice.walletSecretEnc);
    const t=await this.healthyTron(key);
    const contract=await t.contract().at(this.chain.contractAddress);
    const balance=toBigInt(await contract.balanceOf(invoice.address).call());
    if(balance<=0n)throw new Error('Deposit wallet has no token balance');

    const targetTopup=BigInt(this.chain.gasTopupAtomic??0);
    const trxBalance=BigInt(await t.trx.getBalance(invoice.address));
    if(targetTopup>trxBalance){
      const sponsorSecret=this.gasSponsorSecret();
      if(!sponsorSecret)throw new Error(`${this.chain.id}: TRC-20 sweep needs a funded TRX gas sponsor`);
      const sponsor=await this.healthyTron(sponsorSecret);
      const topup=targetTopup-trxBalance;
      const funded=await sponsor.trx.sendTransaction(invoice.address,Number(topup),sponsorSecret);
      if(funded?.result===false)throw new Error(funded?.message||'TRX gas top-up failed');
    }

    const result=await contract.transfer(owner,balance.toString()).send({
      feeLimit:Number(this.chain.feeLimitSun??100000000),
      callValue:0,
      shouldPollResponse:true
    });
    const txid=typeof result==='string'?result:(result?.txid||result?.txID||result?.transaction?.txID||null);
    return {status:'swept',txid,feeAtomic:null,feeSymbol:'TRX',sentAtomic:balance.toString()};
  }
}
