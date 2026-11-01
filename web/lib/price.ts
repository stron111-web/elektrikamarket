/** Розничная цена минус процент скидки, до копеек, половина вверх. Закупку не читает и не показывает. */
export function discounted(retail: string, percent: string) {
  const kopecks = toHundredths(retail);
  const percentHundredths = toHundredths(percent);
  if (percentHundredths <= 0n) return retail;
  const factor = 10000n - percentHundredths;
  const next = (kopecks * factor + 5000n) / 10000n;
  const whole = next / 100n;
  const frac = (next % 100n).toString().padStart(2, '0');
  return `${whole}.${frac}`;
}

function toHundredths(value: string) {
  const [whole, frac = ''] = value.trim().split('.');
  const sign = whole.startsWith('-') ? -1n : 1n;
  const digits = whole.replace('-', '') || '0';
  return sign * (BigInt(digits) * 100n + BigInt((frac + '00').slice(0, 2)));
}

function fromHundredths(kopecks: bigint) {
  const whole = kopecks / 100n;
  const frac = (kopecks % 100n).toString().padStart(2, '0');
  return `${whole}.${frac}`;
}

/** Цена за единицу умножить на количество. Количество уже приведено к масштабу scale. */
export function totalOf(unitPrice: string, quantity: bigint, scale: bigint) {
  const next = (toHundredths(unitPrice) * quantity + scale / 2n) / scale;
  return fromHundredths(next);
}

export function sumMoney(values: string[]) {
  return fromHundredths(values.reduce((total, value) => total + toHundredths(value), 0n));
}
