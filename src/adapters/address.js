export function allocateConfiguredAddress(chain, db) {
  if (chain.addressMode === 'fixed') return chain.depositAddress;
  if (chain.addressMode === 'pool') {
    const address = chain.addressPool.find((a) => !db.isAddressUsed(chain.id, a));
    if (!address) throw new Error(`${chain.id}: no unused deposit address remains in addressPool`);
    return address;
  }
  throw new Error(`${chain.id}: ${chain.addressMode} must be handled by its adapter`);
}
