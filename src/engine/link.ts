import { VIRT } from '../types';
import type { Tx, TxType, Minor } from '../types';
import { uid } from './utils';

const mk = (type: TxType, ts: number, entries: Tx['entries'], extra: Partial<Tx> = {}): Tx =>
  ({ id: uid(), ts, type, entries, ...extra });

// ── личные операции ──
export const txIncome  = (ts: number, acc: string, amt: Minor, categoryId?: string, note?: string) =>
  mk('INCOME', ts, [{ acc, amt }, { acc: VIRT.PNL, amt: -amt }], { categoryId, note });
export const txExpense = (ts: number, acc: string, amt: Minor, categoryId?: string, note?: string, buildId?: string) =>
  mk('EXPENSE', ts, [{ acc: VIRT.PNL, amt }, { acc, amt: -amt }], { categoryId, buildId, note });
export const txTransfer = (ts: number, from: string, to: string, amt: Minor, note?: string) =>
  mk('TRANSFER', ts, [{ acc: to, amt }, { acc: from, amt: -amt }], { note });
export const txOpening = (ts: number, acc: string, amt: Minor) =>
  mk('ADJUST', ts, [{ acc, amt }, { acc: VIRT.EQUITY, amt: -amt }], { note: 'Ввод остатка' });

// ── мост FLIP → FINANCE (вызывается автоматически из мастерской) ──
export const txPurchase = (ts: number, acc: string, amt: Minor, note?: string) =>      // деньги → склад (НЕ расход)
  mk('BUY_COMPONENTS', ts, [{ acc: VIRT.INVENTORY, amt }, { acc, amt: -amt }], { note });
export const txAssemble = (ts: number, buildId: string, cost: Minor) =>                 // склад → незавершёнка
  mk('ASSEMBLE', ts, [{ acc: VIRT.WIP, amt: cost }, { acc: VIRT.INVENTORY, amt: -cost }], { buildId });
export const txUnassemble = (ts: number, buildId: string, cost: Minor) =>               // разборка обратно
  mk('ADJUST', ts, [{ acc: VIRT.INVENTORY, amt: cost }, { acc: VIRT.WIP, amt: -cost }], { buildId, note: 'Разборка сборки' });
export const txSell = (ts: number, buildId: string, cashAcc: string, price: Minor, compCost: Minor, fee: Minor = 0) =>
  mk('SELL_BUILD', ts, [
    { acc: cashAcc, amt: price - fee },          // выручка в кассу бизнеса
    { acc: VIRT.WIP, amt: -compCost },           // списание себестоимости
    { acc: VIRT.PNL, amt: -(price - fee - compCost) } // прибыль признана здесь и только здесь
  ], { buildId });
export const txDraw = (ts: number, from: string, to: string, amt: Minor) =>             // бизнес → личные
  mk('DRAW', ts, [{ acc: to, amt }, { acc: from, amt: -amt }], { note: 'Вывод из бизнеса' });