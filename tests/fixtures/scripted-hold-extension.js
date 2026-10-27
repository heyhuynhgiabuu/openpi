/**
 * Controllable "held" turns for the run-start / steer / follow-up / abort tests.
 *
 * Loaded by Pi's extension loader inside the real sidecar process, next to the
 * scripted provider (see tests/helpers/shippedSidecarBuild.ts, `holdExtension`).
 * It never touches the network. It registers three things that share one module
 * state, so a test can park a run at a known point and open it deliberately:
 *
 * - provider `scripted-hold` (model `hold`). Its answer depends on the newest
 *   user message in the transcript:
 *     HOLD_STREAM_PROMPT  opens the stream, then parks until released or aborted
 *     HOLD_TOOL_PROMPT    asks for the `hold` tool; once that tool has returned,
 *                         the call after it answers like every other message
 *     anything else       answers `HOLD_ANSWER_PREFIX` + that user text, so each
 *                         answer shows which messages that model call saw
 *   Like a real provider, it ends an aborted call with stopReason `aborted`.
 * - tool `hold`: parks until released; a tool abort makes it throw.
 * - a `before_agent_start` handler: for HOLD_START_PROMPT and
 *   HOLD_START_SEND_PROMPT it announces the park through `ctx.ui.notify` (which
 *   the sidecar forwards as a custom message, so a test can await it), then
 *   parks until released. The send variant also calls `pi.sendMessage`.
 *
 * Parking uses named gates (`start`, `stream`, `tool`). The `/release <gate>`
 * extension command releases the hold already registered there. The test waits
 * for the start notification, provider message-start, or tool-start event before
 * releasing, so that hold is registered before the command reaches the
 * extension. Pi runs extension commands immediately, even mid-run, so a test
 * releases through the real `prompt` sidecar command. Abort ends `stream` and `tool` holds, not
 * `start`: Pi gives `before_agent_start` handlers no signal, and an abort
 * requested then takes effect once the run starts.
 *
 * Constants are exported so tests and this extension cannot drift apart.
 */
import { createAssistantMessageEventStream, getCurrentTools, Type } from '@earendil-works/pi-ai'
import { z } from 'zod'

export const HOLD_PROVIDER = 'scripted-hold'
export const HOLD_MODEL = 'hold'
export const RELEASE_COMMAND = 'release'
export const HOLD_TOOL_NAME = 'hold'

export const HOLD_STREAM_PROMPT = 'Hold the model stream open.'
export const HOLD_TOOL_PROMPT = 'Run the held tool.'
export const HOLD_START_PROMPT = 'Hold the run start.'
export const HOLD_START_SEND_PROMPT = 'Hold the run start and send a message.'
export const HOLD_PLAIN_PROMPT = 'Answer right away.'

export const HOLD_ANSWER_PREFIX = 'scripted answered: '
const HOLD_STREAM_DONE_TEXT = 'scripted stream released'
const HOLD_TOOL_RESULT_TEXT = 'hold released'
export const HOLD_NOTIFY_PREFIX = 'run start parked, ctx.isIdle() = '
export const HOLD_NOTE_TEXT = 'sent during run start'
const HOLD_NOTE_TYPE = 'scripted-hold-note'

const GATES = ['start', 'stream', 'tool']
const gates = new Map()

function gateOf(name) {
  let gate = gates.get(name)
  if (!gate) {
    gate = { waiting: [] }
    gates.set(name, gate)
  }
  return gate
}

/**
 * Parks until gate `name` is released ('released') or `signal` aborts
 * ('aborted'). The caller registers the hold before announcing it, so a release
 * that follows the announcement finds it.
 */
function holdAt(name, signal) {
  const gate = gateOf(name)
  if (signal?.aborted) return Promise.resolve('aborted')
  return new Promise((resolve) => {
    const onAbort = () => {
      gate.waiting = gate.waiting.filter((entry) => entry !== onRelease)
      resolve('aborted')
    }
    const onRelease = () => {
      signal?.removeEventListener('abort', onAbort)
      resolve('released')
    }
    gate.waiting.push(onRelease)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Releases the hold parked at gate `name`. */
function releaseGate(name) {
  const release = gateOf(name).waiting.shift()
  if (!release) throw new Error(`no hold is parked at '${name}'`)
  release()
}

const messageContentSchema = z.union([
  z.string(),
  z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
])

function textOf(message) {
  const parsed = z.object({ content: messageContentSchema }).safeParse(message)
  if (!parsed.success) return ''
  const text = z.string().safeParse(parsed.data.content)
  if (text.success) return text.data
  const parts = z
    .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
    .parse(parsed.data.content)
  return parts.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('')
}

function newestUserText(messages) {
  return textOf(messages.findLast((message) => message.role === 'user') ?? { content: '' })
}

/** The newest user message that selects a scenario; steer and follow-up text never does. */
function scenarioOf(messages) {
  const text = newestUserText(messages)
  return text === HOLD_STREAM_PROMPT || text === HOLD_TOOL_PROMPT ? text : ''
}

/** True once the hold tool returned to the run the newest user message started or joined. */
function holdToolReturned(messages) {
  const lastUser = messages.findLastIndex((message) => message.role === 'user')
  return messages
    .slice(lastUser + 1)
    .some((message) => message.role === 'toolResult' && message.toolName === HOLD_TOOL_NAME)
}

function newAssistantOutput(model) {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'pending',
    timestamp: Date.now(),
  }
}

function pushText(stream, output, text) {
  output.content.push({ type: 'text', text })
  stream.push({ type: 'text_start', contentIndex: 0, partial: output })
  stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: output })
  stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: output })
  output.stopReason = 'stop'
}

