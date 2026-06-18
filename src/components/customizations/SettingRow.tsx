import { Check, RotateCcw } from 'lucide-solid'
import { createSignal, For, Show } from 'solid-js'
import type { SettingField } from './settingsHelpers'

interface RowProps {
  field: SettingField
  value: unknown
  isExplicit: boolean
  scope: 'global' | 'project'
  isLast: boolean
  savedKey: string | null
  onChange: (v: unknown) => void
  onReset: () => void
}

export function SettingRow(props: RowProps) {
  const isOverride = () => props.scope === 'project' && props.isExplicit
  const justSaved = () => props.savedKey === props.field.key

  return (
    <div
      class={`osp-row${props.isLast ? ' osp-row-last' : ''}${isOverride() ? ' osp-row-override' : ''}${props.field.type === 'string-array' ? ' osp-row--stacked' : ''}`}
    >
      <div class="osp-row-left">
        <div class="osp-row-name">
          {props.field.label}
          <Show when={justSaved()}>
            <span class="osp-saved">
              <Check size={10} />
              saved
            </span>
          </Show>
          <Show when={isOverride()}>
            <span class="osp-badge-override">override</span>
          </Show>
        </div>
        <div class="osp-row-desc">{props.field.description}</div>
      </div>

      <div class="osp-row-right">
        <Show when={props.isExplicit}>
          <button
            type="button"
            class="osp-reset-btn"
            onClick={props.onReset}
            title={props.scope === 'global' ? 'Reset to Pi default' : 'Remove project override'}
          >
            <RotateCcw size={11} />
          </button>
        </Show>
        <FieldControl field={props.field} value={props.value} onChange={props.onChange} />
      </div>
    </div>
  )
}

function FieldControl(props: {
  field: SettingField
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (props.field.type === 'boolean') {
    const on = () =>
      typeof props.value === 'boolean'
        ? props.value
        : ((props.field.default as boolean | undefined) ?? false)
    return (
      <button
        type="button"
        class={`osp-toggle${on() ? ' is-on' : ''}`}
        onClick={() => props.onChange(!on())}
        role="switch"
        aria-checked={on()}
        aria-label={props.field.label}
      >
        <span class="osp-toggle-thumb" />
      </button>
    )
  }

  if (props.field.type === 'select') {
    const val = () =>
      props.value !== undefined && props.value !== null && props.value !== ''
        ? String(props.value)
        : ''
    return (
      <select
        class="osp-select"
        value={val()}
        onChange={(e) =>
          props.onChange(e.currentTarget.value === '' ? undefined : e.currentTarget.value)
        }
      >
        <For each={props.field.options}>
          {(opt) => <option value={opt}>{opt === '' ? 'Default' : opt}</option>}
        </For>
      </select>
    )
  }

  if (props.field.type === 'number') {
    const num = () =>
      props.value !== undefined && props.value !== null
        ? Number(props.value)
        : ((props.field.default as number | undefined) ?? 0)
    return (
      <input
        class="osp-input osp-input-num"
        type="number"
        value={num()}
        min={props.field.min}
        max={props.field.max}
        step={props.field.step ?? 1}
        onInput={(e) =>
          props.onChange(e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))
        }
      />
    )
  }

  if (props.field.type === 'string') {
    const str = () =>
      props.value !== undefined && props.value !== null && props.value !== ''
        ? String(props.value)
        : ''
    return (
      <input
        class="osp-input"
        type="text"
        value={str()}
        placeholder={
          props.field.placeholder ?? (props.field.default ? String(props.field.default) : undefined)
        }
        onInput={(e) =>
          props.onChange(e.currentTarget.value === '' ? undefined : e.currentTarget.value)
        }
      />
    )
  }

  if (props.field.type === 'string-array') {
    return (
      <TagControl
        value={Array.isArray(props.value) ? (props.value as string[]) : []}
        placeholder={props.field.placeholder}
        onChange={props.onChange}
      />
    )
  }

  return null
}

function TagControl(props: {
  value: string[]
  placeholder?: string
  onChange: (v: unknown) => void
}) {
  const [draft, setDraft] = createSignal('')

  const add = () => {
    const t = draft().trim()
    if (!t) return
    props.onChange([...props.value, t])
    setDraft('')
  }

  const remove = (i: number) => {
    const next = props.value.filter((_, idx) => idx !== i)
    props.onChange(next.length === 0 ? undefined : next)
  }

  return (
    <div class="osp-tags">
      <For each={props.value}>
        {(tag, i) => (
          <span class="osp-tag">
            {tag}
            <button type="button" onClick={() => remove(i())}>
              ×
            </button>
          </span>
        )}
      </For>
      <input
        class="osp-tag-input"
        value={draft()}
        placeholder={props.value.length === 0 ? (props.placeholder ?? 'Add…') : ''}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
          if (e.key === 'Backspace' && !draft() && props.value.length > 0)
            remove(props.value.length - 1)
        }}
        onBlur={add}
      />
    </div>
  )
}
