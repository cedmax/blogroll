import { defineConfig } from "astro/config"

import tailwindcss from "@tailwindcss/vite"

import netlifyRedirects from "./integrations/netlify-redirects.mjs"
import sitemap from "@astrojs/sitemap"
import site from "./src/data/site.json" assert { type: "json" }

const builtAt = new Date(site.builtAt).toISOString()

export default defineConfig({
  // SITE_URL lets CI build previews against their own origin (absolute URLs
  // like og:image derive from Astro.site); production is the default.
  site: process.env.SITE_URL || "https://blogroll.it",

  trailingSlash: "always",

  integrations: [
    netlifyRedirects(),
    sitemap({
      filter: (page) =>
        !page.includes("/sites/non-disponibile/") &&
        !page.includes("/404/") &&
        !page.includes("/rss.xml"),
      serialize: (item) => {
        const isStatic = item.url.includes("/info/") || item.url.includes("/proposte/")
        return { ...item, lastmod: builtAt, changefreq: isStatic ? "monthly" : "daily" }
      },
    }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },

  markdown: {
    shikiConfig: { theme: "css-variables" },
  },
})
