'use client'

import { useConfig, useDocumentInfo, useField, useFormFields } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

type Match = { id: string; name: string; kind: 'one-time' | 'reusable' | 'recurring'; reasons: string[]; question: string }
const REASON: Record<string, string> = { name: 'a similar name', organizer: 'the same organizer', website: 'the same website', venue: 'the same venue' }

/**
 * While a new event is being written: events it largely overlaps, with what to do about each. Nothing is merged
 * without a person's yes; "It's a different event" is remembered on both events once this one is saved.
 */
export function DuplicateCheck() {
  const { config } = useConfig()
  const { id } = useDocumentInfo()
  const api = `${config.serverURL ?? ''}${config.routes.api}`
  const admin = config.routes.admin
  const name = useFormFields(([f]) => f.name?.value as string | undefined)
  const organizer = useFormFields(([f]) => f.organizer?.value as string | undefined)
  const website = useFormFields(([f]) => f.website?.value as string | undefined)
  const { value: dismissed, setValue: setDismissed } = useField<string[]>({ path: 'notDuplicateOf' })
  const [matches, setMatches] = useState<Match[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState('')

  useEffect(() => {
    if (id || !name || name.trim().length < 3) return setMatches([])
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${api}/events/similar`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, organizer, website, notDuplicateOf: dismissed ?? [] }),
        })
        if (res.ok) setMatches(((await res.json()) as { matches: Match[] }).matches)
      } catch {
        // Only a hint: saving works without it.
      }
    }, 400)
    return () => clearTimeout(t)
  }, [api, id, name, organizer, website, dismissed])

  if (id || !matches.length) return <p role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }} />

  async function makeReusable(m: Match) {
    setBusy(m.id)
    const res = await fetch(`${api}/events/${m.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reusable: true }) })
    setBusy(null)
    if (!res.ok) return setSaid(`Couldn’t change “${m.name}”. You may not have permission.`)
    window.location.assign(`${admin}/collections/events/${m.id}`)
  }

  return (
    <div role="status" aria-live="polite" className="field-type" style={{ marginBottom: 'var(--base, 20px)', padding: '12px 16px', borderRadius: 'var(--style-radius-s, 4px)', border: '1px solid var(--theme-warning-500, #b26b00)', background: 'var(--theme-warning-50, #fff7e6)', color: 'var(--theme-text)' }}>
      <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{matches.length === 1 ? 'This may already be here.' : 'These may already be here.'}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
        {matches.map((m) => (
          <li key={m.id}>
            <p style={{ margin: '0 0 6px' }}>
              {m.question} <span style={{ color: 'var(--theme-elevation-650)' }}>({m.reasons.map((r) => REASON[r] ?? r).join(', ')})</span>
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {m.kind === 'one-time' ? (
                <button type="button" className="btn btn--style-secondary btn--size-small" disabled={busy === m.id} onClick={() => void makeReusable(m)}>
                  Make it reusable, then add a date there
                </button>
              ) : (
                <a className="btn btn--style-secondary btn--size-small" href={`${admin}/collections/events/${m.id}`}>
                  Add a date to it instead
                </a>
              )}
              <button type="button" className="btn btn--style-secondary btn--size-small" onClick={() => setDismissed([...(dismissed ?? []), m.id])}>
                It’s a different event
              </button>
            </div>
          </li>
        ))}
      </ul>
      {said ? <p style={{ margin: '8px 0 0' }}>{said}</p> : null}
    </div>
  )
}
