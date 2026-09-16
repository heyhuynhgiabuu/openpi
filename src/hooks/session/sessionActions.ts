/**
 * Session actions: user-initiated commands (prompt send, shell, model and
 * thinking selection, compaction, fork/navigate, session info). Pure command
 * dispatch into window.openpi; state folding lives in the event pipe.
 */

import { batch } from 'solid-js'
import type { BashExecutionResult, ModelInfo } from '../../lib/ipc'
import { buildSessionPromptPayload } from '../../lib/sessionPrompt'
import { taskCancelCommand } from '../../lib/taskToolHelpers'
import type { Message } from '../../types/session'
import type { useRemoteSessionSync } from '../useRemoteSessionSync'
import type { useSessionHistory } from '../useSessionHistory'
import type { QueueMode } from '../useOpenPiSession'
import type { SessionPipeRefs } from './sessionEventPipe'

export interface SessionActionDeps {
  refs: SessionPipeRefs
  input: () => string
  setInput: (value: string) => void
  ready: () => { sessionFile: string | null } | null
  queueMode: () => QueueMode
  isShellRunning: () => boolean
  setIsShellRunning: (value: boolean) => void
  setCurrentModel: (value: ModelInfo | null) => void
  setModels: (value: ModelInfo[]) => void
  setError: (value: string | null) => void
  setMessages: (update: (previous: Message[]) => Message[]) => void
  setThinkingLevelState: (value: string) => void
  setSessionNameState: (value: string | null) => void
  setBranchLeafId: (value: string | null) => void
  refreshContextUsage: () => Promise<void>
  remoteSync: Pick<ReturnType<typeof useRemoteSessionSync>, 'markLocalActivity'>
  sessionHistory: Pick<ReturnType<typeof useSessionHistory>, 'loadInitialMessages'>
}

