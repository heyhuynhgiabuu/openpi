import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import simpleGit from 'simple-git'

export interface TestRepo {
  /** Absolute path to the repository root. */
  cwd: string
  git: ReturnType<typeof simpleGit>
  /** Write a file (creating parent directories) and return its repo-relative path. */
  write(relativePath: string, contents: string): string
  /** Stage and commit everything, using a fixed test identity. */
  commit(message: string): Promise<void>
  /** Stage everything. */
  stage(): Promise<void>
  cleanup(): void
}

/** Create a temporary git repository with `main` checked out and one commit. */
export async function createTestRepo(initialFiles: Record<string, string> = {}): Promise<TestRepo> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-git-'))
  const git = simpleGit({ baseDir: cwd })
  await git.init()
  await git.addConfig('user.email', 'test@example.com')
  await git.addConfig('user.name', 'Test User')
  await git.addConfig('commit.gpgsign', 'false')
  await git.branch(['-M', 'main']).catch(() => undefined)

  const write = (relativePath: string, contents: string): string => {
    const full = path.join(cwd, relativePath)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents, 'utf-8')
    return relativePath
  }

  for (const [relativePath, contents] of Object.entries(initialFiles)) write(relativePath, contents)

  const stage = async () => {
    await git.add('.')
  }
  const commit = async (message: string) => {
    await git.commit(message)
  }

  if (Object.keys(initialFiles).length > 0) {
    await stage()
    await commit('initial')
  }

  return {
    cwd,
    git,
    write,
    commit,
    stage,
    cleanup: () => {
      // Windows can hold a handle briefly (indexer, AV), so retry the removal.
      if (fs.existsSync(cwd)) {
        fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      }
    },
  }
}
