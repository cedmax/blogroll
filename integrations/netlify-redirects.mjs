import fs from "node:fs"

// Domain-level redirect rules, in Netlify `_redirects` syntax. Add lines here
// (e.g. canonicalize the *.netlify.app host to blogroll.it). The per-feed 302s
// for unavailable blogs are appended below at build time.
const staticRedirects = `# Add domain-level redirects here, one per line.
`

// Emits a Netlify `_redirects` file mapping each known-but-unavailable feed
// (a slug present in the OPML whose latest fetch produced no entries) to the
// "temporarily unavailable" explainer via a 302. Kept out of main.go so
// hosting/routing concerns stay in the Astro build.
export default function netlifyRedirects() {
  return {
    name: "netlify-redirects",
    hooks: {
      "astro:build:done": ({ dir }) => {
        const feedsDir = new URL("../src/data/feeds/", import.meta.url)
        const lines = []
        for (const file of fs.readdirSync(feedsDir)) {
          if (!file.endsWith(".json")) continue
          const feed = JSON.parse(fs.readFileSync(new URL(file, feedsDir), "utf8"))
          if (!feed.available) {
            lines.push(`/sites/${feed.slug}/  /sites/non-disponibile/  302`)
          }
        }
        const feedBlock = lines.length ? lines.join("\n") + "\n" : ""
        fs.writeFileSync(new URL("./_redirects", dir), staticRedirects + feedBlock)
      },
    },
  }
}
