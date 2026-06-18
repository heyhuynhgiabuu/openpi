import { For, Show } from 'solid-js'
import type { ExtensionUiRequest } from '../lib/extensionUiTypes'

type Props = {
  request: ExtensionUiRequest | null
  onConfirm: (confirmed: boolean) => void
  onSelect: (value: string | undefined) => void
  onInput: (value: string | undefined) => void
  onCancel: () => void
}

export function ExtensionUiDialog(props: Props) {
  return (
    <Show when={props.request}>
      {(req) => {
        const r = req()
        if (r.method === 'confirm') {
          return (
            <div class="extension-ui-overlay ask-overlay" role="presentation">
              <div class="ask-modal" role="alertdialog" aria-modal="true">
                <div class="ask-modal-header">
                  <span class="ask-modal-title">{r.title}</span>
                </div>
                <Show when={r.message}>{(msg) => <p class="ask-modal-body">{msg()}</p>}</Show>
                <div class="ask-modal-footer">
                  <button type="button" class="ask-btn ask-btn-ghost" onClick={props.onCancel}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="ask-btn ask-btn-primary"
                    onClick={() => props.onConfirm(false)}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    class="ask-btn ask-btn-primary"
                    onClick={() => props.onConfirm(true)}
                  >
                    Yes
                  </button>
                </div>
              </div>
            </div>
          )
        }

        if (r.method === 'select') {
          return (
            <div class="extension-ui-overlay ask-overlay" role="presentation">
              <div class="ask-modal" role="dialog" aria-modal="true">
                <div class="ask-modal-header">
                  <span class="ask-modal-title">{r.title}</span>
                </div>
                <div class="ask-options">
                  <For each={r.options}>
                    {(opt) => (
                      <button type="button" class="ask-option" onClick={() => props.onSelect(opt)}>
                        {opt}
                      </button>
                    )}
                  </For>
                </div>
                <div class="ask-modal-footer">
                  <button type="button" class="ask-btn ask-btn-ghost" onClick={props.onCancel}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )
        }

        if (r.method === 'input') {
          let fieldRef: HTMLInputElement | undefined
          return (
            <div class="extension-ui-overlay ask-overlay" role="presentation">
              <div class="ask-modal" role="dialog" aria-modal="true">
                <div class="ask-modal-header">
                  <span class="ask-modal-title">{r.title}</span>
                </div>
                <input
                  class="ask-input"
                  type="text"
                  placeholder={r.placeholder}
                  ref={(el) => {
                    fieldRef = el
                  }}
                />
                <div class="ask-modal-footer">
                  <button type="button" class="ask-btn ask-btn-ghost" onClick={props.onCancel}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="ask-btn ask-btn-primary"
                    onClick={() => {
                      const value = fieldRef?.value?.trim()
                      props.onInput(value || undefined)
                    }}
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          )
        }

        if (r.method === 'editor') {
          let fieldRef: HTMLTextAreaElement | undefined
          return (
            <div class="extension-ui-overlay ask-overlay" role="presentation">
              <div class="ask-modal" role="dialog" aria-modal="true">
                <div class="ask-modal-header">
                  <span class="ask-modal-title">{r.title}</span>
                </div>
                <textarea
                  class="ask-input ask-textarea"
                  rows={6}
                  value={r.prefill ?? ''}
                  ref={(el) => {
                    fieldRef = el
                  }}
                />
                <div class="ask-modal-footer">
                  <button type="button" class="ask-btn ask-btn-ghost" onClick={props.onCancel}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="ask-btn ask-btn-primary"
                    onClick={() => {
                      const value = fieldRef?.value?.trim()
                      props.onInput(value || undefined)
                    }}
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          )
        }

        return null
      }}
    </Show>
  )
}
