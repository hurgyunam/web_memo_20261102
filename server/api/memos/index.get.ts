import { sendAccountResult } from '../../utils/account-http'
import { listOwnMemos } from '../../utils/memo-access'

export default defineEventHandler((event) => sendAccountResult(event, () => listOwnMemos(event)))
