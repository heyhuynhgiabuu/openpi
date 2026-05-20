import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { assistantText, errorResult, summarizeRecord, textResult } from './helpers'
import type { AgentRunParams, RuntimeOptions } from './types'

export { assistantText }

import { SubagentManager } from './class'
import { AgentParams, GetResultParams, SteerParams } from './schemas'

let manager: SubagentManager | null = null

function getManager(options: RuntimeOptions): SubagentManager {
  manager ??= new SubagentManager(options)
  return manager
}

export function createOpenPiSubagentTools(options: RuntimeOptions): ToolDefinition[] {
  const runtime = getManager(options)
  return [
    {
      name: 'Agent',
      label: 'Agent',
      description:
        'Launch an OpenPi subagent using the Pi SDK. When the user mentions @agent_name (e.g. @explorer, @scout, @worker, @planner, @reviewer, or any .pi/agents/*.md name), delegate to this tool with subagent_type matching the name after @. Use run_in_background for parallel or long-running work; use get_subagent_result to collect results and steer_subagent to redirect running agents.',
      parameters: AgentParams,
      async execute(toolCallId, rawParams, _signal, _onUpdate, ctx) {
        try {
          const params = rawParams as AgentRunParams
          const record = runtime.spawn(params, ctx, toolCallId)
          if (params.run_in_background) {
            return textResult(
              `Agent ID: ${record.id}\nStatus: ${record.status}\nDescription: ${record.description}`,
              summarizeRecord(record)
            )
          }
          const completed = await record.done
          if (completed.status === 'failed') {
            return errorResult(
              `Subagent ${completed.id} failed: ${completed.error ?? 'unknown error'}`,
              summarizeRecord(completed)
            )
          }
          return textResult(
            completed.resultText || `Subagent ${completed.id} completed with no text output.`,
            summarizeRecord(completed)
          )
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err))
        }
      },
    },
    {
      name: 'get_subagent_result',
      label: 'Get Subagent Result',
      description: 'Retrieve the status or completed output of a background OpenPi subagent.',
      parameters: GetResultParams,
      async execute(_toolCallId, rawParams) {
        try {
          const params = rawParams as { agent_id: string; wait?: boolean; verbose?: boolean }
          const record = params.wait
            ? await runtime.wait(params.agent_id)
            : runtime.get(params.agent_id)
          if (!record) return errorResult(`Unknown subagent id: ${params.agent_id}`)
          const summary = summarizeRecord(record)
          const lines = [`Agent ID: ${record.id}`, `Status: ${record.status}`]
          if (record.error) lines.push(`Error: ${record.error}`)
          if (record.resultText) lines.push('', record.resultText)
          if (params.verbose) lines.push('', `Details: ${JSON.stringify(summary, null, 2)}`)
          return record.status === 'failed'
            ? errorResult(lines.join('\n'), summary)
            : textResult(lines.join('\n'), summary)
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err))
        }
      },
    },
    {
      name: 'steer_subagent',
      label: 'Steer Subagent',
      description: 'Send a steering message to a running OpenPi subagent.',
      parameters: SteerParams,
      async execute(_toolCallId, rawParams) {
        const params = rawParams as { agent_id: string; message: string }
        try {
          await runtime.steer(params.agent_id, params.message)
          return textResult(`Steered subagent ${params.agent_id}.`, { agent_id: params.agent_id })
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err), {
            agent_id: params.agent_id,
          })
        }
      },
    },
  ]
}
