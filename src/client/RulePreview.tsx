'use client'

import { useConfig, useFormFields } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

type Preview = { problems: string[]; summary?: string; next?: string[]; timezone?: string }

/**
 * Under the repeat-rule builder: the rule in words and its next six dates, as it's being built. Problems are listed
 * in plain words instead. Reads the form, asks the server (which works the rule out the same way it will on save).
 */
export function RulePreview() {
  const { config } = useConfig()
  const recurring = useFormFields(([f]) => f.recurring?.value)
  const rule = useFormFields(([f]) =>
    Object.fromEntries(
      Object.entries(f)
        .filter(([k]) => k.startsWith('rule.'))
        .map(([k, v]) => [k.slice(5), v?.value]),
    ),
  )
  const key = JSON.stringify(rule)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!recurring) return
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${config.serverURL ?? ''}${config.routes.api}/events/preview-rule`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule }),
        })
        setPreview((await res.json()) as Preview)
        setFailed(!res.ok)
      } catch {
        setFailed(true)
      }
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, recurring])

  if (!recurring) return null
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { timeZone: preview?.timezone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  return (
    <div className="field-type events-rule-preview" style={{ marginBottom: 'var(--base, 20px)' }}>
      <div role="status" aria-live="polite" style={{ padding: '12px 16px', borderRadius: 'var(--style-radius-s, 4px)', background: 'var(--theme-elevation-50)', color: 'var(--theme-text)' }}>
        {failed ? (
          <p style={{ margin: 0 }}>Couldn’t check the rule just now. It’s checked again when you save.</p>
        ) : !preview ? (
          <p style={{ margin: 0 }}>Working out the dates…</p>
        ) : preview.problems.length ? (
          <>
            <p style={{ margin: '0 0 4px', fontWeight: 600 }}>Not finished yet:</p>
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {preview.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p style={{ margin: '0 0 6px', fontWeight: 600 }}>
              {preview.summary} ({preview.timezone})
            </p>
            {preview.next?.length ? (
              <>
                <p style={{ margin: '0 0 2px' }}>Next dates:</p>
                <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                  {preview.next.map((n) => (
                    <li key={n}>{fmt(n)}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p style={{ margin: 0 }}>This rule has no dates left.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
