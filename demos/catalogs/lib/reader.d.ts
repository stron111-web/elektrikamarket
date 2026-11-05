declare module '*.cjs' {
  import type postgres from 'postgres';
  export function readCatalog(tx: postgres.TransactionSql, filters: import('./types').Filters): Promise<import('./types').Catalog>;
  export function activeAssortment(tx: postgres.TransactionSql): Promise<{ id: string; productCount: number; createdAt: Date }>;
  export function attachSnapshotOffers(tx: postgres.TransactionSql, id: string, rows: unknown[]): Promise<import('./types').Item[]>;
}
