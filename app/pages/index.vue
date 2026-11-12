<script setup lang="ts">
  import { useNptsAccess } from '../composables/useNptsAccess'

  const { isAdmin, checkAdmin } = useNptsAccess()
  await checkAdmin()

  const { data: users, pending, error } = await useFetch('/api/users', {
    immediate: isAdmin.value,
  })

  function getImageLink(user: { image: boolean; id: string }) {
    return user.image ? 'api/users/' + user.id + '/profile' : undefined
  }
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Dashboard</h1>
        <p class="mt-1 text-gray-500 dark:text-gray-400">
          Manage your application users and settings, or submit a project ticket.
        </p>
      </div>
    </div>

    <UCard v-if="isAdmin" class="w-full">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-users-20-solid" class="h-5 w-5 text-gray-500" />
            <h2 class="text-base leading-7 font-semibold text-gray-900 dark:text-white">
              Registered Users
            </h2>
          </div>
          <UBadge variant="subtle" color="primary" size="md">{{ users?.length || 0 }} Users</UBadge>
        </div>
      </template>

      <div v-if="pending" class="space-y-4">
        <div v-for="i in 3" :key="i" class="flex items-center justify-between py-2">
          <div class="flex w-full items-center gap-3">
            <USkeleton class="h-10 w-10 rounded-full" />
            <div class="w-full max-w-[200px] space-y-2">
              <USkeleton class="h-4 w-full" />
              <USkeleton class="h-3 w-2/3" />
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="error">
        <UAlert
          icon="i-heroicons-exclamation-triangle-20-solid"
          color="error"
          variant="subtle"
          title="Error loading users"
          :description="error.message"
        />
      </div>

      <div v-else class="divide-y divide-gray-200 dark:divide-gray-800">
        <div
          v-for="user in users"
          :key="user.id"
          class="flex items-center justify-between py-4 first:pt-0 last:pb-0"
        >
          <div class="flex items-center gap-3">
            <UAvatar :src="getImageLink(user)" :alt="user.name" size="md" :as="{ img: 'img' }" />
            <div>
              <p class="font-medium text-gray-900 dark:text-white">{{ user.name }}</p>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ user.email }}</p>
            </div>
          </div>
          <UBadge :color="user.emailVerified ? 'success' : 'warning'" variant="subtle" size="sm">
            {{ user.emailVerified ? 'Verified' : 'Pending' }}
          </UBadge>
        </div>

        <div v-if="users?.length === 0" class="py-8 text-center text-gray-500">No users found.</div>
      </div>
    </UCard>
  </UContainer>
</template>
