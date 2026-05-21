import { Check, Trash2 } from 'lucide-solid'
import type { CustomProviderInfo } from '../../lib/ipc'

interface CustomProviderRowProps {
  provider: CustomProviderInfo
  onRemove: () => void
}

export function CustomProviderRow(props: CustomProviderRowProps) {
  return (
    <div class="cp-provider-row cp-custom-row">
      <div class="cp-provider-header">
        <div class="cp-provider-info">
          <span class="cp-provider-name">{props.provider.name}</span>
          <span class="cp-provider-desc">
            {props.provider.baseUrl} · {props.provider.modelCount}m
          </span>
        </div>
        <div class="cp-provider-actions">
          <div class="cp-connected-badge">
            <Check size={11} strokeWidth={2.5} />
            <span>Custom</span>
          </div>
          <button
            type="button"
            class="cp-disconnect-btn"
            onClick={props.onRemove}
            title="Remove provider"
          >
            <Trash2 size={12} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}
