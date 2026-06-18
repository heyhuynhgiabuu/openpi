import { useExtensionUiDialog } from '../hooks/useExtensionUiDialog'
import { ExtensionUiDialog } from './ExtensionUiDialog'

/** Global overlay for Pi extension ctx.ui.confirm / select / input (RPC bridge). */
export function ExtensionUiOverlay() {
  const dialog = useExtensionUiDialog()

  return (
    <ExtensionUiDialog
      request={dialog.request()}
      onCancel={dialog.dismiss}
      onConfirm={(confirmed) => dialog.respond({ confirmed })}
      onSelect={(value) => dialog.respond(value ? { value } : { cancelled: true })}
      onInput={(value) => dialog.respond(value ? { value } : { cancelled: true })}
    />
  )
}
