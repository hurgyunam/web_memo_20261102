import { sendAccountResult } from '../../../../utils/account-http'
import { listOwnMemoTags } from '../../../../utils/memo-tag-access'

export default defineEventHandler((event) => sendAccountResult(event, () => listOwnMemoTags(event)))
