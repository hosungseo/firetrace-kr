// All times are minutes since the incident's t0 (00:00 KST of the day before ignition).
// The module keeps live bindings that setIncident() rewrites when the user switches incident.
export let T0_MS = Date.UTC(2025, 2, 20, 15, 0) // 2025-03-21 00:00 KST (uiseong-2025 default)
export let T_MIN = 1 * 1440 // display window start (ignition day 00:00)
export let T_MAX = 8 * 1440 // display window end
export const ACTIVE_WINDOW = 12 * 60 // hotspots younger than this are "active"

export function setIncident(t0Iso: string, displayDays: number) {
  T0_MS = Date.parse(t0Iso)
  T_MIN = 1440
  T_MAX = Math.max(2, displayDays) * 1440
}

export const toMinutes = (iso: string) => Math.round((Date.parse(iso) - T0_MS) / 60000)

// KST calendar parts for a timeline minute
export function kst(t: number) {
  const d = new Date(T0_MS + t * 60000 + 9 * 3600 * 1000) // shift so that UTC getters read KST
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() }
}

export function fmt(t: number, withDay = true) {
  const k = kst(t)
  const hm = `${String(k.hh).padStart(2, '0')}:${String(k.mm).padStart(2, '0')}`
  return withDay ? `${k.mo}월 ${k.d}일 ${hm}` : hm
}

export const fmtDay = (t: number) => {
  const k = kst(t)
  return `${k.mo}/${k.d}`
}
export const kstDate = (t: number) => {
  const k = kst(t)
  return `${k.y}-${String(k.mo).padStart(2, '0')}-${String(k.d).padStart(2, '0')}`
}

// index into hourly arrays (clamped to the array length when given)
export const hourIndex = (t: number, n = Infinity) => Math.max(0, Math.min(n - 1, Math.floor(t / 60)))

export const compass = (deg: number) =>
  ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'][
    Math.round(deg / 22.5) % 16
  ]

// Event label from the ISO string itself, honoring the reported precision.
export function eventLabel(iso: string, precision?: string) {
  const [, mo, d, hh, mm] = iso.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/) ?? []
  const day = `${Number(mo)}월 ${Number(d)}일`
  if (precision === 'day') return day
  if (precision === 'hour') return `${day} ${hh}시경`
  return `${day} ${hh}:${mm}`
}
