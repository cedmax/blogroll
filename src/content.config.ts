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

const profilesGlob = glob({ pattern: ["*.json", "!_*.json"], base: "./src/data/profiles" })

const profiles = defineCollection({
  // glob keeps stale store entries when no files match; clear first.
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
