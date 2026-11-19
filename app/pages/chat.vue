<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { useRoute, navigateTo } from '#app'
import type { ChatAdapter } from '../types/chat'
import type { ConversationView, PersonView, ProjectView } from '#shared/types/chat'
import { createSessionChatAdapter } from '../utils/chat-session-adapter'
import { authClient } from '../utils/auth-client'
import ConversationList from '../components/chat/ConversationList.vue'
import CreateConversation from '../components/chat/CreateConversation.vue'
import ChatThread from '../components/chat/ChatThread.vue'

const { data: session } = await authClient.useSession(useFetch)
const currentUser = computed(() => session.value?.user)

const { data: chatContext, error: contextError, pending: contextPending, refresh: refreshContext } =
  await useFetch('/api/chat/context')
const isAdmin = computed(() => chatContext.value?.isAdmin === true)

const { data: conversations, pending, error, refresh } = await useFetch<ConversationView[]>(
  '/api/chat/conversations'
)

const route = useRoute()
const threadParam = computed(() => {
  const params = route.params as { threadId?: string }
  return params.threadId
})

const selectedId = computed(() => {
  const id = threadParam.value
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) return undefined
  const parsed = Number(id)
  return Number.isSafeInteger(parsed) ? parsed : undefined
})

type TabValue = 'mine' | 'discover'

const activeTab = ref<TabValue>('mine')
const tabs: { label: string; value: TabValue }[] = [
  { label: 'My conversations', value: 'mine' },
  { label: 'Discover', value: 'discover' },
]

const selected = computed(() => conversations.value?.find((thread) => thread.id === selectedId.value))

watch(selectedId, () => {
  const thread = selected.value
  if (thread) activeTab.value = thread.isMember ? 'mine' : 'discover'
}, { immediate: true })

let unsubscribeEvents: (() => void) | undefined
onMounted(() => {
  unsubscribeEvents = subscribeSessionChatEvents((frame) => {
    if (frame.type === 'ready' || frame.type === 'message.created' || frame.type === 'thread.created') {
      void refresh()
    }
  })
})
onScopeDispose(() => {
  unsubscribeEvents?.()
})

function changeTab(value: string | number) {
  activeTab.value = String(value) as TabValue
}

async function retryContext() {
  await refreshContext()
  if (!contextError.value && isAdmin.value) await refreshOptions()
}

const { data: options, error: optionsError, refresh: refreshOptions } = await useFetch<{
  projects: ProjectView[]
  people: PersonView[]
}>('/api/chat/conversations/options', { immediate: isAdmin.value, watch: false })

const projects = computed(() => options.value?.projects ?? [])
const people = computed(() => (options.value?.people ?? []).filter((person) => person.id !== currentUser.value?.id))

const currentUserId = computed(() => currentUser.value?.id)

const showCreate = computed(() => {
  const id = threadParam.value
  return isAdmin.value && typeof id === 'string' && id === 'new'
})
const adapter = computed<ChatAdapter | undefined>(() => {
  const thread = selected.value
  if (!thread) return
  const sessionAdapter = createSessionChatAdapter(thread.id)
  return thread.isMember ? sessionAdapter : { ...sessionAdapter, subscribe: undefined }
})

const authorNames = computed<Record<string, string>>(() => {
  const thread = selected.value
  if (!thread) return {}
  return Object.fromEntries(
    thread.members.map((member) => [
      member.id,
      `${member.name} · ${member.organizationName ?? 'NPTS'}`,
    ] as [string, string])
  )
})

const joinError = ref('')
const joining = ref(false)

async function joinConversation() {
  const thread = selected.value
  if (!thread || joining.value) return
  joining.value = true
  joinError.value = ''
  try {
    await $fetch(`/api/chat/conversations/${thread.id}/join`, { method: 'POST' })
    await refresh()
    activeTab.value = 'mine'
  } catch {
    joinError.value = 'Could not join this conversation. Please try again.'
  } finally {
    joining.value = false
  }
}

const formActionError = joinError

async function onConversationCreated(threadId: number) {
  activeTab.value = 'mine'
  await refresh()
  if (route.fullPath !== '/chat/new') return
  await navigateTo(`/chat/${threadId}`)
}

const conversationTitle = (thread: ConversationView) => {
  return thread.name ?? (thread.members.filter(member => member.id !== currentUserId.value).map(member => member.name).join(', ') || 'Group conversation')
}
</script>

<template>
  <UContainer class="py-8">
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Conversations</h1>
      </div>
      <UButton v-if="isAdmin" to="/chat/new">New conversation</UButton>
    </header>

    <UAlert v-if="formActionError" color="error" variant="soft" :description="formActionError" class="mb-4" />
    <UAlert v-if="contextError" role="alert" color="error" variant="soft" description="Could not load conversation permissions." class="mb-4">
      <template #actions><UButton type="button" variant="soft" :loading="contextPending" @click="retryContext">Try again</UButton></template>
    </UAlert>

    <div class="grid gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
      <ConversationList
        :conversations="conversations"
        :selected-id="selectedId"
        :current-user-id="currentUserId"
        :is-admin="isAdmin"
        :active-tab="activeTab"
        :tabs="tabs"
        :pending="pending"
        :error="error"
        :refresh="refresh"
        :change-tab="changeTab"
      />

      <NuxtPage v-slot="{ Component }">
        <component :is="Component">
        <CreateConversation
          v-if="showCreate"
          :projects="projects"
          :people="people"
          :current-user-id="currentUserId"
          :options-error="optionsError"
          :refresh-options="refreshOptions"
          @created="onConversationCreated"
        />
        <section v-else-if="selected && adapter" class="space-y-3">
          <div class="h-[min(720px,70dvh)] min-h-[400px]">
            <ChatThread
              :key="`${selected.id}:${selected.isMember}`"
              :adapter="adapter"
              :read-only="!selected.isMember"
              :thread-id="selected.id"
              :current-user-id="currentUserId"
              :author-names="authorNames"
              :title="conversationTitle(selected)">
              <template #read-only-action>
                <UButton type="button" :loading="joining" @click="joinConversation">Join conversation</UButton>
              </template>
            </ChatThread>
          </div>
        </section>
        <div v-else class="text-muted flex min-h-[400px] items-center justify-center rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm dark:border-gray-800">
          {{ threadParam && !pending && !error ? 'Conversation not found or unavailable.' : 'Select a conversation to read messages.' }}
        </div>
        </component>
      </NuxtPage>
    </div>
  </UContainer>
</template>