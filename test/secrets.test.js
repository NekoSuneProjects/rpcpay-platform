import test from 'node:test';
import assert from 'node:assert/strict';
import { SecretBox } from '../src/lib/secrets.js';

test('wallet secrets encrypt and decrypt', () => {
  const box = new SecretBox('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  const encrypted = box.encrypt('super-secret-private-key');
  assert.notEqual(encrypted, 'super-secret-private-key');
  assert.equal(box.decrypt(encrypted), 'super-secret-private-key');
});
