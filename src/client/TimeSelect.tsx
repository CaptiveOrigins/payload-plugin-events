'use client'

import { FieldDescription, FieldError, FieldLabel, useField } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import { useId } from 'react'

import { timeOptions } from '../time.js'

/**
 * The start-time picker: a plain select of 15-minute steps over a text field. Stored as "HH:MM" text, not as a
 * select field, because a select's values become GraphQL enum names and "19:00" can't be one.
 */
export const TimeSelect: TextFieldClientComponent = ({ field, path: pathIn }) => {
  const path = pathIn ?? field.name
  const { value, setValue, showError, errorMessage } = useField<string>({ path })
  const id = `${useId()}-time`
  const description = typeof field.admin?.description === 'string' ? field.admin.description : undefined
  return (
    <div className="field-type select" style={{ flex: '1 1 auto', width: field.admin?.width }}>
      <FieldLabel htmlFor={id} label={field.label || 'Starts at'} path={path} required={field.required} />
      <div className="field-type__wrap">
        <FieldError path={path} message={errorMessage} showError={showError} />
        <select
          id={id}
          value={value ?? ''}
          onChange={(e) => setValue(e.target.value || null)}
          aria-invalid={showError || undefined}
          style={{ width: '100%', minHeight: 40, padding: '0 10px', border: '1px solid var(--theme-elevation-150)', borderRadius: 'var(--style-radius-s, 4px)', background: 'var(--theme-input-bg)', color: 'var(--theme-elevation-800)', font: 'inherit' }}
        >
          <option value="">Choose a time…</option>
          {timeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {description ? <FieldDescription description={description} path={path} /> : null}
    </div>
  )
}
