import { Check } from 'lucide-solid'
import { Show } from 'solid-js'

interface DiagnosticsSectionProps {
  diagnosticsOutput: string | null
  copyingDiagnostics: boolean
  savedKey: string | null
  onCopy: () => void
}

export function DiagnosticsSection(props: DiagnosticsSectionProps) {
  return (
    <section class="osp-section">
      <div class="osp-section-head">Beta support diagnostics</div>
      <div class="osp-row osp-row-last">
        <div class="osp-row-left">
          <div class="osp-row-name">
            Diagnostics export
            <Show when={props.savedKey === 'diagnostics'}>
              <span class="osp-saved">
                <Check size={10} /> copied
              </span>
            </Show>
          </div>
          <div class="osp-row-desc">
            Copy a redacted support bundle with app/runtime metadata, sidecar state, resource
            inventory, Git state, and SQLite file stats. Provider credentials are never read.
          </div>
          <Show when={props.diagnosticsOutput}>
            {(output) => <pre class="osp-update-output">{output()}</pre>}
          </Show>
        </div>
        <div class="osp-row-right osp-row-right-actions">
          <button
            class="osp-action-btn"
            type="button"
            disabled={props.copyingDiagnostics}
            onClick={props.onCopy}
          >
            {props.copyingDiagnostics ? 'Copying…' : 'Copy bundle'}
          </button>
        </div>
      </div>
    </section>
  )
}
