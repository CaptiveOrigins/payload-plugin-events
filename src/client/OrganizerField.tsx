'use client'

import { TextField, useConfig } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import { useEffect, useId, useRef, useState } from 'react'

/**
 * The organizer box: Payload's own text field, with the organizers of earlier events offered as suggestions
 * (the browser's list, so it works with the keyboard and screen readers). Anything new can still be typed.
 * Only events the signed-in person can read are used.
 */
export const OrganizerField: TextFieldClientComponent = (props) => {
  const { config } = useConfig()
  const ref = useRef<HTMLInputElement>(null)
  const listId = `${useId()}-organizers`
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    const stop = new AbortController()
    const url = `${config.serverURL ?? ''}${config.routes.api}/events?depth=0&limit=200&sort=-updatedAt&select[organizer]=true&where[organizer][exists]=true&draft=true`
    fetch(url, { credentials: 'include', signal: stop.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ docs: { organizer?: string | null }[] }>) : { docs: [] }))
      .then(({ docs }) => {
        const seen = new Map<string, string>()
        for (const d of docs) {
          const n = d.organizer?.trim()
          if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n)
        }
        setNames([...seen.values()].sort((a, b) => a.localeCompare(b)))
      })
      .catch(() => {
        // Only suggestions: the box works without them.
      })
    return () => stop.abort()
  }, [config.serverURL, config.routes.api])

  useEffect(() => {
    ref.current?.setAttribute('list', listId)
  }, [listId])

  return (
    <>
      <TextField {...props} inputRef={ref as React.RefObject<HTMLInputElement>} />
      <datalist id={listId}>
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  )
}
