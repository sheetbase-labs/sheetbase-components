import { chromium } from 'playwright-core'
const [url, out, w = '1500', h = '920', actions = ''] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } })
const logs = []
page.on('console', (msg) => { if (['error', 'warning'].includes(msg.type())) logs.push(`${msg.type()}: ${msg.text()}`) })
page.on('response', (r) => { if (r.status() >= 400) logs.push(`HTTP ${r.status()} ${r.url()}`) })
page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
if (actions) {
  for (const step of actions.split(';;')) {
    const [kind, ...rest] = step.split('::')
    const arg = rest.join('::')
    if (kind === 'click') await page.locator(arg).first().click()
    else if (kind === 'wait') await page.waitForTimeout(Number(arg))
    else if (kind === 'eval') await page.evaluate(arg)
    else if (kind === 'fill') { const [sel, text] = arg.split('=>'); await page.locator(sel).first().fill(text) }
    else if (kind === 'press') await page.keyboard.press(arg)
    else if (kind === 'upload') { const [sel, file] = arg.split('=>'); await page.locator(sel).first().setInputFiles(file) }
  }
  await page.waitForTimeout(1200)
}
await page.screenshot({ path: out })
console.log(logs.slice(0, 30).join('\n') || 'no console errors')
await browser.close()
