import { Dialog } from '@kobalte/core'
import { X } from 'lucide-solid'
import { marked } from 'marked'
import { createResource, Show, Suspense } from 'solid-js'

type ChangelogModalProps = {
  open: boolean
  onClose: () => void
}

export function ChangelogModal(props: ChangelogModalProps) {
  const [html] = createResource(
    () => props.open,
    async (isOpen) => {
      if (!isOpen) return null
      try {
        const raw = await window.openpi.getChangelog()
        if (!raw) return '<p>Changelog not available.</p>'
        return await marked.parse(raw)
      } catch {
        return '<p>Could not load changelog.</p>'
      }
    }
  )

  return (
    <Dialog.Root open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="changelog-modal-overlay" />
        <Dialog.Content class="changelog-modal">
          <div class="changelog-modal-header">
            <Dialog.Title class="changelog-modal-title">What's New</Dialog.Title>
            <Dialog.CloseButton class="changelog-modal-close" aria-label="Close">
              <X size={16} />
            </Dialog.CloseButton>
          </div>

          <div class="changelog-modal-body">
            <Suspense fallback={<div class="changelog-loading">Loading…</div>}>
              <Show when={html()} keyed>
                {(content) => (
                  // eslint-disable-next-line solid/no-innerhtml
                  <div class="changelog-content markdown-body" innerHTML={content} />
                )}
              </Show>
            </Suspense>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
