<script setup lang="ts">
import { computed } from 'vue'
import type { ConversationView } from '#shared/types/chat'

const props = defineProps<{
  conversations: ConversationView[] | undefined
  selectedId: number | undefined
  currentUserId: string | undefined
  isAdmin: boolean
  activeTab: string
  tabs: { label: string; value: string }[]
  pending: boolean
  error: unknown
  refresh: () => void | Promise<void>
  changeTab: (value: string | number) => void
}>()

const visibleConversations = computed(() =>
  (props.conversations ?? []).filter((thread) =>
    props.activeTab === 'mine' ? thread.isMember : !thread.isMember
  )
)

const conversationTitle = (thread: ConversationView) => {
  return (
    thread.name ??
    (thread.members
      .filter((member) => member.id !== props.currentUserId)
      .map((member) => member.name)
      .join(', ') || 'Group conversation')
  )
}

const firstName = (fullName: string) => {
  return fullName.split(' ')[0] ?? fullName
}
</script>

<template>
  <section aria-label="Conversation list" class="space-y-2">
    <UTabs
      v-if="isAdmin"
      :model-value="activeTab"
      :items="tabs"
      :content="false"
      class="mb-3"
      @update:model-value="changeTab"
    />
    <p v-if="pending && !visibleConversations.length" class="text-muted text-sm">Loading conversations…</p>
    <div v-else-if="error" class="space-y-2">
      <p class="text-sm text-red-700 dark:text-red-200">Could not load conversations.</p>
      <UButton variant="soft" @click="refresh()">Try again</UButton>
    </div>
    <p v-else-if="!visibleConversations.length" class="text-muted text-sm">
      {{ activeTab === 'mine' ? 'No conversations yet.' : 'No conversations to discover.' }}
    </p>
    <NuxtLink
      v-for="thread in visibleConversations"
      :key="thread.id"
      :to="'/chat/' + thread.id"
      :aria-current="selectedId === thread.id ? 'page' : undefined"
      class="block w-full rounded-lg border px-4 py-3 text-left transition-colors"
      :class="
        selectedId === thread.id
          ? 'border-primary bg-primary/5'
          : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800'
      "
    >
      <span class="block truncate text-sm font-semibold">{{ conversationTitle(thread) }}</span>
      <span class="text-muted mt-1 block truncate text-xs">
        {{ thread.projectName }} · {{ thread.organizationName }}
      </span>
      <span v-if="thread.latestMessage" class="text-muted mt-2 block truncate text-xs">
        {{ firstName(thread.latestMessage.senderName) }}: {{ thread.latestMessage.plainTextBody }}
      </span>
      <span v-if="!thread.isMember" class="text-muted mt-2 block text-xs">Preview · not joined</span>
    </NuxtLink>
  </section>
</template>
