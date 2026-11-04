import { sendAccountResult } from '../../utils/account-http'
import { saveOwnMemo } from '../../utils/memo-access'

export default defineEventHandler((event) => sendAccountResult(event, () => saveOwnMemo(event)))
