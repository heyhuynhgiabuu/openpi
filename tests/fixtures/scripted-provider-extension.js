/**
 * Scripted model provider for the shipped-path test.
 *
 * Loaded by Pi's extension loader inside the real sidecar process via
 * project-extension discovery (<cwd>/.pi/extensions). Plain JavaScript works;
 * a TypeScript version with the same content also loads and registers fine —
 * an earlier "TS extensions silently fail" conclusion was a misdiagnosis of
 * an incomplete provider config: a provider registered without `apiKey` is
 * silently unusable (the model registry rejects it at selection time with no
 * diagnostic — still true, and a Pi-level behavior, not surfaced here). What
 * IS surfaced now: extension load failures, as extension_error events (see
 * sidecar.ts).
 *
 * The provider never touches the network: the first stream call emits a
 * deterministic `write` tool call, and the call after the tool result emits a
 * fixed final text. A prompt equal to SCRIPTED_CODEMODE_PROMPT instead gets one
 * codemode call whose script makes one nested `write`, then the same kind of
 * fixed final text. A prompt equal to SCRIPTED_TOOLS_PROMPT answers with the
 * names of the tools the provider was offered on that request, so a test can
 * read the active tool set directly. Constants are exported so the test and
 * this extension cannot drift apart.
 */
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
} from '@earendil-works/pi-ai'

export const SCRIPTED_FILE_PATH = 'hello.txt'
export const SCRIPTED_FILE_CONTENT = 'scripted hello\n'
export const SCRIPTED_FINAL_TEXT = 'scripted done'
export const SCRIPTED_PROMPT = 'Create hello.txt with the scripted content.'

// Codemode turn: the provider asks for the codemode tool with one script that
// makes one nested `write` call, then answers with a fixed final text.
export const SCRIPTED_CODEMODE_PROMPT = 'Write nested.txt through codemode.'
export const SCRIPTED_CODEMODE_FILE_PATH = 'nested.txt'
export const SCRIPTED_CODEMODE_FILE_CONTENT = 'nested via codemode\n'
export const SCRIPTED_CODEMODE_SCRIPT = `return await tools.write({ path: ${JSON.stringify(SCRIPTED_CODEMODE_FILE_PATH)}, content: ${JSON.stringify(SCRIPTED_CODEMODE_FILE_CONTENT)} })`
export const SCRIPTED_CODEMODE_FINAL_TEXT = 'scripted codemode done'

// Tools probe: always answers with the tools offered on this request.
export const SCRIPTED_TOOLS_PROMPT = 'List the tools you were offered.'
export const SCRIPTED_TOOLS_ANSWER_PREFIX = 'scripted provider offered tools: '

function scriptedStream(model, context) {
  const prompt = lastUserText(context.messages)
  if (prompt === SCRIPTED_CODEMODE_PROMPT) {
    return scriptedCodemodeStream(model, context)
  }
  if (prompt === SCRIPTED_TOOLS_PROMPT) {
    return scriptedToolsStream(model, context)
  }
  const stream = createAssistantMessageEventStream()
  // Pi 0.86 passes a normalized TranscriptContext to custom providers. Read
  // the prompt and tool patch stream through the public helpers rather than
  // relying on the removed Context.systemPrompt/tools fields.
  const systemPrompt = getCurrentSystemPrompt(context.messages)
  const tools = getCurrentTools(context.messages)
  const hasWriteTool = tools.some((tool) => tool.name === 'write')
  const output = newAssistantOutput(model)

  const afterToolResult = context.messages.some((message) => message.role === 'toolResult')
  stream.push({ type: 'start', partial: output })
  if (!systemPrompt.trim() || !hasWriteTool) {
    const diagnostic = 'scripted provider received an incomplete normalized transcript'
    output.content.push({ type: 'text', text: diagnostic })
    stream.push({ type: 'text_start', contentIndex: 0, partial: output })
    stream.push({ type: 'text_delta', contentIndex: 0, delta: diagnostic, partial: output })
    stream.push({ type: 'text_end', contentIndex: 0, content: diagnostic, partial: output })
    output.stopReason = 'stop'
  } else if (!afterToolResult) {
    const toolCall = {
      type: 'toolCall',
      id: 'scripted-call-1',
      name: 'write',
      arguments: { path: SCRIPTED_FILE_PATH, content: SCRIPTED_FILE_CONTENT },
    }
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
  } else {
    output.content.push({ type: 'text', text: SCRIPTED_FINAL_TEXT })
    stream.push({ type: 'text_start', contentIndex: 0, partial: output })
    stream.push({
      type: 'text_delta',
      contentIndex: 0,
      delta: SCRIPTED_FINAL_TEXT,
      partial: output,
    })
    stream.push({
      type: 'text_end',
      contentIndex: 0,
      content: SCRIPTED_FINAL_TEXT,
      partial: output,
    })
    output.stopReason = 'stop'
  }
  stream.push({ type: 'done', reason: output.stopReason, message: output })
  stream.end()
  return stream
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

/** Text of the most recent user message: the prompt that selects a scripted turn. */
function lastUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') return message.content
    return Array.isArray(message.content)
      ? message.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
      : ''
  }
  return ''
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

/**
 * Codemode turn: asks for the codemode tool once, with one script that makes
 * one nested write; after its result, answers with a fixed final text. Without
 * an active codemode tool it answers with a diagnostic that lists the tools it
 * was offered, so a missing activation is visible in the transcript.
 */
function scriptedCodemodeStream(model, context) {
  const stream = createAssistantMessageEventStream()
  const tools = getCurrentTools(context.messages)
  const output = newAssistantOutput(model)
  const codemodeAnswered = context.messages.some(
    (message) => message.role === 'toolResult' && message.toolName === 'codemode'
  )
  stream.push({ type: 'start', partial: output })
  if (!tools.some((tool) => tool.name === 'codemode')) {
    const names = tools.map((tool) => tool.name).join(', ')
    pushText(stream, output, `scripted provider: codemode tool not active (tools: ${names})`)
  } else if (!codemodeAnswered) {
    pushToolCall(stream, output, {
      type: 'toolCall',
      id: 'scripted-codemode-1',
      name: 'codemode',
      arguments: { code: SCRIPTED_CODEMODE_SCRIPT },
    })
  } else {
    pushText(stream, output, SCRIPTED_CODEMODE_FINAL_TEXT)
  }
  stream.push({ type: 'done', reason: output.stopReason, message: output })
  stream.end()
  return stream
}

/** Tools probe turn: reports the tool names the provider was offered, comma separated. */
function scriptedToolsStream(model, context) {
  const stream = createAssistantMessageEventStream()
  const output = newAssistantOutput(model)
  const names = getCurrentTools(context.messages).map((tool) => tool.name)
  stream.push({ type: 'start', partial: output })
  pushText(stream, output, `${SCRIPTED_TOOLS_ANSWER_PREFIX}${names.join(', ')}`)
  stream.push({ type: 'done', reason: output.stopReason, message: output })
  stream.end()
  return stream
}

export default function (pi) {
  pi.registerProvider('scripted', {
    name: 'Scripted',
    baseUrl: 'https://scripted.invalid/v1',
    apiKey: 'scripted-key',
    api: 'openai-completions',
    models: [
      {
        id: 'scripted-write',
        name: 'Scripted Write',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
    streamSimple: scriptedStream,
  })
}
