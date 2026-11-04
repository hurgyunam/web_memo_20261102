import { sendAccountResult } from '../../../../utils/account-http'
import { unlinkOwnMemoTag } from '../../../../utils/memo-tag-access'

export default defineEventHandler((event) => sendAccountResult(event, () => unlinkOwnMemoTag(event)))
