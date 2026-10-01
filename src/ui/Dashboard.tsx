import { useEffect, useState } from 'react';
import { useData } from '../hooks';
import { fmtMinor, fmtPct, fmtDays, toMinor, DIM, DAY } from '../engine/utils';
import { dealMetrics } from '../engine/flip';
import { VIRT, type Liability, type Tx } from '../types';
import type { Metrics } from '../engine/finance';

const WIDGETS = [
  { id: 'capital', title: 'NET CAPITAL', kicker: 'КАПИТАЛ' },
  { id: 'safe', title: 'SAFE TO SPEND', kicker: 'ЛИКВИДНОСТЬ' },
  { id: 'flow', title: 'CAPITAL FLOW', kicker: 'ДЕНЕЖНЫЙ ПОТОК' },
  { id: 'btc', title: 'BTC POSITION', kicker: 'ЦИФРОВЫЕ АКТИВЫ' },
  { id: 'workshop', title: 'МАСТЕРСКАЯ', kicker: 'ОПЕРАЦИИ' },
  { id: 'recent', title: 'ПОСЛЕДНИЕ ОПЕРАЦИИ', kicker: 'ЖУРНАЛ' },
  { id: 'payments', title: 'БЛИЖАЙШЕЕ', kicker: 'РАСПИСАНИЕ' },
] as const;
type WidgetId = (typeof WIDGETS)[number]['id'];
type Layout = { widgets: WidgetId[]; wide: WidgetId[]; pinned: WidgetId[] };
const DEFAULT_LAYOUT: Layout = {
  widgets: ['capital', 'safe', 'flow', 'btc', 'workshop', 'recent', 'payments'],
  wide: ['capital', 'flow', 'recent'],
  pinned: [],
};
const LAYOUT_KEY = 'capital-os-dashboard-layout-v1';
const CHART_RANGES = [{ label: '7D', days: 7 }, { label: '30D', days: 30 }, { label: '90D', days: 90 },
  { label: '1Y', days: 365 }, { label: 'ALL', days: 0 }];

function readLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
    if (!saved) return DEFAULT_LAYOUT;
    const isWidget = (value: unknown): value is WidgetId => WIDGETS.some(widget => widget.id === value);
    const uniqueWidgets = (values: unknown): WidgetId[] => Array.isArray(values)
      ? [...new Set<WidgetId>((values as unknown[]).filter(isWidget))] : [];
    const widgets = Array.isArray(saved.widgets) ? uniqueWidgets(saved.widgets) : DEFAULT_LAYOUT.widgets;
    return {
      widgets,
      wide: Array.isArray(saved.wide) ? uniqueWidgets(saved.wide) : DEFAULT_LAYOUT.wide,
      pinned: uniqueWidgets(saved.pinned),
    };
  } catch { return DEFAULT_LAYOUT; }
}

function capitalSeries(txs: Tx[], accounts: ReturnType<typeof useData>['accounts'], total: number, now: number, range: number) {
  const tracked = new Set([...accounts.filter(account => account.status === 'ACTIVE' && account.isLiquid).map(account => account.id),
    VIRT.INVENTORY, VIRT.WIP]);
  const oldest = txs.reduce((min, tx) => Math.min(min, tx.ts), now);
  const days = range || Math.max(1, Math.ceil((now - oldest) / DAY));
  const count = range === 7 ? 8 : 32;
  const start = now - days * DAY;
  return Array.from({ length: count }, (_, index) => {
    const at = start + (days * DAY * index) / (count - 1);
    const deltaAfter = txs.filter(tx => tx.ts > at && tx.ts <= now)
      .flatMap(tx => tx.entries).reduce((sum, entry) => sum + (tracked.has(entry.acc) ? entry.amt : 0), 0);
    return { at, value: total - deltaAfter };
  });
}

function nextPayment(liabilities: Liability[], now: number) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const candidates = liabilities.filter(item => item.activeInCashflow && item.day && item.monthlyMinor)
    .map(item => {
      const due = new Date(today.getFullYear(), today.getMonth(), item.day!);
      if (due < today) due.setMonth(due.getMonth() + 1);
      return { item, due };
    }).sort((a, b) => a.due.getTime() - b.due.getTime());
  const next = candidates[0];
  return next ? { name: next.item.name, amount: next.item.monthlyMinor!, days: Math.max(0, Math.ceil((next.due.getTime() - today.getTime()) / DAY)), date: next.due } : null;
}

