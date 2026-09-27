import { readFileSync } from "node:fs"
import { getCollection } from "astro:content"
import { builtAt } from "./feeds"
import { fmtLong } from "./dates"

// Read by /u/ pages only.
export async function getProfiles() {
  const entries = await getCollection("profiles")
  return entries.map((e) => e.data)
}

export type Profile = Awaited<ReturnType<typeof getProfiles>>[number]
export type ProfileFeed = Profile["feeds"][number]

// Mirrors remove-feed-from-opml.mjs.
const normalizeUrl = (raw: string) => {
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, "")
    return `${host}${u.pathname.replace(/\/$/, "")}${u.search}`
  } catch {
    return raw
  }
}

// `page`: available curated feeds. `inOpml`: all, by htmlUrl, like the removal script.
async function curatedLookup() {
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

const latest = (feed: ProfileFeed) => feed.entries[0]?.published ?? ""

// Profile-only feeds get /u/sites/<slug>/; a slug sent for different feeds gets none.
async function buildFeedLinks() {
  const curated = await curatedLookup()
  const sites = new Map<string, ProfileFeed>()
  const clashes = new Set<string>()
  for (const feed of (await getProfiles()).flatMap((p) => p.feeds)) {
    if (curated.page(feed) || curated.inOpml(feed)) continue
    const prev = sites.get(feed.slug)
    if (!prev) sites.set(feed.slug, feed)
    else if (normalizeUrl(prev.xmlUrl) !== normalizeUrl(feed.xmlUrl)) clashes.add(feed.slug)
    else if (latest(feed) > latest(prev)) sites.set(feed.slug, feed)
  }
  for (const slug of clashes) {
    console.warn(`profiles: feed slug "${slug}" used for different feeds, no /u/sites/ page`)
    sites.delete(slug)
  }
  const sitePage = (feed: ProfileFeed) => {
    const site = sites.get(feed.slug)
    return site && normalizeUrl(site.xmlUrl) === normalizeUrl(feed.xmlUrl)
      ? `/u/sites/${feed.slug}/`
      : undefined
  }
  return {
    sites,
    page: (feed: ProfileFeed) => curated.page(feed) ?? sitePage(feed),
    inOpml: curated.inOpml,
  }
}

// Internal page (curated or /u/sites/) and OPML membership for profile feeds.
let feedLinksPromise: ReturnType<typeof buildFeedLinks> | undefined
export const feedLinks = () => (feedLinksPromise ??= buildFeedLinks())

// Not imported: the file may not exist.
const readFetchedAt = () => {
  try {
    const { fetchedAt } = JSON.parse(readFileSync("src/data/profiles/_meta.json", "utf8"))
    const date = new Date(fetchedAt)
    return Number.isNaN(date.getTime()) ? builtAt : fmtLong(date)
  } catch {
    return builtAt
  }
}

// Export time, not build time.
export const profilesFetchedAt = readFetchedAt()
