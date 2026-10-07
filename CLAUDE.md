# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install     # fetch feeds + profiles, write src/data/ (postinstall; profiles env read from .env if present)
npm run build   # astro build → dist/  (requires src/data/ from install)
npm run dev     # start Astro dev server (localhost:4321)
npm run preview # serve dist/ locally

go run main.go              # fetch feeds manually + write src/data/
go run main.go -opml <file> # use a different OPML file
npm run reset               # delete cache.json (forces the next run to refetch all)

# optional: fetch personal profiles into src/data/profiles/ (skips unless both are set)
node --env-file-if-exists=.env scripts/fetch-profiles.mjs   # or export PROFILES_API_URL / PROFILES_API_TOKEN
```

## Architecture

Two-stage build: Go fetches feeds and writes JSON (followed by an optional profiles fetch that
writes JSON too); Astro reads JSON and generates all HTML.

```
main.go                     → fetches feeds → writes src/data/site.json + src/data/feeds/*.json
scripts/fetch-profiles.mjs  → (optional) writes src/data/profiles/*.json
astro build                 → reads src/data/ via Content Layer → outputs dist/
```

**Data flow:**

1. `parseOPML(public/ita.opml)` → `[]Feed`
2. `fetchAllFeeds()` — parallel HTTP with conditional GET (ETag/Last-Modified), results written to `cache.json`. **If `cache.json` already exists when the build starts, existing feeds are served from it with no network request** and only feeds missing from the cache (newly added) are fetched; if it's absent, everything is refetched. CI drives this via the cache restore step: PR/merge builds restore a `cache.json` so warm builds serve from cache and never touch the blogs' servers, while scheduled/dispatch builds start without one and refetch everything fresh (`.github/workflows/deploy.yml`). Locally, `npm run reset` deletes `cache.json` to force a full refetch.
3. `buildFeedData()` — groups entries by feed, sorts each feed's entries desc, sorts feeds by latest entry date
4. `writeSiteJSON()` → `src/data/site.json` (builtAt, opmlFile)
5. `writeFeedFiles()` → `src/data/feeds/<slug>.json` (one file per feed; clears existing `*.json` first so removed feeds don't leave stale pages)
6. Optional: `scripts/fetch-profiles.mjs` (second half of `postinstall`, so before Astro)
   reads personal profiles from the profiles API (`PROFILES_API_URL` + `PROFILES_API_TOKEN`),
   validates them like `main.go` does feeds, and writes `src/data/profiles/<slug>.json` plus
   `_meta.json` (`fetchedAt`). It never fails the build: env unset → clears the directory
   (no `/u/` pages); fetch/parse failure → warns with the cached export's age and leaves the
   directory untouched. In CI the directory is restored from and saved to an actions cache
   (`profiles-cache-*`, every event type, saved only after a successful build), so an API
   outage keeps serving the last good export on `/u/` instead of dropping the pages.
7. Astro reads the `feeds` (and `profiles`) collections via `src/content.config.ts` and
   generates all HTML in `dist/`

The OPML source of truth is `public/ita.opml` — Astro copies `public/` into `dist/` as-is, so it's both the build input and the published, downloadable file (no copy step).

**Key types in `main.go`:**

- `Feed` — title, XML URL, HTML URL, description, slug
- `Entry` — blogURL (the feed's HTML URL, used to group entries by site), post title/URL, published time
- `CacheEntry` — ETag, Last-Modified, description, entries per feed URL (keyed in `cache.json`)
- `JSONFeed` / `JSONEntry` — JSON output types written to `src/data/feeds/`

`parseFeed` accepts RSS, Atom, bare `<channel>`, and RDF, decoding via a
`CharsetReader` so non-UTF-8 (e.g. iso-8859-1) feeds parse. Feed content is
untrusted: entry links must be absolute http(s) URLs (`validLink`) and
responses are capped at 10 MB. `buildFeedData` drops entries with a zero or
future (`> now + 24h`) publish date and strips HTML tags from descriptions, so
the JSON (and everything downstream) is plain text.

Every feed must have an `htmlUrl` and two feeds must never share one (entries
are grouped by it): `main.go` exits 1 on a missing or duplicate `htmlUrl`, and
`add-feed-to-opml.mjs` rejects suggestions whose site URL is already in the
OPML.

`main.go -validate <url>` fetches and parses a single feed and exits non-zero if
it is unreachable, unparseable, or yields no entries. Used by the
"Validate submitted feed" PR check (`.github/workflows/feed-check.yml`).

**GitHub Actions workflows (`.github/workflows/`):**

- `deploy.yml` — builds and deploys to Netlify; warm builds restore `cache.json`, scheduled/dispatch builds don't
- `feed-check.yml` — PR check: validates the submitted feed URL via `main.go -validate`
- `feed-suggestion.yml` — when a "Proponi un sito" issue is filed, parses it and opens a PR adding the feed to `public/ita.opml`; re-runs on issue edits update the same PR (branch keyed by issue number)
- `rebase-on-merge.yml` — when a feed PR merges into main, re-triggers `feed-suggestion` for every open feed-suggestion PR so they rebase onto the updated OPML

**Slug generation:** derived from the feed's HTML URL hostname, minus a leading
`www.` (e.g. `cedmax.net`); SHA1 fallback for collisions or unparseable URLs.

**Astro source layout (Tailwind CSS v4, utility classes in markup):**

```
src/
  content.config.ts          ← defines 'feeds' collection (glob loader over src/data/feeds/)
  data/
    site.json                ← generated: { builtAt, opmlFile }, gitignored
    feeds/<slug>.json        ← generated: one file per feed, gitignored
    profiles/<slug>.json     ← optional, generated by scripts/fetch-profiles.mjs, gitignored
    profiles/_meta.json      ← { fetchedAt } of that export (excluded from the collection)
  styles/global.css          ← Tailwind import + @theme design tokens (bg/ink/green/border…)
  layouts/Base.astro         ← HTML shell, nav, footer; imports global.css
  components/
    EntryRow.astro           ← date|title grid row (site pages + la lista)
    FeedHeader.astro         ← feed title + FeedActions
    FeedActions.astro        ← kebab (⋮) <details> menu: report / visit / copy-feed rows
    ReportDialog.astro       ← modal dialog for reporting a feed (opened from FeedActions)
    ProfileHeader.astro      ← /u/ page heading + post recenti / la lista / OPML tabs
    Logo.astro               ← SVG logo, accepts width prop
    Nav.astro                ← navigation bar with activeNav highlighting + ThemeToggle
    ThemeToggle.astro        ← light/dark theme switcher button
    icons/                   ← ExternalIcon, RssIcon, WarningIcon (shared SVGs)
    Card.astro, MetaLine.astro, SocialMeta.astro
    Prose.astro              ← styles Markdown via scoped `.prose :global(...)` (see below)
  pages/
    index.astro              ← homepage (recent entries grouped by day; includes "un post a caso" link that picks a random blog then a random entry from it, within the last 30 days, at click time via inline JS — blog-weighted so each site gets equal traffic probability)
    lista.astro              ← all sites sorted by last post date (sortFeedsByLatest)
    info.astro               ← "il progetto" page (renders src/content/pages/info.md)
    proposte.astro           ← "Proponi un sito" submission form (Netlify form)
    404.astro                ← renders src/content/pages/404.md
    sites/[slug].astro       ← one page per feed (curated + profile feeds, see Profiles)
    sites/non-disponibile.astro ← "temporarily unavailable" explainer (302 target)
    u/[slug]/index.astro     ← profile "post recenti" (entries grouped by day, no cutoff)
    u/[slug]/lista.astro     ← profile "la lista" (feeds sorted by latest post)
    u/[slug].opml.ts         ← profile OPML export
  scripts/
    netlify-form.ts          ← client-side form validation/wiring for the proposte form
  utils/
    dates.ts                 ← fmtShort/fmtLong/dayKey, it-IT in Europe/Rome (build-machine-TZ independent)
    feeds.ts                 ← getFeeds (filters available), sortFeedsByLatest, builtAt, opmlFile
    entries.ts               ← groupEntriesByDay (home page + profile "post recenti")
    profiles.ts              ← getProfiles, feedLinks (page/inOpml/sites), profilesFetchedAt
scripts/fetch-profiles.mjs   ← optional profiles API fetch → src/data/profiles/
integrations/netlify-redirects.mjs ← build hook: writes dist/_redirects (302s for unavailable feeds)
netlify/
  functions/
    submission-created.js  ← Netlify function: receives form POSTs from proposte.astro,
                              creates a GitHub issue via the feed-bot GitHub App (JWT auth
                              using FEED_BOT_CLIENT_ID / FEED_BOT_PRIVATE_KEY_B64 env vars)
```

**Profiles (optional):** personal feeds never appear on the home page, `/lista`, `rss.xml`, the
random-post picker or `stale.json` (which lists curated feeds only). A profile feed that is
also curated (URLs compared the way `remove-feed-from-opml.mjs` does) links to its curated
`/sites/` page. A profile-only feed with posts gets `/sites/<slug>/` too (one per feed URL),
but `noindex`, out of the sitemap, and marked "Questo sito non fa parte della lista curata, ma
di un blogroll personale"; a slug that is curated, `non-disponibile`, or sent for different
feeds gets no page. A curated feed that is unavailable but has posts in a profile gets its
normal (indexed) page from the profile data (only there: not on the home page, `/lista` or
`rss.xml`); `netlify-redirects.mjs` skips its 302 because the page exists, and
`update-feed-state.mjs` takes its `lastPost` from the profiles so it isn't flagged as
unavailable. `/u/` pages are `noindex`, out of the sitemap, and served with `X-Robots-Tag:
noindex, nofollow` (`public/_headers`, which also covers the profile OPML). Invalid profile
data is dropped silently: the build logs never name profiles or feeds. Without the profiles API
(forks, local checkouts, fork/Dependabot PRs) the build is today's curated site. Reports on
feeds whose site URL isn't in the OPML (even when unavailable, curated feeds count as in it)
are labelled `profile-feed-removal` (no workflow listens to it) and handled manually for now.

Feeds are sorted by latest-entry date at render time in `sortFeedsByLatest`
(`src/utils/feeds.ts`), not in Go.

**`activeNav` prop** on `Base.astro` is forwarded to `Nav.astro` and drives nav active state (`"home"`, `"lista"`, `"info"`, or `""` for site pages).

**Styling:** Tailwind utility classes live directly in the markup; shared design
tokens are defined in `src/styles/global.css`'s `@theme` block. Markdown/slotted
HTML is styled with scoped `<style>` `.prose :global(...)` rules (see
`Prose.astro`), not `is:global`.
