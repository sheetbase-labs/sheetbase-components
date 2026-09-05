import type { ChartSpec } from './types'

/**
 * Chart export boundaries. The chart stage renders a single SVG, so export
 * is serialization: SVG downloads directly, PNG rasterizes through canvas
 * at 2x. Exported SVG will not carry page CSS — marks rely on their own
 * presentation attributes, which the chart builder sets inline.
 */

function chartSvg(stage: HTMLElement): SVGSVGElement | undefined {
  const node = stage.querySelector('svg')
  return node instanceof SVGSVGElement ? node : undefined
}

export function serializeChartSvg(stage: HTMLElement): string | undefined {
  const source = chartSvg(stage)
  if (!source) return undefined
  const clone = source.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const width = source.clientWidth || source.viewBox.baseVal.width || 1200
  const height = source.clientHeight || source.viewBox.baseVal.height || 600
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  return new XMLSerializer().serializeToString(clone)
}

export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not rasterize the chart SVG.'))
    image.src = url
  })
}

export async function exportChartPng(stage: HTMLElement, filename: string, scale = 2): Promise<void> {
  const serialized = serializeChartSvg(stage)
  if (!serialized) throw new Error('No chart SVG found to export.')
  const svgUrl = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await loadImage(svgUrl)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is unavailable.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Could not encode the chart PNG.')
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } finally {
    setTimeout(() => URL.revokeObjectURL(svgUrl), 1000)
  }
}

export function specJson(spec: ChartSpec, sql: string): string {
  return JSON.stringify({ spec, sql }, null, 2)
}
