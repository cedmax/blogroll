import { defineConfig } from "astro/config"

import tailwindcss from "@tailwindcss/vite"

import netlifyRedirects from "./integrations/netlify-redirects.mjs"

export default defineConfig({
  // SITE_URL lets CI build previews against their own origin (absolute URLs
  // like og:image derive from Astro.site); production is the default.
  site: process.env.SITE_URL || "https://blogroll.it",

  trailingSlash: "always",

  integrations: [netlifyRedirects()],

  vite: {
    plugins: [tailwindcss()],
  },
})
