// Reads a parsed feed-removal issue (JSON in ISSUE_JSON) and removes the
// matching <outline> from public/ita.opml. Exposes name/site_url on
// GITHUB_OUTPUT for the PR title/body. Fails loudly if the URL is missing,
// invalid, or not found in the OPML.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs"

const OPML = "public/ita.opml"

const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}

const data = JSON.parse(process.env.ISSUE_JSON ?? "{}")
const siteUrl = (data["site-url"] ?? "").trim()

if (!siteUrl) fail("Missing required field: site-url")

try {
  const u = new URL(siteUrl)
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error()
} catch {
  fail(`Invalid URL: ${siteUrl}`)
}

const normalizeUrl = (raw) => {
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, "")
    return `${host}${u.pathname.replace(/\/$/, "")}${u.search}`
  } catch {
    return raw
  }
}

const unescapeAttr = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")

const extractAttr = (line, attr) => {
  const m = line.match(new RegExp(`${attr}="([^"]*)"`))
  return m ? normalizeUrl(unescapeAttr(m[1])) : null
}

const normalized = normalizeUrl(siteUrl)
const lines = readFileSync(OPML, "utf8").split("\n")

const idx = lines.findIndex((line) => {
  const html = extractAttr(line, "htmlUrl")
  const xml = extractAttr(line, "xmlUrl")
  return html === normalized || xml === normalized
})

if (idx === -1) fail(`No feed found in ${OPML} matching: ${siteUrl}`)

const nameMatch = lines[idx].match(/text="([^"]*)"/)
const name = nameMatch ? unescapeAttr(nameMatch[1]) : siteUrl

lines.splice(idx, 1)
writeFileSync(OPML, lines.join("\n"))

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `name=${name}\nsite_url=${siteUrl}\n`)
}

console.log(`Removed feed: ${name} (${siteUrl})`)
