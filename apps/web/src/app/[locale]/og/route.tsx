import { readFileSync } from 'node:fs'
import { generateOGImage } from '@/app/[locale]/og/og'
import { defaultMessages } from '@/i18n/messages'

const font = readFileSync('./src/app/[locale]/og/fonts/Inter-Regular.ttf')
const fontSemiBold = readFileSync('./src/app/[locale]/og/fonts/Inter-SemiBold.ttf')
const fontBold = readFileSync('./src/app/[locale]/og/fonts/Inter-Bold.ttf')

/**
 * Default Open Graph card, `/og`.
 *
 * Per-page cards live in `og/[...slug]`; this one is the fallback that search
 * and social previews fall back to for a URL with no card of its own.
 */
export function GET() {
  return generateOGImage({
    primaryTextColor: 'rgb(240,240,240)',
    title: defaultMessages.Metadata.title,
    description: defaultMessages.Metadata.description,
    tag: 'MCP / A2A / Skills',
    fonts: [
      { name: 'Inter', data: font, weight: 400 },
      { name: 'Inter', data: fontSemiBold, weight: 600 },
      { name: 'Inter', data: fontBold, weight: 700 },
    ],
  })
}
