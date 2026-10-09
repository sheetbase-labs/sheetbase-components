import type { SVGProps } from 'react'

/**
 * The UI system v3 icon set the explorer needs, ported from the design's
 * `bundle.js` (16x16 viewBox, 1.4px stroke, round caps, `currentColor`).
 * Replaces the Hugeicons dependency (COMP-03.5).
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

/** Run (design `play`). */
export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 3.5l7 4.5-7 4.5z" />
    </Svg>
  )
}

/** Reset / reload. */
export function ReloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5V6H10" />
    </Svg>
  )
}

/** From file (design `upload`). */
export function FileUploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 10.5v-8M4.5 6L8 2.5 11.5 6M2.5 13.5h11" />
    </Svg>
  )
}
