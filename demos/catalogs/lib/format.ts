export const unit = (uom: string) => ({ PCE: 'шт.', MTR: 'м', NMP: 'уп.', KGM: 'кг', KMT: 'км', MTK: 'м²' }[uom] ?? uom);
export const number = (value: unknown) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 8 }).format(Number(value));
export const money = (value: string) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(value));
