import { describe, expect, it } from 'vitest'

import { describeRule, instantToWall, nextOccurrences, occurrences, ruleProblems, toICalRule, wallToInstant, type RepeatRule } from '../src/rules.js'

const base: RepeatRule = { every: 1, unit: 'week', from: '2027-01-07', time: '19:00', durationMinutes: 120, ends: 'never', timezone: 'America/New_York' }
const day = (d: Date, tz: string) => {
  const w = instantToWall(d, tz)
  return `${w.y}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')} ${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`
}
const all = (r: RepeatRule, from = '2027-01-01', to = '2028-12-31') => occurrences(r, { after: new Date(`${from}T00:00:00Z`), before: new Date(`${to}T00:00:00Z`) }).map((o) => day(o.starts, r.timezone))

describe('repeat rules', () => {
  it('does the owner’s example: every other month on the 3rd Thursday', () => {
    const r: RepeatRule = { ...base, every: 2, unit: 'month', monthly: 'weekdayOfMonth', setPos: 3, weekday: 'TH', from: '2027-01-15', ends: 'after', count: 6, timezone: 'America/Phoenix' }
    expect(all(r).map((d) => d.slice(5, 10))).toEqual(['01-21', '03-18', '05-20', '07-15', '09-16', '11-18'])
    expect(toICalRule(r).rrule).toBe('RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=+3TH;COUNT=6')
    expect(describeRule(r)).toBe('Every 2 months on the 3rd Thursday at 19:00, from 15 January 2027, 6 times')
  })

  it('keeps a 7 pm meeting at 7 pm across daylight-saving changes, so the instant moves', () => {
    const r: RepeatRule = { ...base, weekdays: ['TH'], ends: 'on', until: '2027-04-01' }
    const os = occurrences(r, { after: new Date('2027-03-01T00:00:00Z'), before: new Date('2027-04-02T00:00:00Z') })
    expect(os.map((o) => day(o.starts, r.timezone).slice(11))).toEqual(['19:00', '19:00', '19:00', '19:00', '19:00'])
    // 4 March is EST (UTC-5), 18 March is EDT (UTC-4).
    expect(os[0]!.starts.toISOString()).toBe('2027-03-05T00:00:00.000Z')
    expect(os[2]!.starts.toISOString()).toBe('2027-03-18T23:00:00.000Z')
    expect(os[0]!.ends.getTime() - os[0]!.starts.getTime()).toBe(120 * 60_000)
  })

  it('moves a time skipped by spring-forward on by the gap, and reads both sides of fall-back', () => {
    expect(wallToInstant(2027, 3, 14, 2, 30, 'America/New_York').toISOString()).toBe('2027-03-14T07:30:00.000Z') // 03:30 EDT
    expect(day(wallToInstant(2027, 11, 7, 0, 30, 'America/New_York'), 'America/New_York')).toBe('2027-11-07 00:30')
    // 01:30 happens twice on fall-back night: the first one (still EDT, UTC-4).
    expect(wallToInstant(2027, 11, 7, 1, 30, 'America/New_York').toISOString()).toBe('2027-11-07T05:30:00.000Z')
    expect(day(wallToInstant(2027, 11, 8, 19, 0, 'Europe/London'), 'Europe/London')).toBe('2027-11-08 19:00')
  })

  it('finds the last weekday of a month, and skips months without the day asked for', () => {
    const last: RepeatRule = { ...base, unit: 'month', monthly: 'weekdayOfMonth', setPos: -1, weekday: 'FR', from: '2027-01-01', ends: 'after', count: 3 }
    expect(all(last).map((d) => d.slice(0, 10))).toEqual(['2027-01-29', '2027-02-26', '2027-03-26'])
    const the31st: RepeatRule = { ...base, unit: 'month', monthly: 'dayOfMonth', monthDay: 31, from: '2027-01-01', ends: 'after', count: 4 }
    expect(all(the31st).map((d) => d.slice(0, 10))).toEqual(['2027-01-31', '2027-03-31', '2027-05-31', '2027-07-31'])
  })

  it('ends on a date (that day included) or after a count', () => {
    const byDate: RepeatRule = { ...base, weekdays: ['MO', 'TH'], from: '2027-01-04', ends: 'on', until: '2027-01-14' }
    expect(all(byDate).map((d) => d.slice(0, 10))).toEqual(['2027-01-04', '2027-01-07', '2027-01-11', '2027-01-14'])
    expect(toICalRule(byDate).rrule).toMatch(/UNTIL=20270115T045900Z/) // 23:59 New York in UTC
    expect(toICalRule(byDate).dtstart).toBe('DTSTART;TZID=America/New_York:20270104T190000')
    const byCount: RepeatRule = { ...base, unit: 'year', from: '2027-06-01', ends: 'after', count: 2 }
    expect(all(byCount, '2027-01-01', '2035-01-01')).toHaveLength(2)
  })

  it('gives the next dates from now, and says what’s wrong with a half-built rule', () => {
    const r: RepeatRule = { ...base, unit: 'day', every: 3, from: '2027-01-01', time: '09:15' }
    const next = nextOccurrences(r, 3, new Date('2027-01-05T00:00:00Z'))
    expect(next.map((o) => day(o.starts, r.timezone))).toEqual(['2027-01-07 09:15', '2027-01-10 09:15', '2027-01-13 09:15'])
    expect(ruleProblems({ every: 0, unit: 'month', monthly: 'weekdayOfMonth', from: 'soon', time: '25:00', timezone: 'Mars/Base', ends: 'after' })).toHaveLength(6)
    expect(ruleProblems(base)).toEqual([])
  })
})
