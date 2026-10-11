declare module '*.cjs' {
  import type postgres from 'postgres';
  export function readStorefrontPrices(db: postgres.TransactionSql, codes: string[]): Promise<import('./data').Price[]>;
  export function readAvailableStocks(db: postgres.TransactionSql, codes: string[]): Promise<(import('./data').Stock & { supplierCode: string })[]>;
  export function availabilitySql(db: postgres.TransactionSql, scope: postgres.PendingQuery<postgres.Row[]>): Promise<{ query: postgres.PendingQuery<postgres.Row[]> }>;
}
