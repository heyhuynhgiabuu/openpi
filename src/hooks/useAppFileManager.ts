import { batch, createSignal } from 'solid-js'
import type { FileLineComment, NewFileLineComment } from '../lib/fileLineComments'
import { formatFileLineCommentsPrompt } from '../lib/fileLineComments'
import type { GitChangedFile, GitFileDiff, SkillItem } from '../lib/ipc'
import { buildFileContextBlocks, buildSkillContextBlocks } from '../lib/promptContext'

interface UseAppFileManagerOptions {
  cwd: () => string
  input: () => string
  send: (prefix?: string) => void
}

export function useAppFileManager(options: UseAppFileManagerOptions) {
  const [attachedFiles, setAttachedFiles] = createSignal<string[]>([])
  const [lineComments, setLineComments] = createSignal<FileLineComment[]>([])
  const [loadedSkills, setLoadedSkills] = createSignal<SkillItem[]>([])
  const [hiddenModels, setHiddenModels] = createSignal<Set<string>>(new Set())
  const [openFiles, setOpenFiles] = createSignal<string[]>([])
  const [activeFileIdx, setActiveFileIdx] = createSignal(0)
  const [diffFiles, setDiffFiles] = createSignal<GitChangedFile[]>([])
  const [diffIndex, setDiffIndex] = createSignal(0)
  const [commitDiffHash, setCommitDiffHash] = createSignal<string | null>(null)
  const [filePanelOpen, setFilePanelOpen] = createSignal(false)
  const [fileSearchOpen, setFileSearchOpen] = createSignal(false)
  const [fileFindOpen, setFileFindOpen] = createSignal(false)
  const [activeDiff, setActiveDiff] = createSignal<GitFileDiff | null>(null)

  const openFile = (relPath: string) => {
    const files = openFiles()
    const existing = files.indexOf(relPath)
    if (existing >= 0) {
      setActiveFileIdx(existing)
    } else {
      const newFiles = [...files, relPath]
      setOpenFiles(newFiles)
      setActiveFileIdx(newFiles.length - 1)
    }
  }

  const closeFile = (idx: number) => {
    const newFiles = openFiles().filter((_, i) => i !== idx)
    setOpenFiles(newFiles)
    if (newFiles.length > 0) {
      setActiveFileIdx((prev) => Math.min(prev, newFiles.length - 1))
    }
  }

  const closeDeletedFilePreviews = (relPath: string, isDir: boolean) => {
    const prefix = `${relPath.replace(/\/+$/, '')}/`
    const newFiles = openFiles().filter(
      (file) => file !== relPath && !(isDir && file.startsWith(prefix))
    )
    if (newFiles.length === openFiles().length) return
    setOpenFiles(newFiles)
    if (newFiles.length > 0) {
      setActiveFileIdx((prev) => Math.min(prev, newFiles.length - 1))
    }
  }

  /**
   * Update any open previews when a file is renamed in the workspace.
   * The preview pane keys by path; without this, a renamed file shows
   * stale content (the old path no longer exists on disk) or fails to
   * refresh its title to the new name.
   */
  const renameFileInPreviews = (oldPath: string, newPath: string) => {
    if (oldPath === newPath) return
    const before = openFiles()
    const newFiles = before.map((f) => (f === oldPath ? newPath : f))
    if (newFiles.every((f, i) => f === before[i])) return
    setOpenFiles(newFiles)
  }

  const addAttachedFile = (relPath: string) => {
    setAttachedFiles((prev) => (prev.includes(relPath) ? prev : [...prev, relPath]))
  }

  const removeAttachedFile = (relPath: string) => {
    setAttachedFiles((prev) => prev.filter((p) => p !== relPath))
  }

  const addLineComment = (comment: NewFileLineComment) => {
    const id =
      globalThis.crypto?.randomUUID?.() ?? `${comment.path}:${comment.startLine}-${Date.now()}`
    setLineComments((prev) => [...prev, { ...comment, id }])
  }

  const removeLineComment = (id: string) => {
    setLineComments((prev) => prev.filter((comment) => comment.id !== id))
  }

  const addLoadedSkill = (skill: SkillItem) => {
    setLoadedSkills((prev) => (prev.some((s) => s.name === skill.name) ? prev : [...prev, skill]))
  }

  const removeLoadedSkill = (name: string) => {
    setLoadedSkills((prev) => prev.filter((s) => s.name !== name))
  }

  const handleSend = async () => {
    const hasContext =
      loadedSkills().length > 0 || attachedFiles().length > 0 || lineComments().length > 0
    if (!options.input().trim() && !hasContext) return

    let prefix = ''

    const skills = loadedSkills()
    if (skills.length > 0) {
      const skillReads = await Promise.all(
        skills.map((s) => window.openpi.readSkillFile(`${s.path}/SKILL.md`).catch(() => null))
      )
      const skillBlocks = buildSkillContextBlocks(skills, skillReads)
      if (skillBlocks.length > 0) {
        prefix = skillBlocks.join('\n\n')
      }
      setLoadedSkills([])
    }

    const files = attachedFiles()
    if (files.length > 0) {
      const reads = await Promise.all(files.map((p) => window.openpi.readFile(p).catch(() => null)))
      const filePrefix = buildFileContextBlocks(files, reads).join('\n\n')
      prefix = prefix ? `${prefix}\n\n${filePrefix}` : filePrefix
      setAttachedFiles([])
    }

    const comments = lineComments()
    if (comments.length > 0) {
      const commentsPrefix = formatFileLineCommentsPrompt(comments)
      prefix = prefix ? `${prefix}\n\n${commentsPrefix}` : commentsPrefix
      setLineComments([])
    }

    options.send(prefix || undefined)
  }

  const toggleHiddenModel = (key: string) => {
    setHiddenModels((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      void window.openpi.setPref('hidden_models', JSON.stringify([...next]))
      return next
    })
  }

  const openCommitDiff = (hash: string, path: string, allFiles: string[]) => {
    void window.openpi.git.getCommitDiff(hash, path).then((diff) => {
      if (!diff) return
      const filesArray: GitChangedFile[] = allFiles.map((filePath) => ({
        path: filePath,
        status: 'M' as const,
        staged: false,
        added: 0,
        removed: 0,
      }))
      const index = allFiles.indexOf(path)
      batch(() => {
        setCommitDiffHash(hash)
        setActiveDiff(diff)
        setDiffFiles(filesArray)
        setDiffIndex(Math.max(0, index))
      })
    })
  }

  const navigateDiff = async (index: number) => {
    setDiffIndex(index)
    const file = diffFiles()[index]
    if (!file) return
    const hash = commitDiffHash()
    const diff = hash
      ? await window.openpi.git.getCommitDiff(hash, file.path)
      : await window.openpi.git.getDiff(file.path)
    if (diff) setActiveDiff(diff)
  }

  const handleDiffOpen = (diff: GitFileDiff, files: GitChangedFile[], index: number) => {
    batch(() => {
      setActiveDiff(diff)
      setDiffFiles(files)
      setDiffIndex(index)
    })
  }

  return {
    // state
    attachedFiles,
    lineComments,
    loadedSkills,
    hiddenModels,
    openFiles,
    activeFileIdx,
    diffFiles,
    diffIndex,
    commitDiffHash,
    activeDiff,
    filePanelOpen,
    fileSearchOpen,
    fileFindOpen,
    // setters
    setAttachedFiles,
    setLineComments,
    setLoadedSkills,
    setHiddenModels,
    setOpenFiles,
    setActiveFileIdx,
    setDiffFiles,
    setDiffIndex,
    setCommitDiffHash,
    setActiveDiff,
    setFilePanelOpen,
    setFileSearchOpen,
    setFileFindOpen,
    // handlers
    openFile,
    closeFile,
    closeDeletedFilePreviews,
    renameFileInPreviews,
    addAttachedFile,
    removeAttachedFile,
    addLineComment,
    removeLineComment,
    addLoadedSkill,
    removeLoadedSkill,
    handleSend,
    toggleHiddenModel,
    openCommitDiff,
    navigateDiff,
    handleDiffOpen,
  }
}
