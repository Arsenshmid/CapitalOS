import { useEffect, useState } from 'react';
import type { useCloudSync } from '../cloudSync';

type SyncManager = ReturnType<typeof useCloudSync>;

const STATUS_LABELS = {
  unconfigured: 'Нужно подключить Supabase',
  'signed-out': 'Войдите, чтобы включить синхронизацию',
  loading: 'Проверяем облачные данные…',
  syncing: 'Синхронизируем данные…',
  synced: 'Все данные синхронизированы',
  offline: 'Нет связи с облаком',
  conflict: 'На устройствах разные версии данных',
} as const;

export default function CloudSync({ sync }: { sync: SyncManager }) {
  const [url, setUrl] = useState(sync.config.url);
  const [anonKey, setAnonKey] = useState(sync.config.anonKey);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [createAccount, setCreateAccount] = useState(false);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setUrl(sync.config.url);
    setAnonKey(sync.config.anonKey);
  }, [sync.config.url, sync.config.anonKey]);

  const saveConfig = () => {
    sync.saveConfig(url, anonKey);
    setMessage('Настройки проекта сохранены на этом устройстве.');
  };

  const authenticate = async () => {
    if (!email.trim() || password.length < 6) {
      setMessage('Укажите email и пароль длиной не менее 6 символов.');
      return;
    }
    setWorking(true);
    setMessage('');
    const result = createAccount
      ? await sync.signUp(email.trim(), password)
      : await sync.signIn(email.trim(), password);
    setWorking(false);
    setMessage(result ?? (createAccount ? 'Аккаунт создан. Подключаем синхронизацию…' : 'Вы вошли. Подключаем синхронизацию…'));
    setPassword('');
  };

  const canConfigure = url.trim().length > 0 && anonKey.trim().length > 0;

  return <section className="card cloud-sync-card">
    <h2>Синхронизация между устройствами</h2>
    <div className="sync-status" data-state={sync.status} role="status">
      <span className="status-dot" />{STATUS_LABELS[sync.status]}
      {sync.session?.user.email && <strong>{sync.session.user.email}</strong>}
    </div>

    <div className="sync-config">
      <label>Адрес проекта Supabase
        <input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://ваш-проект.supabase.co" autoComplete="url" />
      </label>
      <label>Публичный ключ проекта (anon / publishable)
        <input type="password" value={anonKey} onChange={event => setAnonKey(event.target.value)} placeholder="sb_publishable_… или anon key" autoComplete="off" />
      </label>
      <button onClick={saveConfig} disabled={!canConfigure}>Сохранить подключение</button>
    </div>

    {!sync.session && <div className="sync-auth">
      <h3>{createAccount ? 'Создать аккаунт синхронизации' : 'Войти в свой аккаунт'}</h3>
      <div className="frm">
        <input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email" autoComplete="email" />
        <input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Пароль (не менее 6 символов)" autoComplete={createAccount ? 'new-password' : 'current-password'} />
        <button className="primary" onClick={authenticate} disabled={!sync.configured || !sync.authReady || working}>
          {working ? 'Подождите…' : createAccount ? 'Создать аккаунт' : 'Войти'}
        </button>
      </div>
      <button className="text-action" onClick={() => { setCreateAccount(value => !value); setMessage(''); }}>
        {createAccount ? 'Уже есть аккаунт? Войти' : 'Создать новый аккаунт'}
      </button>
    </div>}

    {sync.session && <div className="sync-account">
      <p>Изменения отправляются автоматически. Новое устройство загрузит эту копию после входа в тот же аккаунт.</p>
      {sync.status === 'conflict' && <div className="sync-conflict">
        <p>Выберите, какую версию оставить. Выбранная копия заменит другую целиком.</p>
        <div className="actions">
          <button className="primary" onClick={() => void sync.chooseLocal()}>Оставить данные этого устройства</button>
          <button onClick={() => void sync.chooseCloud()}>Загрузить данные из облака</button>
        </div>
      </div>}
      {sync.status === 'synced' && sync.cloudVersion && <p className="muted">Последнее обновление: {new Date(sync.cloudVersion.updated_at).toLocaleString('ru-RU')}</p>}
      <button onClick={() => void sync.signOut()}>Выйти из аккаунта</button>
    </div>}

    {(sync.error || message) && <p className="sync-message" role="status">{message || sync.error}</p>}
    <p className="muted sync-privacy">Финансовые данные будут храниться в вашем проекте Supabase. Пароль используется только для входа и не сохраняется приложением. Настройте проект отдельно на каждом устройстве.</p>
  </section>;
}