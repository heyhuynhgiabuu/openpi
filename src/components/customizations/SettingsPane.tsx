import { FolderOpen, Globe } from 'lucide-solid'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import type { PiSettings, SettingsResult } from '../../lib/ipc'
import { SettingRow } from './SettingRow'
import {
  deleteNestedValue,
  getNestedValue,
  hasNestedKey,
  type SettingField,
  setNestedValue,
} from './settingsHelpers'
import type { SettingsPaneProps } from './settingsSections'
import { SECTIONS } from './settingsSections'

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
