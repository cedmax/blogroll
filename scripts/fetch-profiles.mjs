import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Optional: fetches personal profiles (/u/<slug> pages) from the profiles API.
// Never fails the build — unset, down or garbage all exit 0 and the curated
// site builds exactly as without it.

const PROFILES_DIR = "src/data/profiles"
const META_FILE = join(PROFILES_DIR, "_meta.json")
const TIMEOUT_MS = 15000
const MAX_ENTRIES = 15
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000
const MAX_BYTES = 10 * 1024 * 1024 // same cap as main.go

const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

const { PROFILES_API_URL: url, PROFILES_API_TOKEN: token } = process.env

// Mirrors main.go's validLink: absolute http(s) URLs only.
const validLink = (value) => {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

const isNonEmpty = (value) => typeof value === "string" && value.trim() !== ""

const clearDir = () => {
  for (const file of readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json"))) {
    rmSync(join(PROFILES_DIR, file))
  }
}

const formatAge = (ms) => {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${mins}m`
  return `${mins}m`
}

const cachedExportNote = () => {
  try {
    const fetchedAt = new Date(JSON.parse(readFileSync(META_FILE, "utf8")).fetchedAt)
    if (Number.isNaN(fetchedAt.getTime())) throw new Error()
    return `keeping the cached profiles export from ${formatAge(Date.now() - fetchedAt.getTime())} ago`
  } catch {
    return "no cached profiles export available"
  }
}

const normaliseEntries = (entries, where) => {
  const maxTime = Date.now() + FUTURE_SLACK_MS
  const kept = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const published = new Date(entry?.published)
    if (
      !isNonEmpty(entry?.title) ||
      !validLink(entry?.url) ||
      typeof entry?.published !== "string" ||
      Number.isNaN(published.getTime()) ||
      published.getTime() > maxTime
    ) {
      console.warn(`profiles: ${where}: dropping invalid entry ${JSON.stringify(entry?.url)}`)
      continue
    }
    kept.push({ title: entry.title, url: entry.url, published: published.toISOString() })
  }
  return kept
    .sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime())
    .slice(0, MAX_ENTRIES)
}

const normaliseFeed = (feed, profileSlug) => {
  const where = `profile "${profileSlug}"`
  if (!isNonEmpty(feed?.slug) || !isNonEmpty(feed?.htmlUrl) || !validLink(feed.htmlUrl)) {
    const name = JSON.stringify(feed?.slug ?? feed?.xmlUrl)
    console.warn(
      `profiles: ${where}: skipping feed ${name} with missing/invalid slug or htmlUrl`,
    )
    return null
  }
  if (!validLink(feed.xmlUrl)) {
    console.warn(`profiles: ${where}: skipping feed "${feed.slug}" with invalid xmlUrl`)
    return null
  }
  return {
    title: isNonEmpty(feed.title) ? feed.title : new URL(feed.htmlUrl).hostname,
    xmlUrl: feed.xmlUrl,
    htmlUrl: feed.htmlUrl,
    description: typeof feed.description === "string" ? feed.description : "",
    slug: feed.slug,
    available: typeof feed.available === "boolean" ? feed.available : true,
    entries: normaliseEntries(feed.entries, `${where}, feed "${feed.slug}"`),
  }
}

const normaliseProfile = (profile) => {
  if (typeof profile?.slug !== "string" || !SLUG_RE.test(profile.slug)) {
    console.warn(
      `profiles: dropping profile with invalid slug ${JSON.stringify(profile?.slug)}`,
    )
    return null
  }
  // Feed slugs key the per-feed grouping on /u/ pages, so they must be unique
  const seenFeeds = new Set()
  const feeds = (Array.isArray(profile.feeds) ? profile.feeds : [])
    .map((feed) => normaliseFeed(feed, profile.slug))
    .filter((feed) => {
      if (!feed) return false
      if (seenFeeds.has(feed.slug)) {
        console.warn(
          `profiles: profile "${profile.slug}": skipping duplicate feed "${feed.slug}"`,
        )
        return false
      }
      seenFeeds.add(feed.slug)
      return true
    })
  if (feeds.length === 0) {
    console.warn(`profiles: dropping profile "${profile.slug}" with no valid feeds`)
    return null
  }
  return {
    slug: profile.slug,
    displayName: isNonEmpty(profile.displayName) ? profile.displayName : profile.slug,
    feeds,
  }
}

const fetchProfiles = async () => {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
  const chunks = []
  let size = 0
  for await (const chunk of res.body) {
    size += chunk.length
    if (size > MAX_BYTES) throw new Error(`response larger than ${MAX_BYTES} bytes`)
    chunks.push(chunk)
  }
  let body
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new Error("invalid JSON")
  }
  if (!Array.isArray(body)) throw new Error("response is not an array")
  return body
}

mkdirSync(PROFILES_DIR, { recursive: true })

if (!url || !token) {
  console.log("profiles API not configured, skipping")
  clearDir()
  process.exit(0)
}

let raw
try {
  raw = await fetchProfiles()
} catch (err) {
  console.warn(`profiles API fetch failed (${err.message}) — ${cachedExportNote()}`)
  process.exit(0)
}

// Normalise fully in memory first, so a bad response can't leave a
// half-written directory behind.
const seen = new Set()
const profiles = raw.map(normaliseProfile).filter((profile) => {
  if (!profile) return false
  if (seen.has(profile.slug)) {
    console.warn(`profiles: dropping duplicate profile "${profile.slug}"`)
    return false
  }
  seen.add(profile.slug)
  return true
})

clearDir()
for (const profile of profiles) {
  writeFileSync(join(PROFILES_DIR, `${profile.slug}.json`), JSON.stringify(profile, null, 2))
}
writeFileSync(META_FILE, JSON.stringify({ fetchedAt: new Date().toISOString() }) + "\n")
console.log(`Wrote ${PROFILES_DIR}/ (${profiles.length} profiles)`)
