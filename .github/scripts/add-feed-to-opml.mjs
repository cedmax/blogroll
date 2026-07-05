// Reads a parsed feed-suggestion issue (JSON in ISSUE_JSON) and inserts a new
// <outline> into public/ita.opml. Exposes name/site_url/feed_url on GITHUB_OUTPUT
// for the PR title/body. Fails loudly on missing/invalid/duplicate input so the
// workflow surfaces the problem instead of opening a broken PR.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs"

const OPML = "public/ita.opml"

const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}

const data = JSON.parse(process.env.ISSUE_JSON ?? "{}")
// Collapse any newlines: the name flows into GITHUB_OUTPUT (see below), where an
// embedded newline could inject extra key=value lines and spoof the PR body.
const name = (data["site-name"] ?? "").replace(/[\r\n]+/g, " ").trim()
const siteUrl = (data["site-url"] ?? "").trim()
const feedUrl = (data["feed-url"] ?? "").trim()

// Normalize a URL for duplicate comparison: lowercase host, drop a leading
// "www." and a trailing slash, ignore http/https so the same feed can't slip in
// twice via variants. Mirrors the www-stripping in main.go's slugForFeed.
const normalizeUrl = (raw) => {
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, "")
    return `${host}${u.pathname.replace(/\/$/, "")}${u.search}`
  } catch {
    return raw
  }
}

if (!name || !siteUrl || !feedUrl) {
  fail("Missing required field(s): site-name, site-url, feed-url")
}

for (const [label, value] of [
  ["site", siteUrl],
  ["feed", feedUrl],
]) {
  try {
    const u = new URL(value)
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error()
  } catch {
    fail(`Invalid ${label} URL: ${value}`)
  }
}

const escapeAttr = (s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const opml = readFileSync(OPML, "utf8")

const existingFeeds = new Set(
  [...opml.matchAll(/xmlUrl="([^"]+)"/g)].map(([, v]) =>
    // Unescape &amp; last so a sequence like &amp;lt; isn't double-unescaped.
    normalizeUrl(
      v
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&"),
    ),
  ),
)
if (existingFeeds.has(normalizeUrl(feedUrl))) {
  fail(`Feed already present in ${OPML}: ${feedUrl}`)
}

// Two feeds must never share an htmlUrl: main.go groups entries by it (and
// fails the build on duplicates), so reject the suggestion up front.
const existingSites = new Set(
  [...opml.matchAll(/htmlUrl="([^"]+)"/g)].map(([, v]) =>
    normalizeUrl(
      v
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&"),
    ),
  ),
)
if (existingSites.has(normalizeUrl(siteUrl))) {
  fail(`Site already present in ${OPML}: ${siteUrl}`)
}

const line = `      <outline type="rss" text="${escapeAttr(name)}" htmlUrl="${escapeAttr(siteUrl)}" xmlUrl="${escapeAttr(feedUrl)}" />`

// Insert before the closing tag of the outer group outline (indented 4 spaces).
const marker = "\n    </outline>"
const idx = opml.lastIndexOf(marker)
if (idx === -1) fail(`Could not find the group's closing </outline> in ${OPML}`)

writeFileSync(OPML, opml.slice(0, idx) + "\n" + line + opml.slice(idx))

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `name=${name}\nsite_url=${siteUrl}\nfeed_url=${feedUrl}\n`,
  )
}

console.log(`Added feed: ${name} (${feedUrl})`)
