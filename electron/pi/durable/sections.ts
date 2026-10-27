import { defineExtension, section } from '@earendil-works/pi-durable'
import type { Extension, PromptSection, ToolRegistration } from '@earendil-works/pi-durable'
import {
  discoverCustomizations,
  type CustomizationRoots,
  type DurableCustomizations,
} from './customizations'

/**
 * Phase 8.2a: customizations parity for the durable runtime.
 *
 * Skills and prompt templates reach the model as prompt sections, the same channel Pi's SDK path
 * fills from `DefaultResourceLoader`. Themes stay renderer-owned (presentation only).
 * Discovery happens once when the harness opens: sections must be cheap and side-effect free.
 */

/** Render the model-invocable skills as one section; `undefined` when there are none. */
export function skillsSection(skills: DurableCustomizations['skills']): PromptSection {
  return section('skills', () => {
    if (skills.length === 0) return undefined
    const body = skills
      .map((skill) => `## ${skill.name}\n${skill.description}\n\n${skill.body}`.trim())
      .join('\n\n')
    return `Load a skill when its description matches the task.\n\n${body}`
  })
}

/** Render the prompt templates as one section; `undefined` when there are none. */
export function promptsSection(prompts: DurableCustomizations['prompts']): PromptSection {
  return section('prompts', () => {
    if (prompts.length === 0) return undefined
    return prompts.map((prompt) => `### /${prompt.name}\n${prompt.body}`).join('\n\n')
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
export async function loadCustomizationsExtension(roots: CustomizationRoots): Promise<{
  extension: Extension<ToolRegistration>
  diagnostics: DurableCustomizations['diagnostics']
}> {
  const found = await discoverCustomizations(roots)
  return { extension: customizationsExtension(found), diagnostics: found.diagnostics }
}
