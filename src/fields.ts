import type { Field } from 'payload'

import { WEEKDAYS } from './rules.js'

const DAY_LABELS: Record<string, string> = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' }
export const weekdayOptions = WEEKDAYS.map((value) => ({ value, label: DAY_LABELS[value]! }))

let zones: string[] | null = null
export const timezones = () => (zones ??= (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone'))
export const timezoneField = (name: string, defaultValue: string, extra: Partial<Field> = {}): Field =>
  ({ name, type: 'select', defaultValue, options: timezones().map((z) => ({ label: z.replace(/_/g, ' '), value: z })), ...extra }) as Field

export const venueFields: Field[] = [
  { name: 'name', type: 'text', label: 'Venue' },
  { name: 'address', type: 'text' },
  {
    type: 'row',
    fields: [
      { name: 'city', type: 'text' },
      { name: 'region', type: 'text', label: 'State or region' },
      { name: 'postalCode', type: 'text', label: 'Postal code' },
      { name: 'country', type: 'text', admin: { description: 'Two-letter code, e.g. US.' } },
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
        { name: 'time', type: 'text', label: 'Starts at', admin: { placeholder: '19:00', width: '20%', description: '24-hour, local time.' } },
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
