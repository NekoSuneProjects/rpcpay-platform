import test from 'node:test';
import assert from 'node:assert/strict';
import { signWebhook, verifyWebhookSignature } from '../src/lib/webhook.js';

test('webhook signature verifies', () => {
  const sig = signWebhook('secret', '123', '{"ok":true}');
  assert.equal(verifyWebhookSignature('secret', '123', '{"ok":true}', sig), true);
  assert.equal(verifyWebhookSignature('secret', '123', '{"ok":false}', sig), false);
});
