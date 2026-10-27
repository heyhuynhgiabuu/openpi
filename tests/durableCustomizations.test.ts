import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverCustomizations, stripFrontmatter } from '../electron/pi/durable/customizations'
import {
  loadCustomizationsExtension,
  promptsSection,
  skillsSection,
} from '../electron/pi/durable/sections'

/**
 * Phase 8.2a: discovery is delegated to Pi's own resource loader, so these tests assert Pi's
 * documented precedence rather than a private reimplementation (.pi + .agents, project over user,
 * disableModelInvocation kept out of the prompt).
 */

let root = ''
let agentDir = ''
let workspacePath = ''

async function writeSkill(base: string, name: string, extra = ''): Promise<void> {
  const dir = join(base, name)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description\n${extra}---\n\n${name} body\n`,
    'utf-8'
  )
}

async function writePrompt(base: string, name: string): Promise<void> {
  await mkdir(base, { recursive: true })
  await writeFile(
    join(base, `${name}.md`),
    `---\ndescription: ${name} prompt\n---\n\n${name} content\n`,
    'utf-8'
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openpi-custom-'))
  agentDir = join(root, 'agent')
  workspacePath = join(root, 'workspace')
  await mkdir(agentDir, { recursive: true })
  await mkdir(workspacePath, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('durable customizations discovery', () => {
  it('finds user skills and prompt templates', async () => {
    await writeSkill(join(agentDir, 'skills'), 'review')
    await writePrompt(join(agentDir, 'prompts'), 'audit')
    const found = await discoverCustomizations({ userAgentDir: agentDir, workspacePath })
    // Pi also merges machine-wide skill dirs, so assert on the names this test created.
    const review = found.skills.find((skill) => skill.name === 'review')
    const audit = found.prompts.find((prompt) => prompt.name === 'audit')
    expect(review?.body).toContain('review body')
    expect(audit?.body).toContain('audit content')
  })

  it('finds project skills under .pi/skills and .agents/skills', async () => {
    await writeSkill(join(workspacePath, '.pi', 'skills'), 'project-skill')
    await writeSkill(join(workspacePath, '.agents', 'skills'), 'agents-skill')
    const found = await discoverCustomizations({ userAgentDir: agentDir, workspacePath })
    const names = found.skills.map((skill) => skill.name)
    expect(names).toContain('project-skill')
    expect(names).toContain('agents-skill')
  })

  it('lets a project skill override a user skill with the same name', async () => {
    await writeSkill(join(agentDir, 'skills'), 'shared')
    await writeSkill(join(workspacePath, '.pi', 'skills'), 'shared')
    const found = await discoverCustomizations({ userAgentDir: agentDir, workspacePath })
    const shared = found.skills.filter((skill) => skill.name === 'shared')
    expect(shared).toHaveLength(1)
    expect(shared[0].filePath).toContain(join('.pi', 'skills'))
  })

  it('keeps slash-command-only skills out of the model-facing list', async () => {
    await writeSkill(join(agentDir, 'skills'), 'manual', 'disable-model-invocation: true\n')
    const found = await discoverCustomizations({ userAgentDir: agentDir, workspacePath })
    expect(found.skills.map((skill) => skill.name)).not.toContain('manual')
  })

  it('does not throw for a missing agent dir', async () => {
    const found = await discoverCustomizations({
      userAgentDir: join(root, 'missing'),
      workspacePath,
    })
    expect(found.skills.some((skill) => skill.name === 'review')).toBe(false)
    expect(found.prompts.some((prompt) => prompt.name === 'audit')).toBe(false)
  })
})

describe('stripFrontmatter', () => {
  it('strips a frontmatter block and normalizes CRLF', () => {
    expect(stripFrontmatter('---\r\nname: x\r\n---\r\n\r\nbody\r\n')).toBe('body')
  })

  it('leaves a body without frontmatter untouched', () => {
    expect(stripFrontmatter('just body')).toBe('just body')
  })
})

describe('durable customizations sections', () => {
  it('renders discovered skills and prompts into sections', async () => {
    await writeSkill(join(agentDir, 'skills'), 'review')
    await writePrompt(join(agentDir, 'prompts'), 'audit')
    const { extension } = await loadCustomizationsExtension({
      userAgentDir: agentDir,
      workspacePath,
    })
    const rendered: string[] = []
    for (const promptSection of extension.sections ?? []) {
      const text: string | undefined = await promptSection.render({} as never, {} as never)
      if (text !== undefined) rendered.push(text)
    }
    expect(rendered.join('\n')).toContain('review body')
    expect(rendered.join('\n')).toContain('audit content')
  })

  it('omits a section when it has nothing to render', async () => {
    expect(await skillsSection([]).render({} as never, {} as never)).toBeUndefined()
    expect(await promptsSection([]).render({} as never, {} as never)).toBeUndefined()
  })
})
