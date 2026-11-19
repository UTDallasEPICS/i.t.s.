export interface CurrentUser {
  isAdmin: boolean
  user: {
    id: string
    name: string
    email: string
    image: string | null
  } | null
}

export async function useCurrentUser() {
  const { data, pending, error, refresh } = await useFetch<CurrentUser>('/api/me')

  return {
    user: computed(() => data.value?.user ?? null),
    isAdmin: computed(() => data.value?.isAdmin ?? false),
    pending: computed(() => pending.value),
    error: computed(() => error.value),
    refresh,
  }
}
