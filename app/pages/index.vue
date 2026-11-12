<script setup lang="ts">
  import { authClient } from '../utils/auth-client'

  const { data: session } = await authClient.useSession(useFetch)

  // Index redirects to the default route after login (tickets) for signed-in
  // users, and to the login page for everyone else.
  if (session.value) {
    await navigateTo('/tickets', { external: true })
  } else {
    await navigateTo('/auth', { external: true })
  }
</script>
