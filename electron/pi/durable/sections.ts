import { defineExtension, section } from '@earendil-works/pi-durable'
import type { Extension, PromptSection, ToolRegistration } from '@earendil-works/pi-durable'
import { expandPromptTemplateText } from '../../../src/lib/sessionPrompt'
import type { DurableCustomizations } from './customizations'

/**
 * Phase 8.2a: customizations parity for the durable runtime.
 *
 * A prompt template's *body* must not enter the model context: it carries `$1`/`$ARGUMENTS`
 * placeholders that only make sense at invocation time. The section therefore advertises the
 * catalog (name + description, like Pi's slash-command list), and `expandInput()` expands the
 * body with the user's arguments when they actually send `/name args`.
 * Themes stay renderer-owned (presentation only).
 */

/** Render the model-invocable skills as one section; `undefined` when there are none. */
export function skillsSection(skills: DurableCustomizations['skills']): PromptSection {
  return section('skills', () => {
    if (skills.length === 0) return undefined
    // The base directory matters: a skill may reference bundled files relative to it.
    const body = skills
      .map(
        (skill) =>
          `## ${skill.name}\n${skill.description}\nBase directory: ${skill.baseDir}\n\n${skill.body}`
      )
      .join('\n\n')
    return `Load a skill when its description matches the task.\n\n${body}`
  })
}

/** Advertise the prompt templates; bodies are expanded on invocation, never offered as context. */
export function promptsSection(prompts: DurableCustomizations['prompts']): PromptSection {
  return section('prompts', () => {
    if (prompts.length === 0) return undefined
    const lines = prompts.map((prompt) => {
      const hint = prompt.argumentHint ? ` ${prompt.argumentHint}` : ''
      const description = prompt.description ? ` — ${prompt.description}` : ''
      return `- /${prompt.name}${hint}${description}`
    })
    return `The user can invoke these prompt templates by name:\n\n${lines.join('\n')}`
  })
}

/** The customizations extension, built from already-discovered resources. */
export function customizationsExtension(found: DurableCustomizations): Extension<ToolRegistration> {
  return defineExtension({
    name: 'openpi.customizations',
    sections: [skillsSection(found.skills), promptsSection(found.prompts)],
  })
}

/** Discover, then build the extension. Kept together so callers cannot forget the await. */
export async function loadCustomizationsExtension(
  roots: Parameters<typeof import('./customizations').discoverCustomizations>[0]
): Promise<{ extension: Extension<ToolRegistration>; found: DurableCustomizations }> {
  const { discoverCustomizations } = await import('./customizations')
  const found = await discoverCustomizations(roots)
  return { extension: customizationsExtension(found), found }
}

/**
 * Expand a `/template args` input into its body with arguments substituted. Input that is not a
 * known template is returned unchanged.
 */
export function expandInput(text: string, found: DurableCustomizations): string {
  const templates = found.prompts.map((prompt) => ({ name: prompt.name, content: prompt.body }))
  return expandPromptTemplateText(text, templates).text
}
