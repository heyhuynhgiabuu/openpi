import { Check, ExternalLink, RotateCcw } from 'lucide-solid'
import { For, Show } from 'solid-js'
import type { PiUpdateCheckResult } from '../../lib/ipc'
import { UPDATE_PREFERENCES } from '../../lib/updatePreferences'

interface UpdateSectionProps {
  updatePrefs: Record<string, boolean>
  savedKey: string | null
  updateStatus: PiUpdateCheckResult | null
  checkingUpdates: boolean
  installingUpdate: boolean
  installOutput: string | null
  onToggle: (key: string, value: boolean) => void
  onReset: (key: string) => void
  onCheck: () => void
  onInstall: () => void
}

export function UpdateSection(props: UpdateSectionProps) {
  const openLatestReleaseNotes = () => {
    void window.openpi.openExternal('https://github.com/earendil-works/pi/releases/latest')
  }

  return (
    <section class="osp-section">
      <div class="osp-section-head">Updates</div>
      <For each={UPDATE_PREFERENCES}>
        {(field) => {
          const on = () =>
            (props.updatePrefs[field.key] as boolean | undefined) ?? field.defaultValue
          const isDefault = () => on() === field.defaultValue
          const justSaved = () => props.savedKey === field.key
          return (
            <div class="osp-row">
              <div class="osp-row-left">
                <div class="osp-row-name">
                  {field.label}
                  <Show when={justSaved()}>
                    <span class="osp-saved">
                      <Check size={10} /> saved
                    </span>
                  </Show>
                </div>
                <div class="osp-row-desc">{field.description}</div>
              </div>
              <div class="osp-row-right">
                <Show when={!isDefault()}>
                  <button
                    class="osp-reset-btn"
                    type="button"
                    onClick={() => props.onReset(field.key)}
                    title="Reset to default"
                  >
                    <RotateCcw size={11} />
                  </button>
                </Show>
                <button
                  class={`osp-toggle${on() ? ' is-on' : ''}`}
                  type="button"
                  onClick={() => props.onToggle(field.key, !on())}
                  role="switch"
                  aria-checked={on()}
                  aria-label={field.label}
                >
                  <span class="osp-toggle-thumb" />
                </button>
              </div>
            </div>
          )
        }}
      </For>

      <div class="osp-section-subhead">Installation</div>
      <div class="osp-row osp-row-last">
        <div class="osp-row-left">
          <div class="osp-row-name">Pi Update</div>
          <div class="osp-row-desc">Check for and install the latest Pi release</div>
          <Show when={props.updateStatus}>
            {(status) => (
              <div class="osp-update-info">
                <Show when={!status().error} fallback={<span>{status().error}</span>}>
                  <Show when={status().updateAvailable} fallback={<span>Pi is up to date</span>}>
                    <span>v{status().latestVersion ?? ''} available</span>
                  </Show>
                </Show>
              </div>
            )}
          </Show>
        </div>
        <div class="osp-row-right">
          <div class="osp-action-group">
            <button
              class="osp-action-btn"
              type="button"
              onClick={openLatestReleaseNotes}
              title="Open Pi release notes"
            >
              <ExternalLink size={12} /> Release notes
            </button>
            <Show when={props.updateStatus?.updateAvailable}>
              <button
                class="osp-action-btn osp-action-btn-primary"
                type="button"
                disabled={props.installingUpdate}
                onClick={props.onInstall}
              >
                {props.installingUpdate ? 'Installing…' : 'Install'}
              </button>
            </Show>
            <button
              class="osp-action-btn"
              type="button"
              disabled={props.checkingUpdates}
              onClick={props.onCheck}
            >
              {props.checkingUpdates ? 'Checking…' : 'Check now'}
            </button>
          </div>
        </div>
      </div>

      <Show when={props.installOutput}>
        <pre class="osp-update-output">{props.installOutput}</pre>
      </Show>
    </section>
  )
}
