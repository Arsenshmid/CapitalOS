import type { Minor } from './engine/utils';
export type { Minor };

// Виртуальные счета GL: мастерская и результат живут в одной книге с личными деньгами
export const VIRT = { EQUITY: 'virt:equity', PNL: 'virt:pnl', INVENTORY: 'virt:inventory', WIP: 'virt:wip' } as const;
export const isVirt = (id: string) => id.startsWith('virt:');

export interface Account { id: string; name: string; kind: 'CASH' | 'CARD' | 'SAVINGS' | 'CASHBOX';
  isLiquid: boolean; status: 'ACTIVE' | 'ARRESTED' | 'CLOSED'; }
export interface Category { id: string; name: string; mandatory: boolean; }

export type TxType = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'BUY_COMPONENTS' | 'ASSEMBLE' | 'SELL_BUILD' | 'DRAW' | 'ADJUST';
export interface Entry { acc: string; amt: Minor }               // + приход на счёт, − уход; Σ по Tx = 0
export interface Tx { id: string; ts: number; type: TxType; entries: Entry[];
  categoryId?: string; buildId?: string; note?: string; }

export type Reliability = 'GUARANTEED' | 'EXPECTED' | 'POSSIBLE';
export interface IncomeStream { id: string; name: string; reliability: Reliability; coef: number;
  kind: 'MONTHLY' | 'ONCE'; day?: number; date?: string; amountMinor: Minor; }

export interface Liability { id: string; name: string; kind: string; principalMinor: Minor;
  status: 'ACTIVE' | 'LEGAL_FROZEN'; activeInCashflow: boolean; monthlyMinor?: Minor; day?: number; }

export type CompCat = 'CPU' | 'MB' | 'RAM' | 'GPU' | 'STORAGE' | 'PSU' | 'CASE' | 'COOLER';
export interface Component { id: string; category: CompCat; brand: string; model: string;
  condition: 'NEW' | 'USED' | 'REFURB' | 'UNKNOWN'; priceMinor: Minor; date: string; seller?: string;
  status: 'IN_STOCK' | 'INSTALLED' | 'SOLD' | 'WRITTEN_OFF'; buildId?: string;
  specs: Record<string, any>; note?: string; }

export interface Build { id: string; num: number; status: 'ASSEMBLING' | 'FOR_SALE' | 'SOLD' | 'STALLED';
  componentIds: string[]; extras: { name: string; amt: Minor }[];
  targetPriceMinor?: Minor; assembledAt?: string; soldAt?: string; }