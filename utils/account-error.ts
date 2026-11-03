export function accountErrorMessage(error: unknown, fallback: string): string {
  const message = readMessage(error)
  if (message) {
    return message
  }
  return fallback
}

function readMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('data' in error)) {
    return undefined
  }
  const data = (error as { data?: unknown }).data
  if (!data || typeof data !== 'object') {
    return undefined
  }
  const record = data as { message?: unknown, data?: { message?: unknown } }
  if (typeof record.data?.message === 'string' && record.data.message.trim()) {
    return record.data.message
  }
  if (typeof record.message === 'string' && record.message.trim() && !isStatusText(record.message)) {
    return record.message
  }
  return undefined
}

function isStatusText(message: string): boolean {
  return message === 'Bad Request' || message === 'Unauthorized' || message === 'Conflict'
}
