import { sendAccountResult } from '../../utils/account-http'
import { removeOwnMemo } from '../../utils/memo-access'

export default defineEventHandler((event) => sendAccountResult(event, () => removeOwnMemo(event)))
