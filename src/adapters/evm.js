import { ChainAdapter } from './base.js';
import { allocateConfiguredAddress } from './address.js';

const hexToNumber=(hex)=>Number.parseInt(hex,16);

export class EvmNativeAdapter extends ChainAdapter {
  async allocate({invoiceId}) {
    if(this.chain.addressMode!=='generated-local') return {address:allocateConfiguredAddress(this.chain,this.db)};
    const { Wallet } = await import('ethers');
    const wallet=Wallet.createRandom();
    return {address:wallet.address,walletSecretEnc:this.secrets.encrypt(wallet.privateKey)};
  }
  async getStartBlock() { return hexToNumber(await this.rpcPool().jsonRpc('eth_blockNumber')); }
  async observe(invoice) {
    const pool=this.rpcPool(); const latest=hexToNumber(await pool.jsonRpc('eth_blockNumber'));
    if(invoice.txid){
      const receipt=await pool.jsonRpc('eth_getTransactionReceipt',[invoice.txid]);
      if(!receipt) return {found:false,invalidated:true};
      if(receipt.status && receipt.status!=='0x1') return {found:false,invalidated:true};
      const blockNumber=hexToNumber(receipt.blockNumber);
      return {found:true,txid:invoice.txid,blockNumber,confirmations:Math.max(0,latest-blockNumber+1),amountAtomic:invoice.receivedAmountAtomic||invoice.amountAtomic};
    }
    const start=invoice.scanCursor??invoice.startBlock??latest; const end=Math.min(latest,start+Number(this.chain.scanBatchBlocks??199));
    const target=invoice.address.toLowerCase(); const expected=BigInt(invoice.amountAtomic);
    for(let number=start;number<=end;number++){
      const block=await pool.jsonRpc('eth_getBlockByNumber',[`0x${number.toString(16)}`,true]);
      for(const tx of block?.transactions??[]){
        if(!tx.to||tx.to.toLowerCase()!==target) continue;
        const received=BigInt(tx.value||'0x0'); if(received<expected) continue;
        return {found:true,txid:tx.hash,blockNumber:number,confirmations:latest-number+1,amountAtomic:received.toString()};
      }
    }
    return {found:false,nextCursor:end<latest?end+1:end};
  }
  async sweep(invoice) {
    const owner=this.ownerAddress(); if(!owner) throw new Error(`${this.chain.id}: owner wallet is not configured`);
    if(!invoice.walletSecretEnc) throw new Error(`${this.chain.id}: invoice has no local wallet secret`);
    const { JsonRpcProvider, Wallet }=await import('ethers');
    let provider; let lastError;
    for(const url of this.rpcUrls()) { try { const p=new JsonRpcProvider(url); await p.getBlockNumber(); provider=p; break; } catch(e){ lastError=e; } }
    if(!provider) throw lastError||new Error('No healthy EVM RPC');
    const wallet=new Wallet(this.secrets.decrypt(invoice.walletSecretEnc),provider);
    const balance=await provider.getBalance(wallet.address); if(balance<=0n) throw new Error('Deposit wallet has no spendable balance');
    const feeData=await provider.getFeeData(); const feePrice=feeData.maxFeePerGas??feeData.gasPrice;
    if(!feePrice) throw new Error('RPC did not return a gas price');
    const gasLimit=21000n; const bps=BigInt(this.chain.sweepGasMultiplierBps??12500); const reserve=gasLimit*feePrice*bps/10000n;
    if(balance<=reserve) throw new Error(`Balance is too small to sweep after gas reserve (${reserve})`);
    const value=balance-reserve;
    const tx=await wallet.sendTransaction({to:owner,value,gasLimit}); const receipt=await tx.wait(1);
    const actualGasPrice=receipt?.gasPrice??feePrice; const fee=(receipt?.gasUsed??gasLimit)*actualGasPrice;
    return {status:'swept',txid:tx.hash,feeAtomic:fee.toString(),sentAtomic:value.toString()};
  }
}
