import { createError, getRequestURL } from 'h3'
import { isAccountApi } from '../../utils/guarded-paths'
import { getSessionAccountId } from '../utils/session'

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!isAccountApi(path)) {
    return
  }
  const accountId = await getSessionAccountId(event)
  if (!accountId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: '로그인이 필요합니다.',
      data: { message: '로그인이 필요합니다.' },
    })
  }
})
