import { RpcPool } from '../lib/rpc.js';

export class ChainAdapter {
  constructor(chain, db, secrets) { this.chain=chain; this.db=db; this.secrets=secrets; this.pool=null; this.poolKey=''; }
  setting(chainId=this.chain.id) { return this.db.getChainSetting(chainId) || null; }
  rpcSetting() { return this.setting(this.chain.rpcSourceId || this.chain.networkId || this.chain.id); }
  rpcUrls() {
    const own=this.setting();
    if(own?.rpcUrls?.length) return own.rpcUrls.filter(Boolean);
    const source=this.rpcSetting();
    return (source?.rpcUrls?.length ? source.rpcUrls : this.chain.rpcUrls || []).filter(Boolean);
  }
  rpcAuth() { return this.chain.rpcUser ? {user:this.chain.rpcUser,password:this.chain.rpcPassword||''} : undefined; }
  rpcHeaders() { return Object.fromEntries(Object.entries(this.chain.rpcHeaders || {}).filter(([,v])=>v!==undefined&&v!==null&&String(v)!=='')); }
  rpcPool(version='2.0') {
    const urls=this.rpcUrls(); const headers=this.rpcHeaders(); const key=JSON.stringify([urls,headers]);
    if(!this.pool || key!==this.poolKey) { this.pool=new RpcPool(urls,{auth:this.rpcAuth(),headers}); this.poolKey=key; }
    this.pool.version=version; return this.pool;
  }
  ownerAddress() {
    const own=this.setting();
    if(own?.ownerAddress) return own.ownerAddress;
    const sourceId=this.chain.ownerSourceId || this.chain.networkId;
    if(sourceId){ const source=this.setting(sourceId); if(source?.ownerAddress) return source.ownerAddress; }
    return this.chain.ownerAddress || null;
  }
  autoSweep() { const s=this.setting(); return s ? s.autoSweep !== false : this.chain.autoSweep !== false; }
  isEnabled() {
    const own=this.setting();
    if((own && own.enabled===false) || (!own && this.chain.enabled===false)) return false;
    const sourceId=this.chain.rpcSourceId || this.chain.networkId;
    if(sourceId){ const source=this.setting(sourceId); if(source && source.enabled===false) return false; }
    return true;
  }
  gasSponsorSecret() {
    return this.chain.gasSponsorPrivateKey || this.chain.gasSponsorSecretKey || null;
  }
  async sweep() { return {status:'not_applicable'}; }
}
