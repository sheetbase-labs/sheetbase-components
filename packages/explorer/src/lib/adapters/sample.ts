import type { DataAdapter, DataRow } from '../types'
import { inferColumns } from '../schema'

const means = [
  { sample: 'LV-001', day: 0, treatment: 'Control', response: 0.98, low: 0.91, high: 1.05 },
  { sample: 'LV-002', day: 1, treatment: 'Control', response: 1.08, low: 1.00, high: 1.17 },
  { sample: 'LV-003', day: 2, treatment: 'Control', response: 1.13, low: 1.04, high: 1.22 },
  { sample: 'LV-004', day: 3, treatment: 'Control', response: 1.19, low: 1.10, high: 1.29 },
  { sample: 'LV-005', day: 4, treatment: 'Control', response: 1.23, low: 1.13, high: 1.34 },
  { sample: 'LV-101', day: 0, treatment: 'Treatment A', response: 1.01, low: 0.94, high: 1.09 },
  { sample: 'LV-102', day: 1, treatment: 'Treatment A', response: 1.31, low: 1.20, high: 1.43 },
  { sample: 'LV-103', day: 2, treatment: 'Treatment A', response: 1.72, low: 1.58, high: 1.88 },
  { sample: 'LV-104', day: 3, treatment: 'Treatment A', response: 2.08, low: 1.90, high: 2.27 },
  { sample: 'LV-105', day: 4, treatment: 'Treatment A', response: 2.42, low: 2.19, high: 2.67 },
  { sample: 'LV-201', day: 0, treatment: 'Treatment B', response: 1.00, low: 0.92, high: 1.08 },
  { sample: 'LV-202', day: 1, treatment: 'Treatment B', response: 1.19, low: 1.10, high: 1.29 },
  { sample: 'LV-203', day: 2, treatment: 'Treatment B', response: 1.43, low: 1.31, high: 1.56 },
  { sample: 'LV-204', day: 3, treatment: 'Treatment B', response: 1.68, low: 1.54, high: 1.83 },
  { sample: 'LV-205', day: 4, treatment: 'Treatment B', response: 1.86, low: 1.69, high: 2.04 },
]

const offsets = [-0.035, 0.005, 0.03]
const rows: DataRow[] = means.flatMap((mean) => offsets.map((offset, index) => {
  const response = Number((mean.response + offset).toFixed(3))
  const lowerWidth = mean.response - mean.low
  const upperWidth = mean.high - mean.response
  return {
    sample: `${mean.sample}-R${index + 1}`,
    replicate: index + 1,
    day: mean.day,
    treatment: mean.treatment,
    response,
    low: Number((response - lowerWidth).toFixed(3)),
    high: Number((response + upperWidth).toFixed(3)),
  }
}))

export const sampleAdapter: DataAdapter = {
  id: 'sample',
  label: 'Example experiment',
  async load() {
    return { name: 'Example experiment', rows, columns: inferColumns(rows), source: 'sample' }
  },
}
