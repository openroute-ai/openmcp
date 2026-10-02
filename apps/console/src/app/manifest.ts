import type { MetadataRoute } from "next"

import { SITE_DESCRIPTION, SITE_NAME, SITE_NAME_EN } from "@/lib/config/site"

/**
 * The web app manifest.
 *
 * Small on purpose. A manifest earns its place by making a saved shortcut look
 * like the app it was saved from — name, theme colour, background colour, the
 * icons the layout already declares — and every extra entry is another thing to
 * keep true. Nothing new is designed here: the icons are the shipped assets, so
 * the manifest cannot drift from the favicon the way a second maskable icon
 * would.
 *
 * `start_url` is `/anomalies`, not `/`, on purpose: the homepage's job is to
 * explain the site, and someone who added this to their home screen and came back
 * a week later wants the current state of the world, not the pitch again.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — ${SITE_NAME_EN}`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: "zh-CN",
    dir: "ltr",
    start_url: "/anomalies",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    categories: ["news", "productivity", "developer"],
    // The light-theme `--radar-up`, because a shortcut's icon background is drawn
    // by the OS in a colour it picks, not by this page: naming the light value
    // gives the browser a fixed colour rather than leaving it to sample a
    // `--accent` it cannot see.
    background_color: "#fafafa",
    theme_color: "#dc2626",
    // The same three assets the layout declares, in manifest form. Declaring a
    // `192` and a `512` here is what makes the install prompt appear at all on
    // Android, and the SVG covers the rest.
    icons: [
      {
        src: "/logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      { src: "/logo-192.png", sizes: "192x192", type: "image/png" },
      { src: "/logo-512.png", sizes: "512x512", type: "image/png" },
    ],
  }
}
