import { VIRT } from '../types';
import type { Account, Tx, IncomeStream, Liability } from '../types';
import { median, daysBetween, DIM, type Minor } from './utils';

export function accountBalances(txs: Tx[]): Map<string, Minor> {
  const m = new Map<string, Minor>();
  for (const t of txs) for (const e of t.entries) m.set(e.acc, (m.get(e.acc) ?? 0) + e.amt);
  return m;
}
export const checkTx = (t: Tx) => t.entries.reduce((s, e) => s + e.amt, 0) === 0;

export interface Metrics {
  liquidMinor: Minor; arrestedMinor: Minor; btcMinor: Minor; inventoryMinor: Minor; buildsMinor: Minor; totalMinor: Minor;
  netWorthCfMinor: Minor; netWorthFullMinor: Minor;
  minBurnMinor: Minor; normBurnMinor: Minor; runwayMinDays: number | null; runwayNormDays: number | null;
  daysToIncome: number | null; nextIncomeTs: number | null;
  essentialMinor: Minor; committedMinor: Minor; stsMinor: Minor; stsaveMinor: Minor; expectedFlowMinor: Minor;
  savingsRate: number | null; bizRevenueMonth: Minor; bizProfitMonth: Minor; salesMonth: number;
}

export function nextGuaranteed(streams: IncomeStream[], now: number): number | null {
  let best: number | null = null;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  for (const s of streams) {
    if (s.reliability !== 'GUARANTEED') continue;
    let t: number | null = null;
    if (s.kind === 'MONTHLY' && s.day) {
      for (let m = 0; m <= 1; m++) {
        const y = today.getFullYear(), mo = today.getMonth() + m;
        const dim = new Date(y, mo + 1, 0).getDate();
        const d = new Date(y, mo, Math.min(s.day, dim)).getTime();
        if (d >= today.getTime()) { t = d; break; }
      }
    } else if (s.kind === 'ONCE' && s.date) {
      const d = new Date(s.date + 'T00:00:00').getTime();
      if (d >= today.getTime()) t = d;
    }
    if (t != null && (best == null || t < best)) best = t;
  }
  return best;
}

function burnBuckets(txs: Tx[], mand: Set<string>, now: number) {
  const M: number[] = [], O: number[] = [];
  for (let i = 0; i < 3; i++) {
    const from = now - (i + 1) * 30 * 86_400_000, to = now - i * 30 * 86_400_000;
    let m = 0, o = 0;
    for (const t of txs) {
      if (t.type !== 'EXPENSE' || t.ts <= from || t.ts > to || t.buildId) continue;
      const amt = t.entries.filter(e => !isV(e.acc)).reduce((s, e) => s - e.amt, 0);
      if (amt <= 0) continue;
      if (t.categoryId && mand.has(t.categoryId)) m += amt; else o += amt;
    }
    M.push(m); O.push(o);
  }
  return { M, O };
}
const isV = (id: string) => id.startsWith('virt:');

