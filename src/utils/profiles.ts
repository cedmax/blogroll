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
  const unavailable = new Map<string, (typeof all)[number]>()
  for (const f of all) {
    for (const url of [normalizeUrl(f.xmlUrl), normalizeUrl(f.htmlUrl)]) {
      if (f.available) pages.set(url, `/sites/${f.slug}/`)
      else unavailable.set(url, f)
    }
  }
  const match = <T>(map: Map<string, T>, feed: ProfileFeed) =>
    map.get(normalizeUrl(feed.xmlUrl)) ?? map.get(normalizeUrl(feed.htmlUrl))
  return {
    slugs: new Set(all.map((f) => f.slug)),
    page: (feed: ProfileFeed) => match(pages, feed),
    unavailable: (feed: ProfileFeed) => match(unavailable, feed),
    inOpml: (feed: ProfileFeed) => inOpml.has(normalizeUrl(feed.htmlUrl)),
  }
}

const latest = (feed: ProfileFeed) => feed.entries[0]?.published ?? ""

type ProfileSite = { feed: ProfileFeed; followers: Pick<Profile, "slug" | "displayName">[] }

// Profile-only feeds get /sites/<slug>/ unless a curated feed owns the slug or the
// slug is sent for different feeds. Unavailable curated feeds with profile posts
// get their curated page back, from the profile data.
async function buildFeedLinks() {
  const curated = await curatedLookup()
  const sites = new Map<string, ProfileSite>()
  const rescued = new Map<string, ProfileFeed>()
  const clashes = new Set<string>()
  for (const { slug, displayName, feeds } of await getProfiles()) {
    for (const feed of feeds) {
      if (curated.page(feed)) continue
      const cur = curated.unavailable(feed)
      if (cur) {
        const prev = rescued.get(cur.slug)
        if (feed.available && feed.entries.length && (!prev || latest(feed) > latest(prev)))
          rescued.set(cur.slug, { ...cur, entries: feed.entries })
        continue
      }
      if (curated.inOpml(feed)) continue
      const prev = sites.get(feed.slug)
      if (!prev) sites.set(feed.slug, { feed, followers: [{ slug, displayName }] })
      else if (normalizeUrl(prev.feed.xmlUrl) !== normalizeUrl(feed.xmlUrl))
        clashes.add(feed.slug)
      else {
        prev.followers.push({ slug, displayName })
        if (latest(feed) > latest(prev.feed)) prev.feed = feed
      }
    }
  }
  for (const slug of sites.keys()) {
    if (curated.slugs.has(slug)) clashes.add(slug)
  }
  for (const slug of clashes) {
    console.warn(`profiles: feed slug "${slug}" is taken, no /sites/ page`)
    sites.delete(slug)
  }
  const sitePage = (feed: ProfileFeed) => {
    const cur = curated.unavailable(feed)
    if (cur) return rescued.has(cur.slug) ? `/sites/${cur.slug}/` : undefined
    const site = sites.get(feed.slug)
    return site && normalizeUrl(site.feed.xmlUrl) === normalizeUrl(feed.xmlUrl)
      ? `/sites/${feed.slug}/`
      : undefined
  }
  return {
    sites,
    rescued,
    page: (feed: ProfileFeed) => curated.page(feed) ?? sitePage(feed),
    inOpml: curated.inOpml,
  }
}

// Internal page and OPML membership for profile feeds.
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
