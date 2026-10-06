import localFont from 'next/font/local'

/**
 * 1. Fonts Documentation
 *
 * 2. This file shows how to customize the font by using local font or google font
 *
 * [1] use local font
 *
 * - Get font file from https://gwfh.mranftl.com/fonts
 * - Add font file to the assets/fonts folder
 * - Add font variable to the font object
 */
// https://gwfh.mranftl.com/fonts/bricolage-grotesque?subsets=latin
export const fontBricolageGrotesque = localFont({
  src: [
    {
      path: './bricolage-grotesque-v8-latin-regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './bricolage-grotesque-v8-latin-500.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './bricolage-grotesque-v8-latin-600.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: './bricolage-grotesque-v8-latin-700.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-bricolage-grotesque',
  display: 'swap',
})

/**
 * [2] use google font
 *
 * - You can browser fonts at Google Fonts
 * https://fonts.google.com
 *
 * - CSS and font files are downloaded at build time and self-hosted with the rest of your static assets.
 * https://nextjs.org/docs/app/building-your-application/optimizing/fonts#google-fonts
 */
// https://gwfh.mranftl.com/fonts/noto-sans?subsets=latin
export const fontNotoSans = localFont({
  src: [
    {
      path: './noto-sans-mono-v36-latin-500.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './noto-sans-mono-v36-latin-600.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: './noto-sans-mono-v36-latin-700.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-noto-sans',
  display: 'swap',
})

// https://gwfh.mranftl.com/fonts/noto-serif?subsets=latin
export const fontNotoSerif = localFont({
  src: [
    {
      path: './noto-serif-v33-latin-regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './noto-serif-v33-latin-500.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './noto-serif-v33-latin-600.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: './noto-serif-v33-latin-700.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-noto-serif',
  display: 'swap',
})

// https://gwfh.mranftl.com/fonts/noto-sans-mono?subsets=latin
export const fontNotoSansMono = localFont({
  src: [
    {
      path: './noto-sans-mono-v36-latin-regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './noto-sans-mono-v36-latin-500.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './noto-sans-mono-v36-latin-600.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: './noto-sans-mono-v36-latin-700.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-noto-sans-mono',
  display: 'swap',
})
