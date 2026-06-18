export type FileLineCommentSide = 'additions' | 'deletions' | 'current'

export type FileLineCommentSource = 'file' | 'review'

export interface FileLineComment {
  id: string
  path: string
  startLine: number
  endLine: number
  side: FileLineCommentSide
  source: FileLineCommentSource
  comment: string
  snippet: string
}

export type NewFileLineComment = Omit<FileLineComment, 'id'>

export function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`
}

export function formatCompactLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`
}

export function formatFileLineCommentSideLabel(side: FileLineCommentSide): string {
  if (side === 'additions') return 'additions'
  if (side === 'deletions') return 'deletions'
  return 'current'
}

export function formatFileLineCommentPrompt(comment: FileLineComment): string {
  const lineAttr =
    comment.startLine === comment.endLine
      ? `line="${comment.startLine}"`
      : `startLine="${comment.startLine}" endLine="${comment.endLine}"`
  const sideAttr =
    comment.source === 'review' && comment.side !== 'current'
      ? ` side="${formatFileLineCommentSideLabel(comment.side)}"`
      : ''
  return [
    `<file_comment path="${comment.path}"${sideAttr} ${lineAttr}>`,
    `<selected_code>`,
    comment.snippet,
    `</selected_code>`,
    `<comment>`,
    comment.comment,
    `</comment>`,
    `</file_comment>`,
  ].join('\n')
}

export function formatFileLineCommentsPrompt(comments: FileLineComment[]): string {
  if (comments.length === 0) return ''
  return [
    'Use these file-specific line comments as context for the next response:',
    '',
    comments.map(formatFileLineCommentPrompt).join('\n\n'),
  ].join('\n')
}
