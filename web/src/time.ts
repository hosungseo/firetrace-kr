// All times are minutes since 2025-03-21 00:00 KST.
export const T0_MS = Date.UTC(2025, 2, 20, 15, 0) // 2025-03-21 00:00 KST
export const T_MIN = 1 * 1440 // 3/22 00:00
export const T_MAX = 8 * 1440 // 3/29 00:00
export const ACTIVE_WINDOW = 12 * 60 // hotspots younger than this are "active"

export const toMinutes = (iso: string) => Math.round((Date.parse(iso) - T0_MS) / 60000)

export function fmt(t: number, withDay = true) {
  const d = 21 + Math.floor(t / 1440)
  const hh = String(Math.floor((t % 1440) / 60)).padStart(2, '0')
  const mm = String(Math.floor(t % 60)).padStart(2, '0')
  return withDay ? `3월 ${d}일 ${hh}:${mm}` : `${hh}:${mm}`
}

export const hourIndex = (t: number) => Math.max(0, Math.min(263, Math.floor(t / 60)))

export const compass = (deg: number) =>
  ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'][
    Math.round(deg / 22.5) % 16
  ]
