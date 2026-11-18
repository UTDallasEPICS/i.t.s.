<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRoute } from '#app'
import type { PersonView, ProjectView } from '#shared/types/chat'
import { CHAT_MESSAGE_MAX_LENGTH } from '#shared/chat-limits'
import { selectProjectMembers } from '../../utils/chat-member-selection'
import MessageInput from './MessageInput.vue'

const props = defineProps<{
  projects: ProjectView[]
  people: PersonView[]
  currentUserId: string | undefined
  optionsError: unknown
  refreshOptions: () => void
}>()

const emit = defineEmits<{
  (e: 'created', threadId: number): void
}>()

// Conversation creation form state
const projectId = ref<number>()
const name = ref<string>('')
const memberIds = ref<string[]>([])
const message = ref<string>('')
const actionError = ref('')
const creating = ref(false)
let createGeneration = 0

let unmounted = false

const route = useRoute()

const eligiblePeople = computed(() => {
  const orgId = props.projects.find((project) => project.id === projectId.value)?.orgId
  return props.people.filter(
    (person) => person.orgId === null || (orgId && person.orgId === orgId)
  )
})

const memberGroups = computed(() => {
  const groups = new Map<string, { label: string; people: PersonView[] }>()
  for (const person of eligiblePeople.value) {
    const key = person.orgId ?? ''
    if (!groups.has(key)) {
      groups.set(key, { label: person.organizationName ?? 'NPTS', people: [] })
    }
    groups.get(key)!.people.push(person)
  }
  return [...groups.entries()].map(([id, group]) => ({ id, ...group }))
})

const memberOptions = computed(() =>
  memberGroups.value.map((group) => [
    { label: group.label, value: '', description: '', type: 'label' as const },
    ...group.people.map((person) => ({
      label: person.name || person.email,
      value: person.id,
      description: person.email,
    })),
  ])
)

const canCreate = computed(() =>
  !!projectId.value &&
  memberIds.value.length > 0 &&
  !!message.value.trim() &&
  message.value.length <= CHAT_MESSAGE_MAX_LENGTH
)

watch(() => projectId.value, (id) => {
  memberIds.value = selectProjectMembers(
    memberIds.value,
    props.people,
    props.projects.find((project) => project.id === id)?.orgId
  )
})

function toggleMemberGroup(group: { people: PersonView[] }) {
  const ids = group.people.map((person) => person.id)
  const selected = new Set(memberIds.value)
  if (ids.every((id) => selected.has(id))) {
    ids.forEach((id) => selected.delete(id))
  } else {
    ids.forEach((id) => selected.add(id))
  }
  memberIds.value = [...selected]
}

onScopeDispose(() => {
  unmounted = true
})

async function createConversation() {
  if (!canCreate.value) return
  const generation = ++createGeneration
  const submitPath = route.fullPath
  const submitted = {
    projectId: projectId.value!,
    name: name.value,
    memberIds: [...memberIds.value],
    message: message.value,
  }
  actionError.value = ''
  creating.value = true
  try {
    const result = await $fetch<{ thread: { id: number } }>('/api/chat/conversations', {
      method: 'POST',
      body: {
        projectId: submitted.projectId,
        memberIds: submitted.memberIds,
        name: submitted.name.trim() || undefined,
        message: submitted.message.trim(),
      },
    })
    if (unmounted || generation !== createGeneration || route.fullPath !== submitPath) return
    if (
      projectId.value === submitted.projectId &&
      name.value === submitted.name &&
      message.value === submitted.message &&
      memberIds.value.length === submitted.memberIds.length &&
      memberIds.value.every((id, index) => id === submitted.memberIds[index])
    ) {
      name.value = ''
      message.value = ''
      memberIds.value = []
    }
    emit('created', result.thread.id)
  } catch {
    if (!unmounted && generation === createGeneration) {
      actionError.value =
        'Could not start the conversation. Check the project and selected members, then try again.'
    }
  } finally {
    if (!unmounted && generation === createGeneration) creating.value = false
  }
}
</script>

<template>
  <div class="flex h-[min(720px,70dvh)] min-h-[400px] min-w-0 flex-col rounded-lg border border-gray-200 dark:border-gray-800">
    <form @submit.prevent="createConversation" class="flex h-[min(720px,70dvh)] min-h-[400px] min-w-0 flex-col rounded-lg border border-gray-200 dark:border-gray-800">
      <header class="space-y-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <div class="flex items-center justify-between gap-4">
          <h2 class="font-semibold">New conversation</h2>
          <UButton type="button" color="neutral" variant="ghost" to="/chat">Cancel</UButton>
        </div>
        <div v-if="props.optionsError" class="space-y-2">
          <p class="text-sm text-red-700 dark:text-red-200">Could not load projects and people.</p>
          <UButton type="button" variant="soft" @click="props.refreshOptions">Try again</UButton>
        </div>
        <label class="block text-sm font-medium" for="conversation-project">Project</label>
        <USelectMenu
          id="conversation-project"
          v-model="projectId"
          :items="props.projects.map((project) => ({ label: project.name, value: project.id }))"
          value-key="value"
          default-open
          placeholder="Choose a project"
          :search-input="{ placeholder: 'Search projects' }"
          class="w-full"
        />
        <fieldset>
          <legend class="mb-2 text-sm font-medium">Members</legend>
          <USelectMenu
            v-model="memberIds"
            :items="memberOptions"
            value-key="value"
            multiple
            :filter-fields="['label', 'description']"
            placeholder="Select members"
            aria-label="Members"
            class="w-full"
            :search-input="{ placeholder: 'Search members by name or email' }"
          />
          <div v-if="memberGroups.length" class="mt-2 flex flex-wrap items-center gap-2">
            <UButton
              v-for="group in memberGroups"
              :key="group.id"
              type="button"
              color="neutral"
              variant="soft"
              size="xs"
              @click="toggleMemberGroup(group)"
            >
              {{ group.people.every((person) => memberIds.includes(person.id)) ? 'Deselect' : 'Select' }}
              all {{ group.label }}
            </UButton>
          </div>
        </fieldset>
        <label class="block text-sm font-medium" for="conversation-name">
          Channel name <span class="text-muted font-normal">(optional; leave blank for a group DM)</span>
        </label>
        <UInput id="conversation-name" v-model="name" maxlength="100" class="w-full" placeholder="e.g. Launch planning" />
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p class="text-muted text-sm">Write the first message to start the conversation.</p>
      </div>
      <div class="border-t border-gray-200 dark:border-gray-800">
        <MessageInput v-model="message" label="First message">
          <UButton
            type="submit"
            icon="i-lucide-arrow-up"
            :loading="creating"
            :disabled="!canCreate || creating"
            :aria-label="creating ? 'Sending message' : 'Send message'"
            class="absolute right-2 bottom-2"
          />
        </MessageInput>
      </div>
    </form>
  </div>
</template>
