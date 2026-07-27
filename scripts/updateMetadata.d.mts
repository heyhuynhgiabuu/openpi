export interface MacUpdateFile {
  name: string
  sha512: string
  size: number
}

export function renderMacUpdateMetadata(version: string, files: MacUpdateFile[]): string
