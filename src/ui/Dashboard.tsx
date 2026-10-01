import { useState } from 'react';
import { useData } from '../hooks';
import { fmtMinor, fmtPct, fmtDays, toMinor, DIM } from '../engine/utils';
import { dealMetrics } from '../engine/flip';
import type { Metrics } from '../engine/finance';

export default function Dashboard({ go }: { go: (t: any) => void }) {
  const d = useData();
  const m = d.m;
  const forSale = d.builds.filter(b => b.status === 'FOR_SALE');
  const potential = forSale.reduce((s, b) => s + dealMetrics(d.fc(b), b.targetPriceMinor ?? 0).profit, 0);

  if (!d.accounts.length) return (
    <div className="card"><h2>Начало работы</h2>
      <p className="muted">База пуста. Демо-данные уже загружены при первом запуске — если их нет, открой «Настройки» → «Загрузить демо».</p>
      <button className="primary" onClick={() => go('set')}>Перейти в настройки</button>
    </div>);

  return (
    <div>
      {d.mismatch && <div className="warn">⚠ Сверка: баланс GL расходится со складом/сборками — проверь операции</div>}

      <section className="card">
        <h2>ФИНАНСОВОЕ СОСТОЯНИЕ</h2>
        <Row label="Ликвидные деньги" value={fmtMinor(m.liquidMinor)} />
        {m.arrestedMinor > 0 && <Row label="↳ арестовано (вне ликвидности)" value={fmtMinor(m.arrestedMinor)} muted />}
        <Row label="BTC" value={m.btcMinor ? fmtMinor(m.btcMinor) : 'не задано'} muted />
        <Row label="Заморожено в железе" value={fmtMinor(m.inventoryMinor + m.buildsMinor)}
          hint={`склад ${fmtMinor(m.inventoryMinor)} · сборки ${fmtMinor(m.buildsMinor)}`} />
        <hr />
        <Row label="Общий капитал" value={fmtMinor(m.totalMinor)} big
          hint={`Net Worth (CF) ${fmtMinor(m.netWorthCfMinor)} · (полный) ${fmtMinor(m.netWorthFullMinor)}`} />
      </section>

      <section className="card">
        <Row label="Можно безопасно потратить" value={fmtMinor(m.stsMinor)} big hint="только GUARANTEED-деньги" />
        <Row label="Можно направить в накопления" value={fmtMinor(m.stsaveMinor)} big
          hint={`резерв-пол ${fmtMinor(Math.round(m.minBurnMinor * (d.S.reserveMonths ?? 1)))}`} />
        <Row label="Вероятный поток (EXPECTED)" value={fmtMinor(m.expectedFlowMinor)} muted hint="не входит в Safe-to-Spend" />
        <Row label="До гарантированного дохода" value={fmtDays(m.daysToIncome)} />
        <Row label="Runway" value={`мин. ${fmtDays(m.runwayMinDays)} · норм. ${fmtDays(m.runwayNormDays)}`} />
        {m.savingsRate != null && <Row label="Savings Rate (месяц)" value={fmtPct(m.savingsRate * 100)} />}
      </section>

      <section className="card">
        <h2>МАСТЕРСКАЯ</h2>
        <Row label="Касса бизнеса" value={fmtMinor(d.bal.get('acc-box') ?? 0)} />
        <Row label="Месяц: выручка / прибыль" value={`${fmtMinor(m.bizRevenueMonth)} / ${fmtMinor(m.bizProfitMonth)}`}
          hint={`продано ПК: ${m.salesMonth}`} />
        <Row label="Готовых к продаже" value={`${forSale.length} · потенциальная прибыль ${fmtMinor(potential)}`} />
        <button onClick={() => go('flip')}>Открыть мастерскую →</button>
      </section>

      <section className="card">
        <h2>Ближайшее</h2>
        {m.nextIncomeTs && <div className="ev">+ {new Date(m.nextIncomeTs).toLocaleDateString('ru-RU')} · гарантированный доход</div>}
        {d.lias.filter(l => l.activeInCashflow && l.day).map(l =>
          <div key={l.id} className="ev">− {l.day}-е число · {l.name} · <b>{fmtMinor(l.monthlyMinor ?? 0)}</b></div>)}
        {forSale.map(b => <div key={b.id} className="ev">⚑ ПК #{String(b.num).padStart(3, '0')} ждёт покупателя</div>)}
      </section>

      <div className="actions"><button className="primary" onClick={() => go('flip')}>+ ПРОДАНО / ЗАКУПКА</button></div>
      <WhatIf m={m} />
    </div>
  );
}

function Row({ label, value, hint, muted, big }: any) {
  return <div className={`row ${muted ? 'muted' : ''}`}>
    <span>{label}{hint && <small className="hint"> · {hint}</small>}</span><b className={big ? 'big' : ''}>{value}</b>
  </div>;
}

function WhatIf({ m }: { m: Metrics }) {
  const [open, setOpen] = useState(false);
  const [rub, setRub] = useState(15000);
  const [neg, setNeg] = useState(true);
  if (!open) return <div className="actions"><button onClick={() => setOpen(true)}>ЧТО БУДЕТ, ЕСЛИ...</button></div>;
  const liq = m.liquidMinor + (neg ? -1 : 1) * toMinor(rub);
  const calc = (l: number) => ({ sts: Math.max(0, l - m.essentialMinor - m.committedMinor),
    run: m.minBurnMinor > 0 ? l / (m.minBurnMinor / DIM) : null });
  const a = calc(m.liquidMinor), b = calc(liq);
  return (
    <div className="card">
      <h3>ЧТО БУДЕТ, ЕСЛИ...</h3>
      <div className="frm">
        <select value={String(neg)} onChange={e => setNeg(e.target.value === 'true')}>
          <option value="true">расход</option><option value="false">доход</option>
        </select>
        <input type="number" value={rub} onChange={e => setRub(+e.target.value)} /><span>₽</span>
        <button onClick={() => setOpen(false)}>✕</button>
      </div>
      <table className="tbl"><thead><tr><th></th><th>До</th><th>После</th></tr></thead><tbody>
        <tr><td>Ликвидные</td><td>{fmtMinor(m.liquidMinor)}</td><td>{fmtMinor(liq)}</td></tr>
        <tr><td>Safe-to-Spend</td><td>{fmtMinor(a.sts)}</td><td>{fmtMinor(b.sts)}</td></tr>
        <tr><td>Runway мин.</td><td>{fmtDays(a.run)}</td><td>{fmtDays(b.run)}</td></tr>
      </tbody></table>
      <p className="muted">Расчёт последствий. Решение — твоё.</p>
    </div>);
}