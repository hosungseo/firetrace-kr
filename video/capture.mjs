// Continuous CDP screencast of the local app; prints segment marks for cutting.
import { chromium } from 'playwright'
import fs from 'node:fs'

const OUT = new URL('./capture/', import.meta.url).pathname
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await page.goto('http://localhost:5188/#uiseong-2025')
await page.waitForTimeout(9000)
const cdp = await page.context().newCDPSession(page)
const frames = []
cdp.on('Page.screencastFrame', async (f) => {
  const name = `f${String(frames.length).padStart(5, '0')}.jpg`
  fs.writeFileSync(OUT + name, Buffer.from(f.data, 'base64'))
  frames.push({ name, ts: f.metadata.timestamp })
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})
const marks = []
const mark = (k) => { marks.push({ k, ts: Date.now() / 1000 }); console.log('mark', k) }
const key = (k) => page.keyboard.press(k)

// set an opening time: 3/25 21:00 (after the run), overview camera
await page.evaluate(() => { document.activeElement?.blur() })
for (let i = 0; i < 1; i++) await key('7')      // scene 7 = 주불 진화 → overview camera
await page.waitForTimeout(3000)
await key('4'); await page.waitForTimeout(300); // jump clock to 3/25 17:20 without waiting the fly
// back to overview camera at that time
await page.evaluate(() => { const m = window.__map; m.jumpTo({ center: [128.95, 36.45], zoom: 9.3, pitch: 50, bearing: -8 }); return 1 })
await page.waitForTimeout(2500)
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
await page.waitForTimeout(400)

mark('overview')          // slow orbit
await page.evaluate(() => { window.__map.easeTo({ bearing: 12, pitch: 56, zoom: 9.5, duration: 3200, easing: (t) => t * (2 - t) }); return 1 })
await page.waitForTimeout(3300)

mark('fly')               // scene 4: fly along the run
await key('4')
await page.waitForTimeout(3600)

mark('chase')             // follow the head in 10-minute steps
await page.click('.hc-actions button:first-child')
await page.waitForTimeout(300)
for (let i = 0; i < 12; i++) { await key('Shift+ArrowRight'); await page.waitForTimeout(420) }
await page.waitForTimeout(600)

mark('records')           // 기록 대조 table
await page.evaluate(() => { [...document.querySelectorAll('.tabs button')].find((b) => b.innerText.startsWith('기록 대조')).click(); return 1 })
await page.waitForTimeout(500)
await page.evaluate(() => { const p = document.querySelector('.pane'); p.scrollTo({ top: document.querySelector('.rp-cmp').offsetTop - 90, behavior: 'smooth' }); return 1 })
await page.waitForTimeout(3000)
mark('end')
await cdp.send('Page.stopScreencast')
await page.waitForTimeout(300)
fs.writeFileSync(OUT + 'frames.json', JSON.stringify({ frames, marks }))
console.log(frames.length, 'frames')
await browser.close()
