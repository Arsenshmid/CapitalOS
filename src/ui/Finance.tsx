import { useState } from 'react';
import { useData } from '../hooks';
import { db } from '../db';
import { txIncome, txExpense, txTransfer, txOpening } from '../engine/link';
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
    if (type === 'TRANSFER' && !toAcc) return;
    const t = type === 'INCOME' ? txIncome(Date.now(), accId, a, cat || undefined, note)
      : type === 'EXPENSE' ? txExpense(Date.now(), accId, a, cat || undefined, note)
      : txTransfer(Date.now(), accId, toAcc, a, note);
    await db.txs.add(t); setAmt(''); setNote('');
  };

  return (
    <div>
      <section className="card">
        <h2>Счета</h2>
        {real.map(a => <div key={a.id} className="row">
          <span>{a.name} {a.status === 'ARRESTED' ? '· 🔒 арест' : ''}</span><b>{fmtMinor(d.bal.get(a.id) ?? 0)}</b></div>)}
        <div className="row muted"><span>Итог операций мастерской</span><b>{fmtMinor(-(d.bal.get(VIRT.PNL) ?? 0))}</b></div>
        <h3>Добавить свой счёт</h3>
        <AccountForm />
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
              <option value="">Выберите счёт-получатель</option>
              {real.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>)}
          <input type="number" placeholder="₽" value={amt} onChange={e => setAmt(e.target.value)} />
          {type !== 'TRANSFER' && (
            <select value={cat} onChange={e => setCat(e.target.value)}>
              <option value="">Выберите категорию</option>
              {d.cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>)}
          <input placeholder="Например, продукты или поездка" value={note} onChange={e => setNote(e.target.value)} />
          <button className="primary" onClick={save}>Добавить</button>
        </div>
        <p className="muted">Покупки для мастерской удобнее добавить в разделе «Мастерская» — расходы учтутся автоматически.</p>
      </section>

      <section className="card">
        <h2>Потоки дохода</h2>
        {d.streams.map(s => <div key={s.id} className="row">
          <span>{s.name} · {{ GUARANTEED: 'Надёжный', EXPECTED: 'Ожидаемый', POSSIBLE: 'Возможный' }[s.reliability]}{s.reliability === 'EXPECTED' ? ` · учтено ${Math.round(s.coef * 100)}%` : ''}{s.day ? ` · ${s.day}-е число` : ''}</span>
          <b>{fmtMinor(s.amountMinor)}</b></div>)}
        <StreamForm />
      </section>

      <section className="card">
        <h2>Обязательства</h2>
        {d.lias.map(l => <div key={l.id} className="row">
          <span>{l.name} · {l.status === 'ACTIVE' ? `активно${l.monthlyMinor ? `, ${fmtMinor(l.monthlyMinor)}/мес` : ''}` : 'в процедуре (вне расчётов)'}</span>
          <b>{fmtMinor(l.principalMinor)}</b></div>)}
        <LiabForm />
      </section>
    </div>
  );
}

function AccountForm() {
  const [f, setF] = useState({ name: '', kind: 'CARD', open: '', arrested: false });
  const save = async () => {
    if (!f.name.trim()) return;
    const id = uid();
    await db.transaction('rw', [db.accounts, db.txs], async () => {
      await db.accounts.add({ id, name: f.name.trim(), kind: f.kind as any,
        isLiquid: f.kind !== 'CASHBOX', status: f.arrested ? 'ARRESTED' : 'ACTIVE' });
      if (+f.open > 0) await db.txs.add(txOpening(Date.now(), id, toMinor(+f.open)));
    });
    setF({ ...f, name: '', open: '' });
  };
  return (
    <div className="frm">
      <input placeholder="Например, карта основного банка" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
      <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
        <option value="CARD">Карта</option><option value="CASH">Наличные</option>
        <option value="SAVINGS">Накопительный</option><option value="CASHBOX">Касса бизнеса</option>
      </select>
      <input type="number" placeholder="Сколько денег сейчас, ₽" value={f.open} onChange={e => setF({ ...f, open: e.target.value })} />
      <label className="muted"><input type="checkbox" checked={f.arrested}
        onChange={e => setF({ ...f, arrested: e.target.checked })} /> Счёт временно недоступен</label>
      <button onClick={save}>Добавить счёт</button>
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
    <input placeholder="Например, зарплата" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
    <select value={f.rel} onChange={e => setF({ ...f, rel: e.target.value as Reliability })}>
      <option value="GUARANTEED">Надёжный доход</option><option value="EXPECTED">Ожидаемый доход</option><option value="POSSIBLE">Возможный доход</option>
    </select>
    <input type="number" placeholder="₽/мес" value={f.amt} onChange={e => setF({ ...f, amt: e.target.value })} />
    <input type="number" placeholder="день" value={f.day} onChange={e => setF({ ...f, day: e.target.value })} />
    <button onClick={save}>Добавить доход</button>
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
    <input placeholder="Например, кредит" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
    <input type="number" placeholder="Остаток долга, ₽" value={f.amt} onChange={e => setF({ ...f, amt: e.target.value })} />
    <input type="number" placeholder="Платёж в месяц, ₽" value={f.mon} onChange={e => setF({ ...f, mon: e.target.value })} />
    <input type="number" placeholder="День платежа" value={f.day} onChange={e => setF({ ...f, day: e.target.value })} />
    <label className="muted"><input type="checkbox" checked={f.frozen}
      onChange={e => setF({ ...f, frozen: e.target.checked })} /> Платёж пока не учитывать</label>
    <button onClick={save}>Добавить обязательство</button>
  </div>;
}