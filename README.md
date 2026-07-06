# blogroll.it

Source for [blogroll.it](https://blogroll.it/) — a feed aggregator for Italian sites.

## Requirements

- Go 1.25+
- Node.js 22+ (for Astro/npm)

## Commands

```bash
npm install      # fetch feeds and write src/data/ (runs go run main.go via postinstall)
npm run build    # Astro build → dist/
npm run dev      # start Astro dev server at localhost:4321
npm run preview  # serve dist/ locally
```

To fetch feeds manually without going through npm:

```bash
go run main.go              # fetch feeds, write src/data/
go run main.go -opml <file> # use a different OPML file
```

## Architecture

Two-stage build: Go fetches the RSS/Atom feeds and writes JSON to `src/data/`; Astro reads that JSON and generates the static site in `dist/`.

Feed results are cached in `cache.json` using ETag/Last-Modified headers for efficient conditional GET on subsequent runs.

## Adding a feed

The easiest way is to [open a "Proponi un sito" issue](../../issues/new?template=add-feed.yml): fill in the site name, URL, and Italian-only feed URL. An automation parses the issue and opens a PR that adds the entry to `public/ita.opml` for review — a separate **Validate submitted feed** check fetches the added feed and fails the PR if it's unreachable or unparseable.

blogroll.it lists **Italian-language sites only**; sites with English content aren't published, so submit a feed that contains only Italian posts.

You can also edit `public/ita.opml` directly and open a PR yourself. Either way, the next build picks up the change.

## Removing a site

To report a site for removal, [open a "Segnala un sito per la rimozione" issue](../../issues/new?template=remove-feed.yml) with the URL and reason. Removals are reviewed manually — no automated PR is opened.

## Credits

`main.go` is a fork of [peterc/engblogs](https://github.com/peterc/engblogs) by Peter Cooper.
