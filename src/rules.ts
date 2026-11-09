import rrule from 'rrule'

const { RRule } = rrule

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
export type Weekday = (typeof WEEKDAYS)[number]
const DAY_NAMES: Record<Weekday, string> = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' }
const ORDINALS: Record<string, string> = { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '-1': 'last' }

/**
 * A repeat rule as the admin builds it: plain choices, not RRULE text. Times are wall-clock times in `timezone`, so
 * a 7 pm meeting stays at 7 pm across daylight-saving changes.
 */
export type RepeatRule = {
  every: number
  unit: 'day' | 'week' | 'month' | 'year'
  /** Weekly: which days. Default: the weekday of `from`. */
  weekdays?: Weekday[] | null
  /** Monthly: on a day of the month (`monthDay`), or on the nth weekday (`setPos` + `weekday`). */
  monthly?: 'dayOfMonth' | 'weekdayOfMonth' | null
  monthDay?: number | null
  setPos?: 1 | 2 | 3 | 4 | -1 | null
  weekday?: Weekday | null
  /** First possible date, YYYY-MM-DD, and the start time, HH:MM, in `timezone`. */
  from: string
  time: string
  durationMinutes: number
  ends: 'never' | 'on' | 'after'
  until?: string | null
  count?: number | null
  timezone: string
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const parseDay = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) throw new Error(`Not a date: "${s}" (use YYYY-MM-DD).`)
  return [Number(m[1]), Number(m[2]), Number(m[3])] as const
}
const parseTime = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`Not a time: "${s}" (use HH:MM).`)
  return [Number(m[1]), Number(m[2])] as const
}

/** The offset of `timezone` from UTC at `instant`, in minutes. */
function offsetMinutes(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUTC - instant.getTime()) / 60_000)
}

/**
 * The real instant of a wall-clock time in a timezone. A time skipped by a daylight-saving change (2:30 on the
 * spring-forward night) moves forward by the gap, as calendars do.
 */
export function wallToInstant(y: number, mo: number, d: number, h: number, mi: number, timezone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  // The offsets in force half a day either side cover any change of offset on that day.
  const before = offsetMinutes(new Date(guess - 43_200_000), timezone)
  const after = offsetMinutes(new Date(guess + 43_200_000), timezone)
  const candidates = [guess - before * 60_000, guess - after * 60_000]
  const matches = candidates.filter((t) => {
    const w = instantToWall(new Date(t), timezone)
    return w.y === y && w.mo === mo && w.d === d && w.h === h && w.mi === mi
  })
  // Twice in the fall-back hour: the first. Never (spring-forward gap): the earlier offset, which lands after the gap.
  return new Date(matches.length ? Math.min(...matches) : candidates[0]!)
}

/** The wall-clock date and time of an instant in a timezone. */
export function instantToWall(instant: Date, timezone: string) {
  const local = new Date(instant.getTime() + offsetMinutes(instant, timezone) * 60_000)
  return { y: local.getUTCFullYear(), mo: local.getUTCMonth() + 1, d: local.getUTCDate(), h: local.getUTCHours(), mi: local.getUTCMinutes() }
}

export function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Plain-words problems with a rule, or an empty list. */
export function ruleProblems(rule: Partial<RepeatRule> | null | undefined): string[] {
  const out: string[] = []
  if (!rule) return ['Set how often it repeats.']
  if (!rule.every || rule.every < 1 || !Number.isInteger(rule.every)) out.push('“Every” must be a whole number, 1 or more.')
  if (!rule.unit) out.push('Choose days, weeks, months or years.')
  try {
    parseDay(rule.from ?? '')
  } catch {
    out.push('Choose the first date.')
  }
  try {
    parseTime(rule.time ?? '')
  } catch {
    out.push('Choose a start time.')
  }
  if (!rule.timezone || !validTimezone(rule.timezone)) out.push('Choose a timezone.')
  if (rule.unit === 'month' && rule.monthly === 'dayOfMonth' && (!rule.monthDay || rule.monthDay < 1 || rule.monthDay > 31)) out.push('Choose a day of the month, 1 to 31.')
  if (rule.unit === 'month' && rule.monthly === 'weekdayOfMonth' && (!rule.setPos || !rule.weekday)) out.push('Choose which weekday of the month.')
  if (rule.ends === 'on' && !rule.until) out.push('Choose the last date.')
  if (rule.ends === 'after' && (!rule.count || rule.count < 1)) out.push('Say how many times.')
  if (rule.durationMinutes != null && rule.durationMinutes < 0) out.push('The length can’t be negative.')
  return out
}

/** The rule in floating time: wall-clock times carried in UTC fields, which is how rrule does its arithmetic. */
function floating(rule: RepeatRule) {
  const [y, mo, d] = parseDay(rule.from)
  const [h, mi] = parseTime(rule.time)
  const dtstart = new Date(Date.UTC(y, mo - 1, d, h, mi))
  const freq = { day: RRule.DAILY, week: RRule.WEEKLY, month: RRule.MONTHLY, year: RRule.YEARLY }[rule.unit]
  const opts: ConstructorParameters<typeof RRule>[0] = { freq, interval: rule.every, dtstart }
  if (rule.unit === 'week' && rule.weekdays?.length) opts.byweekday = rule.weekdays.map((w) => RRule[w])
  if (rule.unit === 'month' && rule.monthly === 'dayOfMonth' && rule.monthDay) opts.bymonthday = rule.monthDay
  if (rule.unit === 'month' && rule.monthly === 'weekdayOfMonth' && rule.setPos && rule.weekday) opts.byweekday = [RRule[rule.weekday].nth(rule.setPos)]
  if (rule.ends === 'on' && rule.until) {
    const [uy, umo, ud] = parseDay(rule.until)
    opts.until = new Date(Date.UTC(uy, umo - 1, ud, 23, 59, 59))
  }
  if (rule.ends === 'after' && rule.count) opts.count = rule.count
  return new RRule(opts)
}

