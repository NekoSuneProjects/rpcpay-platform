import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {loadConfig} from './config.js';
import {GatewayDatabase} from './db/database.js';
import {buildAdapters} from './adapters/registry.js';
import {InvoiceService} from './services/invoices.js';
import {WebhookService} from './services/webhooks.js';
import {PaymentWatcher} from './services/watcher.js';
import {PriceService} from './services/prices.js';
import {EvmHotWalletService} from './services/hotWallet.js';
import {SecretBox} from './lib/secrets.js';
import {AdminAuth} from './lib/adminAuth.js';
import {buildServer} from './api/server.js';

for(const k of ['API_KEY','WEBHOOK_SECRET','WALLET_ENCRYPTION_KEY','ADMIN_PASSWORD','ADMIN_SESSION_SECRET'])if(!process.env[k])throw new Error(`Missing required environment variable ${k}`);
const dbPath=process.env.DB_PATH??'./data/rpcpay.db';mkdirSync(dirname(dbPath),{recursive:true});
const config=loadConfig();const db=new GatewayDatabase(dbPath);db.seedChains(config.chains);
const secrets=new SecretBox(process.env.WALLET_ENCRYPTION_KEY);const adapters=buildAdapters(config.chains,db,secrets);
const prices=new PriceService({
  provider:process.env.PRICE_PROVIDER??'auto',
  baseUrl:process.env.PRICE_API_BASE,
  apiKey:process.env.COINGECKO_API_KEY,
  nowNodesBaseUrl:process.env.NOWNODES_MARKET_API_BASE,
  nowNodesApiKey:process.env.NOWNODES_MARKET_API_KEY||process.env.NOWNODES_API_KEY,
});
const hotWallet=new EvmHotWalletService({
  chains:config.chains,
  adapters,
  priceService:prices,
  address:process.env.EVM_HOT_WALLET_ADDRESS,
  privateKey:process.env.EVM_HOT_WALLET_PRIVATE_KEY,
});
const invoices=new InvoiceService(db,adapters,Number(process.env.INVOICE_EXPIRY_MINUTES??60),prices);
const webhooks=new WebhookService(db,process.env.WEBHOOK_SECRET);const watcher=new PaymentWatcher(db,adapters,webhooks,Number(process.env.POLL_INTERVAL_MS??10000));
const adminAuth=new AdminAuth(process.env.ADMIN_PASSWORD,process.env.ADMIN_SESSION_SECRET);
const server=buildServer({db,adapters,invoiceService:invoices,apiKey:process.env.API_KEY,adminAuth,watcher,hotWallet});
const host=process.env.HOST??'0.0.0.0',port=Number(process.env.PORT??8080);
server.listen(port,host,()=>{console.log(`RPCPay Platform listening on http://${host}:${port}`);console.log(`Chains: ${[...adapters.keys()].join(', ')}`);if(hotWallet.address)console.log(`EVM hot wallet: ${hotWallet.address} (${hotWallet.mode})`);watcher.start();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{watcher.stop();server.close(()=>process.exit(0));});
