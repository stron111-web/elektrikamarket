declare module '*.cjs' {
  import type postgres from 'postgres';
  export function activeAssortment(db: postgres.TransactionSql): Promise<{id: string}>;
  export function readSnapshotOffers(db: postgres.TransactionSql, snapshotId: string, ids: number[]): Promise<any[]>;
  export function attachSnapshotOffers(db: postgres.TransactionSql, snapshotId: string, rows: import('./data').Product[]): Promise<import('./data').Item[]>;
  export function readCatalog(db: postgres.TransactionSql, filters: import('./data').Filters): Promise<{categories: import('./data').Category[]; brands: {id:number;name:string}[];total:number;pages:number;page:number;items:import('./data').Item[]}>;
  export function readStorefrontPrices(db: postgres.TransactionSql, codes: string[]): Promise<import('./data').Price[]>;
  export function readAvailableStocks(db: postgres.TransactionSql, codes: string[]): Promise<(import('./data').Stock & { supplierCode: string })[]>;
  export function availabilitySql(db: postgres.TransactionSql, scope: postgres.PendingQuery<postgres.Row[]>): Promise<{ query: postgres.PendingQuery<postgres.Row[]> }>;
}
