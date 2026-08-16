import test from 'node:test';
import assert from 'node:assert/strict';
import { atomicToDecimal, decimalToAtomic, rpcAmountToAtomic } from '../src/lib/amount.js';

test('decimalToAtomic EVM', () => assert.equal(decimalToAtomic('1.25', 18), 1250000000000000000n));
test('decimalToAtomic 8 decimals', () => assert.equal(decimalToAtomic('12.3456789', 8), 1234567890n));
test('RPC numeric amount', () => assert.equal(rpcAmountToAtomic(0.00000001, 8), 1n));
test('atomicToDecimal', () => assert.equal(atomicToDecimal(150000000n, 8), '1.5'));
