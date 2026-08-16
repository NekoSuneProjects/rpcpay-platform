import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayDatabase } from '../src/db/database.js';

test('invoice persists in SQLite', () => {
  const db = new GatewayDatabase(':memory:');
  const invoice = {
    id: 'inv_test', chainId: 'pivx', symbol: 'PIV', amount: '1.25', amountAtomic: '125000000',
    address: 'DTest', status: 'pending', confirmationsRequired: 6, confirmations: 0, txid: null,
    startBlock: 100, detectedBlock: null, scanCursor: 100,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+60000).toISOString(),
    confirmedAt: null, webhookUrl: null, metadataJson: '{}'
  };
  db.createInvoice(invoice);
  assert.equal(db.getInvoice('inv_test').amountAtomic, '125000000');
  assert.equal(db.isAddressUsed('pivx', 'DTest'), true);
});
