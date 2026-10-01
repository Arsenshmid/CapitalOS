import type { Component, Build, Minor } from '../types';

export interface Check { pair: string; level: 'OK' | 'WARN' | 'FAIL'; msg: string }
export interface Parts { cpu?: any; mb?: any; gpu?: any; psu?: any; case_?: any; cooler?: any; ram: any[]; storage: any[] }
type Rule = (p: Parts) => Check | Check[] | null;
const C = (pair: string, level: Check['level'], msg: string): Check => ({ pair, level, msg });

export const COMPAT_RULES: Rule[] = [
  p => { if (!p.cpu || !p.mb) return null;
    if (p.cpu.socket !== p.mb.socket) return C('CPU↔MB', 'FAIL', `Сокет ${p.cpu.socket} не подходит к сокету ${p.mb.socket}`);
    if (p.cpu.generation != null && p.mb.gens?.length && !p.mb.gens.includes(p.cpu.generation))
      return C('CPU↔MB', 'WARN', `Плата не заявлена для процессора ${p.cpu.generation}-го поколения — проверьте поддержку BIOS`);
    return C('CPU↔MB', 'OK', 'Сокет и поколение совместимы'); },
  p => { if (!p.mb || !p.ram.length) return null;
    const bad = p.ram.find(r => r.type !== p.mb.ramType);
    if (bad) return C('RAM↔MB', 'FAIL', `Память ${bad.type} не подойдёт к плате с типом ${p.mb.ramType}`);
    const mods = p.ram.reduce((s, r) => s + (r.moduleCount ?? 1), 0);
    const gb = p.ram.reduce((s, r) => s + (r.moduleSizeGb ?? 0) * (r.moduleCount ?? 1), 0);
    const out: Check[] = [];
    if (p.mb.dimmSlots != null && mods > p.mb.dimmSlots) out.push(C('RAM↔MB', 'FAIL', `Модулей памяти: ${mods}, доступно слотов: ${p.mb.dimmSlots}`));
    if (p.mb.maxRamGb != null && gb > p.mb.maxRamGb) out.push(C('RAM↔MB', 'FAIL', `${gb} ГБ — больше максимума платы ${p.mb.maxRamGb} ГБ`));
    for (const r of p.ram) if (r.freqMhz && p.mb.maxMemFreq && r.freqMhz > p.mb.maxMemFreq)
      out.push(C('RAM↔MB', 'WARN', `Частота ${r.freqMhz} МГц выше поддерживаемых ${p.mb.maxMemFreq} МГц — память будет работать медленнее`));
    if (!out.length) out.push(C('RAM↔MB', 'OK', `Совместимо: ${gb} ГБ ${p.mb.ramType}`));
    return out; },
  p => { if (!p.mb || !p.case_) return null;
    return (p.case_.boards ?? []).includes(p.mb.formFactor)
      ? C('MB↔Case', 'OK', 'Форм-фактор совместим')
      : C('MB↔Case', 'FAIL', `Корпус не поддерживает формат платы ${p.mb.formFactor}`); },
  p => { if (!p.gpu || !p.psu) return null;
    if (p.cpu?.tdp == null || p.gpu.tdp == null) return C('GPU↔PSU', 'WARN', 'Не хватает данных о тепловыделении для расчёта мощности');
    const req = Math.ceil((p.cpu.tdp + p.gpu.tdp + 75) * 1.2);
    if (p.gpu.conns?.length && (p.psu.conns ?? []).filter((c: string) => c.startsWith('PCIe')).length < p.gpu.conns.length)
      return C('GPU↔PSU', 'FAIL', `Видеокарте нужно ${p.gpu.conns.length} разъёмов PCIe, а у блока питания их меньше`);
    if (p.psu.watt < req) return C('GPU↔PSU', 'FAIL', `Мощность блока питания ${p.psu.watt} Вт ниже расчётных ${req} Вт (с запасом 20%)`);
    if (p.psu.watt < Math.ceil(req * 1.1)) return C('GPU↔PSU', 'WARN', `Небольшой запас мощности: рекомендуется от ${Math.ceil(req * 1.1)} Вт`);
    return C('GPU↔PSU', 'OK', `Мощности достаточно: нужно не менее ${req} Вт`); },
  p => { if (!p.gpu || !p.case_) return null;
    if (p.gpu.lenMm != null && p.case_.gpuMm != null && p.gpu.lenMm > p.case_.gpuMm)
      return C('GPU↔Case', 'FAIL', `Видеокарта длиной ${p.gpu.lenMm} мм не помещается: максимум ${p.case_.gpuMm} мм`);
    return C('GPU↔Case', 'OK', 'Видеокарта помещается в корпус'); },
  p => { if (!p.cooler || !p.cpu) return null;
    if (!(p.cooler.sockets ?? []).includes(p.cpu.socket)) return C('Cooler↔CPU', 'FAIL', `Кулер не подходит к сокету ${p.cpu.socket}`);
    if (p.cpu.tdp != null && p.cooler.tdp != null && p.cooler.tdp < p.cpu.tdp)
      return C('Cooler↔CPU', 'WARN', 'Кулер может не справиться с охлаждением процессора под нагрузкой');
    return C('Cooler↔CPU', 'OK', 'Кулер подходит к процессору'); },
  p => { if (!p.cooler || !p.case_) return null;
    if (p.cooler.hMm != null && p.case_.coolerMm != null && p.cooler.hMm > p.case_.coolerMm)
      return C('Cooler↔Case', 'FAIL', `Кулер высотой ${p.cooler.hMm} мм не помещается: максимум ${p.case_.coolerMm} мм`);
    return null; },
  p => { if (!p.mb || !p.storage.length) return null;
    let sata = 0; const m2 = { SATA: 0, NVME: 0 };
    for (const s of p.storage) { if (s.iface === 'SATA') sata++; else m2[s.iface === 'M2_SATA' ? 'SATA' : 'NVME']++; }
    const out: Check[] = [];
    if (p.mb.sata != null && sata > p.mb.sata) out.push(C('Storage↔MB', 'FAIL', `Накопителей SATA: ${sata}, доступно портов: ${p.mb.sata}`));
    const slots = { SATA: p.mb.m2sata ?? 0, NVME: p.mb.m2nvme ?? 0 };
    for (const k of ['SATA', 'NVME'] as const)
      if (m2[k] > slots[k]) out.push(C('Storage↔MB', 'FAIL', `Накопителей M.2 ${k}: ${m2[k]}, доступно разъёмов: ${slots[k]}`));
    if (!out.length) out.push(C('Storage↔MB', 'OK', 'Разъёмов достаточно'));
    return out; },
];

