import { onChatMemberJoined, onChatMessage, onChatThreadCreated } from '../utils/chat/events'
import { publishChatMessage, publishThreadCreated, subscribeUserToThread, toWireMessage } from '../utils/chat/ws'

export default defineNitroPlugin(() => {
  onChatMemberJoined(({ userId, threadId }) => subscribeUserToThread(userId, threadId))
  onChatMessage(({ message }) => {
    publishChatMessage(message.threadId, toWireMessage(message))
  })

  onChatThreadCreated(({ thread, memberIds }) => {
    publishThreadCreated(thread, memberIds)
  })
})
