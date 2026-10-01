export type Minor = number; // копейки, integer
export const DAY = 86_400_000;
export const DIM = 30.44;   // дней в месяце

export const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const toMinor = (rub: number) => Math.round(rub * 100);
export const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const daysBetween = (a: number, b: number) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function fmtMinor(m: Minor, cur = '₽'): string {
  const sign = m < 0 ? '−' : '', abs = Math.abs(m);
  const s = new Intl.NumberFormat('ru-RU').format(Math.floor(abs / 100));
  const k = abs % 100;
  return k ? `${sign}${s},${String(k).padStart(2, '0')} ${cur}` : `${sign}${s} ${cur}`;
}
export const fmtPct = (x: number, d = 1) => `${x.toFixed(d)}%`;
export const fmtDays = (d: number | null) => (d == null ? '—' : `${Math.floor(d)} дн`);