import { useState } from 'react';
import Dashboard from './ui/Dashboard';
import Finance from './ui/Finance';
import Flip from './ui/Flip';
import Settings from './ui/Settings';

const TABS = [['dash', 'Дашборд'], ['fin', 'Финансы'], ['flip', 'Мастерская'], ['set', 'Настройки']] as const;

export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('dash');
  return (
    <div className="app">
      <nav>
        <b>CAPITAL OS</b>
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </nav>
      <main>
        {tab === 'dash' && <Dashboard go={setTab} />}
        {tab === 'fin' && <Finance />}
        {tab === 'flip' && <Flip />}
        {tab === 'set' && <Settings />}
      </main>
    </div>
  );
}