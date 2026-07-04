# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install     # fetch feeds + write src/data/ (postinstall runs go run main.go)
npm run build   # astro build → dist/  (requires src/data/ from install)
npm run dev     # start Astro dev server (localhost:4321)
npm run preview # serve dist/ locally

go run main.go              # fetch feeds manually + write src/data/ + copy OPML
go run main.go -opml <file> # use a different OPML file
```

## Architecture

Two-stage build: Go fetches feeds and writes JSON; Astro reads JSON and generates all HTML.

```
main.go      → fetches feeds → writes src/data/site.json + src/data/feeds/*.json + public/itblogs.opml
astro build  → reads src/data/ via Content Layer → outputs dist/
```

**Data flow:**
1. `parseOPML(itblogs.opml)` → `[]Feed`
2. `fetchAllFeeds()` — parallel HTTP with conditional GET (ETag/Last-Modified), results written to `cache.json`
3. `buildFeedData()` — groups entries by feed, sorts each feed's entries desc, sorts feeds by latest entry date
4. `writeSiteJSON()` → `src/data/site.json` (builtAt, opmlFile)
5. `writeFeedFiles()` → `src/data/feeds/<slug>.json` (one file per feed)
6. `copyOPML()` → `public/itblogs.opml` (Astro copies `public/` into `dist/` as-is)
7. Astro reads the `feeds` collection via `src/content/config.ts` and generates all HTML in `dist/`

**Key types in `main.go`:**
- `Feed` — title, XML URL, HTML URL, description, slug
- `Entry` — blogURL, post title/URL, published time
- `CacheEntry` — ETag, Last-Modified, description, entries per feed URL (keyed in `cache.json`)
- `JSONFeed` / `JSONEntry` — JSON output types written to `src/data/feeds/`

**Slug generation:** derived from the feed's HTML URL hostname (e.g. `cedmax.net`); SHA1 fallback for collisions or unparseable URLs.

**Astro source layout:**
```
src/
  content.config.ts         ← defines 'feeds' collection (glob loader over src/data/feeds/)
  data/
    site.json               ← generated: { builtAt, opmlFile }, gitignored
    feeds/<slug>.json       ← generated: one file per feed, gitignored
  layouts/Base.astro        ← HTML shell, all shared CSS (is:global), nav, footer
  components/EntryRow.astro ← shared date|title row; labeled prop adds "ultimo post" eyebrow
  pages/
    index.astro             ← homepage (recent entries grouped by day)
    directory/index.astro   ← all blogs sorted by last post date
    sites/[slug].astro      ← one page per feed (getStaticPaths over feeds collection)
  utils/dates.ts            ← fmtShort/fmtLong using Intl.DateTimeFormat('it-IT')
```

**`activeNav` prop** on `Base.astro` drives nav active state (`"home"`, `"lista"`, or `""` for blog pages).

**Shared CSS components in `Base.astro` (`<style is:global>`):**
- `.entry-row` / `.entry-row-date` / `.entry-row-title` — the date|title grid row used on blog pages and directory
- `.entry-row-date--labeled` modifier adds the "ultimo post" eyebrow label (directory only)
- `.entries` — the card container (white background, border, border-radius)

Page-specific CSS lives in each page's scoped `<style>` block.
