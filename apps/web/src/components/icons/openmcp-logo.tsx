import type { SVGProps } from 'react'

/**
 * OpenMCP Logo
 *
 * Source of truth: `apps/openmcp/public/logo.svg` (also served as the favicon).
 * A hexagonal package glyph with a core hub and four radial spokes, drawn as a
 * standard lucide-style icon: 24×24 viewBox, no fill, `currentColor` stroke.
 */
export function OpenMcpLogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      {...props}
    >
      <path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' />
      <circle cx='12' cy='12' r='4' />
      <line x1='3' y1='8' x2='8' y2='10.5' />
      <line x1='21' y1='8' x2='16' y2='10.5' />
      <line x1='3' y1='16' x2='8' y2='13.5' />
      <line x1='21' y1='16' x2='16' y2='13.5' />
    </svg>
  )
}

export default OpenMcpLogoIcon