export function createSessionActions(deps: SessionActionDeps) {
  const { refs } = deps

  const send = async (contextPrefix?: string) => {
    const promptPayload = buildSessionPromptPayload(deps.input(), contextPrefix)
    const r = deps.ready()
    if (!promptPayload.text || !r) return

    deps.setInput('')
    if (refs.textareaEl) refs.textareaEl.style.height = 'auto'
    deps.remoteSync.markLocalActivity()
    try {
      if (deps.queueMode() === 'steer')
        await window.openpi.steer(promptPayload.text, promptPayload.contextPrefix)
      else if (deps.queueMode() === 'followup')
        await window.openpi.followUp(promptPayload.text, promptPayload.contextPrefix)
      else {
        refs.justSentPrompt = true
        await window.openpi.prompt(promptPayload.text, promptPayload.contextPrefix)
      }
    } catch (err) {
      deps.setError(err instanceof Error ? err.message : String(err))
    }
  }

  const updateShellMessage = (id: string, result: BashExecutionResult | null, error?: string) => {
    deps.setMessages((previous) =>
      previous.map((message) => {
        if (message.id !== id || message.role === 'system' || message.role === 'extension')
          return message
        const card = message.toolCards[0]
        if (!card) return message
        return {
          ...message,
          toolCards: [
            {
              ...card,
              output: error ?? result?.output ?? '',
              isError: !!error || (result?.exitCode ?? 0) !== 0,
              streaming: false,
            },
          ],
        }
      })
    )
  }

  const sendShell = async () => {
    const command = deps.input().trim()
    const r = deps.ready()
    if (!command || !r || deps.isShellRunning()) return

    const id = `bash-${Date.now()}`
    deps.setInput('')
    if (refs.textareaEl) refs.textareaEl.style.height = 'auto'
    deps.setIsShellRunning(true)
    deps.setMessages((previous) => [
      ...previous,
      {
        id,
        role: 'assistant',
        text: '',
        toolCards: [
          {
            toolCallId: id,
            toolName: 'bash',
            args: { command },
            output: '',
            isError: false,
            streaming: true,
          },
        ],
      },
    ])

    try {
      const result = await window.openpi.bash(command)
      updateShellMessage(id, result)
      void deps.refreshContextUsage()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      deps.setError(message)
      updateShellMessage(id, null, message)
    } finally {
      deps.setIsShellRunning(false)
    }
  }

  const selectModel = async (model: ModelInfo) => {
    batch(() => {
      deps.setCurrentModel(model)
      refs.currentModelName = model.name
    })
    await window.openpi.setModel({ provider: model.provider, modelId: model.id })
  }

  const refreshModels = () => {
    window.openpi
      .getModels()
      .then((availableModels) => {
        deps.setModels(availableModels)
      })
      .catch(() => {})
  }

  const selectThinkingLevel = async (level: string) => {
    deps.setThinkingLevelState(level)
    await window.openpi.setThinking(level)
  }

  const setSessionName = async (name: string) => {
    try {
      await window.openpi.setSessionName(name)
      deps.setSessionNameState(name)
    } catch (err) {
      deps.setError(err instanceof Error ? err.message : String(err))
    }
  }

  const forkFromMessage = async (messageId: string) => {
    try {
      await window.openpi.forkSession(messageId)
    } catch (err) {
      deps.setError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Continue the session from an earlier entry (Pi's tree navigation). Stays in
   * the same session file, unlike forkFromMessage which starts a new one.
   * Throws so the caller can surface the reason where the action was taken.
   */
  const navigateTree = async (entryId: string) => {
    const sessionFile = deps.ready()?.sessionFile
    if (!sessionFile) throw new Error('No open session to navigate.')
    const result = await window.openpi.navigateSessionTree({ path: sessionFile, entryId })
    if (result.cancelled) return
    batch(() => {
      deps.setBranchLeafId(result.leafId)
      // Pi hands back the target user message so it can be edited and resent.
      if (result.editorText !== undefined) deps.setInput(result.editorText)
    })
    deps.sessionHistory.loadInitialMessages(sessionFile)
  }

  /**
   * Cancels one pi-task subagent. Control lives in pi-task's `/task cancel`
   * command, and it only closes a live tmux/HerdR pane — SDK-backed runs answer
   * that cancellation is unsupported. The command is only sent when Pi reports
   * it, because an unknown slash text would go to the model as a prompt.
   */
  const cancelTask = async (taskId: string) => {
    const commands = await window.openpi.listSlashCommands()
    const text = taskCancelCommand(taskId, commands)
    if (!text) {
      throw new Error('The pi-task extension is not installed, so this task cannot be cancelled.')
    }
    await window.openpi.prompt(text)
  }

  const compactSession = async (customInstructions?: string) => {
    try {
      await window.openpi.compactSession(customInstructions ? { customInstructions } : {})
      // Pi SDK emits compaction_start/end events; renderer already shows them.
    } catch (err) {
      deps.setError(err instanceof Error ? err.message : String(err))
    }
  }

  const reloadSession = async () => {
    try {
      await window.openpi.reloadSession()
    } catch (err) {
      deps.setError(err instanceof Error ? err.message : String(err))
    }
  }

  const copyLastAssistantText = async (): Promise<string | null> => {
    try {
      return await window.openpi.copyLastAssistantText()
    } catch (err) {
      deps.setError(err instanceof Error ? err.message : String(err))
      return null
    }
  }

  const getSessionInfo = async (): Promise<unknown | null> => {
    try {
      return await window.openpi.getSessionInfo()
    } catch (err) {
      deps.setError(err instanceof Error ? err.message : String(err))
      return null
    }
  }

  return {
    send,
    sendShell,
    selectModel,
    refreshModels,
    selectThinkingLevel,
    setSessionName,
    forkFromMessage,
    navigateTree,
    cancelTask,
    compactSession,
    reloadSession,
    copyLastAssistantText,
    getSessionInfo,
  }
}
