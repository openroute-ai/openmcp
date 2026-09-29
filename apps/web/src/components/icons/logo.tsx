import type { SVGProps } from 'react'

import { OpenMcpLogoIcon } from './openmcp-logo'

export { OpenMcpLogoIcon }

/**
 * OpenMCP logo mark, kept as the app-wide `LogoIcon` entry point.
 *
 * The artwork is generated from `apps/openmcp/public/logo.svg` and also lives
 * in `./openmcp-logo` as a standard lucide-style icon component.
 */
export function LogoIcon(props: SVGProps<SVGSVGElement>) {
  return <OpenMcpLogoIcon {...props} />
}
