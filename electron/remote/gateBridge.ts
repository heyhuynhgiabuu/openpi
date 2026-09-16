/**
 * remote/gateBridge — the registry hop for desktop confirmations.
 *
 * When remote is enabled, every mediated confirm becomes ONE pending promise
 * with two resolvers: the desktop dialog and a paired device. First settle
 * wins — a remote approval answers the bridge immediately (the physical
 * dialog's later click is inert), and a desktop click tombstones the gate so
 * remote answers get 409 already_resolved. When remote is off, the desktop
 * dialog runs alone: zero behavior change on the default path.
 */

import type { OpenedGate } from './gates'

export interface GatedConfirmInput {
  gate: OpenedGate
  /** The desktop dialog's promise (never rejected by design). */
  desktopConfirm: Promise<boolean>
  /** Settles the gate on behalf of the desktop; false when remote won first. */
  settleDesktop: (approved: boolean) => boolean
}

/**
 * Resolves to the winning approval. Remote expiry counts as denial — the
 * desktop dialog may still be answered afterwards, and its answer then
 * decides nothing remotely (the gate is already tombstoned).
 */
export async function runGatedConfirm(input: GatedConfirmInput): Promise<boolean> {
  const desktop = input.desktopConfirm.then((approved) => {
    input.settleDesktop(approved)
    return approved
  })
  const remote = input.gate
    .wait()
    .then((outcome) => ('expired' in outcome ? false : outcome.approved))
  return Promise.race([desktop, remote])
}
