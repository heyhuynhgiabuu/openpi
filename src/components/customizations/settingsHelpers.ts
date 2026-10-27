import type { PiSettings } from '../../lib/ipc'

export function getNestedValue(obj: PiSettings, key: string): unknown {
  const parts = key.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

export function hasNestedKey(obj: PiSettings, key: string): boolean {
  const parts = key.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return false
    if (!Object.hasOwn(cur as object, p)) return false
    cur = (cur as Record<string, unknown>)[p]
  }
  return true
}

export function setNestedValue(obj: PiSettings, key: string, value: unknown): PiSettings {
  const parts = key.split('.')
  if (parts.length === 1) return { ...obj, [key]: value }
  const [first, ...rest] = parts
  const child = (obj[first] as PiSettings) ?? {}
  return { ...obj, [first]: setNestedValue(child, rest.join('.'), value) }
}

export function deleteNestedValue(obj: PiSettings, key: string): PiSettings {
  const parts = key.split('.')
  if (parts.length === 1) {
    const next = { ...obj }
    delete next[key]
    return next
  }
  const [first, ...rest] = parts
  const child = (obj[first] as PiSettings) ?? {}
  const next = deleteNestedValue(child, rest.join('.'))
  if (Object.keys(next).length === 0) {
    const remaining = { ...obj }
    delete remaining[first]
    return remaining
  }
  return { ...obj, [first]: next }
}

/**
 * Apply a settings-pane edit. An emptied string-array means "back to the Pi
 * default", not an explicit empty list — critical for defaultTools where []
 * disables ALL built-in tools while an absent key keeps read/bash/edit/write.
 */
export function applySettingValue(obj: PiSettings, key: string, value: unknown): PiSettings {
  if (Array.isArray(value) && value.length === 0) return deleteNestedValue(obj, key)
  return setNestedValue(obj, key, value)
}

export type BaseField = {
  key: string
  label: string
  description: string
  default?: unknown
}
export type BoolField = BaseField & { type: 'boolean' }
export type StrField = BaseField & { type: 'string'; placeholder?: string }
export type NumField = BaseField & {
  type: 'number'
  min?: number
  max?: number
  step?: number
}
export type SelField = BaseField & { type: 'select'; options: string[] }
export type ArrField = BaseField & { type: 'string-array'; placeholder?: string }

/** One option of a `choice` field. `value` keeps its persisted type (boolean or string). */
export interface ChoiceOption {
  value: boolean | string
  label: string
  help: string
}
export interface ChoiceField extends BaseField {
  type: 'choice'
  options: readonly ChoiceOption[]
}

export type SettingField = BoolField | StrField | NumField | SelField | ArrField | ChoiceField

/** Position of the option whose persisted value is `value` (strict equality), or -1. */
export function choiceIndex(options: readonly ChoiceOption[], value: unknown): number {
  return options.findIndex((option) => option.value === value)
}

/**
 * Option shown and applied for a stored value. Unknown or missing values resolve
 * to the field default, matching how Pi reads quietStartup.
 */
export function effectiveChoiceIndex(field: ChoiceField, value: unknown): number {
  const exact = choiceIndex(field.options, value)
  return exact >= 0 ? exact : choiceIndex(field.options, field.default)
}

export interface SettingSection {
  id: string
  label: string
  fields: SettingField[]
}