const TX_LABELS: Record<Tx['type'], string> = {
  INCOME: 'Доход', EXPENSE: 'Расход', TRANSFER: 'Перевод', BUY_COMPONENTS: 'Закупка',
  ASSEMBLE: 'Сборка', SELL_BUILD: 'Продажа', DRAW: 'Вывод', ADJUST: 'Корректировка',
};

export default function Dashboard({ go }: { go: (t: any) => void }) {
  const d = useData();
  const m = d.m;
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<Layout>(readLayout);
  const [range, setRange] = useState(30);
  const [showScenarios, setShowScenarios] = useState(false);
  const now = Date.now();

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
  }, [layout]);

  const forSale = d.builds.filter(build => build.status === 'FOR_SALE');
  const potential = forSale.reduce((sum, build) => sum + dealMetrics(d.fc(build), build.targetPriceMinor ?? 0).profit, 0);
  const series = capitalSeries(d.txs, d.accounts, m.totalMinor, now, range);
  const chartMin = Math.min(...series.map(point => point.value));
  const chartMax = Math.max(...series.map(point => point.value));
  const chartRange = Math.max(1, chartMax - chartMin);
  const points = series.map((point, index) => `${(index * 100) / (series.length - 1)},${34 - ((point.value - chartMin) / chartRange) * 29}`).join(' ');
  const capitalChange = m.totalMinor - (series[0]?.value ?? m.totalMinor);
  const capitalChangePct = series[0]?.value ? (capitalChange / Math.abs(series[0].value)) * 100 : 0;
  const due = nextPayment(d.lias, now);
  const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  let monthIncome = 0, monthExpenses = 0;
  for (const tx of d.txs) {
    if (tx.ts < monthStart.getTime()) continue;
    if (tx.type === 'INCOME') monthIncome += tx.entries.filter(entry => !entry.acc.startsWith('virt:') && entry.amt > 0).reduce((sum, entry) => sum + entry.amt, 0);
    if (tx.type === 'EXPENSE' && !tx.buildId) monthExpenses += tx.entries.filter(entry => !entry.acc.startsWith('virt:') && entry.amt < 0).reduce((sum, entry) => sum - entry.amt, 0);
  }
  const availableWidgets = WIDGETS.filter(widget => !layout.widgets.includes(widget.id));

  if (!d.accounts.length) return (
    <div className="card"><h2>Начало работы</h2>
      <p className="muted">База пока пуста. Можно внести свои счета или вернуть демо-данные в настройках.</p>
      <button className="primary" onClick={() => go('set')}>Открыть настройки</button>
    </div>);

  const moveWidget = (id: WidgetId, direction: -1 | 1) => setLayout(current => {
    const index = current.widgets.indexOf(id), target = index + direction;
    if (target < 0 || target >= current.widgets.length || current.pinned.includes(id) !== current.pinned.includes(current.widgets[target]!)) return current;
    const widgets = [...current.widgets];
    [widgets[index], widgets[target]] = [widgets[target]!, widgets[index]!];
    return { ...current, widgets };
  });

  const togglePin = (id: WidgetId) => setLayout(current => {
    const pinned = current.pinned.includes(id) ? current.pinned.filter(item => item !== id) : [...current.pinned, id];
    const widgets = [...pinned.filter(item => current.widgets.includes(item)), ...current.widgets.filter(item => !pinned.includes(item))];
    return { ...current, pinned, widgets };
  });

  const renderWidget = (id: WidgetId) => {
    if (id === 'capital') return <>
      <div className="metric-value">{fmtMinor(m.totalMinor)}</div>
      <div className={`metric-delta ${capitalChange < 0 ? 'negative' : ''}`}>
        <span>{capitalChange >= 0 ? '↗' : '↘'}</span>{capitalChange >= 0 ? '+' : ''}{fmtMinor(capitalChange)} · {fmtPct(capitalChangePct)} · {range ? `${range} DAYS` : 'ALL TIME'}
      </div>
      <svg className="capital-chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="История капитала">
        <line x1="0" y1="34.5" x2="100" y2="34.5" /><polyline points={points} />
      </svg>
      <div className="chart-foot"><span>{range ? `${range} дней назад` : 'Начало учёта'}</span><span>СЕЙЧАС</span></div>
      <div className="chart-range" aria-label="Период графика">
        {CHART_RANGES.map(item => <button key={item.label} className={range === item.days ? 'selected' : ''} onClick={() => setRange(item.days)}>{item.label}</button>)}
      </div>
      <div className="widget-detail"><span>Ликвидность</span><strong>{fmtMinor(m.liquidMinor)}</strong></div>
      <div className="widget-detail"><span>Net worth · полный</span><strong>{fmtMinor(m.netWorthFullMinor)}</strong></div>
    </>;

    if (id === 'safe') return <>
      <div className="safe-layout"><div><div className="metric-value">{fmtMinor(m.stsMinor)}</div><div className="metric-caption">Доступно без учёта ожидаемых доходов</div></div>
        <div className="safe-days"><strong>{fmtDays(m.daysToIncome)}</strong><span>до дохода</span></div></div>
      <div className="widget-detail"><span>Следующий обязательный платёж</span><strong>{due ? fmtMinor(due.amount) : 'Нет в расписании'}</strong></div>
      {due && <div className="widget-detail"><span>{due.name}</span><strong>{due.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · через {due.days} дн.</strong></div>}
      <button className="text-action" onClick={() => go('fin')}>Расчёт и счета →</button>
    </>;

    if (id === 'flow') {
      const max = Math.max(monthIncome, monthExpenses, m.minBurnMinor, 1);
      const rows = [
        { label: 'Доход', amount: monthIncome, kind: 'income', percent: monthIncome / max * 100 },
        { label: 'Расходы', amount: monthExpenses, kind: 'expenses', percent: monthExpenses / max * 100 },
        { label: 'Мин. расходы', amount: m.minBurnMinor, kind: 'expenses', percent: m.minBurnMinor / max * 100 },
        { label: 'Остаток', amount: monthIncome - monthExpenses, kind: 'savings', percent: Math.max(0, monthIncome - monthExpenses) / max * 100 },
      ];
      return <>
        <div className="flow-list">{rows.map(row => <div className={`flow-line ${row.kind}`} key={row.label}>
          <span className="flow-label"><i className={`flow-dot ${row.kind === 'expenses' ? 'expense' : row.kind === 'savings' ? 'savings' : ''}`} />{row.label}</span>
          <div className="flow-meter"><span style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }} /></div>
          <b>{fmtMinor(row.amount)}</b>
        </div>)}</div>
        <div className="flow-summary"><span>Прибыль мастерской <strong>{fmtMinor(m.bizProfitMonth)}</strong></span>
          <span>Норма сбережений <strong>{m.savingsRate == null ? '—' : fmtPct(m.savingsRate * 100)}</strong></span></div>
      </>;
    }

    if (id === 'btc') {
      const sats = Number(d.S.btcSats ?? 0), price = Number(d.S.btcPriceRub ?? 0);
      const allocation = m.totalMinor > 0 ? (m.btcMinor / m.totalMinor) * 100 : 0;
      return <>
        <div className="btc-price">Рыночная цена · {price > 0 ? fmtMinor(toMinor(price)) : 'не задана'}</div>
        <div className="btc-position">{(sats / 1e8).toFixed(8)} BTC<small>Текущая позиция</small></div>
        <div className="btc-stat-grid"><div className="btc-stat"><span>Стоимость</span><strong>{m.btcMinor ? fmtMinor(m.btcMinor) : '—'}</strong></div>
          <div className="btc-stat"><span>Доля капитала</span><strong>{m.btcMinor ? fmtPct(allocation) : '—'}</strong></div></div>
        <div className="widget-detail"><span>P/L</span><strong>— · себестоимость не задана</strong></div>
        <button className="text-action" onClick={() => setShowScenarios(value => !value)}>{showScenarios ? 'Скрыть сценарии ↑' : 'Разбор сценариев →'}</button>
        {showScenarios && <div className="scenario-wrap"><table className="scenario-table"><thead><tr><th>Сценарий</th><th>Цена BTC</th><th>Позиция</th><th>Δ</th></tr></thead>
          <tbody>{[-30, -20, -10, 0, 10, 20, 50].map(percent => <tr key={percent}><td>{percent > 0 ? '+' : ''}{percent}%</td>
            <td>{price > 0 ? fmtMinor(toMinor(price * (1 + percent / 100))) : '—'}</td>
            <td>{m.btcMinor ? fmtMinor(Math.round(m.btcMinor * (1 + percent / 100))) : '—'}</td>
            <td>{m.btcMinor ? fmtMinor(Math.round(m.btcMinor * percent / 100)) : '—'}</td></tr>)}</tbody></table>
          <div className="metric-caption">Сценарии изменения цены, не прогноз.</div></div>}
      </>;
    }

    if (id === 'workshop') return <>
      <div className="metric-value">{forSale.length}<span className="metric-unit">{forSale.length === 1 ? 'сборка' : forSale.length > 1 && forSale.length < 5 ? 'сборки' : 'сборок'}</span></div>
      <div className="metric-caption">Готово к продаже · потенциальная прибыль {fmtMinor(potential)}</div>
      <div className="widget-detail"><span>Касса бизнеса</span><strong>{fmtMinor(d.bal.get('acc-box') ?? 0)}</strong></div>
      <div className="widget-detail"><span>Выручка · прибыль за месяц</span><strong>{fmtMinor(m.bizRevenueMonth)} · {fmtMinor(m.bizProfitMonth)}</strong></div>
      <button className="text-action" onClick={() => go('flip')}>Открыть мастерскую →</button>
    </>;

    if (id === 'recent') {
      const recent = [...d.txs].sort((a, b) => b.ts - a.ts).slice(0, 6);
      return recent.length ? <>
        <div className="recent-list">{recent.map(tx => {
          const entries = tx.entries.filter(entry => !entry.acc.startsWith('virt:'));
          const amount = tx.type === 'TRANSFER' ? Math.max(0, ...entries.map(entry => entry.amt))
            : entries.length ? entries.reduce((sum, entry) => sum + entry.amt, 0)
            : Math.max(0, ...tx.entries.map(entry => Math.abs(entry.amt)));
          const isIncome = tx.type === 'INCOME' || tx.type === 'SELL_BUILD' || tx.type === 'DRAW' || (tx.type === 'ADJUST' && amount > 0);
          const isExpense = tx.type === 'EXPENSE' || tx.type === 'BUY_COMPONENTS';
          const category = tx.categoryId ? d.cats.find(item => item.id === tx.categoryId)?.name : undefined;
          return <div className="recent-item" key={tx.id}><span className={`recent-sign ${isIncome ? 'income' : isExpense ? 'expense' : ''}`}>{isIncome ? '↗' : isExpense ? '↘' : '·'}</span>
            <span className="recent-copy"><strong>{tx.note || category || TX_LABELS[tx.type]}</strong><small>{new Date(tx.ts).toLocaleDateString('ru-RU')} · {category || TX_LABELS[tx.type]}</small></span>
            <span className={`recent-amount ${isIncome ? 'income' : isExpense ? 'expense' : ''}`}>{isIncome ? '+' : isExpense ? '−' : ''}{fmtMinor(Math.abs(amount))}</span></div>;
        })}</div>
        <button className="text-action" onClick={() => go('fin')}>Все операции →</button>
      </> : <div className="widget-empty">Операций пока нет</div>;
    }

    return <>
      {m.nextIncomeTs && <div className="ev">Доход · {new Date(m.nextIncomeTs).toLocaleDateString('ru-RU')}<b>{fmtDays(m.daysToIncome)}</b></div>}
      {due && <div className="ev">{due.name} · {due.date.toLocaleDateString('ru-RU')}<b>{fmtMinor(due.amount)}</b></div>}
      {!m.nextIncomeTs && !due && <div className="widget-empty">Нет запланированных поступлений или платежей</div>}
    </>;
  };

  return (
    <div className="dashboard">
      {d.mismatch && <div className="warn">Сверка: баланс счетов расходится со складом или сборками. Проверьте операции.</div>}
      <div className="dashboard-toolbar"><span className="dashboard-status">Локальная финансовая система <span>·</span> данные обновлены сейчас</span>
        <div className="dashboard-toolbar-actions">{editing ? <>
          <select aria-label="Добавить виджет" value="" onChange={event => {
            const id = event.target.value as WidgetId;
            if (id) setLayout(current => ({ ...current, widgets: [...current.widgets, id] }));
          }}><option value="">＋ Добавить виджет</option>{availableWidgets.map(widget => <option key={widget.id} value={widget.id}>{widget.title}</option>)}</select>
          <button onClick={() => { setLayout(DEFAULT_LAYOUT); setRange(30); }}>Сбросить раскладку</button>
          <button className="primary" onClick={() => setEditing(false)}>Готово</button>
        </> : <button onClick={() => setEditing(true)}>Настроить панель</button>}</div>
      </div>
      {editing && <div className="edit-notice">Переставьте виджеты, измените их ширину или скройте ненужные. Закреплённые виджеты остаются вверху.</div>}
      <div className="dashboard-grid">
        {layout.widgets.map((id, index) => {
          const widget = WIDGETS.find(item => item.id === id)!;
          const pinned = layout.pinned.includes(id);
          return <article className={`widget ${layout.wide.includes(id) ? 'widget-wide' : ''}`} key={id}>
            <div className="widget-inner"><header className="widget-header"><div><div className="widget-kicker">{widget.kicker}</div><h2 className="widget-title">{widget.title}</h2></div>
              {editing && <div className="widget-controls">
                <button title={pinned ? 'Открепить' : 'Закрепить'} aria-label={pinned ? 'Открепить виджет' : 'Закрепить виджет'} onClick={() => togglePin(id)}>{pinned ? '◆' : '◇'}</button>
                <button title="Выше" aria-label="Переместить виджет выше" disabled={index === 0 || pinned !== layout.pinned.includes(layout.widgets[index - 1]!)} onClick={() => moveWidget(id, -1)}>↑</button>
                <button title="Ниже" aria-label="Переместить виджет ниже" disabled={index === layout.widgets.length - 1 || pinned !== layout.pinned.includes(layout.widgets[index + 1]!)} onClick={() => moveWidget(id, 1)}>↓</button>
                <button title="Изменить ширину" aria-label="Изменить ширину виджета" onClick={() => setLayout(current => ({ ...current,
                  wide: current.wide.includes(id) ? current.wide.filter(item => item !== id) : [...current.wide, id] }))}>↔</button>
                <button title={pinned ? 'Сначала открепите виджет' : 'Скрыть виджет'} aria-label="Скрыть виджет" disabled={pinned}
                  onClick={() => setLayout(current => ({ ...current, widgets: current.widgets.filter(item => item !== id), wide: current.wide.filter(item => item !== id) }))}>×</button>
              </div>}
            </header>{renderWidget(id)}</div>
          </article>;
        })}
        {!layout.widgets.length && <div className="widget-empty">Все виджеты скрыты. Добавьте виджет в режиме настройки панели.</div>}
      </div>
      <WhatIf m={m} />
    </div>
  );
}

