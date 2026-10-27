/**
 * Shared harness for the shipped-path tests: bundles the real sidecar entry
 * like the electron-vite build, forks it as a child process, routes its IPC
 * messages to waiters, and owns the temp HOME and workspace.
 *
 * It is the composition point of three parts, split by responsibility:
 * - shippedSidecarBuild.ts      bundle + temp HOME/workspace + fixture layout
 * - shippedSidecarTransport.ts  fork, message log, waiters
 * - shippedSidecarCommands.ts   the sidecar commands tests issue
 *
 * Only the model boundary is scripted (see shippedSidecarBuild.ts). Existing
 * tests import `startSidecarHarness`, `SidecarHarness`, `SessionEvent` and
 * `SidecarHarnessOptions` from here; keep those exports.
 */
import {
  createSandbox,
  removeSandbox,
  type HarnessMcpConfig,
  type HarnessMcpServer,
  type SidecarHarnessOptions,
} from './shippedSidecarBuild'
import { createCommands, type SidecarCommands } from './shippedSidecarCommands'
import { startTransport, type SidecarError } from './shippedSidecarTransport'
import type { SessionEvent } from './shippedReplies'

export type {
  HarnessMcpConfig,
  HarnessMcpServer,
  SessionEvent,
  SidecarError,
  SidecarHarnessOptions,
}

export interface SidecarHarness extends SidecarCommands {
  /** The child's HOME: session files must land under it. */
  home: string
  workspace: string
  /** Every session_event received so far, in arrival order. */
  events: SessionEvent[]
  /** Every sidecar `error` message received so far (commands the sidecar rejected). */
  errors: SidecarError[]
  /** Stops the child and removes the temp HOME and workspace. */
  dispose(): Promise<void>
}

/**
 * Bundles and forks the sidecar, then returns a handle. Messages that arrive
 * before a waiter is registered never satisfy it: stale inbox entries must not
 * answer later requests.
 */
export async function startSidecarHarness(options: SidecarHarnessOptions): Promise<SidecarHarness> {
  const sandbox = await createSandbox(options)
  const transport = startTransport(sandbox.bundle, sandbox.home)
  const commands = createCommands(transport, {
    workspace: sandbox.workspace,
    workspaceTrusted: options.workspaceTrusted ?? true,
  })

  return {
    ...commands,
    home: sandbox.home,
    workspace: sandbox.workspace,
    events: transport.events,
    errors: transport.errors,

    async dispose() {
      await transport.stop()
      removeSandbox(sandbox)
    },
  }
}
