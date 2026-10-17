// Frame-by-frame cinematic capture: full-bleed night map, clock + camera driven per frame.
import { chromium } from 'playwright'
import fs from 'node:fs'

const FPS = 30
const OUT = new URL('./capture2/', import.meta.url).pathname
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true })
const gk = JSON.parse(fs.readFileSync(new URL('../web/public/data/uiseong-2025/gk2a.json', import.meta.url)))
const IGN = gk.ignition
const km = (a, b) => Math.hypot((b[0] - a[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), (b[1] - a[1]) * 110.57)
const bearing = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI + 360) % 360
const headAt = (t) => [...gk.head].reverse().find((h) => h[0] <= t)
// monotone leading edge: the head entry with the largest reach so far (never steps back)
const lead = []; let bestH = null
for (const h of gk.head) { if (!bestH || h[3] > bestH[3]) bestH = h; lead.push([h[0], bestH[1], bestH[2], bestH[3]]) }
const leadAt = (t) => [...lead].reverse().find((h) => h[0] <= t) ?? lead[0]
const reachAt = (t) => [...gk.reach].reverse().find((r) => r[0] <= t)?.[1] ?? 0
const lerp = (a, b, k) => a + (b - a) * k
const lerpAng = (a, b, k) => a + ((((b - a) % 360) + 540) % 360 - 180) * k
const ease = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2

// Scenes: A fast-forward (0-3 s), B the run (3-11 s), C pull back (11-13.5 s)
const A = { f0: 0, f1: 90, t0: 2100, t1: 6660 }
const B = { f0: 90, f1: 330, t0: 6660, t1: 7020 }
const C = { f0: 330, f1: 405, t0: 7020, t1: 8640 }
const N = C.f1
const simT = (f) => {
  if (f < A.f1) return lerp(A.t0, A.t1, f / (A.f1 - A.f0))
  if (f < B.f1) return lerp(B.t0, B.t1, (f - B.f0) / (B.f1 - B.f0))
  return lerp(C.t0, C.t1, ease((f - C.f0) / (C.f1 - C.f0)))
}

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await page.goto('http://localhost:5188/#uiseong-2025')
await page.waitForTimeout(8000)
await page.addStyleTag({ content: `
  .topbar, .panel, .dock, .now-card, .head-card, .basemap-switch, .layers-btn, .legend-btn, .map-legend, .maplibregl-ctrl, .stn { display: none !important; }
  .app { grid-template-rows: 0 1fr 0 !important; } .body { grid-template-columns: 1fr 0 !important; }
  .stage { position: fixed !important; inset: 0 !important; }
  #ov { position: fixed; inset: 0; pointer-events: none; font-family: Pretendard, -apple-system, sans-serif; color: #fff; }
  #clock { position: absolute; right: 56px; top: 44px; text-align: right; text-shadow: 0 2px 12px rgba(0,0,0,.8); }
  #clock .d { font-size: 30px; font-weight: 600; color: #d9d2c5; letter-spacing: 1px; }
  #clock .h { font-size: 84px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -1px; margin-top: 2px; }
  #dist { position: absolute; right: 56px; bottom: 54px; text-align: right; text-shadow: 0 2px 12px rgba(0,0,0,.8); opacity: 0; transition: opacity .4s; }
  #dist .l { font-size: 22px; color: #d9d2c5; font-weight: 500; }
  #dist .v { font-size: 96px; font-weight: 900; color: #22d3ee; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -2px; }
  #dist .v small { font-size: 36px; font-weight: 700; color: #a5f3fc; margin-left: 6px; letter-spacing: 0; }
  #dist .s { font-size: 20px; color: #a5f3fc; margin-top: 6px; }
  #vig { position: fixed; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%); }
` })
await page.evaluate(() => {
  document.body.insertAdjacentHTML('beforeend', `<div id="vig"></div><div id="ov"><div id="clock"><div class="d"></div><div class="h"></div></div><div id="dist"><div class="l">발화점에서</div><div class="v"><span id="dv">0.0</span><small>km</small></div><div class="s" id="ds"></div></div></div>`)
  const ft = window.__ft
  ft.setBasemap('night'); ft.setTab('overview'); ft.setPlaying(false); ft.setChase(false)
  ft.setLayers({ gk2a: true, spread: true, active: true, burned: true, wind: true, smoke: false, stations: false, events: false, emd: true, gwis: false, situation: false, forest: false, terrain: true })
  window.__map.resize()
  return 1
})
await page.waitForTimeout(2500)
await page.evaluate(() => { const m = window.__map; m.setPaintProperty('gk2a-px', 'circle-opacity', 0); m.setPaintProperty('gk2a-px', 'circle-stroke-width', 0); m.setPaintProperty('emd-hit', 'fill-opacity', 0.05); m.setPaintProperty('emd-fill', 'fill-opacity', 0); m.setPaintProperty('gk2a-track', 'line-width', 4.5); return 1 })

