import { sendAccountResult } from '../../utils/account-http'
import { addEmptyMemo } from '../../utils/memo-access'

export default defineEventHandler((event) => sendAccountResult(event, () => addEmptyMemo(event)))
