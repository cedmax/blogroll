import { defineConfig } from "astro/config"

import tailwindcss from "@tailwindcss/vite"

import netlifyRedirects from "./integrations/netlify-redirects.mjs"

export default defineConfig({
  trailingSlash: "always",

  integrations: [netlifyRedirects()],

  vite: {
    plugins: [tailwindcss()],
  },
})
