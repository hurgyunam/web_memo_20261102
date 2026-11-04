import { sendAccountResult } from '../../utils/account-http'
import { addOwnTag } from '../../utils/tag-access'

export default defineEventHandler((event) => sendAccountResult(event, () => addOwnTag(event)))
