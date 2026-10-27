/**
 * Scripted model provider for the shipped-path test: plain JavaScript loaded by
 * Pi's extension loader inside the real sidecar (project-extension discovery).
 * Never touches the network. Prompts select deterministic turns (write, nested
 * codemode write, MCP via codemode, deferred MCP via tool_search, tools probe),
 * each ending in a fixed final text. Constants are exported so the test and
 * this extension cannot drift apart. A provider without `apiKey` is silently
 * unusable (registry rejects it at selection, no diagnostic); extension load
 * failures ARE surfaced, as extension_error events.
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

// MCP turn: asks for the codemode tool with a script that calls the fixture MCP
// server's tool. Pi's MCP extension registers the tool as `mcp__<server>__<tool>`
// with the default `codemode` exposure, so a codemode script is the documented
// way to reach it (docs/mcp.md, "Control tool exposure"). Without an active
// codemode tool the diagnostic lists the offered tools, so the guard cases read
// the active set directly.
export const SCRIPTED_MCP_PROMPT = 'Call the fixture MCP echo tool through codemode.'
export const SCRIPTED_MCP_SERVER = 'fixture'
export const SCRIPTED_MCP_TOOL_NAME = `mcp__${SCRIPTED_MCP_SERVER}__echo`
export const SCRIPTED_MCP_TOOL_TEXT = 'hello from the shipped-path test'
export const SCRIPTED_MCP_SCRIPT = `return await tools.${SCRIPTED_MCP_TOOL_NAME}({ text: ${JSON.stringify(SCRIPTED_MCP_TOOL_TEXT)} })`
export const SCRIPTED_MCP_FINAL_TEXT = 'scripted mcp done'
export const SCRIPTED_SEARCH_PROMPT = 'Find the fixture echo tool with tool_search, then call it.'
export const SCRIPTED_SEARCH_QUERY = 'echo'

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
  if (prompt === SCRIPTED_MCP_PROMPT) {
    return scriptedMcpStream(model, context)
  }
  if (prompt === SCRIPTED_SEARCH_PROMPT) {
    return scriptedSearchStream(model, context)
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
    pushText(stream, output, 'scripted provider received an incomplete normalized transcript')
  } else if (!afterToolResult) {
    pushToolCall(stream, output, {
      type: 'toolCall',
      id: 'scripted-call-1',
      name: 'write',
      arguments: { path: SCRIPTED_FILE_PATH, content: SCRIPTED_FILE_CONTENT },
    })
  } else {
    pushText(stream, output, SCRIPTED_FINAL_TEXT)
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
    if (!Array.isArray(message.content)) return ''
    return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
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
  const delta = JSON.stringify(toolCall.arguments)
  stream.push({ type: 'toolcall_delta', contentIndex: 0, delta, partial: output })
  stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: output })
  output.stopReason = 'toolUse'
}

// Codemode turn: one codemode call writing a fixed file, then a fixed final text.
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

// MCP turn: codemode script calls the fixture MCP tool; fixed final text after.
function scriptedMcpStream(model, context) {
  const stream = createAssistantMessageEventStream()
  const tools = getCurrentTools(context.messages)
  const output = newAssistantOutput(model)
  const answered = context.messages.some(
    (message) => message.role === 'toolResult' && message.toolName === 'codemode'
  )
  stream.push({ type: 'start', partial: output })
  if (!tools.some((tool) => tool.name === 'codemode')) {
    const names = tools.map((tool) => tool.name).join(', ')
    pushText(stream, output, `scripted provider: codemode tool not active (tools: ${names})`)
  } else if (!answered) {
    pushToolCall(stream, output, {
      type: 'toolCall',
      id: 'scripted-mcp-1',
      name: 'codemode',
      arguments: { code: SCRIPTED_MCP_SCRIPT },
    })
  } else {
    pushText(stream, output, SCRIPTED_MCP_FINAL_TEXT)
  }
  stream.push({ type: 'done', reason: output.stopReason, message: output })
  stream.end()
  return stream
}

// Deferred turn: tool_search first, then the declared MCP tool directly, then report.
function scriptedSearchStream(model, context) {
  const stream = createAssistantMessageEventStream()
  const tools = getCurrentTools(context.messages)
  const output = newAssistantOutput(model)
  const searchResult = context.messages.findLast(
    (message) => message.role === 'toolResult' && message.toolName === 'tool_search'
  )
  if (!tools.some((tool) => tool.name === 'tool_search')) {
    const names = tools.map((tool) => tool.name).join(', ')
    pushText(stream, output, `scripted provider: tool_search not active (tools: ${names})`)
  } else if (!searchResult) {
    pushToolCall(stream, output, {
      type: 'toolCall',
      id: 'scripted-search-1',
      name: 'tool_search',
      arguments: { query: SCRIPTED_SEARCH_QUERY },
    })
  } else {
    const searched = toolResultText(searchResult)
    const declared = searched.includes(SCRIPTED_MCP_TOOL_NAME)
    const ranTool = context.messages.some(
      (message) => message.role === 'toolResult' && message.toolName === SCRIPTED_MCP_TOOL_NAME
    )
    if (declared && !ranTool) {
      pushToolCall(stream, output, {
        type: 'toolCall',
        id: 'scripted-search-2',
        name: SCRIPTED_MCP_TOOL_NAME,
        arguments: { text: SCRIPTED_MCP_TOOL_TEXT },
      })
    } else {
      const echoResult = context.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolName === SCRIPTED_MCP_TOOL_NAME
      )
      pushText(
        stream,
        output,
        `scripted search done; declared=${declared} result=${toolResultText(echoResult)}`
      )
    }
  }
  stream.push({ type: 'done', reason: output.stopReason, message: output })
  stream.end()
  return stream
}

/** Concatenated text of a toolResult message's content. */
function toolResultText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (part?.type === 'text' && part.text) || '').join('')
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
