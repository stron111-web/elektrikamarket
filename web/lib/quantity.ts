const SCALE = 10n ** 10n;

/** Положительное количество до 10 знаков после запятой. Пустая строка и мусор — не количество. */
export function parseQty(value: unknown): bigint | null {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d{1,10}(\.\d{1,10})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  const scaled = BigInt(whole) * SCALE + BigInt((frac + '0000000000').slice(0, 10));
  return scaled > 0n ? scaled : null;
}

export function formatQty(value: bigint): string {
  if (value <= 0n) return '0';
  const whole = value / SCALE;
  const frac = (value % SCALE).toString().padStart(10, '0').replace(/0+$/, '');
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

/** Кратность поставщика, если она задана. Пустую не подменяем единицей: шаг тогда равен одной единице продажи. */
export function saleStep(multiplicity: unknown, raw: unknown): { step: bigint; known: boolean } {
  const parsed = parseQty(multiplicity) ?? parseQty(raw);
  if (parsed) return { step: parsed, known: true };
  return { step: SCALE, known: false };
}

export function sumQty(values: unknown[]): bigint {
  return values.reduce<bigint>((total, value) => total + (parseQty(value) ?? 0n), 0n);
}

/** Ближайшее количество, кратное шагу и не больше остатка. */
export function fitQuantity(wanted: bigint, step: bigint, stock: bigint): bigint | null {
  if (step <= 0n || stock < step) return null;
  const max = (stock / step) * step;
  let qty = wanted < step ? step : wanted;
  const rest = qty % step;
  if (rest !== 0n) {
    const down = qty - rest;
    const up = qty + (step - rest);
    qty = up - qty <= qty - down ? up : down;
    if (qty < step) qty = step;
  }
  if (qty > max) qty = max;
  return qty >= step ? qty : null;
}

export const QTY_SCALE = SCALE;
