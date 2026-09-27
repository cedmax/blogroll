import { readFileSync } from "node:fs"
import { getCollection } from "astro:content"
import { getFeeds, builtAt } from "./feeds"
import { fmtLong } from "./dates"

// Personal profiles from the optional profiles API (scripts/fetch-profiles.mjs).
// Only /u/ pages read these: profile feeds never reach curated surfaces.
export async function getProfiles() {
  const entries = await getCollection("profiles")
  return entries.map((e) => e.data)
}

export type Profile = Awaited<ReturnType<typeof getProfiles>>[number]
export type ProfileFeed = Profile["feeds"][number]

// xmlUrl → curated page, for the available curated feeds only.
export async function curatedHrefs() {
  const feeds = await getFeeds()
  return new Map(feeds.map((f) => [f.xmlUrl, `/sites/${f.slug}/`]))
}

export const feedHref = (feed: ProfileFeed, curated: Map<string, string>) =>
  curated.get(feed.xmlUrl) ?? feed.htmlUrl

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
