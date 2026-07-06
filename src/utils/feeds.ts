import { getCollection } from "astro:content"
import site from "../data/site.json"
import { fmtLong } from "./dates"

export async function getFeeds() {
  const entries = await getCollection("feeds")
  return entries.filter((e) => !!e.data.available).map((e) => e.data)
}

export type Feed = Awaited<ReturnType<typeof getFeeds>>[number]

export function sortFeedsByLatest(feeds: Feed[]) {
  return [...feeds].sort((a, b) => {
    if (!a.entries[0] && !b.entries[0]) return a.title.localeCompare(b.title)
    if (!a.entries[0]) return 1
    if (!b.entries[0]) return -1
    return (
      new Date(b.entries[0].published).getTime() - new Date(a.entries[0].published).getTime()
    )
  })
}

export function reportUrl(siteUrl: string) {
  return `https://github.com/cedmax/blogroll/issues/new?template=remove-feed.yml&title=${encodeURIComponent("Rimuovi sito: " + siteUrl)}`
}

export const builtAt = fmtLong(new Date(site.builtAt))
export const opmlFile = site.opmlFile
