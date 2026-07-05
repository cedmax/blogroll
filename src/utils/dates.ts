// Everything renders in Europe/Rome so output doesn't depend on the build
// machine's timezone (published dates are stored in UTC).
const shortFmt = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Rome",
})
const longFmt = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Rome",
})
// en-CA formats as YYYY-MM-DD, used as a stable grouping key.
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/Rome",
})

export const fmtShort = (d: Date) => shortFmt.format(d)
export const fmtLong = (d: Date) => longFmt.format(d)
export const dayKey = (d: Date) => dayKeyFmt.format(d)
