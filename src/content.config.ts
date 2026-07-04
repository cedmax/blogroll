import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const entrySchema = z.object({
  title: z.string(),
  url: z.string(),
  published: z.string(),
})

const feeds = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/data/feeds' }),
  schema: z.object({
    title: z.string(),
    xmlUrl: z.string(),
    htmlUrl: z.string(),
    description: z.string(),
    slug: z.string(),
    entries: z.array(entrySchema),
  }),
})

export const collections = { feeds }
