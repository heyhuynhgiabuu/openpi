import { readFileSync } from 'node:fs'
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'
import type { ResourceDiagnostic } from '@earendil-works/pi-coding-agent'
import type { CustomizationDiagnostic } from '../../../src/lib/ipc'

/**
 * Customizations discovery for the durable runtime (Phase 8.2a).
 *
 * Discovery is delegated to Pi's own `DefaultResourceLoader`, exactly as the shipped sidecar path
 * does (`electron/services/customizations.ts`), so precedence is identical: project over user,
 * `.pi/*` plus `.agents/*`, the ancestor walk, package resources, and `disableModelInvocation`.
 * It does not depend on an `AgentSession`, only on the resource loader, which keeps this usable
 * under the durable Harness. Only bodies (which the SDK does not expose) are read here.
 */

/** One skill offered to the durable runtime. */
export interface DurableSkill {
  name: string
  description: string
  filePath: string
  body: string
}

/** One prompt template offered to the durable runtime. */
export interface DurablePromptTemplate {
  name: string
  description: string
  argumentHint: string
  filePath: string
  body: string
}

export interface DurableCustomizations {
  skills: DurableSkill[]
  prompts: DurablePromptTemplate[]
  diagnostics: CustomizationDiagnostic[]
}

export interface CustomizationRoots {
  /** Pi agent dir, e.g. `~/.pi/agent`. */
  userAgentDir: string
  /** Active workspace root; omit for user-scope discovery only. */
  workspacePath?: string | null
}

/** Strip a leading `---` frontmatter block; the sections render the body only. */
export function stripFrontmatter(source: string): string {
  const normalized = source.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---')) return normalized.trim()
  const end = normalized.indexOf('\n---', 3)
  if (end === -1) return normalized.trim()
  return normalized
    .slice(end + 4)
    .replace(/^\n/, '')
    .trim()
}

function readBody(filePath: string): string {
  try {
    return stripFrontmatter(readFileSync(filePath, 'utf-8'))
  } catch {
    return ''
  }
}

/** Pi's diagnostic kinds -> the IPC vocabulary (a collision is a warning, not a failure). */
function toDiagnostic(entry: ResourceDiagnostic): CustomizationDiagnostic {
  const diagnostic: CustomizationDiagnostic = {
    type: entry.type === 'error' ? 'error' : 'warning',
    message: entry.message,
  }
  if (entry.path) diagnostic.path = entry.path
  return diagnostic
}

/**
 * Discover skills and prompt templates through the SDK loader. Package resolution can fail when
 * `npm` is absent from PATH (GUI launch), which the shipped path already degrades to a warning.
 */
export async function discoverCustomizations(
  roots: CustomizationRoots
): Promise<DurableCustomizations> {
  const diagnostics: CustomizationDiagnostic[] = []
  if (!roots.workspacePath) {
    return { skills: [], prompts: [], diagnostics }
  }
  const settingsManager = SettingsManager.create(roots.workspacePath, roots.userAgentDir)
  const loader = new DefaultResourceLoader({
    cwd: roots.workspacePath,
    agentDir: roots.userAgentDir,
    settingsManager,
    noExtensions: true,
  })
  await loader.reload().catch((error: unknown) => {
    diagnostics.push({
      type: 'warning',
      message: `Package resource resolution failed (npm may not be in PATH): ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  })

  const skillInventory = loader.getSkills()
  diagnostics.push(...skillInventory.diagnostics.map(toDiagnostic))
  // `disableModelInvocation` skills are slash-command only; a prompt section would offer them.
  const skills = skillInventory.skills
    .filter((skill) => !skill.disableModelInvocation)
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
      body: readBody(skill.filePath),
    }))

  const promptInventory = loader.getPrompts()
  diagnostics.push(...promptInventory.diagnostics.map(toDiagnostic))
  // The SDK already carries the rendered content; regex/binary-extension prompts need no read.
  const prompts = promptInventory.prompts.map((prompt) => ({
    name: prompt.name,
    description: prompt.description ?? '',
    argumentHint: prompt.argumentHint ?? '',
    filePath: prompt.filePath,
    body: stripFrontmatter(prompt.content),
  }))

  return { skills, prompts, diagnostics }
}
