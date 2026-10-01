import { useEffect, useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { db } from './db';

const CONFIG_KEY = 'capital-os-cloud-config-v1';
const CLOUD_TABLE = 'capital_os_sync';
const POLL_INTERVAL = 5000;
const SAVE_DELAY = 700;

type CloudConfig = { url: string; anonKey: string };
type Snapshot = Record<string, unknown[]>;
type CloudRow = { data: Snapshot; updated_at: string };
export type CloudStatus = 'unconfigured' | 'signed-out' | 'loading' | 'syncing' | 'synced' | 'offline' | 'conflict';

function readConfig(): CloudConfig {
  try {
    const value = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}');
    return { url: typeof value.url === 'string' ? value.url : '', anonKey: typeof value.anonKey === 'string' ? value.anonKey : '' };
  } catch { return { url: '', anonKey: '' }; }
}

async function readLocalSnapshot(): Promise<Snapshot> {
  const rows = await Promise.all(db.tables.map(async table => [table.name, await table.toArray()] as const));
  return Object.fromEntries(rows);
}

async function replaceLocalSnapshot(snapshot: Snapshot) {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
      const rows = snapshot[table.name];
      if (Array.isArray(rows) && rows.length) await table.bulkPut(rows as never[]);
    }
  });
}

function messageFor(error: unknown) {
  const text = error instanceof Error ? error.message.toLowerCase() : '';
  if (text.includes('invalid login') || text.includes('invalid credentials')) return 'Не удалось войти. Проверьте email и пароль.';
  if (text.includes('already registered')) return 'Этот email уже зарегистрирован. Попробуйте войти.';
  if (text.includes('email not confirmed')) return 'Сначала подтвердите email по ссылке из письма.';
  if (text.includes('failed to fetch') || text.includes('network')) return 'Нет связи с облаком. Проверьте интернет и настройки Supabase.';
  return 'Не удалось выполнить действие. Проверьте настройки Supabase и SQL-схему.';
}

