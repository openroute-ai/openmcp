import type { MetadataRoute } from 'next'
import { defaultMessages } from '@/i18n/messages'

/**
 * Generates the Web App Manifest for the application
 *
 * generated file name: manifest.webmanifest
 *
 * The manifest must live at the app root, outside the `[locale]` dynamic
 * segment, so next-intl cannot infer a locale from the pathname. Using the
 * default messages keeps a single canonical set of strings.
 *
 * https://next-intl.dev/docs/environments/actions-metadata-route-handlers#manifest
 *
 * @returns {MetadataRoute.Manifest} The manifest configuration object
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: defaultMessages.Metadata.name,
    short_name: defaultMessages.Metadata.name,
    description: defaultMessages.Metadata.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    categories: ['developer', 'productivity', 'utilities'],
    lang: 'zh-CN',
    dir: 'ltr',
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
