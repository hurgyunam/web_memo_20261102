import { sendAccountResult } from '../../../../utils/account-http'
import { listOwnMemoCommits } from '../../../../utils/memo-commit-access'

export default defineEventHandler((event) => sendAccountResult(event, () => listOwnMemoCommits(event)))
