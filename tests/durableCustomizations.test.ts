import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { PromptInput } from '@earendil-works/pi-durable'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverCustomizations, stripFrontmatter } from '../electron/pi/durable/customizations'
import {
  expandInput,
  loadCustomizationsExtension,
  promptsSection,
  skillsSection,
} from '../electron/pi/durable/sections'

/**
 * Phase 8.2a: discovery is delegated to Pi's own resource loader, so these tests assert Pi's
 * documented precedence rather than a private reimplementation (.pi + .agents, project over user,
 * disableModelInvocation kept out of the prompt).
 */

/** Sections read none of this; the runtime supplies it, so tests pass the real contract. */
const PROMPT_INPUT: PromptInput = {
  conversationId: 1 as PromptInput['conversationId'],
  agent: {
    thinkingLevel: 'off',
    extensions: [],
    tools: [],
    callable: [],
    deferred: [],
    sections: [],
  },
  env: undefined,
  shown: {},
  read: {} as PromptInput['read'],
}
const BACKGROUND = BACKGROUND_CONTEXT

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

  it('keeps a slash-command-only skill, marked so the model is not offered it', async () => {
    await writeSkill(join(agentDir, 'skills'), 'manual', 'disable-model-invocation: true\n')
    const found = await discoverCustomizations({ userAgentDir: agentDir, workspacePath })
    // Kept for `/skill:manual`; `skillsSection` filters it out of the prompt.
    expect(found.skills.find((skill) => skill.name === 'manual')?.slashOnly).toBe(true)
    // ...and an ordinary skill stays model-invocable.
    await writeSkill(join(agentDir, 'skills'), 'plain')
    const again = await discoverCustomizations({ userAgentDir: agentDir, workspacePath })
    expect(again.skills.find((skill) => skill.name === 'plain')?.slashOnly).toBe(false)
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
    const { extension, found } = await loadCustomizationsExtension({
      userAgentDir: agentDir,
      workspacePath,
    })
    const rendered: string[] = []
    for (const promptSection of extension.sections ?? []) {
      const text: string | undefined = await promptSection.render(PROMPT_INPUT, BACKGROUND)
      if (text !== undefined) rendered.push(text)
    }
    const all = rendered.join('\n')
    // Skills are model-facing context; prompt templates are advertised by name only, because their
    // bodies carry $1/$ARGUMENTS placeholders that only resolve at invocation.
    expect(all).toContain('review body')
    expect(all).toContain('/audit')
    expect(all).not.toContain('audit content')
    expect(expandInput('/audit', found)).toContain('audit content')
  })

  it('substitutes template arguments at invocation time', async () => {
    await mkdir(join(agentDir, 'prompts'), { recursive: true })
    await writeFile(
      join(agentDir, 'prompts', 'audit.md'),
      'Review $1 and then $ARGUMENTS\n',
      'utf-8'
    )
    const { found } = await loadCustomizationsExtension({ userAgentDir: agentDir, workspacePath })
    expect(expandInput('/audit src/main.ts the rest', found)).toBe(
      'Review src/main.ts and then src/main.ts the rest'
    )
    expect(expandInput('/unknown free text', found)).toBe('/unknown free text')
  })

  it('omits a section when it has nothing to render', async () => {
    expect(await skillsSection([]).render(PROMPT_INPUT, BACKGROUND)).toBeUndefined()
    expect(await promptsSection([]).render(PROMPT_INPUT, BACKGROUND)).toBeUndefined()
  })
})
