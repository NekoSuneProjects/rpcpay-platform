export function decimalToAtomic(value, decimals) {
  const trimmed = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error('Invalid decimal amount');
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) throw new Error(`Too many decimal places; max is ${decimals}`);
  const padded = fraction.padEnd(decimals, '0');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

export function rpcAmountToAtomic(value, decimals) {
  if (typeof value === 'number') return decimalToAtomic(value.toFixed(decimals), decimals);
  return decimalToAtomic(String(value), decimals);
}

export function atomicToDecimal(value, decimals) {
  const n = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const fraction = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