const idle = () => page.evaluate(() => new Promise((r) => { const m = window.__map; let done = false; const fin = () => { if (!done) { done = true; r(1) } }; if (m.loaded() && m.areTilesLoaded() && !m.isMoving()) return fin(); m.once('idle', fin); setTimeout(fin, 2500) }))
const fmtT = (t) => { const d = new Date(Date.UTC(2025, 2, 20, 15, 0) + t * 60000 + 9 * 3600000); return [`${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`, `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`] }

// camera state
let cam = { lon: 128.70, lat: 36.37, zoom: 9.9, pitch: 50, bearing: -18 }
let bear = 75
// warm the tile cache along the path once (no capture)
for (let pass = 0; pass < 2; pass++) {
  for (let f = 0; f < N; f++) {
    const t = simT(f)
    let target
    if (f < A.f1) { const k = f / A.f1; target = { lon: lerp(128.70, 128.76, k), lat: lerp(36.37, 36.40, k), zoom: lerp(9.9, 9.7, k), pitch: 50, bearing: lerp(-18, 4, k) } }
    else if (f < B.f1) {
      const h = leadAt(t + 15); const prev = leadAt(t - 90)
      if (h && prev && km(prev.slice(1, 3), h.slice(1, 3)) > 1.2) bear = lerpAng(bear, bearing(prev.slice(1, 3), h.slice(1, 3)), 0.08)
      const fwd = 1.4 / 110.57; const lon = h[1] + Math.sin(bear * Math.PI / 180) * fwd / Math.cos(h[2] * Math.PI / 180); const lat = h[2] + Math.cos(bear * Math.PI / 180) * fwd
      target = { lon, lat, zoom: 10.25, pitch: 58, bearing: bear }
    } else { target = { lon: 128.87, lat: 36.43, zoom: 9.0, pitch: 46, bearing: 0 } }
    const k = f < A.f1 ? 0.07 : f < B.f1 ? 0.12 : 0.045
    cam = { lon: lerp(cam.lon, target.lon, k), lat: lerp(cam.lat, target.lat, k), zoom: lerp(cam.zoom, target.zoom, k), pitch: lerp(cam.pitch, target.pitch, k), bearing: lerpAng(cam.bearing, target.bearing, k) }
    if (pass === 0 && f % 6) continue
    const [dd, hh] = fmtT(t); const reach = reachAt(t); const prevR = reachAt(t - 60)
    await page.evaluate(({ cam, t, dd, hh, reach, adv, showDist }) => {
      window.__ft.setT(t)
      window.__map.jumpTo({ center: [cam.lon, cam.lat], zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing })
      document.querySelector('#clock .d').textContent = dd; document.querySelector('#clock .h').textContent = hh
      document.getElementById('dv').textContent = reach.toFixed(1); document.getElementById('ds').textContent = adv > 0.3 ? `최근 1시간 +${adv.toFixed(1)} km` : ''
      document.getElementById('dist').style.opacity = showDist ? 1 : 0
      return 1
    }, { cam, t, dd, hh, reach, adv: reach - prevR, showDist: f >= 70 })
    await idle()
    if (pass === 1) await page.screenshot({ path: OUT + `f${String(f).padStart(4, '0')}.png`, type: 'png' })
    if (pass === 1 && f >= B.f0 && f < B.f1 && f % 15 === 0) { const L = leadAt(t); const pt = await page.evaluate((ll) => { const p = window.__map.project(ll); return [Math.round(p.x), Math.round(p.y)] }, [L[1], L[2]]); console.log('lead on screen', f, hh, pt.join(',')) }
    if (pass === 1 && f % 60 === 0) console.log('frame', f, hh, reach.toFixed(1))
  }
  cam = { lon: 128.70, lat: 36.37, zoom: 9.9, pitch: 50, bearing: -18 }; bear = 75
}
await browser.close()
console.log('done', N)
