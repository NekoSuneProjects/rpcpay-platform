import { SolanaNativeAdapter } from './solana.js';

function decodeKeypair(Keypair,value){
  const raw=String(value||'').trim();
  if(!raw) return null;
  if(raw.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  return Keypair.fromSecretKey(Uint8Array.from(Buffer.from(raw,'base64')));
}

export class SolanaTokenAdapter extends SolanaNativeAdapter {
  async observe(invoice){
    const result=await this.rpc('getTokenAccountsByOwner',[
      invoice.address,
      {mint:this.chain.mintAddress},
      {encoding:'jsonParsed',commitment:'confirmed'}
    ]);
    const expected=BigInt(invoice.amountAtomic);
    const created=Math.floor(new Date(invoice.createdAt).getTime()/1000);
    for(const entry of result?.value||[]){
      const amount=BigInt(entry?.account?.data?.parsed?.info?.tokenAmount?.amount??0);
      if(amount<expected)continue;
      const signatures=await this.rpc('getSignaturesForAddress',[entry.pubkey,{limit:20},'confirmed']);
      const sig=(signatures||[]).find(s=>!s.err&&(!s.blockTime||s.blockTime+60>=created));
      if(!sig)continue;
      const status=(await this.rpc('getSignatureStatuses',[[sig.signature],{searchTransactionHistory:true}]))?.value?.[0];
      const confirmations=status?.confirmationStatus==='finalized'?2:status?.confirmationStatus==='confirmed'?1:0;
      return {found:true,txid:sig.signature,blockNumber:Number(sig.slot??0),confirmations,amountAtomic:amount.toString()};
    }
    return {found:false};
  }

  async sweep(invoice){
    const owner=this.ownerAddress();
    if(!owner)throw new Error(`${this.chain.id}: owner wallet is not configured`);
    if(!invoice.walletSecretEnc)throw new Error(`${this.chain.id}: invoice has no local wallet secret`);
    const {Connection,Keypair,PublicKey,Transaction,sendAndConfirmTransaction}=await import('@solana/web3.js');
    const {
      TOKEN_2022_PROGRAM_ID,TOKEN_PROGRAM_ID,
      createTransferCheckedInstruction,getAssociatedTokenAddress,getOrCreateAssociatedTokenAccount,getAccount
    }=await import('@solana/spl-token');
    let connection;
    for(const url of this.rpcUrls()){
      try{const c=new Connection(url,'confirmed');await c.getSlot();connection=c;break;}catch{}
    }
    if(!connection)throw new Error('No healthy Solana RPC');
    const payer=Keypair.fromSecretKey(Uint8Array.from(Buffer.from(this.secrets.decrypt(invoice.walletSecretEnc),'base64')));
    const sponsor=decodeKeypair(Keypair,this.gasSponsorSecret())||payer;
    const mint=new PublicKey(this.chain.mintAddress);
    const ownerKey=new PublicKey(owner);
    const programId=this.chain.tokenProgram==='token-2022'?TOKEN_2022_PROGRAM_ID:TOKEN_PROGRAM_ID;
    const sourceAta=await getAssociatedTokenAddress(mint,payer.publicKey,false,programId);
    const source=await getAccount(connection,sourceAta,'confirmed',programId);
    const amount=BigInt(source.amount);
    if(amount<=0n)throw new Error('Deposit wallet has no token balance');
    const destination=await getOrCreateAssociatedTokenAccount(connection,sponsor,mint,ownerKey,false,'confirmed',undefined,programId);
    const latest=await connection.getLatestBlockhash('confirmed');
    const tx=new Transaction({feePayer:sponsor.publicKey,recentBlockhash:latest.blockhash}).add(
      createTransferCheckedInstruction(sourceAta,mint,destination.address,payer.publicKey,amount,this.chain.decimals,[],programId)
    );
    const fee=BigInt((await connection.getFeeForMessage(tx.compileMessage(),'confirmed')).value??5000);
    const signers=sponsor.publicKey.equals(payer.publicKey)?[payer]:[sponsor,payer];
    const signature=await sendAndConfirmTransaction(connection,tx,signers,{commitment:'confirmed'});
    return {status:'swept',txid:signature,feeAtomic:fee.toString(),feeSymbol:'SOL',sentAtomic:amount.toString()};
  }
}
