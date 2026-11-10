/**
 * Start times in 15-minute steps: stored as 24-hour "HH:MM", shown as "7:00 pm". A plain module so the admin's
 * time picker (client) and the field's validation (server) share one list.
 */
export const timeOptions = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4)
  const m = (i % 4) * 15
  const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  const label = h === 0 && m === 0 ? 'Midnight' : h === 12 && m === 0 ? 'Noon' : `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
  return { value, label }
})

const VALUES = new Set(timeOptions.map((o) => o.value))
/** A start time is empty or one of the 15-minute steps. */
export const isStartTime = (v: unknown) => v === undefined || v === null || v === '' || (typeof v === 'string' && VALUES.has(v))
