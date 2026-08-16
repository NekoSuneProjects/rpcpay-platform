import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const nowIso = () => new Date().toISOString();

export class GatewayDatabase {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  hasColumn(table, column) {
    return this.db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === column);
  }
  addColumn(table, definition) {
    const name = definition.trim().split(/\s+/)[0];
    if (!this.hasColumn(table, name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        chain_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        amount TEXT NOT NULL,
        amount_atomic TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        confirmations_required INTEGER NOT NULL,
        confirmations INTEGER NOT NULL DEFAULT 0,
        txid TEXT,
        start_block INTEGER,
        detected_block INTEGER,
        scan_cursor INTEGER,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        confirmed_at TEXT,
        webhook_url TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id TEXT NOT NULL,
        event TEXT NOT NULL,
        url TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        delivered_at TEXT,
        last_error TEXT,
        FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        goal_amount TEXT NOT NULL,
        goal_currency TEXT NOT NULL DEFAULT 'GBP',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chain_settings (
        chain_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        owner_address TEXT,
        auto_sweep INTEGER NOT NULL DEFAULT 1,
        rpc_urls_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_chain_status ON invoices(chain_id, status);
      CREATE INDEX IF NOT EXISTS idx_invoices_address ON invoices(chain_id, address);
      CREATE INDEX IF NOT EXISTS idx_webhook_pending ON webhook_deliveries(delivered_at, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_campaign_slug ON campaigns(slug);
    `);

    for (const definition of [
      'campaign_id TEXT',
      'payment_request TEXT',
      'provider_ref TEXT',
      'wallet_secret_enc TEXT',
      'received_amount_atomic TEXT',
      "sweep_status TEXT NOT NULL DEFAULT 'waiting'",
      'sweep_txid TEXT',
      'sweep_fee_atomic TEXT',
      'sweep_error TEXT',
      'swept_at TEXT',
      'fiat_amount TEXT',
      'fiat_currency TEXT',
      'price_rate TEXT'
    ]) this.addColumn('invoices', definition);
  }

  seedChains(chains) {
    const insert = this.db.prepare(`INSERT OR IGNORE INTO chain_settings(chain_id,enabled,owner_address,auto_sweep,rpc_urls_json,updated_at) VALUES(?,?,?,?,?,?)`);
    for (const c of chains) {
      const urls = Array.isArray(c.rpcUrls) ? c.rpcUrls : c.rpcUrl ? [c.rpcUrl] : [];
      insert.run(c.id, (c.enabled === false || urls.filter(Boolean).length === 0) ? 0 : 1, c.ownerAddress ?? null, c.autoSweep === false ? 0 : 1, JSON.stringify(urls.filter(Boolean)), nowIso());
    }
  }

  createInvoice(i) {
    this.db.prepare(`
      INSERT INTO invoices (
        id,chain_id,symbol,amount,amount_atomic,address,status,confirmations_required,confirmations,
        txid,start_block,detected_block,scan_cursor,created_at,expires_at,confirmed_at,webhook_url,metadata_json,
        campaign_id,payment_request,provider_ref,wallet_secret_enc,received_amount_atomic,sweep_status,
        sweep_txid,sweep_fee_atomic,sweep_error,swept_at,fiat_amount,fiat_currency,price_rate
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      i.id,i.chainId,i.symbol,i.amount,i.amountAtomic,i.address ?? '',i.status,i.confirmationsRequired,i.confirmations ?? 0,
      i.txid ?? null,i.startBlock ?? null,i.detectedBlock ?? null,i.scanCursor ?? null,i.createdAt,i.expiresAt,i.confirmedAt ?? null,i.webhookUrl ?? null,i.metadataJson ?? '{}',
      i.campaignId ?? null,i.paymentRequest ?? null,i.providerRef ?? null,i.walletSecretEnc ?? null,i.receivedAmountAtomic ?? null,i.sweepStatus ?? 'waiting',
      i.sweepTxid ?? null,i.sweepFeeAtomic ?? null,i.sweepError ?? null,i.sweptAt ?? null,i.fiatAmount ?? null,i.fiatCurrency ?? null,i.priceRate ?? null
    );
  }

  rowToInvoice(row) {
    if (!row) return null;
    return {
      id: row.id, chainId: row.chain_id, symbol: row.symbol, amount: row.amount, amountAtomic: row.amount_atomic,
      address: row.address, status: row.status, confirmationsRequired: Number(row.confirmations_required), confirmations: Number(row.confirmations),
      txid: row.txid, startBlock: row.start_block === null ? null : Number(row.start_block), detectedBlock: row.detected_block === null ? null : Number(row.detected_block),
      scanCursor: row.scan_cursor === null ? null : Number(row.scan_cursor), createdAt: row.created_at, expiresAt: row.expires_at,
      confirmedAt: row.confirmed_at, webhookUrl: row.webhook_url, metadataJson: row.metadata_json,
      campaignId: row.campaign_id, paymentRequest: row.payment_request, providerRef: row.provider_ref, walletSecretEnc: row.wallet_secret_enc,
      receivedAmountAtomic: row.received_amount_atomic, sweepStatus: row.sweep_status, sweepTxid: row.sweep_txid,
      sweepFeeAtomic: row.sweep_fee_atomic, sweepError: row.sweep_error, sweptAt: row.swept_at,
      fiatAmount: row.fiat_amount, fiatCurrency: row.fiat_currency, priceRate: row.price_rate,
    };
  }

  getInvoice(id) { return this.rowToInvoice(this.db.prepare('SELECT * FROM invoices WHERE id=?').get(id)); }
  listInvoices(limit = 100) { return this.db.prepare('SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?').all(limit).map((r) => this.rowToInvoice(r)); }
  getActiveInvoices() { return this.db.prepare(`SELECT * FROM invoices WHERE status IN ('pending','detected') ORDER BY created_at ASC`).all().map((r) => this.rowToInvoice(r)); }
  getSweepableInvoices() { return this.db.prepare(`SELECT * FROM invoices WHERE status='confirmed' AND sweep_status IN ('waiting','failed') ORDER BY confirmed_at ASC`).all().map((r) => this.rowToInvoice(r)); }
  isAddressUsed(chainId, address) { return Boolean(this.db.prepare('SELECT 1 FROM invoices WHERE chain_id=? AND lower(address)=lower(?) LIMIT 1').get(chainId, address)); }
  updateScanCursor(id, cursor) { this.db.prepare('UPDATE invoices SET scan_cursor=? WHERE id=?').run(cursor, id); }
  resetDetectedInvoice(id) { this.db.prepare(`UPDATE invoices SET status='pending',confirmations=0,txid=NULL,detected_block=NULL,received_amount_atomic=NULL WHERE id=?`).run(id); }
  updateObservation(id, { status, confirmations, txid = null, detectedBlock = null, confirmedAt = null, receivedAmountAtomic = null }) {
    this.db.prepare(`UPDATE invoices SET status=?,confirmations=?,txid=COALESCE(?,txid),detected_block=COALESCE(?,detected_block),confirmed_at=COALESCE(?,confirmed_at),received_amount_atomic=COALESCE(?,received_amount_atomic) WHERE id=?`)
      .run(status,confirmations,txid,detectedBlock,confirmedAt,receivedAmountAtomic,id);
    return this.getInvoice(id);
  }
  markSweep(id, { status, txid = null, feeAtomic = null, error = null }) {
    const sweptAt = status === 'swept' || status === 'not_applicable' ? nowIso() : null;
    this.db.prepare(`UPDATE invoices SET sweep_status=?,sweep_txid=?,sweep_fee_atomic=?,sweep_error=?,swept_at=COALESCE(?,swept_at) WHERE id=?`)
      .run(status,txid,feeAtomic,error ? String(error).slice(0,1000) : null,sweptAt,id);
    return this.getInvoice(id);
  }
  expireDueInvoices() {
    const now = nowIso();
    const rows = this.db.prepare(`SELECT * FROM invoices WHERE status='pending' AND expires_at<=?`).all(now);
    this.db.prepare(`UPDATE invoices SET status='expired' WHERE status='pending' AND expires_at<=?`).run(now);
    return rows.map((r) => ({ ...this.rowToInvoice(r), status: 'expired' }));
  }

  enqueueWebhook(invoiceId,event,url,payload) { this.db.prepare(`INSERT INTO webhook_deliveries(invoice_id,event,url,payload,next_attempt_at) VALUES(?,?,?,?,?)`).run(invoiceId,event,url,payload,nowIso()); }
  getDueWebhooks(limit=20) { return this.db.prepare(`SELECT * FROM webhook_deliveries WHERE delivered_at IS NULL AND next_attempt_at<=? ORDER BY id ASC LIMIT ?`).all(nowIso(),limit); }
  markWebhookDelivered(id) { this.db.prepare(`UPDATE webhook_deliveries SET delivered_at=?,attempts=attempts+1 WHERE id=?`).run(nowIso(),id); }
  markWebhookFailed(id,attempts,error) {
    const delays=[10,30,120,600,1800,3600]; const delaySec=delays[Math.min(attempts,delays.length-1)];
    const next=new Date(Date.now()+delaySec*1000).toISOString();
    this.db.prepare(`UPDATE webhook_deliveries SET attempts=attempts+1,last_error=?,next_attempt_at=? WHERE id=?`).run(String(error).slice(0,1000),next,id);
  }

  createCampaign({ slug, title, description = '', goalAmount, goalCurrency = 'GBP', enabled = true }) {
    const id = `camp_${randomUUID().replaceAll('-','')}`; const now=nowIso();
    this.db.prepare(`INSERT INTO campaigns(id,slug,title,description,goal_amount,goal_currency,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(id,slug,title,description,String(goalAmount),String(goalCurrency).toUpperCase(),enabled?1:0,now,now);
    return this.getCampaignById(id);
  }
  rowToCampaign(r) { return r ? { id:r.id,slug:r.slug,title:r.title,description:r.description,goalAmount:r.goal_amount,goalCurrency:r.goal_currency,enabled:Boolean(r.enabled),createdAt:r.created_at,updatedAt:r.updated_at } : null; }
  listCampaigns({ publicOnly=false }={}) { return this.db.prepare(`SELECT * FROM campaigns ${publicOnly?'WHERE enabled=1':''} ORDER BY created_at DESC`).all().map((r)=>this.withCampaignStats(this.rowToCampaign(r))); }
  getCampaignById(id) { return this.withCampaignStats(this.rowToCampaign(this.db.prepare('SELECT * FROM campaigns WHERE id=?').get(id))); }
  getCampaignBySlug(slug) { return this.withCampaignStats(this.rowToCampaign(this.db.prepare('SELECT * FROM campaigns WHERE slug=?').get(slug))); }
  updateCampaign(id, patch) {
    const old=this.getCampaignById(id); if(!old) return null;
    const next={...old,...patch};
    this.db.prepare(`UPDATE campaigns SET slug=?,title=?,description=?,goal_amount=?,goal_currency=?,enabled=?,updated_at=? WHERE id=?`)
      .run(next.slug,next.title,next.description,String(next.goalAmount),String(next.goalCurrency).toUpperCase(),next.enabled?1:0,nowIso(),id);
    return this.getCampaignById(id);
  }
  withCampaignStats(campaign) {
    if(!campaign) return null;
    const rows=this.db.prepare(`SELECT fiat_amount FROM invoices WHERE campaign_id=? AND status='confirmed' AND fiat_amount IS NOT NULL`).all(campaign.id);
    const raised=rows.reduce((s,r)=>s+Number(r.fiat_amount||0),0); const goal=Number(campaign.goalAmount||0);
    return {...campaign,raisedAmount:raised.toFixed(2),progress:goal>0?Math.min(100,(raised/goal)*100):0,donations:rows.length};
  }

  getChainSetting(chainId) {
    const r=this.db.prepare('SELECT * FROM chain_settings WHERE chain_id=?').get(chainId);
    return r ? { chainId:r.chain_id,enabled:Boolean(r.enabled),ownerAddress:r.owner_address,autoSweep:Boolean(r.auto_sweep),rpcUrls:JSON.parse(r.rpc_urls_json||'[]'),updatedAt:r.updated_at } : null;
  }
  listChainSettings() { return this.db.prepare('SELECT * FROM chain_settings ORDER BY chain_id').all().map((r)=>this.getChainSetting(r.chain_id)); }
  updateChainSetting(chainId,{enabled,ownerAddress,autoSweep,rpcUrls}) {
    const old=this.getChainSetting(chainId) || {enabled:false,ownerAddress:null,autoSweep:true,rpcUrls:[]};
    const next={...old,...Object.fromEntries(Object.entries({enabled,ownerAddress,autoSweep,rpcUrls}).filter(([,v])=>v!==undefined))};
    this.db.prepare(`INSERT INTO chain_settings(chain_id,enabled,owner_address,auto_sweep,rpc_urls_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(chain_id) DO UPDATE SET enabled=excluded.enabled,owner_address=excluded.owner_address,auto_sweep=excluded.auto_sweep,rpc_urls_json=excluded.rpc_urls_json,updated_at=excluded.updated_at`)
      .run(chainId,next.enabled?1:0,next.ownerAddress||null,next.autoSweep?1:0,JSON.stringify((next.rpcUrls||[]).filter(Boolean)),nowIso());
    return this.getChainSetting(chainId);
  }
}
