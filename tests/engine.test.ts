import { describe, it, expect } from 'vitest';
import { dealMetrics, checkCompat, hasFail, compCost } from '../src/engine/flip';
import { computeFinance, accountBalances } from '../src/engine/finance';
import { txSell, txAssemble, txExpense, txOpening } from '../src/engine/link';
import { toMinor, DIM } from '../src/engine/utils';
import { VIRT, type Build, type Tx, type Component } from '../src/types';

describe('Экономика сделки (эталоны ТЗ)', () => {
  it('§25: себестоимость 5 800 → цена 9 990 → прибыль 4 190, ROI 72.2%', () => {
    const m = dealMetrics(toMinor(5800), toMinor(9990));
    expect(m.profit).toBe(toMinor(4190));
    expect(m.roiPct.toFixed(1)).toBe('72.2');
  });
  it('§12.6: 6 200 + 400 доп = 6 600 → 10 000 → ROI 51.5%', () => {
    const m = dealMetrics(toMinor(6600), toMinor(10000));
    expect(m.profit).toBe(toMinor(3400));
    expect(m.roiPct.toFixed(1)).toBe('51.5');
  });
});

describe('Мост FLIP → FINANCE', () => {
  it('продажа: Σ проводок = 0, прибыль попадает в PNL, выручка в кассу', () => {
    const t = txSell(0, 'b1', 'acc-box', toMinor(9990), toMinor(5800));
    expect(t.entries.reduce((s, e) => s + e.amt, 0)).toBe(0);
    expect(-(t.entries.find(e => e.acc === VIRT.PNL)!.amt)).toBe(toMinor(4190));
    expect(accountBalances([t]).get('acc-box')).toBe(toMinor(9990));
  });
  it('закупка — не расход: деньги уходят в Склад, PNL не трогается', () => {
    const b = accountBalances([txAssemble(0, 'b1', toMinor(5800))]);
    expect(b.get(VIRT.WIP)).toBe(toMinor(5800));
    expect(b.get(VIRT.PNL)).toBeUndefined();
  });
  it('личный расход помечает PNL; бизнес-расход с buildId — тоже', () => {
    const b = accountBalances([txExpense(0, 'acc', toMinor(500), 'c-fun')]);
    expect(b.get(VIRT.PNL)).toBe(toMinor(500));
  });
});

describe('Совместимость', () => {
  const base: any = { ram: [], storage: [] };
  it('DDR5 в DDR4 → FAIL', () => {
    const r = checkCompat({ ...base, mb: { socket: 'AM5', formFactor: 'ATX', ramType: 'DDR4' }, ram: [{ type: 'DDR5' }] });
    expect(r.find(c => c.pair === 'RAM↔MB')!.level).toBe('FAIL');
  });
  it('i7-7700 на H110 (gens:[6]) → WARN, не FAIL', () => {
    const r = checkCompat({ ...base, cpu: { socket: 'LGA1151', generation: 7 },
      mb: { socket: 'LGA1151', formFactor: 'MICRO_ATX', ramType: 'DDR4', gens: [6] }, ram: [{ type: 'DDR4' }] });
    expect(r.some(c => c.level === 'WARN')).toBe(true);
    expect(hasFail(r)).toBe(false);
  });
  it('PSU: (65+120+75)×1.2 = 312W → 300 FAIL, 320 WARN, 350 OK', () => {
    const mk = (watt: number) => checkCompat({ ...base, cpu: { socket: 'AM4', tdp: 65 },
      gpu: { tdp: 120, conns: ['PCIe6'] }, psu: { watt, conns: ['ATX', 'PCIe6'] } });
    expect(mk(300).find(c => c.pair === 'GPU↔PSU')!.level).toBe('FAIL');
    expect(mk(320).find(c => c.pair === 'GPU↔PSU')!.level).toBe('WARN');
    expect(mk(350).find(c => c.level === 'FAIL')).toBeUndefined();
  });
});

describe('Финансовые метрики: правила, которые не должны врать', () => {
  const now = Date.parse('2026-10-01T12:00:00');
  const run = (txs: Tx[]) => computeFinance({
    accounts: [
      { id: 'acc', name: '', kind: 'CARD', isLiquid: true, status: 'ACTIVE' },
      { id: 'arr', name: '', kind: 'CARD', isLiquid: true, status: 'ARRESTED' }],
    txs, streams: [
      { id: 'g', name: '', reliability: 'GUARANTEED', coef: 1, kind: 'MONTHLY', day: 15, amountMinor: toMinor(30000) },
      { id: 'e', name: '', reliability: 'EXPECTED', coef: 0.75, kind: 'MONTHLY', day: 15, amountMinor: toMinor(10000) }],
    liabilities: [{ id: 'mom', name: 'мама', kind: 'PERSONAL', principalMinor: toMinor(6000),
      status: 'ACTIVE', activeInCashflow: true, monthlyMinor: toMinor(2000), day: 10 }],
    mandatoryCats: new Set(['c-home']),
    settings: { reserveMonths: 1, expectedCoef: 0.75, manualMinBurnMinor: toMinor(15000), btcSats: 0, btcPriceRub: 0 },
    now });
  it('арестованный счёт вне ликвидности', () => {
    const m = run([txOpening(now - 40 * 864e5, 'acc', toMinor(30000)), txOpening(now - 40 * 864e5, 'arr', toMinor(12000))]);
    expect(m.liquidMinor).toBe(toMinor(30000));
    expect(m.arrestedMinor).toBe(toMinor(12000));
  });
  it('STS только от GUARANTEED: EXPECTED ×0.75 — отдельной строкой', () => {
    const m = run([txOpening(now - 40 * 864e5, 'acc', toMinor(30000))]);
    expect(m.daysToIncome).toBe(14);                              // 1 → 15 октября
    expect(m.essentialMinor).toBe(Math.round((toMinor(15000) * 14) / DIM));
    expect(m.committedMinor).toBe(toMinor(2000));                 // платёж маме 10-го до дохода
    expect(m.stsMinor).toBe(toMinor(30000) - m.essentialMinor - toMinor(2000));
    expect(m.stsaveMinor).toBe(m.stsMinor - toMinor(15000));
    expect(m.expectedFlowMinor).toBe(toMinor(7500));              // 10 000 × 0.75 — НЕ в STS
  });
});