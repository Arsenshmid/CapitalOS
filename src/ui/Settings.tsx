import { useEffect, useState } from 'react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';

export default function Settings() {
  const kv = useLiveQuery(() => db.kv.toArray(), []) ?? [];
  const S = Object.fromEntries(kv.map(r => [r.k, r.v]));
  const [f, setF] = useState<any>({});
  useEffect(() => { setF({ btcSats: S.btcSats ?? 0, btcPriceRub: S.btcPriceRub ?? 0,
    reserveMonths: S.reserveMonths ?? 1, manualMinBurn: S.manualMinBurn ?? 0 }); }, [kv.length]);
  const put = async (k: string, v: any) => db.kv.put({ k, v });

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
    alert('Импортировано. Обнови страницу.');
  };

  return (
    <div>
      <section className="card">
        <h2>BTC (ручной ввод, v1)</h2>
        <div className="frm">
          <label>Sats: <input type="number" value={f.btcSats ?? 0} onChange={e => setF({ ...f, btcSats: +e.target.value })} /></label>
          <label>Цена ₽/BTC: <input type="number" value={f.btcPriceRub ?? 0} onChange={e => setF({ ...f, btcPriceRub: +e.target.value })} /></label>
          <button onClick={() => { put('btcSats', f.btcSats); put('btcPriceRub', f.btcPriceRub); }}>Сохранить</button>
        </div>
        <p className="muted">Watch-only. Ключи и seed-фразы приложение не принимает и не хранит — принципиально.</p>
      </section>
      <section className="card">
        <h2>Параметры модели</h2>
        <div className="frm">
          <label>Резерв (мес): <input type="number" step="0.5" value={f.reserveMonths ?? 1}
            onChange={e => setF({ ...f, reserveMonths: +e.target.value })} /></label>
          <label>Мин. burn ₽/мес: <input type="number" value={f.manualMinBurn ?? 0}
            onChange={e => setF({ ...f, manualMinBurn: +e.target.value })} /></label>
          <button onClick={() => { put('reserveMonths', f.reserveMonths); put('manualMinBurn', f.manualMinBurn); }}>Сохранить</button>
        </div>
        <p className="muted">Все коэффициенты — видимые настройки, не спрятанные константы.</p>
      </section>
      <section className="card">
        <h2>Данные</h2>
        <div className="actions">
          <button className="primary" onClick={exportAll}>Экспорт JSON</button>
          <label className="btn-file">Импорт JSON<input type="file" accept=".json" hidden
            onChange={e => e.target.files?.[0] && importAll(e.target.files[0])} /></label>
          <button onClick={async () => { await db.delete(); location.reload(); }}>Сбросить всё</button>
        </div>
        <p className="muted">Экспорт раз в неделю — дисциплина, которая заменяет облако.</p>
      </section>
    </div>);
}