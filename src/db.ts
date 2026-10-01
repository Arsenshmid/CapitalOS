import Dexie, { type Table } from 'dexie';
import type { Account, Category, Tx, IncomeStream, Liability, Component, Build } from './types';

export class DB extends Dexie {
  accounts!: Table<Account, string>; categories!: Table<Category, string>; txs!: Table<Tx, string>;
  streams!: Table<IncomeStream, string>; liabilities!: Table<Liability, string>;
  components!: Table<Component, string>; builds!: Table<Build, string>;
  kv!: Table<{ k: string; v: any }, string>;
  constructor() {
    super('capital-os');
    this.version(1).stores({
      accounts: 'id', categories: 'id',
      txs: 'id, ts, type, buildId, categoryId',
      streams: 'id', liabilities: 'id',
      components: 'id, category, status, buildId',
      builds: 'id, num, status', kv: 'k',
    });
  }
}
export const db = new DB();