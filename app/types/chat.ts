import type { ChatWireMessage } from '#shared/types/chat'

export type { ChatWireMessage }

export interface ChatAdapter {
  /**
   * Loads a page of messages ordered oldest first. `after` is an exclusive id
   * cursor used to catch up after a reconnect; `before` pages backwards through
   * older history.
   */
  loadMessages(options?: { after?: number, before?: number }): Promise<ChatMessagePage>
  /** Persists a message and returns the stored row. */
  sendMessage(body: string): Promise<ChatWireMessage>
  /** Opens a live feed and returns an unsubscribe function. */
  subscribe?(handlers: ChatSubscriptionHandlers): () => void
}

export type ChatMessagePage = {
  messages: ChatWireMessage[]
  metadata: {
    hasMore: boolean
  }
}

export type ChatConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

export type ChatSubscriptionHandlers = {
  onMessage: (message: ChatWireMessage) => void
  onStatusChange?: (status: ChatConnectionStatus) => void
  /**
   * Called when the server's live feed is ready, initially and after reconnect.
   * The consumer reconciles any gap after its initial history has loaded.
   */
  onResync?: () => void | Promise<void>
}
