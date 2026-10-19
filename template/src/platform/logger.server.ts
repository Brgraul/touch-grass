export function logError(code: string, correlationId: string) {
  console.error(JSON.stringify({ level: 'error', code, correlationId }))
}
