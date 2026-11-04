import { sendAccountResult } from '../../utils/account-http'
import { removeOwnTag } from '../../utils/tag-access'

export default defineEventHandler((event) => sendAccountResult(event, () => removeOwnTag(event)))
