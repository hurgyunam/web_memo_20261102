import { sendAccountResult } from '../../../../utils/account-http'
import { commitOwnMemo } from '../../../../utils/memo-commit-access'

export default defineEventHandler((event) => sendAccountResult(event, () => commitOwnMemo(event)))
