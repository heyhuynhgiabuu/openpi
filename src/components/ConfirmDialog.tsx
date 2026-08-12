import { createEffect, Show } from 'solid-js'

type Props = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog(props: Props) {
  let dialog: HTMLDialogElement | undefined

  createEffect(() => {
    if (props.open && !dialog?.open) dialog?.showModal()
    if (!props.open && dialog?.open) dialog.close()
  })

  return (
    <Show when={props.open}>
      <dialog
        ref={dialog}
        class="confirm-dialog-backdrop"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onCancel={(event) => {
          event.preventDefault()
          props.onCancel()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onCancel()
        }}
        onKeyDown={() => undefined}
      >
        <div class="confirm-dialog">
          <div class="confirm-dialog-header">
            <span id="confirm-dialog-title" class="confirm-dialog-title">
              {props.title}
            </span>
          </div>
          <p class="confirm-dialog-body">{props.message}</p>
          <div class="confirm-dialog-footer">
            <button
              type="button"
              class="confirm-dialog-btn confirm-dialog-btn-ghost"
              onClick={props.onCancel}
            >
              {props.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              class="confirm-dialog-btn confirm-dialog-btn-danger"
              onClick={props.onConfirm}
            >
              {props.confirmLabel ?? 'Delete'}
            </button>
          </div>
        </div>
      </dialog>
    </Show>
  )
}
