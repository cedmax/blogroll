import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const SITE_URL = "https://blogroll.it"
const FEEDS_DIR = "src/data/feeds"
const OUT_FILE = "public/stale.json"

const RETRIES = 4
const BACKOFF_MS = 2000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Fetch the live state, tolerating transient failures. A 404 is definitive —
// the file genuinely doesn't exist yet (first-ever deploy), so we start empty.
// Network errors, timeouts and 5xx are inconclusive: retrying an empty state
// here would silently reset every feed's accumulated `lastBuild` and restart
// its unavailability clock, so we retry with backoff before giving up.
const fetchLiveState = async () => {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const res = await fetch(`${SITE_URL}/stale.json`).catch(() => null)
    if (res?.ok) return await res.json()
    if (res?.status === 404) return {}
    const detail = res ? `HTTP ${res.status}` : "network error"
    console.error(`Attempt ${attempt}/${RETRIES} to fetch live stale.json failed (${detail}).`)
    if (attempt < RETRIES) await sleep(BACKOFF_MS * attempt)
  }
  console.error(
    "Warning: could not fetch live stale.json after retries — starting from empty state; accumulated feed aging may be lost.",
  )
  return {}
}

const state = await fetchLiveState()

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