function WhatIf({ m }: { m: Metrics }) {
  const [open, setOpen] = useState(false);
  const [rub, setRub] = useState(15000);
  const [negative, setNegative] = useState(true);
  if (!open) return <div className="actions"><button onClick={() => setOpen(true)}>Что будет, если...</button></div>;
  const liquid = m.liquidMinor + (negative ? -1 : 1) * toMinor(rub);
  const calculate = (amount: number) => ({ sts: Math.max(0, amount - m.essentialMinor - m.committedMinor),
    runway: m.minBurnMinor > 0 ? amount / (m.minBurnMinor / DIM) : null });
  const before = calculate(m.liquidMinor), after = calculate(liquid);
  return <section className="card">
    <div className="widget-header"><h2>СЦЕНАРИЙ РАСХОДА ИЛИ ДОХОДА</h2><button aria-label="Закрыть" onClick={() => setOpen(false)}>×</button></div>
    <div className="frm"><select value={String(negative)} onChange={event => setNegative(event.target.value === 'true')}>
      <option value="true">Расход</option><option value="false">Доход</option></select>
      <input aria-label="Сумма сценария" type="number" min="0" value={rub} onChange={event => setRub(+event.target.value)} /><span>₽</span></div>
    <table className="tbl"><thead><tr><th></th><th>До</th><th>После</th></tr></thead><tbody>
      <tr><td>Ликвидные</td><td>{fmtMinor(m.liquidMinor)}</td><td>{fmtMinor(liquid)}</td></tr>
      <tr><td>Safe to Spend</td><td>{fmtMinor(before.sts)}</td><td>{fmtMinor(after.sts)}</td></tr>
      <tr><td>Runway</td><td>{fmtDays(before.runway)}</td><td>{fmtDays(after.runway)}</td></tr>
    </tbody></table>
  </section>;
}