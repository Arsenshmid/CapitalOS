import { db } from './db';
import { txOpening, txExpense, txIncome, txPurchase, txAssemble } from './engine/link';
import { toMinor, uid, DAY, todayISO } from './engine/utils';
import type { Component } from './types';

export async function seedDemo() {
  const now = Date.now();
  await db.accounts.bulkPut([
    { id: 'acc-card', name: 'Карта (личная)', kind: 'CARD', isLiquid: true, status: 'ACTIVE' },
    { id: 'acc-cash', name: 'Наличные', kind: 'CASH', isLiquid: true, status: 'ACTIVE' },
    { id: 'acc-box', name: 'Касса бизнеса', kind: 'CASHBOX', isLiquid: false, status: 'ACTIVE' },
    { id: 'acc-arr', name: 'Карта (арестована)', kind: 'CARD', isLiquid: true, status: 'ARRESTED' },
  ]);
  await db.categories.bulkPut([
    { id: 'c-home', name: 'Жильё', mandatory: true }, { id: 'c-food', name: 'Еда', mandatory: true },
    { id: 'c-tr', name: 'Транспорт', mandatory: true }, { id: 'c-comm', name: 'Связь', mandatory: true },
    { id: 'c-fun', name: 'Развлечения', mandatory: false }, { id: 'c-tech', name: 'Техника', mandatory: false },
  ]);
  const txs = [
    txOpening(now - 45 * DAY, 'acc-card', toMinor(25000)), txOpening(now - 45 * DAY, 'acc-cash', toMinor(8000)),
    txOpening(now - 45 * DAY, 'acc-arr', toMinor(12000)),
  ];
  for (let i = 1; i <= 3; i++) { // три месяца истории для burn
    const d = (x: number) => now - i * 30 * DAY + x * DAY;
    txs.push(txExpense(d(2), 'acc-card', toMinor(9000), 'c-home'), txExpense(d(6), 'acc-card', toMinor(6300), 'c-food'),
      txExpense(d(10), 'acc-card', toMinor(1500), 'c-tr'), txExpense(d(12), 'acc-card', toMinor(700), 'c-comm'));
  }
  txs.push(txExpense(now - 4 * DAY, 'acc-card', toMinor(1800), 'c-fun'));
  txs.push(txIncome(now - 12 * DAY, 'acc-card', toMinor(30000)));
  txs.push(txPurchase(now - 6 * DAY, 'acc-card', toMinor(2500), 'Комплект MB+CPU+RAM (Иван)'));
  txs.push(txPurchase(now - 5 * DAY, 'acc-cash', toMinor(3300), 'HDD, БП, корпус, SSD (Авито)'));
  await db.txs.bulkPut(txs);

  await db.streams.bulkPut([
    { id: 's1', name: 'Основной доход', reliability: 'GUARANTEED', coef: 1, kind: 'MONTHLY', day: 15, amountMinor: toMinor(30000) },
    { id: 's2', name: 'Продажи ПК (вероятно)', reliability: 'EXPECTED', coef: 0.75, kind: 'MONTHLY', day: 25, amountMinor: toMinor(10000) },
  ]);
  await db.liabilities.bulkPut([
    { id: 'l1', name: 'Долг маме', kind: 'PERSONAL', principalMinor: toMinor(6000),
      status: 'ACTIVE', activeInCashflow: true, monthlyMinor: toMinor(2000), day: 20 },
    { id: 'l2', name: 'Кредит банка X (в процедуре)', kind: 'CREDIT', principalMinor: toMinor(350000),
      status: 'LEGAL_FROZEN', activeInCashflow: false },
  ]);
  const C = (id: string, category: any, brand: string, model: string, price: number, specs: any): Component => ({
    id, category, brand, model, condition: 'USED', priceMinor: toMinor(price), date: todayISO(),
    status: 'IN_STOCK', specs });
  const comps: Component[] = [
    C('cp1', 'CPU', 'Intel', 'Core i3-6100', 1000, { socket: 'LGA1151', generation: 6, tdp: 51 }),
    C('cm1', 'MB', 'MSI', 'H110M PRO-VD PLUS', 1000, { socket: 'LGA1151', formFactor: 'MICRO_ATX',
      ramType: 'DDR4', maxRamGb: 32, dimmSlots: 2, maxMemFreq: 2133, sata: 4, gens: [6, 7] }),
    C('cr1', 'RAM', 'Kingston', 'DDR4 2×4GB 2133', 500, { type: 'DDR4', moduleSizeGb: 4, moduleCount: 2, freqMhz: 2133 }),
    C('ch1', 'STORAGE', 'WD', 'WD3200BPVT 320GB', 500, { kind: 'HDD', iface: 'SATA', gb: 320 }),
    C('cs1', 'STORAGE', 'Kingston', 'A400 240GB', 800, { kind: 'SSD', iface: 'SATA', gb: 240 }),
    C('cps1', 'PSU', 'FSP', 'ATX-450PNR 450W', 1200, { watt: 450, conns: ['ATX', 'EPS', 'PCIe6'] }),
    C('cc1', 'CASE', 'Zalman', 'i3 NEO mATX', 800, { boards: ['MICRO_ATX', 'MINI_ITX'], gpuMm: 320, coolerMm: 160 }),
  ];
  await db.components.bulkPut(comps);
  const buildId = uid();
  await db.txs.add(txAssemble(now - 4 * DAY, buildId, toMinor(5800))); // 5 800 ₽ в WIP
  await db.builds.add({ id: buildId, num: 1, status: 'FOR_SALE',
    componentIds: comps.map(c => c.id), extras: [], targetPriceMinor: toMinor(9990), assembledAt: todayISO() });
  await db.components.bulkPut(comps.map(c => ({ ...c, status: 'INSTALLED', buildId })));
  await db.kv.bulkPut([
    { k: 'reserveMonths', v: 1 }, { k: 'expectedCoef', v: 0.75 },
    { k: 'manualMinBurn', v: 0 }, { k: 'btcSats', v: 0 }, { k: 'btcPriceRub', v: 0 },
  ]);
}