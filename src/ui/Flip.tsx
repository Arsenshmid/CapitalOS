import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { checkCompat, hasFail, dealMetrics, specLine, compCost, type Parts, type Check } from '../engine/flip';
import { txPurchase, txAssemble, txUnassemble, txSell, txExpense } from '../engine/link';
import { fmtMinor, fmtPct, toMinor, uid, todayISO, type Minor } from '../engine/utils';
import type { Account, Build, Component, CompCat } from '../types';

const CATS: CompCat[] = ['CPU', 'MB', 'RAM', 'GPU', 'STORAGE', 'PSU', 'CASE', 'COOLER'];
const CAT_LABELS: Record<CompCat, string> = {
  CPU: 'Процессор', MB: 'Материнская плата', RAM: 'Оперативная память', GPU: 'Видеокарта',
  STORAGE: 'Накопитель', PSU: 'Блок питания', CASE: 'Корпус', COOLER: 'Охлаждение',
};
const CONDITION_LABELS = { NEW: 'Новая', USED: 'Б/у', REFURB: 'Восстановленная', UNKNOWN: 'Не указано' } as const;
const PAIR_LABELS: Record<string, string> = {
  'CPU↔MB': 'Процессор и материнская плата', 'RAM↔MB': 'Память и материнская плата',
  'MB↔Case': 'Материнская плата и корпус', 'GPU↔PSU': 'Видеокарта и блок питания',
  'GPU↔Case': 'Видеокарта и корпус', 'Cooler↔CPU': 'Кулер и процессор',
  'Cooler↔Case': 'Кулер и корпус', 'Storage↔MB': 'Накопители и материнская плата',
};

