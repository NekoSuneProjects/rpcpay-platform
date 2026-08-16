import { EvmNativeAdapter } from './evm.js';

const TRANSFER_TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const hexToNumber=(hex)=>Number.parseInt(hex,16);
const addressTopic=(address)=>`0x${String(address).toLowerCase().replace(/^0x/,'').padStart(64,'0')}`;
const hexQty=(n)=>`0x${Number(n).toString(16)}`;

function parseTransferLog(log,target,contract,expected){
  if(!log || String(log.address||'').toLowerCase()!==String(contract).toLowerCase()) return null;
  const topics=log.topics||[];
  if(String(topics[0]||'').toLowerCase()!==TRANSFER_TOPIC) return null;
  if(String(topics[2]||'').toLowerCase()!==addressTopic(target)) return null;
  const amount=BigInt(log.data||'0x0');
  if(amount<expected) return null;
  return amount;
}

export class EvmTokenAdapter extends EvmNativeAdapter {
  async observe(invoice){
    const pool=this.rpcPool();
    const latest=hexToNumber(await pool.jsonRpc('eth_blockNumber'));
    const expected=BigInt(invoice.amountAtomic);
    const contract=this.chain.contractAddress;
    if(invoice.txid){
      const receipt=await pool.jsonRpc('eth_getTransactionReceipt',[invoice.txid]);
      if(!receipt) return {found:false,invalidated:true};
      if(receipt.status && receipt.status!=='0x1') return {found:false,invalidated:true};
      const amount=(receipt.logs||[]).map(l=>parseTransferLog(l,invoice.address,contract,expected)).find(v=>v!==null);
      if(amount===undefined) return {found:false,invalidated:true};
      const blockNumber=hexToNumber(receipt.blockNumber);
      return {found:true,txid:invoice.txid,blockNumber,confirmations:Math.max(0,latest-blockNumber+1),amountAtomic:amount.toString()};
    }
    const start=invoice.scanCursor??invoice.startBlock??latest;
    const end=Math.min(latest,start+Number(this.chain.scanBatchBlocks??1500));
    const logs=await pool.jsonRpc('eth_getLogs',[{fromBlock:hexQty(start),toBlock:hexQty(end),address:contract,topics:[TRANSFER_TOPIC,null,addressTopic(invoice.address)]}]);
    for(const log of logs||[]){
      const amount=parseTransferLog(log,invoice.address,contract,expected);
      if(amount===null) continue;
      const blockNumber=hexToNumber(log.blockNumber);
      return {found:true,txid:log.transactionHash,blockNumber,confirmations:Math.max(0,latest-blockNumber+1),amountAtomic:amount.toString()};
    }
    return {found:false,nextCursor:end<latest?end+1:end};
  }

  async sweep(invoice){
    const owner=this.ownerAddress();
    if(!owner) throw new Error(`${this.chain.id}: owner wallet is not configured`);
    if(!invoice.walletSecretEnc) throw new Error(`${this.chain.id}: invoice has no local wallet secret`);
    const {Contract,JsonRpcProvider,Wallet}=await import('ethers');
    let provider; let lastError;
    for(const url of this.rpcUrls()){
      try{const p=new JsonRpcProvider(url);await p.getBlockNumber();provider=p;break;}catch(e){lastError=e;}
    }
    if(!provider) throw lastError||new Error('No healthy EVM RPC');
    const wallet=new Wallet(this.secrets.decrypt(invoice.walletSecretEnc),provider);
    const token=new Contract(this.chain.contractAddress,[
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address,uint256)'
    ],wallet);
    const balance=BigInt(await token.balanceOf(wallet.address));
    if(balance<=0n) throw new Error('Deposit wallet has no token balance');
    const gasLimit=BigInt(await token.transfer.estimateGas(owner,balance));
    const feeData=await provider.getFeeData();
    const feePrice=feeData.maxFeePerGas??feeData.gasPrice;
    if(!feePrice) throw new Error('RPC did not return a gas price');
    const bps=BigInt(this.chain.sweepGasMultiplierBps??14000);
    const gasNeeded=gasLimit*feePrice*bps/10000n;
    const nativeBalance=await provider.getBalance(wallet.address);
    if(nativeBalance<gasNeeded){
      const sponsorSecret=this.gasSponsorSecret();
      if(!sponsorSecret) throw new Error(`${this.chain.id}: token sweep needs a funded ${this.chain.feeSymbol||'native'} gas sponsor`);
      const sponsor=new Wallet(sponsorSecret,provider);
      const topup=gasNeeded-nativeBalance;
      const funding=await sponsor.sendTransaction({to:wallet.address,value:topup});
      await funding.wait(1);
    }
    const tx=await token.transfer(owner,balance,{gasLimit});
    const receipt=await tx.wait(1);
    const actualPrice=receipt?.gasPrice??feePrice;
    const fee=(receipt?.gasUsed??gasLimit)*actualPrice;
    return {status:'swept',txid:tx.hash,feeAtomic:fee.toString(),feeSymbol:this.chain.feeSymbol||'NATIVE',sentAtomic:balance.toString()};
  }
}
