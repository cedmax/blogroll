import rss from "@astrojs/rss"
import type { APIContext } from "astro"
import { getFeeds } from "../utils/feeds"

// Aggregate feed: the latest post from each site, one item per site, capped at 20.
// Deliberately undiscoverable — no autodiscovery <link> in <head>, no visible link,
// and excluded from the sitemap (see astro.config.mjs). Reachable only at /rss.xml.
export async function GET(context: APIContext) {
  const feeds = await getFeeds()

  const items = feeds
    .map((feed) => ({ feed, entry: feed.entries[0] }))
    .filter((x): x is { feed: (typeof feeds)[number]; entry: NonNullable<typeof x.entry> } =>
      Boolean(x.entry),
    )
    .sort(
      (a, b) => new Date(b.entry.published).getTime() - new Date(a.entry.published).getTime(),
    )
    .slice(0, 20)
    .map(({ feed, entry }) => ({
      title: entry.title,
      link: entry.url,
      pubDate: new Date(entry.published),
      description: feed.title,
    }))

  return rss({
    title: "blogroll.it",
    description: "Gli ultimi post dai blog personali italiani",
    site: context.site!,
    items,
  })
}
