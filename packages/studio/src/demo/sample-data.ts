/**
 * Synthetic bioprocess data for the demo — deterministic, so screenshots and
 * walkthroughs are repeatable. Nothing here is real.
 */

function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(next: () => number, mean = 0, sd = 1) {
  const u = Math.max(next(), 1e-9)
  const v = next()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places

export function bioreactorSamples(): Record<string, unknown>[] {
  const next = rng(20261010)
  const lines = ['CHO-K1 A12', 'CHO-K1 B07', 'HEK293 T4']
  const media = ['ActiPro', 'CD FortiCHO', 'Dynamis']
  const operators = ['A. Patel', 'J. Morgan', 'S. Okafor', 'L. Chen']
  const rows: Record<string, unknown>[] = []
  for (let run = 1; run <= 24; run++) {
    const line = lines[run % lines.length] as string
    const medium = media[(run * 7) % media.length] as string
    const vessel = `BR-${String(((run - 1) % 6) + 1).padStart(2, '0')}`
    const start = Date.UTC(2026, 0, 5) + (run - 1) * 5 * 86_400_000
    const growth = 0.42 + normal(next, 0, 0.05) + (line.startsWith('HEK') ? -0.08 : 0)
    const peak = 18 + normal(next, 0, 3) + (medium === 'Dynamis' ? 3 : 0)
    const aborted = run === 9 || run === 17
    const days = aborted ? 8 : 14
    for (let day = 0; day <= days; day++) {
      const vcd = peak / (1 + Math.exp(-growth * (day - 6))) * (day > 11 ? 1 - (day - 11) * 0.07 : 1)
      const viability = Math.min(99.5, 98 - (day > 9 ? (day - 9) ** 1.6 * 2.2 : 0) + normal(next, 0, 0.6)) - (aborted && day > 5 ? 25 : 0)
      const glucose = Math.max(0.2, 6.5 - day * 0.38 + (day % 3 === 0 ? 2 : 0) + normal(next, 0, 0.25))
      const lactate = Math.max(0, 0.4 + day * 0.32 - (day > 7 ? (day - 7) * 0.4 : 0) + normal(next, 0, 0.2))
      const titer = day < 3 ? null : round(Math.max(0, (day - 2) * 0.21 * (peak / 18) + normal(next, 0, 0.05)), 3)
      rows.push({
        sample_id: `R${String(run).padStart(3, '0')}-D${String(day).padStart(2, '0')}`,
        run_id: `R-${String(run).padStart(3, '0')}`,
        bioreactor: vessel,
        cell_line: line,
        medium,
        day,
        sampled_at: new Date(start + day * 86_400_000 + Math.floor(next() * 4) * 3_600_000 + 8 * 3_600_000).toISOString(),
        vcd_e6_per_ml: round(Math.max(0.3, vcd + normal(next, 0, 0.4))),
        viability_pct: round(viability, 1),
        glucose_g_l: round(glucose),
        lactate_g_l: round(lactate),
        ph: round(7.05 - lactate * 0.04 + normal(next, 0, 0.03)),
        do_pct: round(40 + normal(next, 0, 4), 1),
        temp_c: day >= 7 && run % 2 === 0 ? 33 : 36.8,
        titer_g_l: titer,
        operator: next() < 0.04 ? null : operators[Math.floor(next() * operators.length)],
        run_status: aborted ? 'Aborted' : 'Complete',
        qc_pass: aborted ? false : viability > 80 ? true : next() < 0.5,
        comment: aborted && day === days ? 'Contamination suspected — run stopped' : next() < 0.05 ? 'Sample re-measured' : null,
      })
    }
  }
  return rows
}

export function elisaWells(): Record<string, unknown>[] {
  const next = rng(9617)
  const rows: Record<string, unknown>[] = []
  const analytes = ['HCP', 'Protein A', 'IgG titre']
  for (let plate = 1; plate <= 36; plate++) {
    const analyte = analytes[plate % analytes.length] as string
    const runDate = new Date(Date.UTC(2026, 1, 2) + plate * 2 * 86_400_000).toISOString().slice(0, 10)
    const drift = normal(next, 1, 0.04)
    for (let r = 0; r < 8; r++) {
      for (let c = 1; c <= 12; c++) {
        const well = `${String.fromCharCode(65 + r)}${c}`
        const role = c <= 2 ? 'Standard' : c === 12 ? 'Blank' : r === 7 ? 'Control' : 'Sample'
        const conc = role === 'Standard' ? 2 ** (7 - r) * 3.125 : role === 'Blank' ? 0 : role === 'Control' ? 50 : Math.max(0, normal(next, 40, 25))
        const od = role === 'Blank' ? Math.abs(normal(next, 0.05, 0.01)) : (2.9 * conc / (60 + conc) + 0.05) * drift + normal(next, 0, 0.02)
        rows.push({
          plate_id: `P-${String(plate).padStart(3, '0')}`,
          analyte,
          run_date: runDate,
          well,
          row: String.fromCharCode(65 + r),
          column: c,
          role,
          nominal_conc_ng_ml: role === 'Sample' ? null : round(conc, 3),
          od_450: round(od, 4),
          flagged: od > 2.8 || (role === 'Blank' && od > 0.08),
        })
      }
    }
  }
  return rows
}