export function checkCompat(p: Parts): Check[] {
  const out: Check[] = [];
  for (const r of COMPAT_RULES) { const res = r(p); if (res) out.push(...(Array.isArray(res) ? res : [res])); }
  return out;
}
export const hasFail = (cs: Check[]) => cs.some(c => c.level === 'FAIL');

/** GL-себестоимость (только комплектующие — ровно то, что лежит в WIP) */
export const compCost = (b: Build, byId: Map<string, Component>) =>
  b.componentIds.reduce((s, id) => s + (byId.get(id)?.priceMinor ?? 0), 0);
/** Полная себестоимость для ROI (GL + доп.расходы сборки) */
export const fullCost = (b: Build, byId: Map<string, Component>) => compCost(b, byId) + b.extras.reduce((s, e) => s + e.amt, 0);

export function dealMetrics(cost: Minor, price: Minor, fee: Minor = 0) {
  const profit = price - fee - cost;
  return { profit, marginPct: price ? (profit / price) * 100 : 0, roiPct: cost ? (profit / cost) * 100 : 0 };
}

export function specLine(comps: Component[]): string {
  const one = (k: string) => comps.find(c => c.category === k);
  const ramGb = comps.filter(c => c.category === 'RAM')
    .reduce((s, c) => s + (c.specs.moduleSizeGb ?? 0) * (c.specs.moduleCount ?? 1), 0);
  const cpu = one('CPU'), gpu = one('GPU'), st = one('STORAGE');
  return [cpu && `${cpu.brand} ${cpu.model}`, ramGb && `${ramGb} ГБ`,
    gpu && `${gpu.brand} ${gpu.model}`, st && st.model].filter(Boolean).join(' / ') || '—';
}