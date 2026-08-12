import fs from 'node:fs'
import path from 'node:path'
import type { SidecarCommand, SidecarMessage } from './sidecarTypes'

type ResourceCommand = Extract<
  SidecarCommand,
  {
    type: 'list_prompt_templates' | 'list_slash_commands' | 'list_skills' | 'read_skill_file'
  }
>

interface ResourceLoaderShape {
  getPrompts(): {
    prompts: Array<{ name: string; description?: string; argumentHint?: string }>
  }
  getSkills(): {
    skills: Array<{
      name: string
      description: string
      baseDir: string
      filePath: string
      sourceInfo: { scope: string }
    }>
  }
}

interface ResourceSessionShape {
  extensionRunner: {
    getRegisteredCommands(): Array<{
      invocationName: string
      description?: string
    }>
  }
  promptTemplates: ReadonlyArray<{ name: string; description?: string; argumentHint?: string }>
}

interface ResourceCommandDeps {
  getCwd: () => string | null
  getSession: () => ResourceSessionShape | null
  getResourceLoader: (cwd: string, workspaceTrusted: boolean) => Promise<ResourceLoaderShape>
  send: (message: SidecarMessage) => void
}

export function isResourceCommand(command: SidecarCommand): command is ResourceCommand {
  return (
    command.type === 'list_prompt_templates' ||
    command.type === 'list_slash_commands' ||
    command.type === 'list_skills' ||
    command.type === 'read_skill_file'
  )
}

export async function handleResourceCommand(
  command: ResourceCommand,
  deps: ResourceCommandDeps
): Promise<void> {
  const cwd = command.cwd ?? deps.getCwd() ?? process.cwd()
  const workspaceTrusted = command.workspaceTrusted ?? false

  switch (command.type) {
    case 'list_prompt_templates': {
      const loader = await deps.getResourceLoader(cwd, workspaceTrusted)
      const prompts = loader.getPrompts().prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        argHint: prompt.argumentHint,
      }))
      deps.send({ type: 'prompt_templates_result', requestId: command.requestId, prompts })
      return
    }
    case 'list_slash_commands': {
      const session = deps.getSession()
      if (!session) {
        deps.send({ type: 'slash_commands_result', requestId: command.requestId, commands: [] })
        return
      }
      const commands: Array<{
        name: string
        description: string
        source: 'extension' | 'prompt'
        argHint?: string
      }> = session.extensionRunner.getRegisteredCommands().map((registered) => ({
        name: registered.invocationName,
        description: registered.description ?? '',
        source: 'extension',
      }))
      for (const template of session.promptTemplates) {
        commands.push({
          name: template.name,
          description: template.description ?? '',
          source: 'prompt' as const,
          ...(template.argumentHint ? { argHint: template.argumentHint } : {}),
        })
      }
      deps.send({ type: 'slash_commands_result', requestId: command.requestId, commands })
      return
    }
    case 'list_skills': {
      const loader = await deps.getResourceLoader(cwd, workspaceTrusted)
      const skills = loader.getSkills().skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        path: skill.baseDir,
        scope: skill.sourceInfo.scope === 'project' ? 'project' : 'user',
        tags: [],
      }))
      deps.send({ type: 'skills_result', requestId: command.requestId, skills })
      return
    }
    case 'read_skill_file': {
      const loader = await deps.getResourceLoader(cwd, workspaceTrusted)
      const requested = path.resolve(command.path)
      const skill = loader
        .getSkills()
        .skills.find((candidate) => path.resolve(candidate.filePath) === requested)
      let content: string | null = null
      if (skill) {
        try {
          content = fs.readFileSync(skill.filePath, 'utf-8')
        } catch {
          content = null
        }
      }
      deps.send({ type: 'skill_file_result', requestId: command.requestId, content })
    }
  }
}
