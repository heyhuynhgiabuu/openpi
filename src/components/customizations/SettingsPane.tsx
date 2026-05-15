import { Check, FolderOpen, Globe, RotateCcw } from 'lucide-solid'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import type { PiSettings, SettingsResult } from '../../lib/ipc'

function getNestedValue(obj: PiSettings, key: string): unknown {
  const parts = key.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function hasNestedKey(obj: PiSettings, key: string): boolean {
  const parts = key.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return false
    if (!Object.hasOwn(cur as object, p)) return false
    cur = (cur as Record<string, unknown>)[p]
  }
  return true
}

function setNestedValue(obj: PiSettings, key: string, value: unknown): PiSettings {
  const parts = key.split('.')
  if (parts.length === 1) return { ...obj, [key]: value }
  const [first, ...rest] = parts
  const child = (obj[first] as PiSettings) ?? {}
  return { ...obj, [first]: setNestedValue(child, rest.join('.'), value) }
}

function deleteNestedValue(obj: PiSettings, key: string): PiSettings {
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

type BaseField = {
  key: string
  label: string
  description: string
  default?: unknown
}
type BoolField = BaseField & { type: 'boolean' }
type StrField = BaseField & { type: 'string'; placeholder?: string }
type NumField = BaseField & {
  type: 'number'
  min?: number
  max?: number
  step?: number
}
type SelField = BaseField & { type: 'select'; options: string[] }
type ArrField = BaseField & { type: 'string-array'; placeholder?: string }
export type SettingField = BoolField | StrField | NumField | SelField | ArrField

interface SettingSection {
  id: string
  label: string
  fields: SettingField[]
}

const SECTIONS: SettingSection[] = [
  {
    id: 'model',
    label: 'Model & Thinking',
    fields: [
      {
        key: 'defaultProvider',
        type: 'string',
        label: 'Default Provider',
        description: 'Provider used for new sessions, e.g. "anthropic" or "openai"',
        placeholder: 'anthropic',
        default: '',
      },
      {
        key: 'defaultModel',
        type: 'string',
        label: 'Default Model',
        description: 'Model ID used for new sessions',
        placeholder: 'claude-sonnet-4-20250514',
        default: '',
      },
      {
        key: 'defaultThinkingLevel',
        type: 'select',
        label: 'Default Thinking Level',
        description: 'Thinking depth applied when starting a session',
        options: ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
        default: '',
      },
      {
        key: 'hideThinkingBlock',
        type: 'boolean',
        label: 'Hide Thinking Blocks',
        description: 'Suppress thinking content from appearing in the conversation',
        default: false,
      },
    ],
  },
  {
    id: 'compaction',
    label: 'Compaction',
    fields: [
      {
        key: 'compaction.enabled',
        type: 'boolean',
        label: 'Auto-Compaction',
        description: 'Automatically compress context when approaching token limits',
        default: true,
      },
      {
        key: 'compaction.reserveTokens',
        type: 'number',
        label: 'Reserve Tokens',
        description: 'Tokens reserved for the LLM response during compaction',
        default: 16384,
        min: 512,
        max: 131072,
        step: 512,
      },
      {
        key: 'compaction.keepRecentTokens',
        type: 'number',
        label: 'Keep Recent Tokens',
        description: 'Most-recent tokens to keep uncompacted',
        default: 20000,
        min: 1024,
        max: 131072,
        step: 512,
      },
    ],
  },
  {
    id: 'retry',
    label: 'Retry',
    fields: [
      {
        key: 'retry.enabled',
        type: 'boolean',
        label: 'Auto-Retry',
        description: 'Automatically retry on transient agent errors',
        default: true,
      },
      {
        key: 'retry.maxRetries',
        type: 'number',
        label: 'Max Retries',
        description: 'Maximum number of agent-level retry attempts',
        default: 3,
        min: 0,
        max: 20,
      },
      {
        key: 'retry.baseDelayMs',
        type: 'number',
        label: 'Base Delay (ms)',
        description: 'Starting delay for exponential backoff between retries',
        default: 2000,
        min: 100,
        max: 30000,
        step: 100,
      },
      {
        key: 'retry.provider.timeoutMs',
        type: 'number',
        label: 'Provider Timeout (ms)',
        description: 'Per-request timeout for provider calls',
        default: 3600000,
        min: 1000,
        max: 3600000,
        step: 1000,
      },
      {
        key: 'retry.provider.maxRetries',
        type: 'number',
        label: 'Provider Retries',
        description: 'Provider/SDK-level retry attempts',
        default: 0,
        min: 0,
        max: 20,
      },
      {
        key: 'retry.provider.maxRetryDelayMs',
        type: 'number',
        label: 'Max Retry Delay (ms)',
        description: 'Cap on server-requested retry delays — set 0 to disable',
        default: 60000,
        min: 0,
        max: 3600000,
        step: 1000,
      },
    ],
  },
  {
    id: 'delivery',
    label: 'Message Delivery',
    fields: [
      {
        key: 'steeringMode',
        type: 'select',
        label: 'Steering Mode',
        description: 'How steering messages are dispatched while the agent is running',
        options: ['one-at-a-time', 'all'],
        default: 'one-at-a-time',
      },
      {
        key: 'followUpMode',
        type: 'select',
        label: 'Follow-Up Mode',
        description: 'How follow-up messages are sent after the agent stops',
        options: ['one-at-a-time', 'all'],
        default: 'one-at-a-time',
      },
      {
        key: 'transport',
        type: 'select',
        label: 'Transport',
        description: 'Preferred transport for providers that support multiple options',
        options: ['sse', 'websocket', 'auto'],
        default: 'sse',
      },
    ],
  },
  {
    id: 'ui',
    label: 'UI & Display',
    fields: [
      {
        key: 'quietStartup',
        type: 'boolean',
        label: 'Quiet Startup',
        description: 'Hide the Pi startup header when a session opens',
        default: false,
      },
      {
        key: 'enableInstallTelemetry',
        type: 'boolean',
        label: 'Install Telemetry',
        description: 'Send an anonymous install/update ping to pi.dev',
        default: true,
      },
      {
        key: 'doubleEscapeAction',
        type: 'select',
        label: 'Double Escape Action',
        description: 'Action triggered when you press Escape twice',
        options: ['tree', 'fork', 'none'],
        default: 'tree',
      },
      {
        key: 'collapseChangelog',
        type: 'boolean',
        label: 'Collapse Changelog',
        description: 'Show condensed changelog after Pi updates',
        default: false,
      },
      {
        key: 'warnings.anthropicExtraUsage',
        type: 'boolean',
        label: 'Anthropic Usage Warning',
        description: 'Warn when subscription auth may trigger paid extra usage',
        default: true,
      },
    ],
  },
  {
    id: 'terminal',
    label: 'Terminal & Images',
    fields: [
      {
        key: 'terminal.showImages',
        type: 'boolean',
        label: 'Show Terminal Images',
        description: 'Render inline images in terminal output when the terminal supports it',
        default: true,
      },
      {
        key: 'terminal.imageWidthCells',
        type: 'number',
        label: 'Image Width (cells)',
        description: 'Preferred image width in terminal cells',
        default: 60,
        min: 10,
        max: 300,
        step: 1,
      },
      {
        key: 'images.autoResize',
        type: 'boolean',
        label: 'Auto-Resize Images',
        description: 'Scale images down to 2000×2000 before sending to the LLM',
        default: true,
      },
      {
        key: 'images.blockImages',
        type: 'boolean',
        label: 'Block All Images',
        description: 'Prevent images from being sent to the LLM entirely',
        default: false,
      },
    ],
  },
  {
    id: 'shell',
    label: 'Shell',
    fields: [
      {
        key: 'shellPath',
        type: 'string',
        label: 'Shell Path',
        description: 'Custom shell binary path — leave blank to use the system default',
        placeholder: '/bin/zsh',
        default: '',
      },
      {
        key: 'shellCommandPrefix',
        type: 'string',
        label: 'Command Prefix',
        description: 'Prefix prepended to every bash command Pi executes',
        placeholder: 'shopt -s expand_aliases',
        default: '',
      },
    ],
  },
  {
    id: 'sessions',
    label: 'Sessions & Model Cycling',
    fields: [
      {
        key: 'sessionDir',
        type: 'string',
        label: 'Session Directory',
        description:
          'Directory where Pi session files are stored — accepts ~, absolute, or relative paths',
        placeholder: '~/.pi/agent/sessions',
        default: '',
      },
      {
        key: 'enabledModels',
        type: 'string-array',
        label: 'Model Cycling Patterns',
        description: 'Glob patterns for Ctrl+P model cycling, e.g. claude-*, gpt-4o',
        placeholder: 'claude-*',
      },
    ],
  },
  {
    id: 'resources',
    label: 'Resources',
    fields: [
      {
        key: 'packages',
        type: 'string-array',
        label: 'Pi Packages',
        description:
          'Pi package sources loaded by the SDK. MCP support appears only when supplied by an installed Pi package or extension; it is not a built-in OpenPi/Pi core feature.',
        placeholder: 'npm:@scope/pi-package',
      },
      {
        key: 'extensions',
        type: 'string-array',
        label: 'Extension Paths',
        description:
          'Additional Pi extension entrypoints. Extensions execute with full Node permissions and are governed by workspace trust.',
        placeholder: './.pi/extensions/my-extension.ts',
      },
      {
        key: 'enableSkillCommands',
        type: 'boolean',
        label: 'Skill Slash Commands',
        description: 'Register discovered skills as /skill:name commands',
        default: true,
      },
    ],
  },
]

interface SettingsPaneProps {
  hasCwd: boolean
  onError: (message: string) => void
}

export function SettingsPane(props: SettingsPaneProps) {
  const [scope, setScope] = createSignal<'global' | 'project'>('global')
  const [result, setResult] = createSignal<SettingsResult | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [savedKey, setSavedKey] = createSignal<string | null>(null)
  const [local, setLocal] = createSignal<PiSettings>({})
  let savedTimer: ReturnType<typeof setTimeout> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const load = async () => {
    setLoading(true)
    try {
      const r = await window.openpi.getSettings()
      setResult(r)
      setLocal(scope() === 'global' ? { ...r.global } : { ...r.project })
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    scope()
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    onCleanup(() => window.clearTimeout(timer))
  })

  onCleanup(() => {
    if (saveTimer) clearTimeout(saveTimer)
    if (savedTimer) clearTimeout(savedTimer)
  })

  const scheduleSave = (key: string, next: PiSettings) => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      try {
        await window.openpi.saveSettings(scope(), next)
        setSavedKey(key)
        if (savedTimer) clearTimeout(savedTimer)
        savedTimer = setTimeout(() => setSavedKey(null), 1800)
        const r = await window.openpi.getSettings()
        setResult(r)
      } catch (err) {
        props.onError(err instanceof Error ? err.message : String(err))
      }
    }, 400)
  }

  const setValue = (key: string, value: unknown) => {
    setLocal((prev) => {
      const next = setNestedValue(prev, key, value)
      scheduleSave(key, next)
      return next
    })
  }

  const clearValue = (key: string) => {
    setLocal((prev) => {
      const next = deleteNestedValue(prev, key)
      scheduleSave(key, next)
      return next
    })
  }

  const effective = () => result()?.effective ?? {}

  const resolve = (field: SettingField): { value: unknown; isExplicit: boolean } => {
    const explicit = hasNestedKey(local(), field.key)
    if (scope() === 'global') {
      return {
        value: explicit ? getNestedValue(local(), field.key) : field.default,
        isExplicit: explicit,
      }
    }
    const effVal = getNestedValue(effective() as PiSettings, field.key)
    return {
      value: explicit
        ? getNestedValue(local(), field.key)
        : effVal !== undefined
          ? effVal
          : field.default,
      isExplicit: explicit,
    }
  }

  const pathLabel = () =>
    scope() === 'global'
      ? (result()?.globalPath ?? '~/.pi/agent/settings.json')
      : (result()?.projectPath ?? '.pi/settings.json')

  return (
    <div class="osp-root">
      <div class="osp-topbar">
        <div class="osp-scope-row">
          <div class="osp-scope-tabs">
            <button
              type="button"
              class={`osp-scope-btn${scope() === 'global' ? ' is-active' : ''}`}
              onClick={() => setScope('global')}
            >
              <Globe size={11} />
              Global
            </button>
            <button
              type="button"
              class={`osp-scope-btn${scope() === 'project' ? ' is-active' : ''}`}
              onClick={() => setScope('project')}
              disabled={!props.hasCwd}
              title={!props.hasCwd ? 'Open a workspace to access project settings' : undefined}
            >
              <FolderOpen size={11} />
              Project
            </button>
          </div>
          <span class="osp-path">{pathLabel()}</span>
        </div>
      </div>

      <Show when={!loading() || result()} fallback={<div class="osp-loading">Loading…</div>}>
        <div class="osp-scroll">
          <Show
            when={scope() !== 'project' || props.hasCwd}
            fallback={
              <div class="osp-empty">
                Open a workspace to view and edit project-level Pi settings.
              </div>
            }
          >
            <For each={SECTIONS}>
              {(section) => (
                <section class="osp-section">
                  <div class="osp-section-head">{section.label}</div>
                  <For each={section.fields}>
                    {(field, i) => {
                      const resolved = () => resolve(field)
                      return (
                        <SettingRow
                          field={field}
                          value={resolved().value}
                          isExplicit={resolved().isExplicit}
                          scope={scope()}
                          isLast={i() === section.fields.length - 1}
                          savedKey={savedKey()}
                          onChange={(v) => setValue(field.key, v)}
                          onReset={() => clearValue(field.key)}
                        />
                      )
                    }}
                  </For>
                </section>
              )}
            </For>
          </Show>
        </div>
      </Show>

      <div class="osp-footer">
        <code>{pathLabel()}</code> — edit directly for advanced options not listed above.
      </div>
    </div>
  )
}

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

function SettingRow(props: RowProps) {
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
        <FieldControl field={props.field} value={props.value} onChange={props.onChange} />{' '}
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
    const on =
      typeof props.value === 'boolean'
        ? props.value
        : ((props.field.default as boolean | undefined) ?? false)
    return (
      <button
        type="button"
        class={`osp-toggle${on ? ' is-on' : ''}`}
        onClick={() => props.onChange(!on)}
        role="switch"
        aria-checked={on}
        aria-label={props.field.label}
      >
        <span class="osp-toggle-thumb" />
      </button>
    )
  }

  if (props.field.type === 'select') {
    const val =
      props.value !== undefined && props.value !== null && props.value !== ''
        ? String(props.value)
        : ''
    return (
      <select
        class="osp-select"
        value={val}
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
    const num =
      props.value !== undefined && props.value !== null
        ? Number(props.value)
        : ((props.field.default as number | undefined) ?? 0)
    return (
      <input
        class="osp-input osp-input-num"
        type="number"
        value={num}
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
    const str =
      props.value !== undefined && props.value !== null && props.value !== ''
        ? String(props.value)
        : ''
    return (
      <input
        class="osp-input"
        type="text"
        value={str}
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
