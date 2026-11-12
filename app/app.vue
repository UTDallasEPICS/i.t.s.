<script setup lang="ts">
  const colorMode = useColorMode()

  const isDark = computed({
    get() {
      return colorMode.value === 'dark'
    },
    set() {
      colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
    },
  })
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
            <!--
              Both icons stay mounted. During SSR a system preference is the
              string "system", so a single icon chosen from colorMode.value is
              the sun and never updates after the client resolves that to dark.
            -->
            <UButton
              color="neutral"
              variant="ghost"
              aria-label="Toggle Theme"
              @click="isDark = !isDark"
            >
              <template #leading="{ ui }">
                <UIcon
                  name="i-heroicons-moon-20-solid"
                  :class="ui.leadingIcon({ class: 'hidden dark:inline-block' })"
                />
                <UIcon
                  name="i-heroicons-sun-20-solid"
                  :class="ui.leadingIcon({ class: 'dark:hidden' })"
                />
              </template>
            </UButton>
          </div>
        </UContainer>
      </header>

      <main class="flex-1">
        <NuxtPage />
      </main>
    </div>
  </UApp>
</template>
