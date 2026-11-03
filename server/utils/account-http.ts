import { createError, setResponseHeader, type H3Event } from 'h3'
import { AccountActionError } from './account-access'

export async function sendAccountResult<T>(event: H3Event, action: () => Promise<T>): Promise<T> {
  setResponseHeader(event, 'cache-control', 'no-store')
  try {
    return await action()
  } catch (error) {
    setResponseHeader(event, 'cache-control', 'no-store')
    if (error instanceof AccountActionError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: statusText(error.statusCode),
        message: error.message,
        data: { message: error.message },
      })
    }
    throw error
  }
}

function statusText(statusCode: number): string {
  if (statusCode === 400) {
    return 'Bad Request'
  }
  if (statusCode === 401) {
    return 'Unauthorized'
  }
  if (statusCode === 404) {
    return 'Not Found'
  }
  if (statusCode === 409) {
    return 'Conflict'
  }
  if (statusCode === 500) {
    return 'Internal Server Error'
  }
  return 'Error'
}
