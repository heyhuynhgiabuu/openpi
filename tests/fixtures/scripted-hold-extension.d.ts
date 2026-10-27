/**
 * Type surface for tests/fixtures/scripted-hold-extension.js.
 * The extension itself must stay plain JavaScript (see scripted-provider-extension.js).
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/** The three parking points: before_agent_start, the model stream, the `hold` tool. */
export type HoldGate = 'start' | 'stream' | 'tool'

export declare const HOLD_PROVIDER: string
export declare const HOLD_MODEL: string
export declare const RELEASE_COMMAND: string
export declare const HOLD_TOOL_NAME: string
export declare const HOLD_STREAM_PROMPT: string
export declare const HOLD_TOOL_PROMPT: string
export declare const HOLD_START_PROMPT: string
export declare const HOLD_START_SEND_PROMPT: string
export declare const HOLD_PLAIN_PROMPT: string
export declare const HOLD_ANSWER_PREFIX: string
export declare const HOLD_NOTIFY_PREFIX: string
export declare const HOLD_NOTE_TEXT: string

export default function (pi: ExtensionAPI): void