export default function Flip() {
  const [tab, setTab] = useState<'stock' | 'buy' | 'build'>('stock');
  const comps = useLiveQuery(() => db.components.toArray(), []) ?? [];
  const builds = useLiveQuery(() => db.builds.toArray(), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const boxAcc = accounts.find(a => a.kind === 'CASHBOX')?.id ?? accounts[0]?.id ?? '';
  const byId = useMemo(() => new Map(comps.map(c => [c.id, c])), [comps]);

  return (
    <div>
      <div className="actions">
        <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>Склад и сборки</button>
        <button className={tab === 'buy' ? 'on' : ''} onClick={() => setTab('buy')}>＋ Добавить покупку</button>
        <button className={tab === 'build' ? 'on' : ''} onClick={() => setTab('build')}>Собрать компьютер</button>
      </div>
      {tab === 'stock' && <Stock comps={comps} builds={builds} byId={byId} boxAcc={boxAcc} />}
      {tab === 'buy' && <PurchaseForm accounts={accounts} />}
      {tab === 'build' && <Configurator comps={comps} builds={builds} byId={byId} />}
    </div>
  );
}

// ── ЗАКУПКА: позиции падают на склад + проводка «деньги → Склад» ──
function PurchaseForm({ accounts }: { accounts: Account[] }) {
  const [seller, setSeller] = useState(''); const [payAcc, setPayAcc] = useState('');
  const [items, setItems] = useState([{ cat: 'CPU', brand: '', model: '', price: '', cond: 'USED' }]);
  const total = items.reduce((s, i) => s + (+i.price || 0), 0);
  const accId = payAcc || accounts[0]?.id || '';
  const upd = (k: number, patch: any) => setItems(items.map((x, j) => j === k ? { ...x, ...patch } : x));

  const save = async () => {
    if (total <= 0) return;
    await db.transaction('rw', [db.components, db.txs], async () => {
      await db.components.bulkPut(items.map(i => ({
        id: uid(), category: i.cat, brand: i.brand, model: i.model, condition: i.cond,
        priceMinor: toMinor(+i.price), date: todayISO(), seller, status: 'IN_STOCK', specs: {},
      } as Component)));
      await db.txs.add(txPurchase(Date.now(), accId, toMinor(total), `Закупка: ${seller || '—'}`));
    });
    setItems([{ cat: 'CPU', brand: '', model: '', price: '', cond: 'USED' }]); setSeller('');
  };

  return (
    <div className="card">
      <h3>Добавим детали на склад</h3>
      <input placeholder="У кого купили (необязательно)" value={seller} onChange={e => setSeller(e.target.value)} />
      <select value={accId} onChange={e => setPayAcc(e.target.value)}>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {items.map((it, k) => (
        <div key={k} className="frm">
          <select value={it.cat} onChange={e => upd(k, { cat: e.target.value })}>{CATS.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}</select>
          <input placeholder="Производитель" value={it.brand} onChange={e => upd(k, { brand: e.target.value })} />
          <input placeholder="Модель" value={it.model} onChange={e => upd(k, { model: e.target.value })} />
          <select value={it.cond} onChange={e => upd(k, { cond: e.target.value })}>
            {Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input type="number" placeholder="₽" value={it.price} onChange={e => upd(k, { price: e.target.value })} />
          <button onClick={() => setItems(items.filter((_, j) => j !== k))}>✕</button>
        </div>))}
      <button onClick={() => setItems([...items, { cat: 'CPU', brand: '', model: '', price: '', cond: 'USED' }])}>＋ Добавить деталь</button>
      <div>Сумма покупки: <b>{fmtMinor(toMinor(total))}</b> · Добавьте каждую деталь отдельной строкой.</div>
      <button className="primary" disabled={total <= 0} onClick={save}>Сохранить покупку</button>
    </div>);
}

// ── КОНФИГУРАТОР: живая совместимость + создание сборки одной транзакцией ──
function partsOf(list: Component[]): Parts {
  const one = (k: string) => list.find(c => c.category === k)?.specs;
  return { cpu: one('CPU'), mb: one('MB'), gpu: one('GPU'), psu: one('PSU'), case_: one('CASE'), cooler: one('COOLER'),
    ram: list.filter(c => c.category === 'RAM').map(c => c.specs),
    storage: list.filter(c => c.category === 'STORAGE').map(c => c.specs) };
}

function Configurator({ comps, builds, byId }: { comps: Component[]; builds: Build[]; byId: Map<string, Component> }) {
  const stock = comps.filter(c => c.status === 'IN_STOCK');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const chosen = [...sel].map(id => byId.get(id)!).filter(Boolean);
  const parts = useMemo(() => partsOf(chosen), [sel, byId]);
  const checks: Check[] = useMemo(() => (sel.size ? checkCompat(parts) : []), [parts, sel]);
  const cost: Minor = chosen.reduce((s, c) => s + c.priceMinor, 0);
  const dm = dealMetrics(cost, toMinor(+target || 0));
  const fail = hasFail(checks);

  const create = async () => {
    if (!sel.size || +target <= 0 || fail) return;
    const n = builds.reduce((mx, b) => Math.max(mx, b.num), 0) + 1;
    const id = uid();
    await db.transaction('rw', [db.builds, db.components, db.txs], async () => {
      await db.builds.add({ id, num: n, status: 'FOR_SALE', componentIds: [...sel],
        extras: [], targetPriceMinor: toMinor(+target), assembledAt: todayISO() });
      await db.components.bulkPut([...sel].map(sid => ({ ...byId.get(sid)!, status: 'INSTALLED', buildId: id })));
      await db.txs.add(txAssemble(Date.now(), id, cost)); // ← проводка в финансы
    });
    setSel(new Set()); setTarget('');
  };

  return (
    <div>
      <table className="tbl"><thead><tr><th></th><th>Деталь</th><th>Категория</th><th>Цена</th></tr></thead><tbody>
        {stock.map(c => <tr key={c.id}>
          <td><input type="checkbox" checked={sel.has(c.id)} onChange={e => {
            const s = new Set(sel); e.target.checked ? s.add(c.id) : s.delete(c.id); setSel(s); }} /></td>
          <td>{c.brand} {c.model}</td><td>{CAT_LABELS[c.category]}</td><td>{fmtMinor(c.priceMinor)}</td>
        </tr>)}
      </tbody></table>
      <div className="card">
        <div className="frm">
          <label>За сколько планируете продать? <input type="number" placeholder="Цена, ₽" value={target} onChange={e => setTarget(e.target.value)} /></label>
        </div>
        <div>Затраты: <b>{fmtMinor(cost)}</b> · Возможная прибыль: <b>{fmtMinor(dm.profit)}</b> · Доходность: <b>{fmtPct(dm.roiPct)}</b></div>
        {checks.map((c, i) => <div key={i}>{c.level === 'OK' ? '🟢' : c.level === 'WARN' ? '🟡' : '🔴'} {PAIR_LABELS[c.pair] ?? c.pair} — {c.msg}</div>)}
        <button className="primary" disabled={!sel.size || +target <= 0 || fail} onClick={create}>
          {fail ? 'Проверьте совместимость деталей' : 'Собрать и выставить на продажу'}
        </button>
      </div>
    </div>);
}

// ── СКЛАД/СБОРКИ: продажа одной кнопкой — 3 проводки + статусы атомарно ──
function Stock({ comps, builds, byId, boxAcc }: {
  comps: Component[]; builds: Build[]; byId: Map<string, Component>; boxAcc: string;
}) {
  const [sell, setSell] = useState<Record<string, { p: string; f: string; x: string }>>({});
  const doSell = async (b: Build) => {
    const s = sell[b.id]; if (!s || +s.p <= 0) return;
    const list = b.componentIds.map(id => byId.get(id)!).filter(Boolean);
    const cc = compCost(b, byId);
    await db.transaction('rw', [db.builds, db.components, db.txs], async () => {
      const ops = [txSell(Date.now(), b.id, boxAcc, toMinor(+s.p), cc, toMinor(+s.f || 0))];
      if (+s.x > 0) ops.push(txExpense(Date.now(), boxAcc, toMinor(+s.x), undefined, `Доп.расход ПК#${b.num}`, b.id));
      await db.txs.bulkPut(ops);
      await db.builds.update(b.id, { status: 'SOLD', soldAt: todayISO() });
      await db.components.bulkPut(list.map(c => ({ ...c, status: 'SOLD' })));
    });
    setSell({ ...sell, [b.id]: { p: '', f: '', x: '' } });
  };
  const disassemble = async (b: Build) => {
    const list = b.componentIds.map(id => byId.get(id)!).filter(Boolean);
    await db.transaction('rw', [db.builds, db.components, db.txs], async () => {
      await db.txs.add(txUnassemble(Date.now(), b.id, compCost(b, byId)));
      await db.builds.update(b.id, { status: 'STALLED' });
      await db.components.bulkPut(list.map(c => ({ ...c, status: 'IN_STOCK', buildId: undefined })));
    });
  };

  return (
    <div>
      {builds.map(b => {
        const cc = compCost(b, byId), fc = cc + b.extras.reduce((s, e) => s + e.amt, 0);
        const dm = dealMetrics(fc, b.targetPriceMinor ?? 0);
        const s = sell[b.id] ?? { p: '', f: '', x: '' };
        return (
          <div key={b.id} className="card">
            <b>ПК #{String(b.num).padStart(3, '0')}</b> · {specLine(b.componentIds.map(id => byId.get(id)!).filter(Boolean))}
            <div className="row"><span>Статус</span><b>{b.status === 'SOLD' ? 'Продан' : b.status === 'FOR_SALE' ? 'Выставлен на продажу' : b.status === 'STALLED' ? 'Разобран' : 'Собирается'}</b></div>
            <div className="row"><span>Себестоимость / цель</span>
              <b>{fmtMinor(fc)} / {fmtMinor(b.targetPriceMinor ?? 0)}</b></div>
            {b.status !== 'SOLD' && <div className="row"><span>Прибыль / доходность при продаже</span>
              <b>{fmtMinor(dm.profit)} · {fmtPct(dm.roiPct)}</b></div>}
            {b.soldAt && <div className="muted">Продан {b.soldAt}</div>}
            {b.status === 'FOR_SALE' && (
              <div className="frm">
                <input placeholder="цена ₽" value={s.p} onChange={e => setSell({ ...sell, [b.id]: { ...s, p: e.target.value } })} />
                <input placeholder="комиссия ₽" value={s.f} onChange={e => setSell({ ...sell, [b.id]: { ...s, f: e.target.value } })} />
                <input placeholder="доп.расход ₽" value={s.x} onChange={e => setSell({ ...sell, [b.id]: { ...s, x: e.target.value } })} />
                <button className="primary" onClick={() => doSell(b)}>ПРОДАНО</button>
                <button onClick={() => disassemble(b)}>Разобрать</button>
              </div>)}
          </div>);
      })}
      <h3>Склад (свободные лоты)</h3>
      <table className="tbl"><thead><tr><th>Деталь</th><th>Категория</th><th>Состояние</th><th>Цена</th></tr></thead><tbody>
        {comps.filter(c => c.status === 'IN_STOCK').map(c =>
          <tr key={c.id}><td>{c.brand} {c.model}</td><td>{CAT_LABELS[c.category]}</td><td>{CONDITION_LABELS[c.condition]}</td><td>{fmtMinor(c.priceMinor)}</td></tr>)}
      </tbody></table>
    </div>);
}