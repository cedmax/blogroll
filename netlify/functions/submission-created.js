const fs = require("fs")
const path = require("path")

// Easy to extend — add hostnames (without www.) here to reject suggestions
const BLOCKED_HOSTNAMES = [
  "medium.com",
  "substack.com",
  "wordpress.com",
  "blogspot.com",
  "tumblr.com",
  "ghost.io",
  "hashnode.dev",
  "beehiiv.com",
  "livejournal.com",
  "blogger.com",
]

// Mirrors the normalizeUrl in add-feed-to-opml.mjs
const normalizeUrl = (raw) => {
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, "")
    return `${host}${u.pathname.replace(/\/$/, "")}${u.search}`
  } catch {
    return raw
  }
}

const unescapeXmlAttr = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")

exports.handler = async (event) => {
  try {
    const { data } = JSON.parse(event.body).payload
    const { siteName, siteUrl, feedUrl, ack1, ack2, ack3, website } = data

    // Honeypot — Netlify already filters these before this function fires,
    // but re-check defensively in case that filtering changes or lags
    if (website) {
      return { statusCode: 200 }
    }

    // Server-side re-check of acknowledgments
    if (!ack1 || !ack2 || !ack3) {
      console.error("Submission rejected: missing acknowledgment checkbox(es)")
      return { statusCode: 200 }
    }

    // URL validation
    for (const [label, value] of [
      ["sito", siteUrl],
      ["feed", feedUrl],
    ]) {
      try {
        const u = new URL(value)
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error()
      } catch {
        console.error(`Submission rejected: invalid URL del ${label}: ${value}`)
        return { statusCode: 200 }
      }
    }

    // Blocklist check
    const feedHost = new URL(feedUrl).hostname.replace(/^www\./, "")
    const siteHost = new URL(siteUrl).hostname.replace(/^www\./, "")
    for (const blocked of BLOCKED_HOSTNAMES) {
      if (
        feedHost === blocked ||
        feedHost.endsWith("." + blocked) ||
        siteHost === blocked ||
        siteHost.endsWith("." + blocked)
      ) {
        console.error(`Submission rejected: blocked hostname (${feedHost}, ${siteHost})`)
        return { statusCode: 200 }
      }
    }

    // OPML duplicate check — file bundled at deploy time via netlify.toml included_files
    try {
      const opml = fs.readFileSync(path.join(__dirname, "public/ita.opml"), "utf8")

      const normAttr = (v) => normalizeUrl(unescapeXmlAttr(v))
      const existingFeeds = [...opml.matchAll(/xmlUrl="([^"]+)"/g)].map(([, v]) => normAttr(v))
      if (existingFeeds.includes(normalizeUrl(feedUrl))) {
        console.error(`Submission rejected: feed already present (${feedUrl})`)
        return { statusCode: 200 }
      }
      const existingSites = [...opml.matchAll(/htmlUrl="([^"]+)"/g)].map(([, v]) => normAttr(v))
      if (existingSites.includes(normalizeUrl(siteUrl))) {
        console.error(`Submission rejected: site already present (${siteUrl})`)
        return { statusCode: 200 }
      }
    } catch (err) {
      console.warn("OPML duplicate check skipped:", err.message)
    }

    // Create GitHub issue — body format must match what stefanbuck/github-issue-parser@v3
    // expects when parsing against add-feed.yml (headings mirror the template's field labels)
    const issueBody = [
      "### Nome del sito",
      "",
      siteName,
      "",
      "### URL del sito",
      "",
      siteUrl,
      "",
      "### URL del feed RSS/Atom",
      "",
      feedUrl,
      "",
      "### Conferma",
      "",
      "- [x] Il sito è uno spazio personale, non un profilo su una piattaforma di publishing (es. Medium, Substack)",
      "- [x] I contenuti del sito sono personali, non commerciali",
      "- [x] I contenuti del feed sono solo in italiano",
    ].join("\n")

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN
    try {
      const issueResp = await fetch("https://api.github.com/repos/cedmax/blogroll/issues", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "blogroll.it",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          title: `Aggiungi sito: ${siteName}`,
          body: issueBody,
          labels: ["feed-suggestion"],
        }),
      })

      if (!issueResp.ok) {
        const text = await issueResp.text()
        console.error("GitHub API error:", issueResp.status, text)
      }
    } catch (err) {
      console.error("GitHub issue creation failed:", err.message)
    }

    return { statusCode: 200 }
  } catch (err) {
    console.error("submission-created handler failed:", err.message)
    return { statusCode: 200 }
  }
}
