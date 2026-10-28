import type { DurableOpenResult, DurableSessionDeps, DurableStartOptions } from './durableTypes'
import { errorText } from './durablePrompt'

/** What `session_ready` reports about a freshly opened harness. */
export async function inspectOpened(
  deps: Pick<DurableSessionDeps, 'resolveModel' | 'log'>,
  opened: DurableOpenResult,
  options: DurableStartOptions
) {
  const { harness } = opened
  const agent = await harness.agentState()
  // A reopened session keeps the model it was using, which may not be today's default. A new
  // one was opened with its model, so there is nothing to look up.
  let { model, thinkingLevels } = opened
  if (
    options.resume &&
    agent.model &&
    (model?.provider !== agent.model.provider || model?.id !== agent.model.modelId)
  ) {
    const stored = await deps
      .resolveModel(agent.model.provider, agent.model.modelId)
      .catch((error) => {
        deps.log('warn', `[durable] looking up the stored model failed: ${errorText(error)}`)
        return undefined
      })
    if (stored) ({ info: model, thinkingLevels } = stored)
    else {
      deps.log(
        'warn',
        `[durable] stored model ${agent.model.provider}/${agent.model.modelId} is not available; ` +
          `reporting ${model?.provider}/${model?.id}, though the session still uses the stored one`
      )
    }
  }
  const sessionName = options.resume ? (await harness.stats()).sessionName : null
  return { agent, model, thinkingLevels, sessionName }
}
