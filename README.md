# Blogroll.it

Source for [blogroll.it](https://blogroll.it/) — a feed aggregator for Italian tech blogs.

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
go run main.go              # fetch feeds, write src/data/, copy OPML
go run main.go -opml <file> # use a different OPML file
```

## Architecture

Two-stage build: Go fetches the RSS/Atom feeds and writes JSON to `src/data/`; Astro reads that JSON and generates the static site in `dist/`.

Feed results are cached in `cache.json` using ETag/Last-Modified headers for efficient conditional GET on subsequent runs.

## Adding a feed

Edit `itblogs.opml` directly or open a PR. The next build picks up the change.

## Credits

`main.go` is a fork of [peterc/engblogs](https://github.com/peterc/engblogs) by Peter Cooper.
