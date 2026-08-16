import {randomUUID} from 'node:crypto';
import {decimalToAtomic} from '../lib/amount.js';

export class InvoiceService {
  constructor(db,adapters,defaultExpiryMinutes,priceService){this.db=db;this.adapters=adapters;this.defaultExpiryMinutes=defaultExpiryMinutes;this.priceService=priceService;}
  async create({chainId,amount,fiatAmount,fiatCurrency,campaignId,webhookUrl,metadata={},expiryMinutes}){
    const adapter=this.adapters.get(chainId); if(!adapter) throw new Error(`Unknown chain: ${chainId}`); if(!adapter.isEnabled()) throw new Error(`${chainId} is disabled`);
    let cryptoAmount=amount; let priceRate=null;
    if(!cryptoAmount&&fiatAmount){ const q=await this.priceService.fiatToCrypto(adapter.chain,fiatAmount,fiatCurrency||'GBP'); cryptoAmount=q.amount; priceRate=q.rate; }
    if(!cryptoAmount) throw new Error('amount or fiatAmount is required');
    const amountAtomic=decimalToAtomic(cryptoAmount,adapter.chain.decimals); if(amountAtomic<=0n) throw new Error('Amount must be greater than zero');
    const id=`inv_${randomUUID().replaceAll('-','')}`; const expires=Number(expiryMinutes??this.defaultExpiryMinutes); if(!Number.isInteger(expires)||expires<1||expires>10080) throw new Error('Invalid expiryMinutes');
    const now=new Date(); const allocation=await adapter.allocate({invoiceId:id,amountAtomic:amountAtomic.toString(),expirySeconds:expires*60});
    const startBlock=allocation.startBlock!==undefined?allocation.startBlock:await adapter.getStartBlock();
    const invoice={id,chainId:adapter.chain.id,symbol:adapter.chain.symbol,amount:String(cryptoAmount),amountAtomic:amountAtomic.toString(),address:allocation.address||'',status:'pending',confirmationsRequired:adapter.chain.confirmations,confirmations:0,txid:null,startBlock,detectedBlock:null,scanCursor:startBlock,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+expires*60000).toISOString(),confirmedAt:null,webhookUrl:webhookUrl??null,metadataJson:JSON.stringify(metadata),campaignId:campaignId??null,paymentRequest:allocation.paymentRequest??null,providerRef:allocation.providerRef??null,walletSecretEnc:allocation.walletSecretEnc??null,sweepStatus:adapter.chain.adapter==='lnd'?'not_applicable':'waiting',fiatAmount:fiatAmount?String(fiatAmount):null,fiatCurrency:fiatCurrency?String(fiatCurrency).toUpperCase():null,priceRate};
    this.db.createInvoice(invoice); return this.db.getInvoice(id);
  }
  async createForCampaign(slug,{chainId,fiatAmount,webhookUrl,metadata={},expiryMinutes}){
    const campaign=this.db.getCampaignBySlug(slug); if(!campaign||!campaign.enabled) throw new Error('Campaign not found');
    return this.create({chainId,fiatAmount,fiatCurrency:campaign.goalCurrency,campaignId:campaign.id,webhookUrl,metadata:{...metadata,campaignSlug:slug},expiryMinutes});
  }
}
