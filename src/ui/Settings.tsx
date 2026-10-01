import { useEffect, useState } from 'react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { VIRT, type Component, type CompCat } from '../types';
import { toMinor, uid, todayISO } from '../engine/utils';

const CATS: CompCat[] = ['CPU', 'MB', 'RAM', 'GPU', 'STORAGE', 'PSU', 'CASE', 'COOLER'];

export default function Settings() {
  const kv = useLiveQuery(() => db.kv.toArray(), []) ?? [];
  const S = Object.fromEntries(kv.map(r => [r.k, r.v]));
  const [f, setF] = useState<any>({});
  useEffect(() => { setF({ btcSats: S.btcSats ?? 0, btcPriceRub: S.btcPriceRub ?? 0,
    reserveMonths: S.reserveMonths ?? 1, manualMinBurn: S.manualMinBurn ?? 0 }); }, [kv.length]);
  const put = async (k: string, v: any) => db.kv.put({ k, v });

  const cleanStart = async () => {
    if (!confirm('Удалить ВСЕ данные (включая демо) и начать с пустой программы?')) return;
    await db.transaction('rw', db.tables, async () => {
      for (const t of db.tables) await t.clear();
      await db.kv.put({ k: 'seeded', v: 1 });
    });
    location.reload();
  };

  const exportAll = async () => {
    const dump: any = { v: 1, exportedAt: new Date().toISOString() };
    for (const t of db.tables) dump[t.name] = await t.toArray();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }));
    a.download = `capital-os-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  const importAll = async (file: File) => {
    const dump = JSON.parse(await file.text());
    await db.transaction('rw', db.tables, async () => {
      for (const t of db.tables) if (Array.isArray(dump[t.name])) { await t.clear(); await t.bulkPut(dump[t.name]); }
    });
    alert('Импортировано. Обнови страницу (F5).');
  };

  return (
    <div>
      <section className="card">
        <h2>Параметры модели</h2>
        <div className="frm">
          <label>Резерв (мес): <input type="number" step="0.5" value={f.reserveMonths ?? 1}
            onChange={e => setF({ ...f, reserveMonths: +e.target.value })} /></label>
          <label>Мин. жизнь ₽/мес: <input type="number" value={f.manualMinBurn ?? 0}
            onChange={e => setF({ ...f, manualMinBurn: +e.target.value })} /></label>
          <button onClick={() => { put('reserveMonths', f.reserveMonths); put('manualMinBurn', f.manualMinBurn); }}>Сохранить</button>
        </div>
        <p className="muted">«Мин. жизнь» — сколько минимум тебе нужно в месяц (еда, жильё, связь, транспорт). От этой цифры считаются Runway и «безопасно потратить». Программа потом уточнит её сама по истории трат.</p>
      </section>

      <section className="card">
        <h2>BTC (ручной ввод)</h2>
        <div className="frm">
          <label>Sats: <input type="number" value={f.btcSats ?? 0} onChange={e => setF({ ...f, btcSats: +e.target.value })} /></label>
          <label>Цена ₽/BTC: <input type="number" value={f.btcPriceRub ?? 0} onChange={e => setF({ ...f, btcPriceRub: +e.target.value })} /></label>
          <button onClick={() => { put('btcSats', f.btcSats); put('btcPriceRub', f.btcPriceRub); }}>Сохранить</button>
        </div>
        <p className="muted">Ключи и seed-фразы приложение не принимает и не хранит — принципиально.</p>
      </section>

      <section className="card">
        <h2>Начальный склад (детали уже есть)</h2>
        <InitialStock />
      </section>

      <section className="card">
        <h2>Данные</h2>
        <div className="actions">
          <button className="primary" onClick={exportAll}>Экспорт JSON (бэкап)</button>
          <label className="btn-file">Импорт JSON<input type="file" accept=".json" hidden
            onChange={e => e.target.files?.[0] && importAll(e.target.files[0])} /></label>
          <button onClick={cleanStart}>Начать с чистого листа</button>
          <button onClick={async () => { if (confirm('Вернуть демо-данные?')) { await db.delete(); location.reload(); } }}>
            Вернуть демо
          </button>
        </div>
        <p className="muted">Данные живут только в браузере этого устройства. Экспорт раз в неделю — твоя страховка.</p>
      </section>
    </div>);
}

function InitialStock() {
  const [items, setItems] = useState([{ cat: 'CPU', brand: '', model: '', price: '', cond: 'USED' }]);
  const upd = (k: number, patch: any) => setItems(items.map((x, j) => j === k ? { ...x, ...patch } : x));
  const total = items.reduce((s, i) => s + (+i.price || 0), 0);
  const save = async () => {
    if (total <= 0) return;
    const amt = toMinor(total);
    await db.transaction('rw', [db.components, db.txs], async () => {
      await db.components.bulkPut(items.map(i => ({
        id: uid(), category: i.cat, brand: i.brand, model: i.model, condition: i.cond,
        priceMinor: toMinor(+i.price), date: todayISO(), status: 'IN_STOCK', specs: {} } as Component)));
      await db.txs.add({ id: uid(), ts: Date.now(), type: 'BUY_COMPONENTS',
        entries: [{ acc: VIRT.INVENTORY, amt }, { acc: VIRT.EQUITY, amt: -amt }], note: 'Начальный склад' });
    });
    setItems([{ cat: 'CPU', brand: '', model: '', price: '', cond: 'USED' }]);
  };
  return (
    <div>
      {items.map((it, k) => (
        <div key={k} className="frm">
          <select value={it.cat} onChange={e => upd(k, { cat: e.target.value })}>{CATS.map(c => <option key={c}>{c}</option>)}</select>
          <input placeholder="бренд" value={it.brand} onChange={e => upd(k, { brand: e.target.value })} />
          <input placeholder="модель" value={it.model} onChange={e => upd(k, { model: e.target.value })} />
          <input type="number" placeholder="₽" value={it.price} onChange={e => upd(k, { price: e.target.value })} />
          <button onClick={() => setItems(items.filter((_, j) => j !== k))}>✕</button>
        </div>))}
      <div className="actions">
        <button onClick={() => setItems([...items, { cat: 'CPU', brand: '', model: '', price: '', cond: 'USED' }])}>+ позиция</button>
        <button className="primary" disabled={total <= 0} onClick={save}>ВНЕСТИ НА СКЛАД ({total} ₽)</button>
      </div>
      <p className="muted">Для деталей, купленных раньше: попадут на склад без фальшивого расхода — как капитал, который уже был.</p>
    </div>);
}