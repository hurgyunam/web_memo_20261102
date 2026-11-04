import { sendAccountResult } from '../../utils/account-http'
import { listOwnTags } from '../../utils/tag-access'

export default defineEventHandler((event) => sendAccountResult(event, () => listOwnTags(event)))