export function computeFinance(inp: {
  accounts: Account[]; txs: Tx[]; streams: IncomeStream[]; liabilities: Liability[];
  mandatoryCats: Set<string>;
  settings: { reserveMonths: number; expectedCoef: number; manualMinBurnMinor: Minor; btcSats: number; btcPriceRub: number };
  now: number;
}): Metrics {
  const { accounts, txs, streams, liabilities, mandatoryCats, settings: S, now } = inp;
  const bal = accountBalances(txs);

  let liquid = 0, arrested = 0;
  for (const a of accounts) {
    const b = bal.get(a.id) ?? 0;
    if (a.status === 'ARRESTED') { arrested += Math.max(0, b); continue; }
    if (a.status === 'ACTIVE' && a.isLiquid) liquid += b;
  }
  const btcMinor = S.btcPriceRub > 0 ? Math.round((S.btcSats / 1e8) * S.btcPriceRub * 100) : 0;
  const inventoryMinor = bal.get(VIRT.INVENTORY) ?? 0;
  const buildsMinor = bal.get(VIRT.WIP) ?? 0;
  const totalMinor = liquid + btcMinor + inventoryMinor + buildsMinor;

  let liaA = 0, liaF = 0;
  for (const l of liabilities) { liaF += l.principalMinor; if (l.activeInCashflow) liaA += l.principalMinor; }

  const { M, O } = burnBuckets(txs, mandatoryCats, now);
  const minBurn = Math.max(S.manualMinBurnMinor, Math.round(median(M)));
  const normBurn = minBurn + Math.max(0, Math.round(median(O)));
  const runwayMinDays = minBurn > 0 ? liquid / (minBurn / DIM) : null;
  const runwayNormDays = normBurn > 0 ? liquid / (normBurn / DIM) : null;

  const nextIncomeTs = nextGuaranteed(streams, now);
  const daysToIncome = nextIncomeTs != null ? daysBetween(now, nextIncomeTs) : null;
  const essentialMinor = daysToIncome != null ? Math.round((minBurn * daysToIncome) / DIM) : minBurn;

  let committedMinor = 0;
  for (const l of liabilities) {
    if (!l.activeInCashflow || !l.monthlyMinor) continue;
    committedMinor += countPay(l.day, now, nextIncomeTs) * l.monthlyMinor;
  }
  const stsMinor = Math.max(0, liquid - essentialMinor - committedMinor);
  const stsaveMinor = Math.max(0, stsMinor - Math.round(minBurn * S.reserveMonths));

  let expectedFlowMinor = 0;
  for (const s of streams) if (s.reliability === 'EXPECTED') expectedFlowMinor += Math.round(s.amountMinor * s.coef);

  // месяц: личный SR + бизнес-итог (из PNL-проводок, без двойного счёта)
  const start = new Date(now); start.setDate(1); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  let inc = 0, cons = 0, rev = 0, profit = 0, sales = 0;
  for (const t of txs) {
    if (t.ts < t0) continue;
    if (t.type === 'INCOME') inc += t.entries.filter(e => !isV(e.acc)).reduce((s, e) => s + e.amt, 0);
    if (t.type === 'EXPENSE' && !t.buildId) cons += t.entries.filter(e => !isV(e.acc)).reduce((s, e) => s - e.amt, 0);
    if (t.type === 'SELL_BUILD') {
      profit += -(t.entries.find(e => e.acc === VIRT.PNL)?.amt ?? 0);
      rev += t.entries.filter(e => !isV(e.acc)).reduce((s, e) => s + e.amt, 0);
      sales++;
    }
    if (t.type === 'EXPENSE' && t.buildId)
      profit -= t.entries.filter(e => !isV(e.acc)).reduce((s, e) => s - e.amt, 0);
  }

  return { liquidMinor: liquid, arrestedMinor: arrested, btcMinor, inventoryMinor, buildsMinor, totalMinor,
    netWorthCfMinor: totalMinor - liaA, netWorthFullMinor: totalMinor - liaF,
    minBurnMinor: minBurn, normBurnMinor: normBurn, runwayMinDays, runwayNormDays,
    daysToIncome, nextIncomeTs, essentialMinor, committedMinor, stsMinor, stsaveMinor, expectedFlowMinor,
    savingsRate: inc > 0 ? (inc - cons) / inc : null,
    bizRevenueMonth: rev, bizProfitMonth: profit, salesMonth: sales };
}

function countPay(day: number | undefined, now: number, until: number | null): number {
  if (!day || until == null) return 1;
  let c = 0; const n = new Date(now);
  for (let m = 0; m <= 1; m++) {
    const y = n.getFullYear(), mo = n.getMonth() + m;
    const dim = new Date(y, mo + 1, 0).getDate();
    const t = new Date(y, mo, Math.min(day, dim)).getTime();
    if (t > now && t <= until) c++;
  }
  return c;
}