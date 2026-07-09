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

function isHttpUrl(value) {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

async function createGithubIssue({ title, body, labels }) {
  try {
    const issueResp = await fetch("https://api.github.com/repos/cedmax/blogroll/issues", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "blogroll.it",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ title, body, labels }),
    })

    if (!issueResp.ok) {
      const text = await issueResp.text()
      console.error("GitHub API error:", issueResp.status, text)
    }
  } catch (err) {
    console.error("GitHub issue creation failed:", err.message)
  }
}

async function handleProposta(data) {
  const { siteName, siteUrl, feedUrl, ack1, ack2, ack3 } = data

  // Server-side re-check of acknowledgments
  if (!ack1 || !ack2 || !ack3) {
    console.error("Proposta rejected: missing acknowledgment checkbox(es)")
    return
  }

  // URL validation
  for (const [label, value] of [
    ["sito", siteUrl],
    ["feed", feedUrl],
  ]) {
    if (!isHttpUrl(value)) {
      console.error(`Proposta rejected: invalid URL del ${label}: ${value}`)
      return
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
      console.error(`Proposta rejected: blocked hostname (${feedHost}, ${siteHost})`)
      return
    }
  }

  // Duplicates are rejected downstream: add-feed-to-opml.mjs fails the
  // feed-suggestion workflow if the feed/site is already in the OPML.

  // Body format must match what stefanbuck/github-issue-parser@v3 expects
  // when parsing against add-feed.yml (headings mirror the template's field labels)
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

  await createGithubIssue({
    title: `Aggiungi sito: ${siteName}`,
    body: issueBody,
    labels: ["feed-suggestion"],
  })
}

async function handleSegnalazione(data) {
  const { siteUrl, reason } = data

  if (!isHttpUrl(siteUrl)) {
    console.error(`Segnalazione rejected: invalid URL del sito o del feed: ${siteUrl}`)
    return
  }

  if (!reason || !reason.trim()) {
    console.error("Segnalazione rejected: missing motivo")
    return
  }

  // No BLOCKED_HOSTNAMES check here — that list exists to keep platforms out
  // of new proposals, but a legitimate removal report may well target one.
  // No OPML-membership check either — same "let manual review catch it"
  // approach as handleProposta; there's no automation on feed-removal issues
  // to fail out of even if there were.

  // Headings mirror remove-feed.yml's field labels verbatim, matching the
  // same convention as handleProposta above.
  const issueBody = [
    "### URL del sito o del feed",
    "",
    siteUrl,
    "",
    "### Motivo",
    "",
    reason,
  ].join("\n")

  await createGithubIssue({
    title: `Rimuovi sito: ${siteUrl}`,
    body: issueBody,
    labels: ["feed-removal"],
  })
}

const FORM_HANDLERS = {
  proposte: handleProposta,
  segnalazioni: handleSegnalazione,
}

exports.handler = async (event) => {
  try {
    const { form_name, data } = JSON.parse(event.body).payload

    // Honeypot — Netlify already filters these before this function fires,
    // but re-check defensively in case that filtering changes or lags
    if (data.website) {
      return { statusCode: 200 }
    }

    const handler = FORM_HANDLERS[form_name]
    if (!handler) {
      console.error(`submission-created: unrecognized form_name "${form_name}"`)
      return { statusCode: 200 }
    }

    await handler(data)
    return { statusCode: 200 }
  } catch (err) {
    console.error("submission-created handler failed:", err.message)
    return { statusCode: 200 }
  }
}
