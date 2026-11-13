import type { Field } from 'payload'

import { WEEKDAYS } from './rules.js'
import { isStartTime } from './time.js'

const DAY_LABELS: Record<string, string> = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' }
export const weekdayOptions = WEEKDAYS.map((value) => ({ value, label: DAY_LABELS[value]! }))

let zones: string[] | null = null
/**
 * The timezone field's choices: `UTC`, the plugin's default, then every IANA zone this runtime knows.
 * `Intl.supportedValuesOf('timeZone')` leaves `UTC` out, so it's added here, or the default couldn't be saved.
 */
export const timezones = () => (zones ??= ['UTC', ...(Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone').filter((z) => z !== 'UTC')])
export const timezoneField = (name: string, defaultValue: string, extra: Partial<Field> = {}): Field =>
  ({ name, type: 'select', defaultValue, options: timezones().map((z) => ({ label: z.replace(/_/g, ' '), value: z })), ...extra }) as Field

/** ISO 3166-1 alpha-2 codes, shown by their English names. */
const COUNTRY_CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ')
let countries: { label: string; value: string }[] | null = null
export const countryOptions = () => {
  if (countries) return countries
  const names = new Intl.DisplayNames(['en'], { type: 'region' })
  return (countries = COUNTRY_CODES.map((value) => ({ value, label: names.of(value) ?? value })).sort((a, b) => a.label.localeCompare(b.label)))
}

export { timeOptions } from './time.js'

export const venueFields: Field[] = [
  { name: 'name', type: 'text', label: 'Venue' },
  { name: 'address', type: 'text' },
  {
    type: 'row',
    fields: [
      { name: 'city', type: 'text' },
      { name: 'region', type: 'text', label: 'State or region' },
      { name: 'postalCode', type: 'text', label: 'Postal code' },
      { name: 'country', type: 'select', options: countryOptions() },
    ],
  },
]

/** The admin's repeat-rule builder: plain choices, shown only for what applies. */
export function ruleFields(defaultTimezone: string): Field[] {
  const is = (unit: string) => (_: unknown, sib: Record<string, unknown>) => sib?.unit === unit
  return [
    {
      type: 'row',
      fields: [
        { name: 'every', type: 'number', min: 1, defaultValue: 1, label: 'Every', admin: { width: '20%' } },
        {
          name: 'unit',
          type: 'select',
          label: ' ',
          defaultValue: 'week',
          options: [
            { label: 'day(s)', value: 'day' },
            { label: 'week(s)', value: 'week' },
            { label: 'month(s)', value: 'month' },
            { label: 'year(s)', value: 'year' },
          ],
          admin: { width: '30%' },
        },
      ],
    },
    { name: 'weekdays', type: 'select', hasMany: true, label: 'On', options: weekdayOptions, admin: { condition: is('week'), description: 'Leave empty for the weekday of the first date.' } },
    {
      name: 'monthly',
      type: 'radio',
      label: 'On',
      defaultValue: 'weekdayOfMonth',
      options: [
        { label: 'a weekday of the month (e.g. the 3rd Thursday)', value: 'weekdayOfMonth' },
        { label: 'a day of the month (e.g. the 15th)', value: 'dayOfMonth' },
      ],
      admin: { condition: is('month') },
    },
    {
      type: 'row',
      admin: { condition: (_: unknown, sib: Record<string, unknown>) => sib?.unit === 'month' && sib?.monthly !== 'dayOfMonth' },
      fields: [
        {
          name: 'setPos',
          type: 'select',
          label: 'The',
          options: [
            { label: '1st', value: '1' },
            { label: '2nd', value: '2' },
            { label: '3rd', value: '3' },
            { label: '4th', value: '4' },
            { label: 'last', value: '-1' },
          ],
          admin: { width: '30%' },
        },
        { name: 'weekday', type: 'select', label: ' ', options: weekdayOptions, admin: { width: '40%' } },
      ],
    },
    { name: 'monthDay', type: 'number', min: 1, max: 31, label: 'Day of the month', admin: { condition: (_: unknown, sib: Record<string, unknown>) => sib?.unit === 'month' && sib?.monthly === 'dayOfMonth', description: 'Months without this day are skipped.' } },
    {
      type: 'row',
      fields: [
        { name: 'from', type: 'date', label: 'From', admin: { date: { pickerAppearance: 'dayOnly', displayFormat: 'd MMM yyyy' }, width: '30%' } },
        {
          // Text, not select: "19:00" can't be a GraphQL enum name. The admin shows a select of 15-minute steps.
          name: 'time',
          type: 'text',
          label: 'Starts at',
          validate: (v: unknown) => (isStartTime(v) ? true : 'Pick a start time in 15-minute steps.'),
          admin: { width: '20%', description: 'Local time.', components: { Field: '@extantape/payload-plugin-events/client#TimeSelect' } },
        },
        { name: 'durationMinutes', type: 'number', min: 0, defaultValue: 120, label: 'Length (minutes)', admin: { width: '20%' } },
      ],
    },
    timezoneField('timezone', defaultTimezone, { admin: { description: 'Times are kept in this timezone, so they stay put across daylight saving.' } } as never),
    {
      name: 'ends',
      type: 'radio',
      defaultValue: 'never',
      options: [
        { label: 'Never', value: 'never' },
        { label: 'On a date', value: 'on' },
        { label: 'After a number of times', value: 'after' },
      ],
    },
    { name: 'until', type: 'date', label: 'Last date', admin: { date: { pickerAppearance: 'dayOnly', displayFormat: 'd MMM yyyy' }, condition: (_: unknown, sib: Record<string, unknown>) => sib?.ends === 'on' } },
    { name: 'count', type: 'number', min: 1, label: 'Times', admin: { condition: (_: unknown, sib: Record<string, unknown>) => sib?.ends === 'after' } },
  ]
}
