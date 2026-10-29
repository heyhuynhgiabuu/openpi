import type { DurableCustomizations } from './customizations'

/**
 * What the slash picker offers on the durable runtime: the prompt templates its harness discovered,
 * plus the skills marked slash-only — those are deliberately kept out of the model-facing list, but
 * typing `/skill:name` must still work.
 */
export function slashCommandsOf(
  customizations: DurableCustomizations | undefined
): Array<{ name: string; description: string; argHint?: string }> {
  const prompts = (customizations?.prompts ?? []).map((prompt) => {
    const command: { name: string; description: string; argHint?: string } = {
      name: prompt.name,
      description: prompt.description,
    }
    if (prompt.argumentHint) command.argHint = prompt.argumentHint
    return command
  })
  const skills = (customizations?.skills ?? [])
    .filter((skill) => skill.slashOnly)
    .map((skill) => ({ name: `skill:${skill.name}`, description: skill.description }))
  return [...prompts, ...skills]
}
