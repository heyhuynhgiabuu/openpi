/**
 * highRiskConfirm — the mediated desktop confirmation for high-risk
 * mutations, with the remote registry hop.
 *
 * With remote enabled, the dialog and a paired device race on ONE promise
 * (first settle wins). With remote off this is the plain dialog: zero
 * behavior change on the default path.
 */
import { dialog, type BrowserWindow } from 'electron'
import { runGatedConfirm } from '../remote/gateBridge'
import type { OpenedGate } from '../remote/gates'

export interface ConfirmMutationOptions {
  title: string
  message: string
  detail: string
}

export interface HighRiskConfirmDeps {
  getMainWindow: () => BrowserWindow | null
  /** Registry hop; null when remote is off. */
  openBridgeGate: (input: { title: string; summary: string; ttlMs: number }) => OpenedGate | null
  settleBridgeGate: (gateId: string, approved: boolean) => boolean
}

/** Dialogs are indefinite; the remote hop expires well after a human answer. */
const BRIDGED_GATE_TTL_MS = 10 * 60_000

export function createHighRiskConfirm(
  deps: HighRiskConfirmDeps
): (options: ConfirmMutationOptions) => Promise<boolean> {
  return async (options) => {
    const desktopConfirm = showHighRiskDialog(deps.getMainWindow(), options)
    const gate = deps.openBridgeGate({
      title: options.title,
      summary: `${options.message}\n${options.detail}`.slice(0, 500),
      ttlMs: BRIDGED_GATE_TTL_MS,
    })
    if (!gate) return desktopConfirm
    const gateId = gate.gate.id
    return runGatedConfirm({
      gate,
      desktopConfirm,
      settleDesktop: (approved) => deps.settleBridgeGate(gateId, approved),
    })
  }
}

function showHighRiskDialog(
  window: BrowserWindow | null,
  options: ConfirmMutationOptions
): Promise<boolean> {
  if (!window) return Promise.resolve(false)
  return dialog
    .showMessageBox(window, {
      type: 'warning',
      title: options.title,
      message: options.message,
      detail: options.detail,
      buttons: ['Cancel', 'Approve'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    .then((result) => result.response === 1)
}
