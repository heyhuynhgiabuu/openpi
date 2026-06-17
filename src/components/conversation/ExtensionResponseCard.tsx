import { Terminal } from 'lucide-solid'
import { type Component, Show } from 'solid-js'
import type { ExtensionResponseMessage } from '../../types/session'

interface ExtensionResponseCardProps {
  message: ExtensionResponseMessage
}

const levelBorder: Record<ExtensionResponseMessage['level'], string> = {
  info: 'var(--accent, #6366f1)',
  warn: '#d97706',
  error: '#dc2626',
}

/**
 * Renders the output of an extension slash command (e.g. /fff-health) as a
 * distinct response card in the conversation. Styled inline so this behavior
 * does not depend on broad global CSS changes.
 */
export const ExtensionResponseCard: Component<ExtensionResponseCardProps> = (props) => {
  return (
    <div style={{ margin: '8px 0' }}>
      <div
        style={{
          display: 'inline-flex',
          'align-items': 'center',
          gap: '6px',
          'font-size': '11px',
          color: 'var(--graphite)',
          'margin-bottom': '4px',
        }}
      >
        <Terminal size={12} strokeWidth={2} />
        <span
          style={{
            display: 'inline-flex',
            'align-items': 'center',
            gap: '6px',
          }}
        >
          Extension output
          <Show when={props.message.commandName}>
            <code
              style={{
                'font-family': 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
                'font-size': '11px',
                background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
                padding: '0 5px',
                'border-radius': '4px',
                color: 'var(--ink)',
              }}
            >
              /{props.message.commandName}
            </code>
          </Show>
        </span>
      </div>
      <pre
        style={{
          margin: '0',
          padding: '10px 12px',
          background: 'transparent',
          border: '1px solid var(--hairline)',
          'border-left': `3px solid ${levelBorder[props.message.level]}`,
          'border-radius': '6px',
          'font-family': 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
          'font-size': '12.5px',
          'line-height': '1.5',
          'white-space': 'pre-wrap',
          'overflow-wrap': 'anywhere',
          color: 'var(--ink)',
          'overflow-x': 'visible',
        }}
      >
        {props.message.text}
      </pre>
    </div>
  )
}
