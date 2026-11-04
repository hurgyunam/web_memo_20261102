import { sendAccountResult } from '../../utils/account-http'
import { renameOwnTag } from '../../utils/tag-access'

export default defineEventHandler((event) => sendAccountResult(event, () => renameOwnTag(event)))
