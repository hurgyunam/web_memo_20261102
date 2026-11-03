import { isAccountArea } from '~/utils/guarded-paths'

export default defineNuxtRouteMiddleware(async (to) => {
  if (!isAccountArea(to.path)) {
    return
  }
  const requestFetch = useRequestFetch()
  try {
    const session = await requestFetch<{ email: string | null }>('/api/auth/session')
    if (!session.email) {
      return navigateTo('/login', { replace: true })
    }
  } catch {
    return navigateTo('/login', { replace: true })
  }
})
