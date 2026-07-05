# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install     # fetch feeds + write src/data/ (postinstall runs go run main.go)
npm run build   # astro build → dist/  (requires src/data/ from install)
npm run dev     # start Astro dev server (localhost:4321)
npm run preview # serve dist/ locally

go run main.go              # fetch feeds manually + write src/data/
go run main.go -opml <file> # use a different OPML file
```

## Architecture

Two-stage build: Go fetches feeds and writes JSON; Astro reads JSON and generates all HTML.

```
main.go      → fetches feeds → writes src/data/site.json + src/data/feeds/*.json
astro build  → reads src/data/ via Content Layer → outputs dist/
```

**Data flow:**

1. `parseOPML(public/ita.opml)` → `[]Feed`
2. `fetchAllFeeds()` — parallel HTTP with conditional GET (ETag/Last-Modified), results written to `cache.json`
3. `buildFeedData()` — groups entries by feed, sorts each feed's entries desc, sorts feeds by latest entry date
4. `writeSiteJSON()` → `src/data/site.json` (builtAt, opmlFile)
5. `writeFeedFiles()` → `src/data/feeds/<slug>.json` (one file per feed; clears existing `*.json` first so removed feeds don't leave stale pages)
6. Astro reads the `feeds` collection via `src/content.config.ts` and generates all HTML in `dist/`

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

Two feeds must never share an `htmlUrl` (entries are grouped by it): `main.go`
exits 1 on duplicates and `add-feed-to-opml.mjs` rejects suggestions whose site
URL is already in the OPML.

`main.go -validate <url>` fetches and parses a single feed and exits non-zero if
it is unreachable, unparseable, or yields no entries. Used by the
"Validate submitted feed" PR check (`.github/workflows/feed-check.yml`).

**Slug generation:** derived from the feed's HTML URL hostname, minus a leading
`www.` (e.g. `cedmax.net`); SHA1 fallback for collisions or unparseable URLs.

**Astro source layout (Tailwind CSS v4, utility classes in markup):**

```
src/
  content.config.ts          ← defines 'feeds' collection (glob loader over src/data/feeds/)
  data/
    site.json                ← generated: { builtAt, opmlFile }, gitignored
    feeds/<slug>.json        ← generated: one file per feed, gitignored
  styles/global.css          ← Tailwind import + @theme design tokens (bg/ink/green/border…)
  layouts/Base.astro         ← HTML shell, nav, footer; imports global.css
  components/
    EntryRow.astro           ← date|title grid row (blog pages + la lista)
    FeedHeader.astro         ← feed title + BlogLink + FeedLink
    Card.astro, BlogLink.astro, FeedLink.astro, MetaLine.astro, SocialMeta.astro
    Prose.astro              ← styles Markdown via scoped `.prose :global(...)` (see below)
  pages/
    index.astro              ← homepage (recent entries grouped by day)
    lista.astro              ← all blogs sorted by last post date (sortFeedsByLatest)
    info.astro               ← "il progetto" page (renders src/content/pages/info.md)
    404.astro                ← renders src/content/pages/404.md
    sites/[slug].astro       ← one page per feed (getStaticPaths over feeds collection)
    sites/non-disponibile.astro ← "temporarily unavailable" explainer (302 target)
  utils/
    dates.ts                 ← fmtShort/fmtLong/dayKey, it-IT in Europe/Rome (build-machine-TZ independent)
    feeds.ts                 ← getFeeds (filters available), sortFeedsByLatest, builtAt, opmlFile
integrations/netlify-redirects.mjs ← build hook: writes dist/_redirects (302s for unavailable feeds)
```

Feeds are sorted by latest-entry date at render time in `sortFeedsByLatest`
(`src/utils/feeds.ts`), not in Go.

**`activeNav` prop** on `Base.astro` drives nav active state (`"home"`, `"lista"`, `"info"`, or `""` for blog pages).

**Styling:** Tailwind utility classes live directly in the markup; shared design
tokens are defined in `src/styles/global.css`'s `@theme` block. Markdown/slotted
HTML is styled with scoped `<style>` `.prose :global(...)` rules (see
`Prose.astro`), not `is:global`.
