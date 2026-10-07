import { dayKey } from "./dates"

type GroupableFeed = {
  slug: string
  entries: { title: string; url: string; published: string }[]
}

export function groupEntriesByDay<F extends GroupableFeed>(feeds: F[], maxDays?: number) {
  const cutoff = maxDays === undefined ? -Infinity : Date.now() - maxDays * 24 * 60 * 60 * 1000
  const entries = feeds
    .flatMap(({ entries, ...feed }) =>
      entries
        .filter((e) => new Date(e.published).getTime() >= cutoff)
        .map((e) => ({ ...e, feed })),
    )
    .sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime())

  const entryCount = entries.length
  // The YYYY-MM-DD day keys are parsed back with new Date(), i.e. UTC midnight;
  // fmtLong then renders them in Europe/Rome on the same calendar day only
  // because Rome is always at or ahead of UTC.
  const groupDates = [...new Set(entries.map((e) => dayKey(new Date(e.published))))]
  const byDate = Object.groupBy(entries, (e) => dayKey(new Date(e.published)))

  function collapseByFeed(dayEntries: typeof entries) {
    const feedGroups = new Map<string, typeof entries>()
    for (const e of dayEntries) {
      const slug = e.feed.slug
      if (!feedGroups.has(slug)) feedGroups.set(slug, [])
      feedGroups.get(slug)!.push(e)
    }
    const keep = new Map<(typeof entries)[0], number>()
    for (const group of feedGroups.values()) {
      keep.set(group[group.length - 1], group.length - 1)
    }
    return dayEntries
      .filter((e) => keep.has(e))
      .map((e) => ({ ...e, extraCount: keep.get(e)! }))
  }

  const collapsedByDate = Object.fromEntries(
    groupDates.map((date) => [date, collapseByFeed(byDate[date]!)]),
  )

  return { groupDates, collapsedByDate, entryCount, entries }
}