function pushToolCall(stream, output, toolCall) {
  output.content.push(toolCall)
  stream.push({ type: 'toolcall_start', contentIndex: 0, partial: output })
  stream.push({
    type: 'toolcall_delta',
    contentIndex: 0,
    delta: JSON.stringify(toolCall.arguments),
    partial: output,
  })
  stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: output })
  output.stopReason = 'toolUse'
}

function finish(stream, output) {
  if (output.stopReason === 'aborted') {
    output.content = []
    stream.push({ type: 'error', reason: 'aborted', error: output })
  } else {
    stream.push({ type: 'done', reason: output.stopReason, message: output })
  }
  stream.end()
}

function answerStream(model, context, options) {
  const stream = createAssistantMessageEventStream()
  const output = newAssistantOutput(model)
  const scenario = scenarioOf(context.messages)
  stream.push({ type: 'start', partial: output })

  if (scenario === HOLD_STREAM_PROMPT) {
    // Register the hold before the stream is observable, then park the call.
    const parked = holdAt('stream', options?.signal)
    void parked.then((outcome) => {
      if (outcome === 'released') pushText(stream, output, HOLD_STREAM_DONE_TEXT)
      else output.stopReason = 'aborted'
      finish(stream, output)
    })
    return stream
  }
  if (options?.signal?.aborted) {
    output.stopReason = 'aborted'
  } else if (scenario === HOLD_TOOL_PROMPT && !holdToolReturned(context.messages)) {
    if (getCurrentTools(context.messages).some((tool) => tool.name === HOLD_TOOL_NAME)) {
      pushToolCall(stream, output, {
        type: 'toolCall',
        id: 'scripted-hold-call-1',
        name: HOLD_TOOL_NAME,
        arguments: {},
      })
    } else {
      pushText(stream, output, 'scripted hold provider: hold tool not active')
    }
  } else {
    pushText(stream, output, `${HOLD_ANSWER_PREFIX}${newestUserText(context.messages)}`)
  }
  finish(stream, output)
  return stream
}

export default function (pi) {
  pi.registerProvider(HOLD_PROVIDER, {
    name: 'Scripted Hold',
    baseUrl: 'https://scripted-hold.invalid/v1',
    apiKey: 'scripted-key',
    api: 'openai-completions',
    models: [
      {
        id: HOLD_MODEL,
        name: 'Scripted Hold',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
    streamSimple: answerStream,
  })

  pi.registerTool({
    name: HOLD_TOOL_NAME,
    label: 'Hold',
    description: 'Test tool that waits until the test releases it.',
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      const outcome = await holdAt('tool', signal)
      if (outcome === 'aborted') throw new Error('hold tool aborted')
      return { content: [{ type: 'text', text: HOLD_TOOL_RESULT_TEXT }], details: undefined }
    },
  })

  pi.registerCommand(RELEASE_COMMAND, {
    description: 'Test only: open a hold gate (start, stream or tool).',
    handler: async (args) => {
      const name = args.trim()
      if (!GATES.includes(name)) throw new Error(`unknown hold gate '${name}'`)
      releaseGate(name)
    },
  })

  pi.on('before_agent_start', async (event, ctx) => {
    if (event.messageType !== 'user') return
    if (event.prompt !== HOLD_START_PROMPT && event.prompt !== HOLD_START_SEND_PROMPT) return
    const parked = holdAt('start')
    ctx.ui.notify(`${HOLD_NOTIFY_PREFIX}${ctx.isIdle()}`, 'info')
    if (event.prompt === HOLD_START_SEND_PROMPT) {
      pi.sendMessage(
        { customType: HOLD_NOTE_TYPE, content: HOLD_NOTE_TEXT, display: true },
        { triggerTurn: true }
      )
    }
    await parked
  })
}
