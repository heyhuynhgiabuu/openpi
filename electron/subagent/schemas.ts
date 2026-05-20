import { Type } from 'typebox'

export const AgentParams = Type.Object({
  prompt: Type.String({ description: 'The task for the subagent to perform.' }),
  description: Type.Optional(Type.String({ description: 'Short description shown in UI.' })),
  subagent_type: Type.Optional(
    Type.String({
      description:
        'Agent type: worker, explorer, scout, planner, reviewer, or a .pi/agents/<name>.md file. When the user mentions @name in their prompt, set this to the name after @.',
    })
  ),
  model: Type.Optional(
    Type.String({
      description: 'Optional model override. Use provider/modelId or a unique fuzzy id/name match.',
    })
  ),
  thinking: Type.Optional(
    Type.Union([
      Type.Literal('off'),
      Type.Literal('minimal'),
      Type.Literal('low'),
      Type.Literal('medium'),
      Type.Literal('high'),
      Type.Literal('xhigh'),
    ])
  ),
  max_turns: Type.Optional(
    Type.Number({ description: 'Maximum turns before the subagent is aborted.' })
  ),
  run_in_background: Type.Optional(
    Type.Boolean({
      description: 'Return immediately with an agent id while the subagent continues.',
    })
  ),
  resume: Type.Optional(
    Type.String({ description: 'Resume a completed subagent by id with a new prompt.' })
  ),
})

export const GetResultParams = Type.Object({
  agent_id: Type.String({ description: 'Agent id returned by Agent.' }),
  wait: Type.Optional(Type.Boolean({ description: 'Wait for completion before returning.' })),
  verbose: Type.Optional(Type.Boolean({ description: 'Include detailed run metadata.' })),
})

export const SteerParams = Type.Object({
  agent_id: Type.String({ description: 'Running agent id to steer.' }),
  message: Type.String({
    description: 'Message to inject before the subagent next calls the model.',
  }),
})
