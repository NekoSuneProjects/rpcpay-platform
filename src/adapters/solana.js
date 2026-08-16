import { ChainAdapter } from './base.js';

export class SolanaNativeAdapter extends ChainAdapter {
  async rpc(method,params=[]){ return this.rpcPool().jsonRpc(method,params); }
  async allocate(){
    const {Keypair}=await import('@solana/web3.js'); const kp=Keypair.generate();
    return {address:kp.publicKey.toBase58(),walletSecretEnc:this.secrets.encrypt(Buffer.from(kp.secretKey).toString('base64'))};
  }
  async getStartBlock(){ return Number(await this.rpc('getSlot',[{commitment:'confirmed'}])); }
  async observe(invoice){
    const signatures=await this.rpc('getSignaturesForAddress',[invoice.address,{limit:100},'confirmed']);
    const created=Math.floor(new Date(invoice.createdAt).getTime()/1000); const expected=BigInt(invoice.amountAtomic);
    for(const sig of signatures||[]){
      if(sig.err) continue; if(sig.blockTime&&sig.blockTime+60<created) continue;
      const tx=await this.rpc('getTransaction',[sig.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]); if(!tx?.meta) continue;
      const keys=tx.transaction?.message?.accountKeys||[];
      const index=keys.findIndex((k)=>(typeof k==='string'?k:k?.pubkey)===invoice.address); if(index<0) continue;
      const delta=BigInt(tx.meta.postBalances?.[index]??0)-BigInt(tx.meta.preBalances?.[index]??0); if(delta<expected) continue;
      const status=(await this.rpc('getSignatureStatuses',[[sig.signature],{searchTransactionHistory:true}]))?.value?.[0];
      const confirmations=status?.confirmationStatus==='finalized'?2:status?.confirmationStatus==='confirmed'?1:0;
      return {found:true,txid:sig.signature,blockNumber:Number(tx.slot),confirmations,amountAtomic:delta.toString()};
    }
    return {found:false};
  }
  async sweep(invoice){
    const owner=this.ownerAddress(); if(!owner) throw new Error('solana: owner wallet is not configured');
    const {Connection,Keypair,PublicKey,SystemProgram,Transaction,sendAndConfirmTransaction}=await import('@solana/web3.js');
    let connection; for(const url of this.rpcUrls()){try{const c=new Connection(url,'confirmed');await c.getSlot();connection=c;break;}catch{}}
    if(!connection) throw new Error('No healthy Solana RPC');
    const kp=Keypair.fromSecretKey(Uint8Array.from(Buffer.from(this.secrets.decrypt(invoice.walletSecretEnc),'base64')));
    const balance=BigInt(await connection.getBalance(kp.publicKey,'confirmed')); if(balance<=0n) throw new Error('Deposit wallet has no SOL');
    const latest=await connection.getLatestBlockhash('confirmed');
    const probe=new Transaction({feePayer:kp.publicKey,recentBlockhash:latest.blockhash}).add(SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:new PublicKey(owner),lamports:1}));
    const fee=BigInt((await connection.getFeeForMessage(probe.compileMessage(),'confirmed')).value??5000); if(balance<=fee) throw new Error('Balance is too small to pay Solana fee');
    const send=balance-fee;
    const tx=new Transaction().add(SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:new PublicKey(owner),lamports:Number(send)}));
    const signature=await sendAndConfirmTransaction(connection,tx,[kp],{commitment:'confirmed'});
    return {status:'swept',txid:signature,feeAtomic:fee.toString(),sentAtomic:send.toString()};
  }
}
