import fs from 'node:fs'
import path from 'node:path'
import type { IpcMain } from 'electron'
import { z } from 'zod'
import type {
  ListDirectoryResult,
  PromptTemplate,
  SkillItem,
  SlashCommandItem,
} from '../../src/lib/ipc'
import {
  IPC,
  listDirectoryRequestSchema,
  promptTemplateSchema,
  readSkillFileRequestSchema,
  skillItemSchema,
  slashCommandItemSchema,
} from '../../src/lib/ipc'
import type { SidecarCommand, SidecarMessage } from '../pi/sidecar'

interface ResourcesIpcDeps {
  ipcMain: IpcMain
  activeWorkspacePath: () => string | null
  createRequestId: () => string
  requestSidecar: <T extends SidecarMessage>(
    message: SidecarCommand & { requestId: string }
  ) => Promise<T>
  isWorkspaceTrusted: (cwd: string) => boolean
  getCwd: () => string | null
}

export function registerResourcesIpc(deps: ResourcesIpcDeps): void {
  deps.ipcMain.handle(IPC.LIST_PROMPT_TEMPLATES, async (): Promise<PromptTemplate[]> => {
    const cwd = deps.activeWorkspacePath() ?? undefined
    const response = await deps.requestSidecar<
      Extract<SidecarMessage, { type: 'prompt_templates_result' }>
    >({
      type: 'list_prompt_templates',
      requestId: deps.createRequestId(),
      cwd,
      workspaceTrusted: cwd ? deps.isWorkspaceTrusted(cwd) : false,
    })
    return z
      .array(promptTemplateSchema)
      .parse(response.prompts)
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  deps.ipcMain.handle(IPC.LIST_SLASH_COMMANDS, async (): Promise<SlashCommandItem[]> => {
    const cwd = deps.activeWorkspacePath() ?? undefined
    const response = await deps.requestSidecar<
      Extract<SidecarMessage, { type: 'slash_commands_result' }>
    >({
      type: 'list_slash_commands',
      requestId: deps.createRequestId(),
      cwd,
      workspaceTrusted: cwd ? deps.isWorkspaceTrusted(cwd) : false,
    })
    return z.array(slashCommandItemSchema).parse(response.commands)
  })

  deps.ipcMain.handle(IPC.LIST_SKILLS, async (): Promise<SkillItem[]> => {
    const cwd = deps.activeWorkspacePath() ?? undefined
    const response = await deps.requestSidecar<Extract<SidecarMessage, { type: 'skills_result' }>>({
      type: 'list_skills',
      requestId: deps.createRequestId(),
      cwd,
      workspaceTrusted: cwd ? deps.isWorkspaceTrusted(cwd) : false,
    })
    return z
      .array(skillItemSchema)
      .parse(response.skills)
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  deps.ipcMain.handle(IPC.READ_SKILL_FILE, async (_event, raw: unknown): Promise<string | null> => {
    const { path: filePath } = readSkillFileRequestSchema.parse(raw)
    const cwd = deps.activeWorkspacePath() ?? undefined
    const response = await deps.requestSidecar<
      Extract<SidecarMessage, { type: 'skill_file_result' }>
    >({
      type: 'read_skill_file',
      requestId: deps.createRequestId(),
      path: filePath,
      cwd,
      workspaceTrusted: cwd ? deps.isWorkspaceTrusted(cwd) : false,
    })
    return response.content
  })

  deps.ipcMain.handle(IPC.LIST_DIRECTORY, (_event, raw: unknown): ListDirectoryResult => {
    const cwd = deps.getCwd()
    if (!cwd) return []
    const { path: relPath } = listDirectoryRequestSchema.parse(raw)
    const full = path.resolve(cwd, relPath)
    const sep = path.sep
    if (full !== cwd && !full.startsWith(cwd + sep)) return []
    try {
      return fs
        .readdirSync(full, { withFileTypes: true })
        .filter((entry) => entry.name.endsWith('.md') || entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          path: path.join(relPath, entry.name),
          isDirectory: entry.isDirectory(),
        }))
    } catch {
      return []
    }
  })
}
