import { saveNewSecret } from '../../utils/account-access'
import { sendAccountResult } from '../../utils/account-http'

export default defineEventHandler((event) => sendAccountResult(event, () => saveNewSecret(event)))
