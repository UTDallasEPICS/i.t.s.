<script setup lang="ts">
  import { ticketStatuses, type TicketStatus } from '#shared/tickets'
  import type { TicketDetail } from '../types/ticket'

  const props = defineProps<{ ticket: TicketDetail }>()
  const emit = defineEmits<{ updated: [ticket: TicketDetail] }>()

  const toast = useToast()

  const statusItems = ticketStatuses.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))

  const selectedStatus = ref<TicketStatus>(props.ticket.status as TicketStatus)
  const saving = ref(false)

  const isDirty = computed(() => selectedStatus.value !== props.ticket.status)

  async function save() {
    if (!isDirty.value || saving.value) return
    saving.value = true
    try {
      const updated = await $fetch<TicketDetail>(`/api/tickets/${props.ticket.id}/status`, {
        method: 'PATCH',
        body: { status: selectedStatus.value },
      })
      emit('updated', updated)
      toast.add({ title: 'Status updated', color: 'success' })
    } catch {
      // Revert select to the last confirmed status.
      selectedStatus.value = props.ticket.status as TicketStatus
      toast.add({ title: 'Could not update status', color: 'error' })
    } finally {
      saving.value = false
    }
  }
</script>

<template>
  <div class="flex items-center gap-2">
    <USelect
      v-model="selectedStatus"
      :items="statusItems"
      value-key="value"
      :disabled="saving"
    />
    <UButton :disabled="!isDirty || saving" @click="save">
      {{ saving ? 'Saving…' : 'Update status' }}
    </UButton>
  </div>
</template>

