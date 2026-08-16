import { RpcPool } from '../lib/rpc.js';

export class ChainAdapter {
  constructor(chain, db, secrets) { this.chain=chain; this.db=db; this.secrets=secrets; this.pool=null; this.poolKey=''; }
  setting() { return this.db.getChainSetting(this.chain.id) || { enabled:this.chain.enabled!==false, ownerAddress:this.chain.ownerAddress||null, autoSweep:this.chain.autoSweep!==false, rpcUrls:this.chain.rpcUrls||[] }; }
  rpcUrls() { const s=this.setting(); return (s.rpcUrls?.length ? s.rpcUrls : this.chain.rpcUrls || []).filter(Boolean); }
  rpcAuth() { return this.chain.rpcUser ? {user:this.chain.rpcUser,password:this.chain.rpcPassword||''} : undefined; }
  rpcHeaders() { return this.chain.rpcHeaders || {}; }
  rpcPool(version='2.0') {
    const urls=this.rpcUrls(); const key=JSON.stringify(urls);
    if(!this.pool || key!==this.poolKey) { this.pool=new RpcPool(urls,{auth:this.rpcAuth(),headers:this.rpcHeaders()}); this.poolKey=key; }
    this.pool.version=version; return this.pool;
  }
  ownerAddress() { return this.setting().ownerAddress || this.chain.ownerAddress || null; }
  autoSweep() { return this.setting().autoSweep !== false; }
  isEnabled() { return this.setting().enabled !== false; }
  async sweep() { return {status:'not_applicable'}; }
}
