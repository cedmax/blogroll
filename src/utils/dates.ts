const shortFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
const longFmt  = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long',  year: 'numeric' })

export const fmtShort = (d: Date) => shortFmt.format(d)
export const fmtLong  = (d: Date) => longFmt.format(d)
