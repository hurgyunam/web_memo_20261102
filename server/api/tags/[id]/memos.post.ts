import { sendAccountResult } from '../../../utils/account-http'
import { linkOwnTagMemos } from '../../../utils/tag-memo-assign'

export default defineEventHandler((event) => sendAccountResult(event, () => linkOwnTagMemos(event)))
