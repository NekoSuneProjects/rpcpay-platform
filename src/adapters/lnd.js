import { ChainAdapter } from './base.js';

export class LndAdapter extends ChainAdapter {
  headers(){ return {'content-type':'application/json','Grpc-Metadata-macaroon':this.chain.macaroonHex||''}; }
  base(){ const url=this.rpcUrls()[0]; if(!url) throw new Error('LND REST endpoint not configured'); return url.replace(/\/$/,''); }
  async allocate({invoiceId,amountAtomic,expirySeconds}){
    const response=await fetch(`${this.base()}/v1/invoices`,{method:'POST',headers:this.headers(),body:JSON.stringify({value:String(amountAtomic),memo:`RPCPay ${invoiceId}`,expiry:String(expirySeconds)}),signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error(`LND AddInvoice HTTP ${response.status}`); const body=await response.json();
    const hashHex=Buffer.from(body.r_hash,'base64').toString('hex');
    return {address:'',paymentRequest:body.payment_request,providerRef:hashHex,startBlock:null};
  }
  async getStartBlock(){return null;}
  async observe(invoice){
    const response=await fetch(`${this.base()}/v1/invoice/${invoice.providerRef}`,{headers:this.headers(),signal:AbortSignal.timeout(15000)}); if(!response.ok) throw new Error(`LND LookupInvoice HTTP ${response.status}`);
    const body=await response.json(); const settled=body.state==='SETTLED'||body.settled===true;
    return settled?{found:true,txid:invoice.providerRef,confirmations:1,amountAtomic:String(body.amt_paid_sat||body.value||invoice.amountAtomic)}:{found:false};
  }
  async sweep(){return {status:'not_applicable'};}
}
