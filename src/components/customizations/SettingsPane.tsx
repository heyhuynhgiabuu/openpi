import { Check, FolderOpen, Globe, RotateCcw } from 'lucide-solid'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import type { PiSettings, SettingsResult } from '../../lib/ipc'
import { SettingRow } from './SettingRow'
import {
  deleteNestedValue,
  getNestedValue,
  hasNestedKey,
  type SettingField,
  type SettingSection,
  setNestedValue,
} from './settingsHelpers'

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
