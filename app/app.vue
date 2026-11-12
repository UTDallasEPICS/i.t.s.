<script setup lang="ts">
  import type { DropdownMenuItem } from '@nuxt/ui/runtime/components/DropdownMenu.vue'
  import { authClient } from './utils/auth-client'
  import { clearChatDrafts } from './utils/chat-drafts'
  import { useCurrentUser } from './composables/useCurrentUser'

  const colorMode = useColorMode()

  const isDark = computed({
    get() {
      return colorMode.value === 'dark'
    },
    set() {
      colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
    },
  })

  const { user, isAdmin, pending } = await useCurrentUser()

  const selectedFile = ref<File | null>(null)
  const imagePreview = ref<string>('')
  const isUploading = ref(false)
  const isModalOpen = ref(false)

  async function logout() {
    const result = await authClient.signOut()
    if (result.error) return
    clearChatDrafts()
    await navigateTo('/auth', { external: true })
  }

  function profileImageUrl() {
    return user.value?.image ? `/api/users/${user.value.id}/profile` : undefined
  }

  function handleImageUpload(event: Event) {
    const target = event.target as HTMLInputElement
    const files = target.files as FileList

    if (!files || files.length === 0) return

    const file = files[0]

    if (!file?.type.startsWith('image/')) {
      return
    }

    selectedFile.value = file

    const reader = new FileReader()
    reader.onload = (e) => {
      imagePreview.value = e.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  const openModal = () => {
    isModalOpen.value = true
  }

  const closeModal = () => {
    isModalOpen.value = false
  }

  async function updatePfp() {
    if (!selectedFile.value) return

    isUploading.value = true

    try {
      const formData = new FormData()
      formData.append('file', selectedFile.value)

      await $fetch('/api/users/upload', {
        method: 'POST',
        body: formData,
      })

      // Refresh current user data to show the updated profile picture
      await refreshNuxtData()

      // Reset state
      selectedFile.value = null
      imagePreview.value = ''
      isModalOpen.value = false
    } catch (error) {
      console.error('Upload failed:', error)
    } finally {
      isUploading.value = false
    }
  }

  const accountMenuItems = computed<DropdownMenuItem[]>(() => [
    {
      label: 'Update Profile Picture',
      icon: 'i-heroicons-arrow-up-on-square-20-solid',
      onSelect: openModal,
    },
    {
      type: 'separator' as const,
    },
    {
      label: 'Logout',
      color: 'error',
      icon: 'i-heroicons-arrow-right-on-rectangle-20-solid',
      onSelect: logout,
    },
  ])
</script>

<template>
  <UApp>
    <div
      class="flex min-h-screen flex-col bg-white text-gray-900 transition-colors duration-300 dark:bg-gray-900 dark:text-gray-100"
    >
      <header
        class="sticky top-0 z-50 border-b border-gray-200 bg-white/75 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/75"
      >
        <UContainer class="flex h-16 items-center justify-between">
          <NuxtLink to="/" class="flex items-center gap-2 text-xl font-bold">
            <UIcon name="i-heroicons-cube-transparent" class="text-primary-500 h-8 w-8" />
            <span>Nuxt Template</span>
          </NuxtLink>

          <div class="flex items-center gap-2">
            <UButton to="/tickets" variant="outline">View tickets</UButton>
            <UButton to="/tickets/new">New ticket</UButton>
            <UButton v-if="isAdmin" to="/admin" variant="outline">Manage users</UButton>

            <UDropdownMenu
              v-if="user && !pending"
              :items="accountMenuItems"
            >
              <template #default="{ open }">
                <UButton
                  variant="ghost"
                  class="p-0 rounded-full"
                  :aria-expanded="open"
                  aria-label="Account"
                >
                  <UAvatar
                    :src="profileImageUrl()"
                    :alt="user.name"
                    class="h-8 w-8 rounded-full"
                  />
                  <UIcon
                    name="i-heroicons-chevron-down-20-solid"
                    class="ml-1 h-4 w-4"
                    aria-hidden="true"
                  />
                </UButton>
              </template>
            </UDropdownMenu>

            <UButton
              :icon="isDark ? 'i-heroicons-moon-20-solid' : 'i-heroicons-sun-20-solid'"
              color="neutral"
              variant="ghost"
              @click="isDark = !isDark"
              aria-label="Toggle Theme"
            />
          </div>
        </UContainer>
      </header>

      <main class="flex-1">
        <NuxtPage />
      </main>

      <UModal :open="isModalOpen">
        <template #content>
          <div class="m-12 space-y-4">
            <h3 class="text-lg font-medium text-gray-900 dark:text-white">
              Update Profile Picture
            </h3>

            <div v-if="imagePreview" class="flex justify-center">
              <UAvatar :src="imagePreview" size="3xl" />
            </div>

            <div>
              <input
                type="file"
                accept="image/*"
                class="file:bg-primary-50 file:text-brand4 hover:file:bg-primary-100 block w-full cursor-pointer text-sm text-gray-500 file:mr-4 file:rounded-full file:border-0 file:px-4 file:py-2 file:text-sm file:font-semibold"
                @change="handleImageUpload"
              />
            </div>

            <div class="flex justify-end gap-2">
              <UButton variant="soft" @click="closeModal"> Cancel </UButton>
              <UButton
                color="success"
                :loading="isUploading"
                :disabled="!selectedFile"
                @click="updatePfp"
              >
                Upload
              </UButton>
            </div>
          </div>
        </template>
      </UModal>
    </div>
  </UApp>
</template>
