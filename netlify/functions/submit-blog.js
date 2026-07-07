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

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

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
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" }
    }

    let body
    try {
      body = JSON.parse(event.body)
    } catch {
      return json(400, { error: "Richiesta non valida." })
    }

    const { siteName, siteUrl, feedUrl, ack1, ack2, ack3, turnstileToken, honeypot } = body

    // Honeypot — bots fill it, humans don't; silently succeed
    if (honeypot) {
      return json(200, { ok: true })
    }

    // Server-side re-check of acknowledgments
    if (!ack1 || !ack2 || !ack3) {
      return json(400, { error: "Tutte le conferme sono obbligatorie." })
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
        return json(400, { error: `URL del ${label} non valido.` })
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
        return json(400, {
          error:
            "Questo tipo di piattaforma non è accettata. Solo siti personali indipendenti.",
        })
      }
    }

    // Turnstile verification (fail open on network errors or missing token)
    const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET
    if (TURNSTILE_SECRET && turnstileToken) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        let verifyData
        try {
          const verifyResp = await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ secret: TURNSTILE_SECRET, response: turnstileToken }),
              signal: controller.signal,
            },
          )
          verifyData = await verifyResp.json()
        } finally {
          clearTimeout(timeout)
        }
        if (!verifyData.success) {
          return json(400, { error: "Verifica di sicurezza fallita. Riprova." })
        }
      } catch (err) {
        console.warn("Turnstile verify failed, proceeding:", err.message)
      }
    }

    // OPML duplicate check — file bundled at deploy time via netlify.toml included_files
    try {
      const opml = fs.readFileSync(path.join(__dirname, "public/ita.opml"), "utf8")

      const normAttr = (v) => normalizeUrl(unescapeXmlAttr(v))
      const existingFeeds = [...opml.matchAll(/xmlUrl="([^"]+)"/g)].map(([, v]) => normAttr(v))
      if (existingFeeds.includes(normalizeUrl(feedUrl))) {
        return json(400, { error: "Questo feed è già presente nella lista." })
      }
      const existingSites = [...opml.matchAll(/htmlUrl="([^"]+)"/g)].map(([, v]) => normAttr(v))
      if (existingSites.includes(normalizeUrl(siteUrl))) {
        return json(400, { error: "Questo sito è già presente nella lista." })
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
        return json(500, {
          error: "Errore durante la creazione della segnalazione. Riprova più tardi.",
        })
      }
    } catch (err) {
      console.error("GitHub issue creation failed:", err.message)
      return json(500, {
        error: "Errore durante la creazione della segnalazione. Riprova più tardi.",
      })
    }

    return json(200, { ok: true })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
