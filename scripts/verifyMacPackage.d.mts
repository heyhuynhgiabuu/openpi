export interface MacPackageVerification {
  appDir: string
  nativeFiles: string[]
}

export function expectedMacNativePackages(arch: string): string[]
export function hasMacArchitecture(description: string, arch: string): boolean
export function verifyMacPackage(
  version: string,
  arch: string,
  projectDir?: string
): MacPackageVerification