/** RFC 5545 text, with the timezone, for calendars: `DTSTART;TZID=…:…` and `RRULE:…`. */
export function toICalRule(rule: RepeatRule) {
  const r = floating(rule)
  // DTSTART must be the first real occurrence: calendars count DTSTART itself as one, even off the rule.
  const first = r.after(r.options.dtstart, true) ?? r.options.dtstart
  const [y, mo, d, h, mi] = [first.getUTCFullYear(), first.getUTCMonth() + 1, first.getUTCDate(), first.getUTCHours(), first.getUTCMinutes()]
  const body = new RRule({ ...r.origOptions, dtstart: first })
    .toString()
    .split('\n')
    .find((l) => l.startsWith('RRULE:'))!
    // Calendars expect UNTIL in UTC when DTSTART has a TZID: convert the floating end of day.
    .replace(/UNTIL=(\d{8}T\d{6})Z/, () => {
      const [uy, umo, ud] = parseDay(rule.until!)
      const t = wallToInstant(uy, umo, ud, 23, 59, rule.timezone)
      return `UNTIL=${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00Z`
    })
  return { dtstart: `DTSTART;TZID=${rule.timezone}:${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(mi)}00`, rrule: body }
}

export type Occurrence = { starts: Date; ends: Date }

/** Occurrences whose start falls in [after, before), as real instants. */
export function occurrences(rule: RepeatRule, range: { after: Date; before: Date; limit?: number }): Occurrence[] {
  const r = floating(rule)
  // Widen by a day each side in floating time, then filter on real instants.
  const lo = new Date(range.after.getTime() - 86_400_000 * 2)
  const hi = new Date(range.before.getTime() + 86_400_000 * 2)
  const out: Occurrence[] = []
  for (const f of r.between(lo, hi, true)) {
    const starts = wallToInstant(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes(), rule.timezone)
    if (starts < range.after || starts >= range.before) continue
    out.push({ starts, ends: new Date(starts.getTime() + (rule.durationMinutes ?? 0) * 60_000) })
    if (range.limit && out.length >= range.limit) break
  }
  return out
}

/** The next `n` occurrences on or after `from`. */
export function nextOccurrences(rule: RepeatRule, n: number, from = new Date()): Occurrence[] {
  const r = floating(rule)
  const out: Occurrence[] = []
  const w = instantToWall(from, rule.timezone)
  let cursor = new Date(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - 1)
  for (let guard = 0; out.length < n && guard < n + 5; guard++) {
    const f = r.after(cursor, false)
    if (!f) break
    cursor = f
    const starts = wallToInstant(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes(), rule.timezone)
    if (starts >= from) out.push({ starts, ends: new Date(starts.getTime() + (rule.durationMinutes ?? 0) * 60_000) })
  }
  return out
}

const monthName = (mo: number) => new Date(Date.UTC(2000, mo - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
const plural = (n: number, word: string) => (n === 1 ? word : `${n} ${word}s`)

/** The rule in plain English: "Every 2 months on the 3rd Thursday, from 15 January 2027". */
export function describeRule(rule: RepeatRule): string {
  const unit = plural(rule.every, rule.unit)
  let s = `Every ${unit}`
  if (rule.unit === 'week' && rule.weekdays?.length) {
    const days = [...rule.weekdays].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)).map((w) => DAY_NAMES[w])
    s += ` on ${days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${days.at(-1)}` : days[0]}`
  }
  if (rule.unit === 'month' && rule.monthly === 'dayOfMonth' && rule.monthDay) s += ` on day ${rule.monthDay}`
  if (rule.unit === 'month' && rule.monthly === 'weekdayOfMonth' && rule.setPos && rule.weekday) s += ` on the ${ORDINALS[String(rule.setPos)]} ${DAY_NAMES[rule.weekday]}`
  s += ` at ${rule.time}`
  const [y, mo, d] = parseDay(rule.from)
  s += `, from ${d} ${monthName(mo)} ${y}`
  if (rule.ends === 'on' && rule.until) {
    const [uy, umo, ud] = parseDay(rule.until)
    s += ` until ${ud} ${monthName(umo)} ${uy}`
  }
  if (rule.ends === 'after' && rule.count) s += `, ${rule.count === 1 ? 'once' : `${rule.count} times`}`
  return s
}

/** A fingerprint of everything that changes the dates, so a rule edit can tell whether dates must be redone. */
export const ruleFingerprint = (rule: RepeatRule) =>
  JSON.stringify([rule.every, rule.unit, rule.weekdays ?? [], rule.monthly ?? null, rule.monthDay ?? null, rule.setPos ?? null, rule.weekday ?? null, rule.from, rule.time, rule.durationMinutes ?? 0, rule.ends, rule.until ?? null, rule.count ?? null, rule.timezone])
