<script setup lang="ts">
  import { nextTick, onMounted, ref, useId, watch } from 'vue'
  import { CHAT_MESSAGE_COUNTER_THRESHOLD, CHAT_MESSAGE_MAX_LENGTH } from '#shared/chat-limits'

  defineProps<{ disabled?: boolean, label?: string }>()
  const value = defineModel<string>({ default: '' })
  const textarea = ref<HTMLTextAreaElement | null>(null)
  const mirror = ref<HTMLElement | null>(null)
  const id = useId()

  function resize() {
    const element = textarea.value
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 192)}px`
    syncScroll()
  }

  function syncScroll() {
    if (mirror.value && textarea.value) {
      mirror.value.scrollTop = textarea.value.scrollTop
      mirror.value.scrollLeft = textarea.value.scrollLeft
    }
  }

  watch(value, () => { void nextTick(resize) })
  onMounted(resize)
</script>

<template>
  <div class="relative w-full">
    <label :for="id" class="sr-only">{{ label ?? 'Message' }}</label>
    <div ref="mirror" aria-hidden="true" class="message-input-text pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap wrap-break-word text-transparent"><span>{{ value.slice(0, CHAT_MESSAGE_MAX_LENGTH) }}</span><mark class="rounded-sm bg-red-300/60 text-transparent dark:bg-red-500/40">{{ value.slice(CHAT_MESSAGE_MAX_LENGTH) }}</mark></div>
    <textarea
      :id="id" ref="textarea" v-model="value" :disabled="disabled" rows="2"
      placeholder="Write a message…" :aria-invalid="value.length > CHAT_MESSAGE_MAX_LENGTH ? 'true' : undefined"
      :aria-describedby="value.length >= CHAT_MESSAGE_COUNTER_THRESHOLD ? `${id}-counter` : undefined"
      class="message-input-text relative block w-full resize-none rounded-b-md bg-transparent text-sm text-highlighted outline outline-1 outline-default placeholder:text-dimmed focus:outline-2 focus:outline-primary disabled:cursor-not-allowed disabled:opacity-75"
      @input="resize" @scroll="syncScroll"
    />
    <span v-if="value.length >= CHAT_MESSAGE_COUNTER_THRESHOLD" :id="`${id}-counter`" role="status" class="pointer-events-none absolute right-14 bottom-2 rounded bg-default px-1 text-xs tabular-nums" :class="value.length > CHAT_MESSAGE_MAX_LENGTH ? 'text-red-600 dark:text-red-400' : 'text-muted'">{{ value.length }} / {{ CHAT_MESSAGE_MAX_LENGTH }}</span>
    <slot />
  </div>
</template>

<style scoped>
.message-input-text {
  box-sizing: border-box;
  min-height: 76px;
  max-height: 192px;
  padding: 8px 56px 32px 12px;
  font: inherit;
  font-size: 0.875rem;
  line-height: 1.25rem;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}
</style>
