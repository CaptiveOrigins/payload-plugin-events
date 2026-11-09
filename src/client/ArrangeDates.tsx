'use client'

import { useConfig, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useCallback, useEffect, useId, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'

type DateDoc = { id: string; starts: string; timezone?: string; status?: string; source?: string; venue?: { name?: string; city?: string } | null }
type Plan = { summary: string; refused: string[]; applied: boolean }
type Match = { id: string; name: string; kind: string }

const THIS = 'this'
const box: CSSProperties = { border: '1px solid var(--theme-elevation-150)', borderRadius: 'var(--style-radius-m, 6px)', padding: 12, background: 'var(--theme-elevation-0)', minHeight: 72 }
const card: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', marginTop: 6, borderRadius: 4, background: 'var(--theme-elevation-50)', cursor: 'grab' }

/**
 * Arrange dates: split this event's dates into new events (each date is a card you drag, or move with its "Move to"
 * list), make every date its own event, or merge similar single events into this one. Nothing changes until Apply,
 * and Apply shows what will happen first.
 */
export function ArrangeDates() {
  const { config } = useConfig()
  const { id } = useDocumentInfo()
  const name = useFormFields(([f]) => f.name?.value as string | undefined)
  const api = `${config.serverURL ?? ''}${config.routes.api}`
  const uid = useId()
  const [dates, setDates] = useState<DateDoc[]>([])
  const [where, setWhere] = useState<Record<string, string>>({})
  const [buckets, setBuckets] = useState<{ key: string; name: string }[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [mode, setMode] = useState<'buckets' | 'individual' | 'merge'>('buckets')
  const [similar, setSimilar] = useState<Match[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    const res = await fetch(`${api}/event-dates?where[event][equals]=${id}&limit=0&sort=starts&depth=0`, { credentials: 'include' })
    if (res.ok) setDates(((await res.json()) as { docs: DateDoc[] }).docs)
    if (name) {
      const s = await fetch(`${api}/events/similar`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, id }) })
      if (s.ok) setSimilar(((await s.json()) as { matches: Match[] }).matches.filter((m) => m.kind === 'one-time'))
    }
  }, [api, id, name])

  useEffect(() => {
    void load()
  }, [load])

  if (!id) return null
  const changed = () => (setPlan(null), setMessage(''))
  const move = (dateId: string, to: string) => (setWhere((w) => ({ ...w, [dateId]: to })), changed())
  const addBucket = () => {
    const key = `new-${buckets.length + 1}`
    setBuckets((b) => [...b, { key, name: '' }])
    changed()
    return key
  }
  const fmt = (d: DateDoc) => new Intl.DateTimeFormat(undefined, { timeZone: d.timezone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d.starts))
  const payloadFor = (apply: boolean) =>
    mode === 'merge'
      ? { url: `${api}/events/merge`, body: { into: id, from: picked, apply } }
      : { url: `${api}/events/${id}/arrange`, body: mode === 'individual' ? { allIndividual: true, apply } : { buckets: buckets.map((b) => ({ name: b.name, dates: dates.filter((d) => where[d.id] === b.key).map((d) => d.id) })), apply } }

  async function send(apply: boolean) {
    setBusy(true)
    setMessage('')
    const { url, body } = payloadFor(apply)
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const out = (await res.json()) as Plan & { errors?: { message: string }[] }
      if (!res.ok) setMessage(out.errors?.[0]?.message ?? 'That didn’t work. Nothing was changed.')
      else if (out.applied) {
        setMessage(`Done: ${out.summary}`)
        window.location.reload()
      } else setPlan(out)
    } catch {
      setMessage('Couldn’t reach the site. Nothing was changed.')
    }
    setBusy(false)
  }

  const drop = (to: string) => (e: DragEvent) => {
    e.preventDefault()
    const dateId = e.dataTransfer.getData('text/plain')
    if (dateId) move(dateId, to)
  }
  const targets = [{ key: THIS, name: 'This event' }, ...buckets.map((b, i) => ({ key: b.key, name: b.name.trim() || `New event ${i + 1}` }))]
  const bucket = (key: string, title: string, extra?: ReactNode) => (
    <div style={box} onDragOver={(e) => e.preventDefault()} onDrop={drop(key)} aria-label={title} role="group">
      <div style={{ fontWeight: 600 }}>{title}</div>
      {extra}
      {dates
        .filter((d) => (where[d.id] ?? THIS) === key)
        .map((d) => (
          <div key={d.id} style={card} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', d.id)}>
            <span>
              {fmt(d)}
              {d.venue?.city ? ` · ${d.venue.city}` : ''}
              {d.status && d.status !== 'scheduled' ? ` · ${d.status}` : ''}
            </span>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.9em' }}>
              Move to
              <select value={where[d.id] ?? THIS} onChange={(e) => move(d.id, e.target.value === '+' ? addBucket() : e.target.value)}>
                {targets.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
                <option value="+">+ A new event</option>
              </select>
            </label>
          </div>
        ))}
    </div>
  )

  return (
    <section className="field-type events-arrange" aria-labelledby={`${uid}-h`} style={{ marginBottom: 'var(--base, 20px)' }}>
      <h3 id={`${uid}-h`} style={{ margin: '0 0 4px' }}>
        Arrange dates
      </h3>
      <p style={{ margin: '0 0 12px', color: 'var(--theme-elevation-650)' }}>Split dates into events of their own, or merge similar events into this one. Nothing changes until you apply it.</p>
      <div role="radiogroup" aria-label="What to do" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
        {(
          [
            ['buckets', 'Move dates into new events'],
            ['individual', 'Make every date its own event'],
            ['merge', `Merge similar events into this one${similar.length ? ` (${similar.length})` : ''}`],
          ] as const
        ).map(([value, label]) => (
          <label key={value} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="radio" name={`${uid}-mode`} checked={mode === value} onChange={() => (setMode(value), changed())} />
            {label}
          </label>
        ))}
      </div>

      {mode === 'buckets' ? (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {bucket(THIS, 'This event')}
          {buckets.map((b, i) =>
            bucket(
              b.key,
              b.name.trim() || `New event ${i + 1}`,
              <label style={{ display: 'block', marginTop: 6 }}>
                Name{' '}
                <input
                  value={b.name}
                  placeholder={String(name ?? '')}
                  onChange={(e) => (setBuckets((all) => all.map((x) => (x.key === b.key ? { ...x, name: e.target.value } : x))), changed())}
                />
              </label>,
            ),
          )}
          <button type="button" className="btn btn--style-secondary btn--size-small" onClick={() => void addBucket()} style={{ alignSelf: 'start', justifySelf: 'start' }}>
            + New event
          </button>
        </div>
      ) : mode === 'individual' ? (
        <p>Each of the {dates.length} dates becomes a one-time event of its own, except the first, which stays here.</p>
      ) : similar.length ? (
        <fieldset style={{ border: 0, padding: 0 }}>
          <legend>Single events with a similar name. Their dates move here and their addresses lead here.</legend>
          {similar.map((m) => (
            <label key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <input type="checkbox" checked={picked.includes(m.id)} onChange={(e) => (setPicked((p) => (e.target.checked ? [...p, m.id] : p.filter((x) => x !== m.id))), changed())} />
              {m.name}
            </label>
          ))}
        </fieldset>
      ) : (
        <p>No single events with a similar name.</p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn btn--style-secondary btn--size-small" disabled={busy} onClick={() => void send(false)}>
          Show what will change
        </button>
        <button type="button" className="btn btn--style-primary btn--size-small" disabled={busy || !plan || plan.refused.length > 0} onClick={() => void send(true)}>
          Apply
        </button>
      </div>
      <div role="status" aria-live="polite" style={{ marginTop: 8 }}>
        {plan ? (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>{plan.summary}</p>
            {plan.refused.length ? (
              <>
                <p style={{ margin: '6px 0 2px' }}>It can’t be applied:</p>
                <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                  {plan.refused.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : null}
        {message ? <p style={{ margin: '6px 0 0' }}>{message}</p> : null}
      </div>
    </section>
  )
}
