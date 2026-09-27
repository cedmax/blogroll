import { readFileSync } from "node:fs"
import { getCollection } from "astro:content"
import { builtAt } from "./feeds"
import { fmtLong } from "./dates"

// Personal profiles from the optional profiles API (scripts/fetch-profiles.mjs).
// Only /u/ pages read these: profile feeds never reach curated surfaces.
export async function getProfiles() {
  const entries = await getCollection("profiles")
  return entries.map((e) => e.data)
}

export type Profile = Awaited<ReturnType<typeof getProfiles>>[number]
export type ProfileFeed = Profile["feeds"][number]

// Mirrors .github/scripts/remove-feed-from-opml.mjs, so "is this feed in the
// OPML?" gets the same answer the removal pipeline will.
const normalizeUrl = (raw: string) => {
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, "")
    return `${host}${u.pathname.replace(/\/$/, "")}${u.search}`
  } catch {
    return raw
  }
}

// How profile feeds relate to the curated ones. `page` links only to available
// curated feeds (unavailable ones 302 away); `inOpml` covers every curated
// feed and matches the reported site URL (htmlUrl) the way the removal
// workflow does, so a report it couldn't act on is never labelled feed-removal.
export async function curatedLookup() {
  const all = (await getCollection("feeds")).map((e) => e.data)
  const inOpml = new Set(all.flatMap((f) => [normalizeUrl(f.xmlUrl), normalizeUrl(f.htmlUrl)]))
  const pages = new Map<string, string>()
  for (const f of all.filter((f) => f.available)) {
    pages.set(normalizeUrl(f.xmlUrl), `/sites/${f.slug}/`)
    pages.set(normalizeUrl(f.htmlUrl), `/sites/${f.slug}/`)
  }
  return {
    page: (feed: ProfileFeed) =>
      pages.get(normalizeUrl(feed.xmlUrl)) ?? pages.get(normalizeUrl(feed.htmlUrl)),
    inOpml: (feed: ProfileFeed) => inOpml.has(normalizeUrl(feed.htmlUrl)),
  }
}

// Read at build time rather than imported: the file doesn't exist when the
// profiles API isn't configured, and a static import would break the build.
const readFetchedAt = () => {
  try {
    const { fetchedAt } = JSON.parse(readFileSync("src/data/profiles/_meta.json", "utf8"))
    const date = new Date(fetchedAt)
    return Number.isNaN(date.getTime()) ? builtAt : fmtLong(date)
  } catch {
    return builtAt
  }
}

// When the profiles export was fetched: after an API outage this is the age
// of the cached data on the page, not the build time.
export const profilesFetchedAt = readFetchedAt()
