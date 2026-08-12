export interface DisposableSession {
  abort(): Promise<void>
  dispose(): void
}

export async function teardownSession(
  session: DisposableSession,
  emitShutdown: () => Promise<void>
): Promise<void> {
  try {
    await session.abort()
  } catch {
    // Teardown must continue even when cancellation itself fails.
  }
  try {
    await emitShutdown()
  } finally {
    session.dispose()
  }
}
