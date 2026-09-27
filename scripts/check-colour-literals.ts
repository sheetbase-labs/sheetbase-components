/**
 * COMP-01.4: fail on new literal colours in the table and explorer CSS.
 *
 * The package stylesheets must use the theme variables (see
 * `packages/shared/src/theme.css` and `themes/v3.css`). The only literals
 * allowed are `rgb(0 0 0 / x%)` box-shadow elevations.
 *
 *   bun run check:colours
 */
import { Glob } from 'bun'

const PATTERNS = [
  'packages/table/src/ui/styles/*.css',
  'packages/explorer/src/*.css',
]

const ALLOWED_SHADOW = /rgba?\(\s*0\s+0\s+0\s*\/\s*[\d.]+%?\s*\)/g
const HEX = /#[0-9a-fA-F]{3,8}\b/
const RGB = /\brgba?\(/

const findings: Array<{ file: string; line: number; rule: string }> = []

for (const pattern of PATTERNS) {
  for await (const file of new Glob(pattern).scan('.')) {
    if (file.includes('/dist')) continue
    const lines = (await Bun.file(file).text())
      .replace(ALLOWED_SHADOW, '')
      .split('\n')
    lines.forEach((line, index) => {
      if (HEX.test(line))
        findings.push({ file, line: index + 1, rule: 'hex colour' })
      if (RGB.test(line))
        findings.push({ file, line: index + 1, rule: 'rgb() colour' })
    })
  }
}

if (findings.length > 0) {
  console.error('Literal colours found in package CSS (use theme variables):\n')
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.rule}`)
  }
  console.error(`\n${findings.length} finding(s).`)
  process.exit(1)
}
console.log('No literal colours in table/explorer CSS.')
