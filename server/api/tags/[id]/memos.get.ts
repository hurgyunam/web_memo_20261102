import { sendAccountResult } from '../../../utils/account-http'
import { listOwnTagMemos } from '../../../utils/tag-memo-assign'

export default defineEventHandler((event) => sendAccountResult(event, () => listOwnTagMemos(event)))
