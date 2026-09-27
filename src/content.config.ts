import { defineCollection, z } from "astro:content"
import { glob } from "astro/loaders"

const entrySchema = z.object({
  title: z.string(),
  url: z.string(),
  published: z.string(),
})

const feedSchema = z.object({
  title: z.string(),
  xmlUrl: z.string(),
  htmlUrl: z.string(),
  description: z.string(),
  slug: z.string(),
  available: z.boolean().default(true),
  entries: z.array(entrySchema),
})

const feeds = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/data/feeds" }),
  schema: feedSchema,
})

// Optional, written by scripts/fetch-profiles.mjs; empty when the profiles API
// isn't configured. `_meta.json` is bookkeeping, not a profile.
const profilesGlob = glob({ pattern: ["*.json", "!_*.json"], base: "./src/data/profiles" })

const profiles = defineCollection({
  // The glob loader returns early on a directory with no matching files,
  // leaving the previous build's entries in Astro's persisted data store, so
  // profiles removed since would still get /u/ pages. Start from a clean slate.
  loader: {
    ...profilesGlob,
    load: (context) => {
      context.store.clear()
      return profilesGlob.load(context)
    },
  },
  schema: z.object({
    slug: z.string(),
    displayName: z.string(),
    feeds: z.array(feedSchema),
  }),
})

export const collections = { feeds, profiles }
