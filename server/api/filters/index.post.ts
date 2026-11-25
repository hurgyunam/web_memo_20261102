import { sendAccountResult } from '../../utils/account-http'
import { addOwnFilter } from '../../utils/filter-access'

export default defineEventHandler((event) => sendAccountResult(event, () => addOwnFilter(event)))
