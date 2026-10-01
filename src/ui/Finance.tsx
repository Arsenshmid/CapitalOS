import { useState } from 'react';
import { useData } from '../hooks';
import { db } from '../db';
import { txIncome, txExpense, txTransfer } from '../engine/link';
import { fmtMinor, toMinor, uid, todayISO } from '../engine/utils';
import { VIRT, type Reliability } from '../types';

export default function Finance() {
  const d = useData();
  const [type, setType] = useState<'INCOME' | 'EXPENSE' | 'TRANSFER'>('EXPENSE');
  const [acc, setAcc] = useState(''); const [toAcc, setToAcc] = useState('');
  const [amt, setAmt] = useState(''); const [cat, setCat] = useState(''); const [note, setNote] = useState('');
  const real = d.accounts.filter(a => a.status !== 'CLOSED');
  const accId = acc || real[0]?.id || '';

  const save = async () => {
    const a = toMinor(+amt); if (a <= 0 || !accId) return;
    const t = type === 'INCOME' ? txIncome(Date.now(), accId, a, cat || undefined, note)
      : type === 'EXPENSE' ? txExpense(Date.now(), accId, a, cat || undefined, note)
      : txTransfer(Date.now(), accId, toAcc, a, note);
    await db.txs.add(t); setAmt(''); setNote('');
  };

  return (
    <div>
      <section className="card">
        <h2>Счета</h2>
        {real.map(a => <Row key={a.id} label={`${a.name} ${a.status === 'ARRESTED' ? '· 🔒 арест' : ''}`}
          value={fmtMinor(d.bal.get(a.id) ?? 0)} />)}
        <Row label="Накопленный финансовый результат (PNL)" value={fmtMinor(-(d.bal.get(VIRT.PNL) ?? 0))} muted />
      </section>

      <section className="card">
        <h2>Новая операция</h2>
        <div className="frm">
          <select value={type} onChange={e => setType(e.target.value as any)}>
            <option value="EXPENSE">Расход</option><option value="INCOME">Доход</option><option value="TRANSFER">Перевод</option>
          </select>
          <select value={accId} onChange={e => setAcc(e.target.value)}>
            {real.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {type === 'TRANSFER' && (
            <select value={toAcc} onChange={e => setToAcc(e.target.value)}>
              <option value="">→ куда</option>
              {real.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>)}
          <input type="number" placeholder="₽" value={amt} onChange={e => setAmt(e.target.value)} />
          {type !== 'TRANSFER' && (
            <select value={cat} onChange={e => setCat(e.target.value)}>
              <option value="">категория</option>
              {d.cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>)}
          <input placeholder="заметка" value={note} onChange={e => setNote(e.target.value)} />
          <button className="primary" onClick={save}>OK</button>
        </div>
        <p className="muted">Покупка комплектующих — не здесь, а в «Мастерской»: там проводка создаётся сама.</p>
      </section>

      <section className="card">
        <h2>Потоки дохода</h2>
        {d.streams.map(s => <Row key={s.id}
          label={`${s.name} · ${s.reliability}${s.reliability === 'EXPECTED' ? ` ×${s.coef}` : ''}${s.day ? ` · ${s.day}-е` : ''}`}
          value={fmtMinor(s.amountMinor)} />)}
        <StreamForm />
      </section>

      <section className="card">
        <h2>Обязательства</h2>
        {d.lias.map(l => <Row key={l.id}
          label={`${l.name} · ${l.status === 'ACTIVE' ? `активно${l.monthlyMinor ? `, ${fmtMinor(l.monthlyMinor)}/мес` : ''}` : 'в процедуре (вне cash-flow)'}`}
          value={fmtMinor(l.principalMinor)} />)}
        <LiabForm />
      </section>
    </div>
  );
}

const Row = ({ label, value }: any) => <div className="row"><span>{label}</span><b>{value}</b></div>;

function StreamForm() {
  const [f, setF] = useState({ name: '', rel: 'GUARANTEED' as Reliability, amt: '', day: '15' });
  const save = async () => {
    if (!f.name || +f.amt <= 0) return;
    await db.streams.add({ id: uid(), name: f.name, reliability: f.rel,
      coef: f.rel === 'EXPECTED' ? 0.75 : 1, kind: 'MONTHLY', day: +f.day, amountMinor: toMinor(+f.amt) });
    setF({ ...f, name: '', amt: '' });
  };
  return <div className="frm">
    <input placeholder="название" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
    <select value={f.rel} onChange={e => setF({ ...f, rel: e.target.value as Reliability })}>
      <option>GUARANTEED</option><option>EXPECTED</option><option>POSSIBLE</option>
    </select>
    <input type="number" placeholder="₽/мес" value={f.amt} onChange={e => setF({ ...f, amt: e.target.value })} />
    <input type="number" placeholder="день" value={f.day} onChange={e => setF({ ...f, day: e.target.value })} />
    <button onClick={save}>+</button>
  </div>;
}

function LiabForm() {
  const [f, setF] = useState({ name: '', amt: '', mon: '', day: '', frozen: false });
  const save = async () => {
    if (!f.name || +f.amt <= 0) return;
    await db.liabilities.add({ id: uid(), name: f.name, kind: f.frozen ? 'CREDIT' : 'PERSONAL',
      principalMinor: toMinor(+f.amt), status: f.frozen ? 'LEGAL_FROZEN' : 'ACTIVE',
      activeInCashflow: !f.frozen, monthlyMinor: +f.mon ? toMinor(+f.mon) : undefined, day: +f.day || undefined });
    setF({ ...f, name: '', amt: '', mon: '' });
  };
  return <div className="frm">
    <input placeholder="название" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
    <input type="number" placeholder="долг ₽" value={f.amt} onChange={e => setF({ ...f, amt: e.target.value })} />
    <input type="number" placeholder="₽/мес" value={f.mon} onChange={e => setF({ ...f, mon: e.target.value })} />
    <input type="number" placeholder="день" value={f.day} onChange={e => setF({ ...f, day: e.target.value })} />
    <label className="muted"><input type="checkbox" checked={f.frozen}
      onChange={e => setF({ ...f, frozen: e.target.checked })} /> в процедуре</label>
    <button onClick={save}>+</button>
  </div>;
}