export function useCloudSync() {
  const [config, setConfig] = useState<CloudConfig>(readConfig);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [status, setStatus] = useState<CloudStatus>('unconfigured');
  const [error, setError] = useState('');
  const [cloudVersion, setCloudVersion] = useState<CloudRow | null>(null);
  const engineRef = useRef<{ chooseLocal: () => Promise<void>; chooseCloud: () => Promise<void> } | null>(null);

  useEffect(() => {
    setSession(null);
    setAuthReady(false);
    setClient(null);
    setError('');
    let active = true;
    if (!config.url.trim() || !config.anonKey.trim()) {
      setStatus('unconfigured');
      return () => { active = false; };
    }
    try { new URL(config.url); }
    catch {
      setStatus('offline');
      setError('Проверьте адрес проекта Supabase.');
      return () => { active = false; };
    }
    setStatus('loading');
    void import('@supabase/supabase-js').then(({ createClient }) => {
      if (active) setClient(createClient(config.url, config.anonKey));
    }).catch(() => {
      if (active) { setStatus('offline'); setError('Не удалось загрузить клиент Supabase.'); }
    });
    return () => { active = false; };
  }, [config.url, config.anonKey]);

  useEffect(() => {
    if (!client) return;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    let active = true;
    void client.auth.getSession().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError) setError(messageFor(authError));
      setSession(data.session);
      setAuthReady(true);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [client]);

  useEffect(() => {
    if (!client || !authReady || !session?.user.id) {
      if (authReady && !session) setStatus(client ? 'signed-out' : 'unconfigured');
      return;
    }

    const userId = session.user.id;
    let active = true;
    let applyingCloud = false;
    let pushing = false;
    let conflicted = false;
    let offline = false;
    let pendingLocalChange = false;
    let knownVersion: string | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const fetchCloud = async () => {
      const { data, error: fetchError } = await client.from(CLOUD_TABLE)
        .select('data, updated_at').eq('user_id', userId).maybeSingle();
      if (fetchError) throw fetchError;
      return data as CloudRow | null;
    };

    const applyCloud = async (remote: CloudRow) => {
      applyingCloud = true;
      try { await replaceLocalSnapshot(remote.data); }
      finally { applyingCloud = false; }
      conflicted = false;
      offline = false;
      knownVersion = remote.updated_at;
      setCloudVersion(remote);
      setStatus('synced');
      setError('');
    };

    const raiseConflict = async () => {
      const latest = await fetchCloud();
      if (!latest) return;
      conflicted = true;
      setCloudVersion(latest);
      setStatus('conflict');
      setError('На другом устройстве данные уже изменились. Выберите, какую копию оставить.');
    };

    const insertSnapshot = async (snapshot: Snapshot) => {
      const { data, error: insertError } = await client.from(CLOUD_TABLE)
        .insert({ user_id: userId, data: snapshot }).select('data, updated_at').single();
      if (insertError) throw insertError;
      return data as CloudRow;
    };

    const updateSnapshot = async (snapshot: Snapshot, expectedVersion: string) => {
      const { data, error: updateError } = await client.from(CLOUD_TABLE)
        .update({ data: snapshot }).eq('user_id', userId).eq('updated_at', expectedVersion)
        .select('data, updated_at').maybeSingle();
      if (updateError) throw updateError;
      return data as CloudRow | null;
    };

    const pushSnapshot = async (allowOverwrite = false) => {
      if (!active || pushing || applyingCloud) return;
      if (conflicted && !allowOverwrite) return;
      pushing = true;
      pendingLocalChange = false;
      setStatus('syncing');
      try {
        const remote = await fetchCloud();
        if (remote && knownVersion && remote.updated_at !== knownVersion && !allowOverwrite) {
          conflicted = true;
          setCloudVersion(remote);
          setStatus('conflict');
          setError('На другом устройстве данные уже изменились. Выберите, какую копию оставить.');
          return;
        }
        const snapshot = await readLocalSnapshot();
        let saved: CloudRow | null;
        if (!remote) saved = await insertSnapshot(snapshot);
        else if (allowOverwrite || remote.updated_at === knownVersion) saved = await updateSnapshot(snapshot, remote.updated_at);
        else saved = null;

        if (!saved) {
          await raiseConflict();
          return;
        }
        conflicted = false;
        offline = false;
        knownVersion = saved.updated_at;
        setCloudVersion(saved);
        setStatus('synced');
        setError('');
      } catch (syncError) {
        offline = true;
        pendingLocalChange = true;
        setStatus(conflicted ? 'conflict' : 'offline');
        setError(messageFor(syncError));
      } finally {
        pushing = false;
        if (active && pendingLocalChange && !offline && !conflicted) scheduleSave();
      }
    };

    const scheduleSave = () => {
      if (!active || applyingCloud) return;
      pendingLocalChange = true;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveTimer = undefined; void pushSnapshot(); }, SAVE_DELAY);
    };

    const onLocalMutation = () => scheduleSave();
    const subscriptions = db.tables.map(table => {
      table.hook('creating').subscribe(onLocalMutation);
      table.hook('updating').subscribe(onLocalMutation);
      table.hook('deleting').subscribe(onLocalMutation);
      return () => {
        table.hook('creating').unsubscribe(onLocalMutation);
        table.hook('updating').unsubscribe(onLocalMutation);
        table.hook('deleting').unsubscribe(onLocalMutation);
      };
    });

    const pollCloud = async () => {
      if (!active || pushing || applyingCloud || conflicted) return;
      try {
        const remote = await fetchCloud();
        if (!remote) {
          if (knownVersion === null) { pendingLocalChange = true; void pushSnapshot(); }
          return;
        }
        if (knownVersion === null) {
          if (pendingLocalChange) await raiseConflict();
          else await applyCloud(remote);
          return;
        }
        if (remote.updated_at === knownVersion) {
          if (pendingLocalChange && offline) void pushSnapshot();
          else if (offline) {
            offline = false;
            setStatus('synced');
            setError('');
          }
          return;
        }
        if (pendingLocalChange) {
          conflicted = true;
          setCloudVersion(remote);
          setStatus('conflict');
          setError('На другом устройстве данные уже изменились. Выберите, какую копию оставить.');
        } else await applyCloud(remote);
      } catch (syncError) {
        if (active) { offline = true; setStatus('offline'); setError(messageFor(syncError)); }
      }
    };

    const initialize = async () => {
      setStatus('loading');
      setError('');
      try {
        const remote = await fetchCloud();
        if (!active) return;
        if (remote) await applyCloud(remote);
        else {
          const localSnapshot = await readLocalSnapshot();
          const saved = await insertSnapshot(localSnapshot);
          knownVersion = saved.updated_at;
          setCloudVersion(saved);
          setStatus('synced');
        }
      } catch (syncError) {
        if (active) { setStatus('offline'); setError(messageFor(syncError)); }
      } finally {
        if (active && !pollTimer) pollTimer = setInterval(() => { void pollCloud(); }, POLL_INTERVAL);
      }
    };

    const engine = {
      chooseLocal: () => pushSnapshot(true),
      chooseCloud: async () => {
        try {
          setStatus('loading');
          const latest = await fetchCloud();
          if (!latest) throw new Error('missing cloud snapshot');
          await applyCloud(latest);
        } catch (syncError) {
          setStatus(conflicted ? 'conflict' : 'offline');
          setError(messageFor(syncError));
        }
      },
    };
    engineRef.current = engine;

    void initialize();
    return () => {
      active = false;
      if (engineRef.current === engine) engineRef.current = null;
      if (saveTimer) clearTimeout(saveTimer);
      if (pollTimer) clearInterval(pollTimer);
      subscriptions.forEach(unsubscribe => unsubscribe());
    };
  }, [client, authReady, session?.user.id]);

  const saveConfig = (url: string, anonKey: string) => {
    const next = { url: url.trim().replace(/\/$/, ''), anonKey: anonKey.trim() };
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(next)); } catch {}
    setConfig(next);
  };

  const signIn = async (email: string, password: string) => {
    if (!client) return 'Сначала сохраните URL и публичный ключ проекта Supabase.';
    const { error: authError } = await client.auth.signInWithPassword({ email, password });
    return authError ? messageFor(authError) : null;
  };

  const signUp = async (email: string, password: string) => {
    if (!client) return 'Сначала сохраните URL и публичный ключ проекта Supabase.';
    const emailRedirectTo = new URL(window.location.pathname, window.location.origin).toString();
    const { data, error: authError } = await client.auth.signUp({ email, password, options: { emailRedirectTo } });
    if (authError) return messageFor(authError);
    return data.session ? null : 'Проверьте почту и подтвердите регистрацию, затем войдите.';
  };

  const signOut = async () => {
    if (!client) return;
    const { error: authError } = await client.auth.signOut();
    if (authError) setError(messageFor(authError));
  };

  const chooseLocal = async () => {
    if (!cloudVersion) return;
    setError('');
    await engineRef.current?.chooseLocal();
  };

  const chooseCloud = async () => {
    if (!cloudVersion) return;
    await engineRef.current?.chooseCloud();
  };

  return {
    config, configured: Boolean(client), session, authReady, status, error, cloudVersion,
    saveConfig, signIn, signUp, signOut, chooseLocal, chooseCloud,
  };
}
