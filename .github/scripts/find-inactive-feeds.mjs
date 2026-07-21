const SITE_URL = "https://blogroll.it"
const GH_REPO = process.env.GITHUB_REPOSITORY
const GH_TOKEN = process.env.GH_TOKEN
const unavailMs = Number(process.env.UNAVAIL_DAYS) * 86400000
const staleMs = Number(process.env.STALE_DAYS) * 86400000

const ghFetch = (path, opts = {}) =>
  fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...opts.headers,
    },
  })

// A 404 is definitive — stale.json genuinely doesn't exist yet (first-ever
// deploy) — so there's nothing to check. Anything else (network error,
// timeout, 5xx) is inconclusive and must fail loudly rather than silently
// skipping detection every time it happens.
const res = await fetch(`${SITE_URL}/stale.json`).catch(() => null)
if (res?.status === 404) process.exit(0)
if (!res?.ok) throw new Error(`Failed to fetch ${SITE_URL}/stale.json: ${res ? res.status : "network error"}`)
const state = await res.json()

const now = Date.now()
const flagged = new Set()
const hits = []

for (const f of Object.values(state)) {
  if (now - new Date(f.lastBuild).getTime() > unavailMs) {
    hits.push({ ...f, reason: "unavailable" })
    flagged.add(f.htmlUrl)
  }
}
for (const f of Object.values(state)) {
  if (!flagged.has(f.htmlUrl) && f.lastPost && now - new Date(f.lastPost).getTime() > staleMs) {
    hits.push({ ...f, reason: "stale" })
  }
}

if (hits.length === 0) process.exit(0)

const issuesRes = await ghFetch(
  `/repos/${GH_REPO}/issues?labels=feed-removal&state=open&per_page=100`,
)
if (!issuesRes.ok) throw new Error(`GitHub API error fetching issues: ${issuesRes.status}`)
const openIssues = await issuesRes.json()

const unavailDays = process.env.UNAVAIL_DAYS
const staleDays = process.env.STALE_DAYS

for (const { htmlUrl, title, reason, lastPost } of hits) {
  if (openIssues.some((i) => i.body?.includes(htmlUrl))) continue

  const lastPostStr = lastPost ? lastPost.slice(0, 10) : "mai"
  const motivo =
    reason === "unavailable"
      ? `Feed non raggiungibile da più di ${unavailDays} giorni consecutivi (rilevato automaticamente).`
      : `Feed inattivo da più di ${staleDays} giorni (ultimo post: ${lastPostStr}, rilevato automaticamente).`

  const createRes = await ghFetch(`/repos/${GH_REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: `Rimuovi sito: ${title}`,
      labels: ["feed-removal"],
      body: `### URL del sito o del feed\n\n${htmlUrl}\n\n### Motivo\n\n${motivo}`,
    }),
  })
  if (!createRes.ok)
    throw new Error(`Failed to create issue for ${htmlUrl}: ${createRes.status}`)
  console.log(`Opened issue: ${title} (${htmlUrl}) — ${reason}`)
}
