import { AlertTriangle, Check, Copy, ExternalLink, Loader2, Trash2 } from 'lucide-solid'
import { createSignal, Show } from 'solid-js'
import type { ParsedEntry } from './packageHelpers'
import { DISPLAY_SCOPE, formatModifiedAt, shortenPath } from './packageHelpers'

interface PackageCardProps {
  entry: ParsedEntry
  removing: boolean
  onRemove: (entry: ParsedEntry) => void
}

export function PackageCard(props: PackageCardProps) {
  const [copied, setCopied] = createSignal(false)

  const copyInstall = () => {
    void navigator.clipboard.writeText(props.entry.parsed.installCmd).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  const openExternal = () => {
    if (props.entry.parsed.externalUrl)
      void window.openpi.openExternal(props.entry.parsed.externalUrl)
  }

  return (
    <article class="pkg-card">
      <div class="pkg-card-inner">
        <div class="pkg-card-body">
          <div class="pkg-card-nameline">
            <span class="pkg-card-name">{props.entry.parsed.displayName}</span>
            <Show
              when={
                props.entry.parsed.isPinned &&
                (props.entry.parsed.version ?? props.entry.parsed.ref)
              }
              fallback={<span class="pkg-float-chip">latest</span>}
            >
              <span class="pkg-pin-chip">
                {props.entry.parsed.version ?? props.entry.parsed.ref}
              </span>
            </Show>
            <span class="pkg-scope-chip">{DISPLAY_SCOPE[props.entry.item.scope]}</span>
            <span class={`resource-risk-chip risk-${props.entry.item.riskLevel ?? 'medium'}`}>
              {props.entry.item.riskLevel ?? 'medium'} risk
            </span>
            <Show when={!props.entry.item.enabled}>
              <span class="pkg-disabled-chip">disabled</span>
            </Show>
          </div>

          <Show when={props.entry.item.path}>
            <div class="pkg-card-path">{shortenPath(props.entry.item.path)}</div>
          </Show>
          <Show when={formatModifiedAt(props.entry.item.lastModifiedAt)}>
            {(modified) => <div class="resource-modified">Modified {modified()}</div>}
          </Show>

          <Show when={props.entry.item.warning}>
            <div class="pkg-card-warning">
              <AlertTriangle size={12} />
              <span>{props.entry.item.warning}</span>
            </div>
          </Show>
        </div>

        <div class="pkg-card-actions">
          <Show when={props.entry.parsed.externalUrl}>
            <button
              type="button"
              class="pkg-action-btn"
              onClick={openExternal}
              title="Open source"
              aria-label="Open package source"
              disabled={props.removing}
            >
              <ExternalLink size={13} />
            </button>
          </Show>
          <button
            type="button"
            class={`pkg-action-btn${copied() ? ' is-copied' : ''}`}
            onClick={copyInstall}
            title="Copy install command"
            aria-label="Copy install command"
            disabled={props.removing}
          >
            <Show when={copied()} fallback={<Copy size={13} />}>
              <Check size={13} />
            </Show>
          </button>
          <button
            type="button"
            class="pkg-action-btn pkg-action-danger"
            onClick={() => props.onRemove(props.entry)}
            title="Remove package"
            aria-label={`Remove ${props.entry.item.name}`}
            disabled={props.removing}
          >
            <Show when={props.removing} fallback={<Trash2 size={13} />}>
              <Loader2 size={13} class="spin" />
            </Show>
          </button>
        </div>
      </div>
    </article>
  )
}
