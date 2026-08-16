import {createServer} from 'node:http';
import {publicInvoice} from '../services/webhooks.js';
import {parseCookies} from '../lib/adminAuth.js';
import {homePage,campaignPage,adminPage} from '../ui/pages.js';

function send(res,status,body,type='application/json; charset=utf-8',extra={}){const data=type.startsWith('application/json')?JSON.stringify(body):String(body);res.writeHead(status,{'content-type':type,'content-length':Buffer.byteLength(data),'x-content-type-options':'nosniff','cache-control':'no-store',...extra});res.end(data);}
const json=(res,status,body,extra={})=>send(res,status,body,'application/json; charset=utf-8',extra);
const html=(res,status,body)=>send(res,status,body,'text/html; charset=utf-8',{'content-security-policy':"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"});
async function readJson(req,max=128*1024){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>max)throw new Error('request_body_too_large');chunks.push(c);}const t=Buffer.concat(chunks).toString('utf8');return t?JSON.parse(t):{};}
function cleanSlug(s){return String(s||'').toLowerCase().trim().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');}
function adminOk(req,auth){return auth.verifySession(parseCookies(req.headers.cookie||'').rpcpay_admin);}
function chainPublic(adapter){return{id:adapter.chain.id,name:adapter.chain.name,symbol:adapter.chain.symbol,adapter:adapter.chain.adapter,decimals:adapter.chain.decimals,confirmations:adapter.chain.confirmations,enabled:adapter.isEnabled()};}

export function buildServer({db,adapters,invoiceService,apiKey,adminAuth,watcher}){
  return createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':process.env.PUBLIC_CORS_ORIGIN||'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'content-type,x-api-key'});return res.end();}
    if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,chains:[...adapters.values()].filter(a=>a.isEnabled()).map(a=>a.chain.id)});
    if(req.method==='GET'&&url.pathname==='/'){return html(res,200,homePage(db.listCampaigns({publicOnly:true})));}
    if(req.method==='GET'&&url.pathname==='/admin')return html(res,200,adminPage());
    const campPage=url.pathname.match(/^\/c\/([^/]+)$/);if(req.method==='GET'&&campPage){const c=db.getCampaignBySlug(decodeURIComponent(campPage[1]));if(!c||!c.enabled)return html(res,404,'Campaign not found');return html(res,200,campaignPage(c,[...adapters.values()].filter(a=>a.isEnabled()).map(chainPublic)));}

    // Public website API
    if(req.method==='GET'&&url.pathname==='/api/public/chains')return json(res,200,{chains:[...adapters.values()].filter(a=>a.isEnabled()).map(chainPublic)},{'access-control-allow-origin':process.env.PUBLIC_CORS_ORIGIN||'*'});
    if(req.method==='GET'&&url.pathname==='/api/public/campaigns')return json(res,200,{campaigns:db.listCampaigns({publicOnly:true})},{'access-control-allow-origin':process.env.PUBLIC_CORS_ORIGIN||'*'});
    const pc=url.pathname.match(/^\/api\/public\/campaigns\/([^/]+)$/);if(req.method==='GET'&&pc){const c=db.getCampaignBySlug(decodeURIComponent(pc[1]));return c&&c.enabled?json(res,200,c):json(res,404,{error:'campaign_not_found'});}
    const pci=url.pathname.match(/^\/api\/public\/campaigns\/([^/]+)\/invoices$/);if(req.method==='POST'&&pci){const body=await readJson(req);try{const inv=await invoiceService.createForCampaign(decodeURIComponent(pci[1]),body);return json(res,201,publicInvoice(inv),{'access-control-allow-origin':process.env.PUBLIC_CORS_ORIGIN||'*'});}catch(e){return json(res,400,{error:e.message});}}
    const pi=url.pathname.match(/^\/api\/public\/invoices\/([^/]+)$/);if(req.method==='GET'&&pi){const inv=db.getInvoice(decodeURIComponent(pi[1]));return inv?json(res,200,publicInvoice(inv),{'access-control-allow-origin':process.env.PUBLIC_CORS_ORIGIN||'*'}):json(res,404,{error:'invoice_not_found'});}

    // Admin API
    if(url.pathname.startsWith('/admin/api/')){
      if(req.method==='POST'&&url.pathname==='/admin/api/login'){const body=await readJson(req);if(!adminAuth.verifyPassword(body.password))return json(res,401,{error:'invalid_password'});const token=adminAuth.createSession();return json(res,200,{ok:true},{'set-cookie':`rpcpay_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.COOKIE_SECURE==='false'?'':'; Secure'}`});}
      if(req.method==='POST'&&url.pathname==='/admin/api/logout')return json(res,200,{ok:true},{'set-cookie':'rpcpay_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
      if(!adminOk(req,adminAuth))return json(res,401,{error:'unauthorized'});
      if(req.method==='GET'&&url.pathname==='/admin/api/me')return json(res,200,{ok:true});
      if(req.method==='GET'&&url.pathname==='/admin/api/overview')return json(res,200,{invoices:db.listInvoices(100).map(publicInvoice),campaigns:db.listCampaigns()});
      if(req.method==='GET'&&url.pathname==='/admin/api/campaigns')return json(res,200,{campaigns:db.listCampaigns()});
      if(req.method==='POST'&&url.pathname==='/admin/api/campaigns'){const b=await readJson(req);const slug=cleanSlug(b.slug);if(!slug||!b.title||!/^\d+(\.\d+)?$/.test(String(b.goalAmount||'')))return json(res,400,{error:'slug, title and numeric goalAmount are required'});try{return json(res,201,db.createCampaign({...b,slug}));}catch(e){return json(res,400,{error:e.message});}}
      const cu=url.pathname.match(/^\/admin\/api\/campaigns\/([^/]+)$/);if(req.method==='PUT'&&cu){const b=await readJson(req);if(b.slug)b.slug=cleanSlug(b.slug);const c=db.updateCampaign(decodeURIComponent(cu[1]),b);return c?json(res,200,c):json(res,404,{error:'campaign_not_found'});}
      if(req.method==='GET'&&url.pathname==='/admin/api/chains'){return json(res,200,{chains:[...adapters.values()].map(a=>({...chainPublic(a),settings:db.getChainSetting(a.chain.id)}))});}
      const cs=url.pathname.match(/^\/admin\/api\/chains\/([^/]+)$/);if(req.method==='PUT'&&cs){const id=decodeURIComponent(cs[1]);if(!adapters.has(id))return json(res,404,{error:'chain_not_found'});const b=await readJson(req);if(b.rpcUrls!==undefined&&(!Array.isArray(b.rpcUrls)||b.rpcUrls.some(x=>typeof x!=='string')))return json(res,400,{error:'rpcUrls must be an array'});return json(res,200,db.updateChainSetting(id,b));}
      const sw=url.pathname.match(/^\/admin\/api\/invoices\/([^/]+)\/sweep$/);if(req.method==='POST'&&sw){const inv=db.getInvoice(decodeURIComponent(sw[1]));if(!inv)return json(res,404,{error:'invoice_not_found'});await watcher.attemptSweep(inv,true);return json(res,200,publicInvoice(db.getInvoice(inv.id)));}
      return json(res,404,{error:'not_found'});
    }

    // Server-to-server integration API (API key protected)
    if(req.headers['x-api-key']!==apiKey)return json(res,401,{error:'unauthorized'});
    if(req.method==='GET'&&url.pathname==='/v1/chains')return json(res,200,{chains:[...adapters.values()].map(chainPublic)});
    if(req.method==='GET'&&url.pathname==='/v1/campaigns')return json(res,200,{campaigns:db.listCampaigns()});
    if(req.method==='POST'&&url.pathname==='/v1/invoices'){const b=await readJson(req);try{return json(res,201,publicInvoice(await invoiceService.create(b)));}catch(e){return json(res,400,{error:e.message});}}
    const invm=url.pathname.match(/^\/v1\/invoices\/([^/]+)$/);if(req.method==='GET'&&invm){const inv=db.getInvoice(decodeURIComponent(invm[1]));return inv?json(res,200,publicInvoice(inv)):json(res,404,{error:'invoice_not_found'});}
    return json(res,404,{error:'not_found'});
  }catch(error){return json(res,error instanceof SyntaxError?400:500,{error:error instanceof Error?error.message:String(error)});}});
}
