export class PaymentWatcher {
  constructor(db,adapters,webhooks,pollIntervalMs){this.db=db;this.adapters=adapters;this.webhooks=webhooks;this.pollIntervalMs=pollIntervalMs;this.running=false;this.sweeping=new Set();}
  start(){if(!this.running){this.running=true;void this.loop();}}
  stop(){this.running=false;}
  async attemptSweep(invoice,manual=false){
    if(this.sweeping.has(invoice.id)) return; const adapter=this.adapters.get(invoice.chainId); if(!adapter) return;
    if(!manual&&!adapter.autoSweep()) return; if(invoice.sweepStatus==='swept'||invoice.sweepStatus==='not_applicable') return;
    this.sweeping.add(invoice.id); this.db.markSweep(invoice.id,{status:'sweeping'});
    try{ const result=await adapter.sweep(invoice); const updated=this.db.markSweep(invoice.id,{status:result.status||'swept',txid:result.txid??null,feeAtomic:result.feeAtomic??null}); this.webhooks.enqueue('payment.swept',updated); }
    catch(error){this.db.markSweep(invoice.id,{status:'failed',error:error instanceof Error?error.message:String(error)});}
    finally{this.sweeping.delete(invoice.id);}
  }
  async tick(){
    for(const invoice of this.db.expireDueInvoices()) this.webhooks.enqueue('invoice.expired',invoice);
    for(const invoice of this.db.getActiveInvoices()){
      const adapter=this.adapters.get(invoice.chainId); if(!adapter||!adapter.isEnabled()) continue;
      try{
        const observation=await adapter.observe(invoice);
        if(observation.invalidated&&invoice.txid){this.db.resetDetectedInvoice(invoice.id);this.webhooks.enqueue('payment.invalidated',{...invoice,status:'pending',confirmations:0,txid:null});continue;}
        if(!observation.found){if(observation.nextCursor!==undefined)this.db.updateScanCursor(invoice.id,observation.nextCursor);continue;}
        const confirmations=Number(observation.confirmations??0); const confirmed=confirmations>=invoice.confirmationsRequired; const previous=invoice.status;
        const updated=this.db.updateObservation(invoice.id,{status:confirmed?'confirmed':'detected',confirmations,txid:observation.txid??null,detectedBlock:observation.blockNumber??null,confirmedAt:confirmed?new Date().toISOString():null,receivedAmountAtomic:observation.amountAtomic??null});
        if(previous==='pending')this.webhooks.enqueue('payment.detected',updated);
        if(confirmed&&previous!=='confirmed'){this.webhooks.enqueue('payment.confirmed',updated);await this.attemptSweep(updated);}
      }catch(error){console.error(`[watcher] ${invoice.chainId}/${invoice.id}:`,error instanceof Error?error.message:error);}
    }
    for(const invoice of this.db.getSweepableInvoices()) await this.attemptSweep(invoice);
    await this.webhooks.deliverDue();
  }
  async loop(){while(this.running){const started=Date.now();try{await this.tick();}catch(error){console.error('[watcher] tick failed:',error);}await new Promise((r)=>setTimeout(r,Math.max(250,this.pollIntervalMs-(Date.now()-started))));}}
}
