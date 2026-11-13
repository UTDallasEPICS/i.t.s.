export type ChatWireMessage = {
  id: number
  threadId: number
  userId: string
  plainTextBody: string
  createdAt: string
}

export type ChatWireThread = {
  id: number
  name: string | null
  projectId: number
  createdAt: string
  closedAt: string | null
}

export type ChatServerFrame =
  | { type: 'ready' }
  | { type: 'message.created', message: ChatWireMessage }
  | { type: 'thread.created', thread: ChatWireThread }
  | { type: 'ping' }
  | { type: 'pong' }

export type ConversationView = {
  id: number
  name: string | null
  projectId: number
  projectName: string
  organizationName: string
  isMember: boolean
  closedAt: string | null
  members: ConversationMember[]
  latestMessage: ConversationLatestMessage | null
}

export type ConversationMember = {
  id: string
  name: string
  organizationName: string | null
}

export type ConversationLatestMessage = {
  id: number
  plainTextBody: string
  senderName: string
}

export type PersonView = {
  id: string
  name: string
  email: string
  orgId: string | null
  organizationName: string | null
}

export type ProjectView = {
  id: number
  name: string
  orgId: string
}
