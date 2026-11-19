import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type { ChatAdapter, ChatConnectionStatus, ChatWireMessage } from '../types/chat'

export type ChatLoadState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * State and lifecycle for one chat thread, independent of where the messages
 * come from or who the user is.
 *
 * `adapter` is expected to be stable for the lifetime of the composable. Swapping
 * threads should recreate the caller (for example with `:key="threadId"`), which
 * also tears down the socket cleanly through `onScopeDispose`.
 */
export function useChatThread(adapter: ChatAdapter) {
  const messages = ref<ChatWireMessage[]>([])
  const loadState = ref<ChatLoadState>('idle')
  const loadError = ref('')
  const sendError = ref('')
  const sending = ref(false)
  const connection = ref<ChatConnectionStatus>('offline')
  const hasMore = ref(false)
  const loadingOlder = ref(false)

  let unsubscribe: (() => void) | undefined
  let historyLoaded = false
  let historyCursor = 0
  let resyncPending = false
  let resyncing = false

  const lastMessageId = computed(() => messages.value[messages.value.length - 1]?.id ?? 0)

  /** Appends anything unseen and keeps the list in server order. */
  function mergeMessages(incoming: ChatWireMessage[]) {
    if (incoming.length === 0) return

    const seen = new Set(messages.value.map((message) => message.id))
    const fresh = incoming.filter((message) => !seen.has(message.id))
    if (fresh.length === 0) return

    messages.value = [...messages.value, ...fresh].sort((a, b) => a.id - b.id)
  }

  async function loadHistory() {
    const page = await adapter.loadMessages()
    mergeMessages(page.messages)
    historyCursor = Math.max(historyCursor, ...page.messages.map(message => message.id))
    hasMore.value = page.metadata.hasMore
  }

  /** Fetches the page before the oldest loaded message, for scroll-up. */
  async function loadOlder() {
    if (loadingOlder.value || !hasMore.value) return false

    const oldestId = messages.value[0]?.id
    if (oldestId === undefined) return false

    loadingOlder.value = true
    try {
      const page = await adapter.loadMessages({ before: oldestId })
      mergeMessages(page.messages)
      hasMore.value = page.metadata.hasMore
      return page.messages.length > 0
    } finally {
      loadingOlder.value = false
    }
  }

  /** Only HTTP history advances this cursor: a newer live event may hide a gap. */
  async function catchUp() {
    // Bound each batch, not the total gap: live traffic can leave this cursor far behind.
    for (let page = 0; page < 100 && historyLoaded; page += 1) {
      const cursor = historyCursor || undefined
      const result = await adapter.loadMessages(cursor === undefined ? undefined : { after: cursor })
      mergeMessages(result.messages)
      historyCursor = Math.max(historyCursor, ...result.messages.map(message => message.id))

      // A broken hasMore response must not keep scheduling batches forever.
      if (!result.metadata.hasMore || historyCursor <= (cursor ?? 0)) return false
    }
    return historyLoaded
  }

  async function resync() {
    resyncPending = true
    if (!historyLoaded || resyncing) return
    resyncing = true
    try {
      while (resyncPending && historyLoaded) {
        resyncPending = false
        try {
          if (await catchUp()) {
            resyncPending = true
            // Let rendering and newer ready frames run between advancing batches.
            await new Promise(resolve => setTimeout(resolve, 0))
          }
        } catch {
          // Only retry if another ready was explicitly queued during this request.
        }
      }
    } finally {
      resyncing = false
    }
  }

  function connect() {
    // Some adapters are snapshot-only; there is nothing to reconnect to.
    if (!adapter.subscribe) {
      connection.value = 'offline'
      return
    }

    unsubscribe = adapter.subscribe({
      onMessage: (message) => mergeMessages([message]),
      onStatusChange: (status) => {
        connection.value = status
      },
      onResync: resync,
    })
  }

  async function start() {
    if (loadState.value === 'loading' || loadState.value === 'ready') return

    loadState.value = 'loading'
    loadError.value = ''

    connect()

    try {
      await loadHistory()
      historyLoaded = true
      if (resyncPending) await resync()
      loadState.value = 'ready'
    } catch {
      stop()
      loadState.value = 'error'
      loadError.value = 'We could not load this conversation. Please try again.'
    }
  }

  async function retry() {
    loadState.value = 'idle'
    await start()
  }

  async function sendMessage(body: string) {
    const trimmed = body.trim()
    if (!trimmed || sending.value) return false

    sending.value = true
    sendError.value = ''

    try {
      mergeMessages([await adapter.sendMessage(trimmed)])
      return true
    } catch {
      sendError.value =
        'We could not send your message. Your draft is still here. Please try again.'
      return false
    } finally {
      sending.value = false
    }
  }

  function stop() {
    historyLoaded = false
    resyncPending = false
    unsubscribe?.()
    unsubscribe = undefined
  }

  if (getCurrentScope()) onScopeDispose(stop)

  return {
    messages,
    loadState,
    loadError,
    sendError,
    sending,
    connection,
    hasMore,
    loadingOlder,
    lastMessageId,
    start,
    retry,
    loadOlder,
    sendMessage,
    stop,
  }
}
