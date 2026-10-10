import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('console', (m) => console.log('console:', m.text()))
await page.goto('http://localhost:5204/', { waitUntil: 'networkidle' })
const result = await page.evaluate(async () => {
  const out = []
  const m = await import('/src/sources/duckdb-wasm.ts')
  const b = await import('/src/demo/duckdb-bundles.ts')
  const e = await m.createDuckDbWasmEngine({ bundles: b.localDuckDbBundles })
  const tryq = async (sql) => { try { out.push([sql.slice(0, 60), JSON.stringify(await e.query(sql)).slice(0, 200)]) } catch (err) { out.push([sql.slice(0, 60), 'ERR ' + err.message]) } }
  await tryq("create table t as select range as i, CAST(range*0.5 AS DOUBLE) as y, range::VARCHAR || 'x' as s from range(10)")
  await tryq("select quantile_cont(y, [0.5, 0.9]) q, median(y) m from t")
  await tryq("copy t to 'out.parquet' (format parquet)")
  await tryq("select count(*) n, sum(y) s from read_parquet('out.parquet')")
  await e.registerFile('typed.csv', 'x,d,ts,b\n1.5,2026-01-02,2026-01-02T08:30:00.000Z,true\n,,,\n')
  await tryq("select * from read_csv('typed.csv', header = true, auto_detect = false, columns = {'x': 'DOUBLE', 'd': 'DATE', 'ts': 'TIMESTAMP', 'b': 'BOOLEAN'}, nullstr = '')")
  return out
})
console.log(result.map((r) => r.join(' => ')).join('\n'))
await browser.close()
