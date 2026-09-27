import type { APIRoute, GetStaticPaths } from "astro"
import { sortFeedsByLatest } from "../../utils/feeds"
import { getProfiles, type Profile } from "../../utils/profiles"

export const getStaticPaths = (async () => {
  const profiles = await getProfiles()
  return profiles.map((profile) => ({ params: { slug: profile.slug }, props: { profile } }))
}) satisfies GetStaticPaths

// Mirrors .github/scripts/add-feed-to-opml.mjs
const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export const GET: APIRoute = ({ props }) => {
  const { profile } = props as { profile: Profile }
  const name = escapeAttr(profile.displayName)
  const outlines = sortFeedsByLatest(profile.feeds).map(
    (feed) =>
      `      <outline type="rss" text="${escapeAttr(feed.title)}" htmlUrl="${escapeAttr(feed.htmlUrl)}" xmlUrl="${escapeAttr(feed.xmlUrl)}" />`,
  )
  const opml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<opml version="1.0">`,
    `  <head>`,
    `    <title>blogroll.it — ${name}</title>`,
    `  </head>`,
    `  <body>`,
    `    <outline text="${name}" title="${name}">`,
    ...outlines,
    `    </outline>`,
    `  </body>`,
    `</opml>`,
    ``,
  ].join("\n")
  return new Response(opml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  })
}
