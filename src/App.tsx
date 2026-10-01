import { useEffect, useMemo, useState } from 'react';
import Dashboard from './ui/Dashboard';
import Finance from './ui/Finance';
import Flip from './ui/Flip';
import Settings, { applySavedAppearance } from './ui/Settings';
import { useData } from './hooks';
import { fmtMinor } from './engine/utils';

const NAV = [
  { group: 'WORKSPACE', items: [{ id: 'dash', label: 'Обзор', icon: '▦' }] },
  { group: 'MONEY', items: [{ id: 'fin', label: 'Счета и операции', icon: '◉' }] },
  { group: 'OPERATIONS', items: [{ id: 'flip', label: 'Мастерская', icon: '▰' }] },
  { group: 'SYSTEM', items: [{ id: 'set', label: 'Настройки', icon: '⚙' }] },
] as const;
type Section = (typeof NAV)[number]['items'][number]['id'];
type SearchResult = { label: string; detail: string; section: Section };
const TITLES: Record<Section, string> = {
  dash: 'Рабочая среда', fin: 'Счета и операции', flip: 'Мастерская', set: 'Настройки системы',
};

export default function App() {
  const [tab, setTab] = useState<Section>('dash');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const d = useData();

  useEffect(() => {
    applySavedAppearance();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'k' || event.code === 'Space')) {
        event.preventDefault(); setSearchOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault(); setTab('fin'); setMobileOpen(false);
      }
      if (event.key === 'Escape') { setSearchOpen(false); setMobileOpen(false); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const results = useMemo<SearchResult[]>(() => {
    const pages: SearchResult[] = [
      { label: 'Обзор', detail: 'Рабочая среда', section: 'dash' },
      { label: 'Счета и операции', detail: 'Баланс, доходы и расходы', section: 'fin' },
      { label: 'Мастерская', detail: 'Склад и сборки', section: 'flip' },
      { label: 'Настройки', detail: 'Параметры и резервные копии', section: 'set' },
      { label: 'Safe to Spend', detail: `Доступно ${fmtMinor(d.m.stsMinor)}`, section: 'dash' },
      { label: 'BTC', detail: d.m.btcMinor ? fmtMinor(d.m.btcMinor) : 'Позиция не настроена', section: 'dash' },
      ...d.accounts.map(account => ({ label: account.name, detail: `Счёт · ${fmtMinor(d.bal.get(account.id) ?? 0)}`, section: 'fin' as Section })),
      ...d.cats.map(category => ({ label: category.name, detail: 'Категория операций', section: 'fin' as Section })),
      ...[...d.txs].sort((a, b) => b.ts - a.ts).slice(0, 60).map<SearchResult>(tx => {
        const entries = tx.entries.filter(entry => !entry.acc.startsWith('virt:'));
        const amount = tx.type === 'TRANSFER' ? Math.max(0, ...entries.map(entry => entry.amt))
          : entries.length ? entries.reduce((sum, entry) => sum + entry.amt, 0)
          : Math.max(0, ...tx.entries.map(entry => Math.abs(entry.amt)));
        const absoluteAmount = Math.abs(amount);
        return {
          label: tx.note || ({ INCOME: 'Доход', EXPENSE: 'Расход', TRANSFER: 'Перевод', BUY_COMPONENTS: 'Закупка',
            ASSEMBLE: 'Сборка', SELL_BUILD: 'Продажа', DRAW: 'Вывод', ADJUST: 'Корректировка' }[tx.type]),
          detail: `${new Date(tx.ts).toLocaleDateString('ru-RU')} · ${tx.categoryId ? d.cats.find(c => c.id === tx.categoryId)?.name ?? '' : tx.type} · ${fmtMinor(absoluteAmount)} ${Math.floor(absoluteAmount / 100)}`,
          section: tx.type === 'BUY_COMPONENTS' || tx.type === 'ASSEMBLE' || tx.type === 'SELL_BUILD' ? 'flip' : 'fin',
        };
      }),
    ];
    const normalized = query.trim().toLocaleLowerCase('ru');
    return normalized ? pages.filter(item => `${item.label} ${item.detail}`.toLocaleLowerCase('ru').includes(normalized)).slice(0, 12) : pages.slice(0, 8);
  }, [d.accounts, d.bal, d.cats, d.m.btcMinor, d.m.stsMinor, d.txs, query]);

  const chooseSection = (section: Section) => { setTab(section); setMobileOpen(false); setSearchOpen(false); setQuery(''); };
  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 760px)').matches) setMobileOpen(value => !value);
    else setCollapsed(value => !value);
  };

  return (
    <div className={`app ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark">C</span><span className="brand-name">CAPITAL OS<small>PERSONAL FINANCE</small></span></div>
        <nav className="side-nav" aria-label="Основная навигация">
          {NAV.map(group => <div className="nav-group" key={group.group}>
            <div className="nav-group-label">{group.group}</div>
            {group.items.map(item => <button key={item.id} title={collapsed ? item.label : undefined}
              className={`nav-item ${tab === item.id ? 'active' : ''}`} onClick={() => chooseSection(item.id)}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="nav-label">{item.label}</span>
            </button>)}
          </div>)}
        </nav>
        <div className="sidebar-bottom"><span className="status-dot" /> Локальная база данных</div>
      </aside>
      {mobileOpen && <button className="sidebar-scrim" aria-label="Закрыть навигацию" onClick={() => setMobileOpen(false)} />}

      <div className="workspace">
        <header className="topbar">
          <button className="icon-button menu-toggle" aria-label="Переключить боковую панель" title="Боковая панель" onClick={toggleSidebar}>☰</button>
          <div className="breadcrumb"><span>Capital OS</span><span className="breadcrumb-separator">/</span><strong>{TITLES[tab]}</strong></div>
          <div className="topbar-actions">
            <button className="search-trigger" onClick={() => setSearchOpen(true)}><span>⌕</span><span>Поиск и команды</span><kbd>Ctrl K</kbd></button>
            <span className="topbar-date">{new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <button className="icon-button settings-shortcut" title="Настройки" aria-label="Настройки" onClick={() => chooseSection('set')}>⚙</button>
          </div>
        </header>
        <main className="main-view">
          <div className="page-heading"><div><div className="eyebrow">CAPITAL OS <span>/</span> {tab.toUpperCase()}</div><h1>{TITLES[tab]}</h1></div>
            <button className="primary heading-action" onClick={() => chooseSection('fin')}><span aria-hidden="true">＋</span> Новая операция</button>
          </div>
          {tab === 'dash' && <Dashboard go={chooseSection} />}
          {tab === 'fin' && <Finance />}
          {tab === 'flip' && <Flip />}
          {tab === 'set' && <Settings />}
        </main>
      </div>

      {searchOpen && <div className="command-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
        <section className="command-dialog" role="dialog" aria-modal="true" aria-label="Поиск Capital OS">
          <div className="command-input-row"><span className="command-search-icon">⌕</span>
            <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Поиск по Capital OS..." />
            <kbd>ESC</kbd></div>
          <div className="command-results">
            {results.length ? results.map((item, index) => <button key={`${item.section}-${item.label}-${index}`} className="command-result"
              onClick={() => chooseSection(item.section)}><span className="result-symbol">{item.section === 'fin' ? '◉' : item.section === 'flip' ? '▰' : item.section === 'set' ? '⚙' : '▦'}</span>
              <span className="result-copy"><strong>{item.label}</strong><small>{item.detail}</small></span><span className="result-enter">↵</span></button>)
              : <div className="empty-search">Ничего не найдено</div>}
          </div>
          <footer className="command-footer"><span>Переход к разделу или данным</span><span><kbd>Ctrl K</kbd> открыть поиск</span></footer>
        </section>
      </div>}
    </div>
  );
}