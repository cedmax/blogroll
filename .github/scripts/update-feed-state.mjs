import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const SITE_URL = "https://blogroll.it"
const FEEDS_DIR = "src/data/feeds"
const OUT_FILE = "public/stale.json"

const res = await fetch(`${SITE_URL}/stale.json`).catch(() => null)
if (!res?.ok) {
  console.error(
    "Warning: could not fetch live stale.json — starting from empty state; accumulated feed aging may be lost.",
  )
}
const state = res?.ok ? await res.json() : {}

const now = new Date().toISOString()
const seenXmlUrls = new Set()

for (const file of readdirSync(FEEDS_DIR).filter((f) => f.endsWith(".json"))) {
  const feed = JSON.parse(readFileSync(join(FEEDS_DIR, file), "utf8"))
  seenXmlUrls.add(feed.xmlUrl)
  if (!feed.entries || feed.entries.length === 0) {
    if (!state[feed.xmlUrl]) {
      state[feed.xmlUrl] = {
        htmlUrl: feed.htmlUrl,
        title: feed.title,
        lastBuild: now,
        lastPost: null,
      }
    }
    // Already in state: leave lastBuild untouched — let it age
    continue
  }
  state[feed.xmlUrl] = {
    htmlUrl: feed.htmlUrl,
    title: feed.title,
    lastBuild: now,
    lastPost: feed.entries[0].published,
  }
}

for (const key of Object.keys(state)) {
  if (!seenXmlUrls.has(key)) delete state[key]
}

writeFileSync(OUT_FILE, JSON.stringify(state, null, 2) + "\n")
