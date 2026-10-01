import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from './db';
import { computeFinance, accountBalances } from './engine/finance';
import { compCost, fullCost } from './engine/flip';
import { toMinor } from './engine/utils';
import { VIRT, type Build } from './types';

export function useData() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const txs = useLiveQuery(() => db.txs.toArray(), []) ?? [];
  const streams = useLiveQuery(() => db.streams.toArray(), []) ?? [];
  const lias = useLiveQuery(() => db.liabilities.toArray(), []) ?? [];
  const comps = useLiveQuery(() => db.components.toArray(), []) ?? [];
  const builds = useLiveQuery(() => db.builds.toArray(), []) ?? [];
  const kv = useLiveQuery(() => db.kv.toArray(), []) ?? [];
  const S = useMemo(() => Object.fromEntries(kv.map(r => [r.k, r.v])), [kv]);

  const bal = useMemo(() => accountBalances(txs), [txs]);
  const m = useMemo(() => computeFinance({
    accounts, txs, streams, liabilities: lias,
    mandatoryCats: new Set(cats.filter(c => c.mandatory).map(c => c.id)),
    settings: { reserveMonths: S.reserveMonths ?? 1, expectedCoef: S.expectedCoef ?? 0.75,
      manualMinBurnMinor: toMinor(S.manualMinBurn ?? 0), btcSats: S.btcSats ?? 0, btcPriceRub: S.btcPriceRub ?? 0 },
    now: Date.now(),
  }), [accounts, txs, streams, lias, cats, S]);

  const compById = useMemo(() => new Map(comps.map(c => [c.id, c])), [comps]);
  const cc = useMemo(() => (b: Build) => compCost(b, compById), [compById]);
  const fc = useMemo(() => (b: Build) => fullCost(b, compById), [compById]);

  // сверка GL ↔ склада (расхождение = ошибка учёта, показываем баннером)
  const mismatch = useMemo(() => {
    const stockVal = comps.filter(c => c.status === 'IN_STOCK').reduce((s, c) => s + c.priceMinor, 0);
    const wipVal = builds.filter(b => b.status !== 'SOLD').reduce((s, b) => s + cc(b), 0);
    return (bal.get(VIRT.INVENTORY) ?? 0) !== stockVal || (bal.get(VIRT.WIP) ?? 0) !== wipVal;
  }, [bal, comps, builds, cc]);

  return { accounts, cats, txs, streams, lias, comps, builds, S, bal, m, compById, cc, fc, mismatch };
}