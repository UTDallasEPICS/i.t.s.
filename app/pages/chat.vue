<script setup lang="ts">
  import ChatThread from '../components/chat/ChatThread.vue'
  import MessageInput from '../components/chat/MessageInput.vue'
  import { CHAT_MESSAGE_MAX_LENGTH } from '#shared/chat-limits'
  import { createSessionChatAdapter, subscribeSessionChatEvents } from '../utils/chat-session-adapter'
  import { authClient } from '../utils/auth-client'
  import { selectProjectMembers } from '../utils/chat-member-selection'
  import type { ChatAdapter } from '../types/chat'

  type Conversation = {
    id: number
    name: string | null
    projectId: number
    projectName: string
    organizationName: string
    isMember: boolean
    closedAt: string | null
    members: { id: string, name: string, organizationName: string | null }[]
    latestMessage: { id: number, plainTextBody: string, senderName: string } | null
  }
  type Person = { id: string, name: string, email: string, orgId: string | null, organizationName: string | null }
  type Project = { id: number, name: string, orgId: string }

  const { data: session } = await authClient.useSession(useFetch)
  const currentUser = computed(() => session.value?.user)
  const { data: chatContext, error: contextError, pending: contextPending, refresh: refreshContext } = await useFetch('/api/chat/context')
  const isAdmin = computed(() => chatContext.value?.isAdmin === true)
  const { data: conversations, pending, error, refresh } = await useFetch<Conversation[]>('/api/chat/conversations')
  const route = useRoute()
  const threadParam = computed(() => 'threadId' in route.params ? route.params.threadId : undefined)
  const selectedId = computed(() => {
    const id = threadParam.value
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) return undefined
    const parsed = Number(id)
    return Number.isSafeInteger(parsed) ? parsed : undefined
  })
  const activeTab = ref('mine')
  const tabs = [{ label: 'My conversations', value: 'mine' }, { label: 'Discover', value: 'discover' }]
  const visibleConversations = computed(() => conversations.value?.filter(thread => activeTab.value === 'mine' ? thread.isMember : !thread.isMember) ?? [])
  const selected = computed(() => conversations.value?.find(thread => thread.id === selectedId.value))
  watch(selectedId, () => {
    const thread = selected.value
    if (thread) activeTab.value = thread.isMember ? 'mine' : 'discover'
  }, { immediate: true })
  const authorNames = computed(() => Object.fromEntries(selected.value?.members.map(member => [member.id, `${member.name} · ${member.organizationName ?? 'NPTS'}`]) ?? []))
  const adapter = computed<ChatAdapter | undefined>(() => {
    if (!selected.value) return
    const sessionAdapter = createSessionChatAdapter(selected.value.id)
    return selected.value.isMember ? sessionAdapter : { ...sessionAdapter, subscribe: undefined }
  })
  const actionError = ref('')
  const joining = ref(false)
  const creating = ref(false)
  const showCreate = computed(() => threadParam.value === 'new' && isAdmin.value)
  const { data: options, error: optionsError, refresh: refreshOptions } = await useFetch<{ projects: Project[], people: Person[] }>('/api/chat/conversations/options', { immediate: isAdmin.value, watch: false })
  async function retryContext() {
    await refreshContext()
    if (!contextError.value && isAdmin.value) await refreshOptions()
  }
  const projects = computed(() => options.value?.projects ?? [])
  const people = computed(() => (options.value?.people ?? []).filter(person => person.id !== currentUser.value?.id))
  const projectId = ref<number>()
  const name = ref('')
  const memberIds = ref<string[]>([])
  const message = ref('')
  const canCreate = computed(() => !!projectId.value && memberIds.value.length > 0 && !!message.value.trim() && message.value.length <= CHAT_MESSAGE_MAX_LENGTH && !creating.value)
  let createGeneration = 0
  watch(() => route.fullPath, () => {
    createGeneration += 1
    creating.value = false
  }, { flush: 'sync' })
  let unsubscribeEvents: (() => void) | undefined
  onMounted(() => {
    unsubscribeEvents = subscribeSessionChatEvents((frame) => {
      if (frame.type === 'ready' || frame.type === 'message.created' || frame.type === 'thread.created') void refresh()
    })
  })
  onScopeDispose(() => {
    createGeneration += 1
    unsubscribeEvents?.()
  })
  const eligiblePeople = computed(() => {
    const orgId = projects.value.find(project => project.id === projectId.value)?.orgId
    return people.value.filter(person => person.orgId === null || (orgId && person.orgId === orgId))
  })
  const memberGroups = computed(() => {
    const groups = new Map<string, { label: string, people: Person[] }>()
    for (const person of eligiblePeople.value) {
      const key = person.orgId ?? ''
      if (!groups.has(key)) groups.set(key, { label: person.organizationName ?? 'NPTS', people: [] })
      groups.get(key)!.people.push(person)
    }
    return [...groups.entries()].map(([id, group]) => ({ id, ...group }))
  })
  const memberOptions = computed(() => memberGroups.value.map(group => [
    { label: group.label, value: '', description: '', type: 'label' as const },
    ...group.people.map(person => ({ label: person.name || person.email, value: person.id, description: person.email })),
  ]))
  function toggleMemberGroup(group: { people: Person[] }) {
    const ids = group.people.map(person => person.id)
    const selected = new Set(memberIds.value)
    if (ids.every(id => selected.has(id))) ids.forEach(id => selected.delete(id))
    else ids.forEach(id => selected.add(id))
    memberIds.value = [...selected]
  }
  watch(projectId, (id) => {
    memberIds.value = selectProjectMembers(memberIds.value, people.value, projects.value.find(project => project.id === id)?.orgId)
  })

  function conversationTitle(thread: Conversation) {
    return thread.name ?? (thread.members.filter(member => member.id !== currentUser.value?.id).map(member => member.name).join(', ') || 'Group conversation')
  }

  function firstName(fullName: string) {
    return fullName.split(' ')[0] ?? fullName
  }

  async function createConversation() {
    if (!canCreate.value) return
    const generation = ++createGeneration
    const submitted = { projectId: projectId.value, name: name.value, memberIds: [...memberIds.value], message: message.value }
    actionError.value = ''
    creating.value = true
    try {
      const result = await $fetch<{ thread: { id: number } }>('/api/chat/conversations', {
        method: 'POST', body: {
          projectId: submitted.projectId, memberIds: submitted.memberIds,
          name: submitted.name.trim() || undefined, message: submitted.message.trim(),
        },
      })
      if (generation !== createGeneration) return
      if (projectId.value === submitted.projectId && name.value === submitted.name && message.value === submitted.message
        && memberIds.value.length === submitted.memberIds.length && memberIds.value.every((id, index) => id === submitted.memberIds[index])) {
        name.value = ''
        message.value = ''
        memberIds.value = []
      }
      await refresh()
      if (generation !== createGeneration) return
      activeTab.value = 'mine'
      await navigateTo(`/chat/${result.thread.id}`)
    } catch {
      if (generation === createGeneration) actionError.value = 'Could not start the conversation. Check the project and selected members, then try again.'
    } finally {
      if (generation === createGeneration) creating.value = false
    }
  }
  function onCreateKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
    event.preventDefault()
    void createConversation()
  }

  async function joinConversation() {
    if (!selected.value || joining.value) return
    joining.value = true
    actionError.value = ''
    try {
      await $fetch(`/api/chat/conversations/${selected.value.id}/join`, { method: 'POST' })
      await refresh()
      activeTab.value = 'mine'
    } catch {
      actionError.value = 'Could not join this conversation. Please try again.'
    } finally {
      joining.value = false
    }
  }
  function changeTab(value: string | number) {
    activeTab.value = String(value)
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

    <UAlert v-if="actionError" color="error" variant="soft" :description="actionError" class="mb-4" />
    <UAlert v-if="contextError" role="alert" color="error" variant="soft" description="Could not load conversation permissions." class="mb-4">
      <template #actions><UButton type="button" variant="soft" :loading="contextPending" @click="retryContext">Try again</UButton></template>
    </UAlert>

    <div class="grid gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
      <section aria-label="Conversation list" class="space-y-2">
        <UTabs v-if="isAdmin" :model-value="activeTab" :items="tabs" :content="false" class="mb-3" @update:model-value="changeTab" />
        <p v-if="pending && !conversations" class="text-muted text-sm">Loading conversations…</p>
        <div v-else-if="error" class="space-y-2"><p class="text-sm text-red-700 dark:text-red-200">Could not load conversations.</p><UButton variant="soft" @click="refresh()">Try again</UButton></div>
        <p v-else-if="!visibleConversations.length" class="text-muted text-sm">{{ activeTab === 'mine' ? 'No conversations yet.' : 'No conversations to discover.' }}</p>
        <NuxtLink
          v-for="thread in visibleConversations" :key="thread.id" :to="`/chat/${thread.id}`" :aria-current="selectedId === thread.id ? 'page' : undefined"
          class="block w-full rounded-lg border px-4 py-3 text-left transition-colors"
          :class="selectedId === thread.id && !showCreate ? 'border-primary bg-primary/5' : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800'"
          >
          <span class="block truncate text-sm font-semibold">{{ conversationTitle(thread) }}</span>
          <span class="text-muted mt-1 block truncate text-xs">{{ thread.projectName }} · {{ thread.organizationName }}</span>
          <span v-if="thread.latestMessage" class="text-muted mt-2 block truncate text-xs">{{ firstName(thread.latestMessage.senderName) }}: {{ thread.latestMessage.plainTextBody }}</span>
          <span v-if="!thread.isMember" class="text-muted mt-2 block text-xs">Preview · not joined</span>
        </NuxtLink>
      </section>

      <NuxtPage v-slot="{ Component }">
        <component :is="Component">
      <form v-if="showCreate" class="flex h-[min(720px,70dvh)] min-h-[400px] min-w-0 flex-col rounded-lg border border-gray-200 dark:border-gray-800" @submit.prevent="createConversation">
        <header class="space-y-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div class="flex items-center justify-between gap-4">
            <h2 class="font-semibold">New conversation</h2>
            <UButton type="button" color="neutral" variant="ghost" to="/chat">Cancel</UButton>
          </div>
          <div v-if="optionsError" class="space-y-2"><p class="text-sm text-red-700 dark:text-red-200">Could not load projects and people.</p><UButton type="button" variant="soft" @click="refreshOptions()">Try again</UButton></div>
          <label class="block text-sm font-medium" for="conversation-project">Project</label>
          <USelectMenu
            id="conversation-project" v-model="projectId" :items="projects.map(project => ({ label: project.name, value: project.id }))"
            value-key="value" default-open placeholder="Choose a project" :search-input="{ placeholder: 'Search projects' }" class="w-full"
          />
          <fieldset>
            <legend class="mb-2 text-sm font-medium">Members</legend>
            <USelectMenu
              v-model="memberIds" :items="memberOptions" value-key="value" multiple
              :filter-fields="['label', 'description']" placeholder="Select members" aria-label="Members" class="w-full"
              :search-input="{ placeholder: 'Search members by name or email' }"
            />
            <div v-if="memberGroups.length" class="mt-2 flex flex-wrap items-center gap-2">
              <UButton v-for="group in memberGroups" :key="group.id" type="button" color="neutral" variant="soft" size="xs" @click="toggleMemberGroup(group)">
                {{ group.people.every(person => memberIds.includes(person.id)) ? 'Deselect' : 'Select' }} all {{ group.label }}
              </UButton>
            </div>
          </fieldset>
          <label class="block text-sm font-medium" for="conversation-name">Channel name <span class="text-muted font-normal">(optional; leave blank for a group DM)</span></label>
          <UInput id="conversation-name" v-model="name" maxlength="100" class="w-full" placeholder="e.g. Launch planning" />
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <p class="text-muted text-sm">Write the first message to start the conversation.</p>
        </div>
        <div class="border-t border-gray-200 dark:border-gray-800">
          <MessageInput v-model="message" label="First message" @keydown="onCreateKeydown">
            <UButton type="submit" icon="i-lucide-arrow-up" :loading="creating" :disabled="!canCreate" :aria-label="creating ? 'Sending message' : 'Send message'" class="absolute right-2 bottom-2" />
          </MessageInput>
        </div>
      </form>
      <section v-else-if="selected && adapter" class="space-y-3">
        <div class="h-[min(720px,70dvh)] min-h-[400px]">
          <ChatThread
            :key="`${selected.id}:${selected.isMember}`" :adapter="adapter" :read-only="!selected.isMember"
            :thread-id="selected.id" :current-user-id="currentUser?.id" :author-names="authorNames" :title="conversationTitle(selected)">
            <template #read-only-action>
              <UButton type="button" :loading="joining" @click="joinConversation">Join conversation</UButton>
            </template>
          </ChatThread>
        </div>
      </section>
      <div v-else class="text-muted flex min-h-[400px] items-center justify-center rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm dark:border-gray-800">{{ threadParam && !pending && !error ? 'Conversation not found or unavailable.' : 'Select a conversation to read messages.' }}</div>
        </component>
      </NuxtPage>
    </div>
  </UContainer>
</template>
