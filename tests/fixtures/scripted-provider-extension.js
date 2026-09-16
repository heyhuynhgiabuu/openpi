/**
 * Scripted model provider for the shipped-path test.
 *
 * Loaded by Pi's extension loader inside the real sidecar process via
 * project-extension discovery (<cwd>/.pi/extensions). Plain JavaScript on
 * purpose: a TypeScript variant of this file silently failed to load in the
 * bundled sidecar, while identical .js extensions (with the same pi-ai import)
 * load and register fine — kept .js until that discrepancy is understood.
 *
 * The provider never touches the network: the first stream call emits a
 * deterministic `write` tool call, and the call after the tool result emits a
 * fixed final text. Constants are exported so the test and this extension
 * cannot drift apart.
 */
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'

export const SCRIPTED_FILE_PATH = 'hello.txt'
export const SCRIPTED_FILE_CONTENT = 'scripted hello\n'
export const SCRIPTED_FINAL_TEXT = 'scripted done'
export const SCRIPTED_PROMPT = 'Create hello.txt with the scripted content.'

function scriptedStream(model, context) {
  const stream = createAssistantMessageEventStream()
  const output = {
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

  const afterToolResult = (context.messages ?? []).some((message) => message.role === 'toolResult')
  stream.push({ type: 'start', partial: output })
  if (!afterToolResult) {
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
