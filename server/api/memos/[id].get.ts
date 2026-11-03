import { sendAccountResult } from '../../utils/account-http'
import { readOwnMemo } from '../../utils/memo-access'

export default defineEventHandler((event) => sendAccountResult(event, () => readOwnMemo(event)))
