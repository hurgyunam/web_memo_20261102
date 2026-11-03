export type AccountSession = {
  email: string | null
}

export function useAccountSession() {
  const requestFetch = useRequestFetch()
  return useAsyncData<AccountSession>('account-session', async () => {
    try {
      return await requestFetch<AccountSession>('/api/auth/session')
    } catch {
      return { email: null }
    }
  })
}
