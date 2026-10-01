import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { db } from './db';
import { seedDemo } from './seed';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
navigator.storage?.persist?.().catch(() => {});
db.on('ready', async () => {
  const seeded = await db.kv.get('seeded');
  if (!seeded && !(await db.accounts.count())) await seedDemo();
});