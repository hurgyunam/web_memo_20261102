import { sendAccountResult } from '../../../../utils/account-http'
import { linkOwnMemoTag } from '../../../../utils/memo-tag-access'

export default defineEventHandler((event) => sendAccountResult(event, () => linkOwnMemoTag(event)))
