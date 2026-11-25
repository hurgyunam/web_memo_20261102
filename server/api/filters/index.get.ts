import { sendAccountResult } from '../../utils/account-http'
import { listOwnFilters } from '../../utils/filter-access'

export default defineEventHandler((event) => sendAccountResult(event, () => listOwnFilters(event)))
