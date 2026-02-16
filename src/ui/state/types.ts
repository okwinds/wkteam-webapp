export type TabKey = 'chats' | 'contacts' | 'discover' | 'me'

export type ThemeSetting = 'light' | 'dark' | 'system'
export type FontSizeSetting = 'small' | 'medium' | 'large'
export type SendKeyBehavior = 'enter_to_send' | 'ctrl_enter_to_send'

export type ToastKind = 'info' | 'error'

export type ToastItem = {
  id: string
  kind: ToastKind
  title: string
  detail?: string
}

export type User = {
  id: string
  displayName: string
  avatarSeed: string
  statusText: string
}

export type Contact = {
  id: string
  displayName: string
  avatarSeed: string
  note?: string
  signature?: string
}

export type MessageDirection = 'inbound' | 'outbound'

export type TextMessage = {
  id: string
  conversationId: string
  direction: MessageDirection
  sentAt: number
  kind: 'text'
  text: string
}

export type ImageMessage = {
  id: string
  conversationId: string
  direction: MessageDirection
  sentAt: number
  kind: 'image'
  image: {
    dataUrl: string
    alt: string
  }
}

export type FileMessage = {
  id: string
  conversationId: string
  direction: MessageDirection
  sentAt: number
  kind: 'file'
  file: {
    name: string
    mime: string
    dataUrl: string
  }
}

export type Message = TextMessage | ImageMessage | FileMessage

export type Conversation = {
  id: string
  title: string
  peerContactId: string
  pinned: boolean
  unreadCount: number
  lastMessageId: string
  lastActivityAt: number
  draftText: string
}

export type Settings = {
  theme: ThemeSetting
  fontSize: FontSizeSetting
  sendKeyBehavior: SendKeyBehavior
}

export type PersistedStateV1 = {
  schemaVersion: 1
  updatedAt: number
  activeTab: TabKey
  selectedConversationId: string | null
  selectedContactId: string | null
  settings: Settings
  me: User
  contacts: Contact[]
  conversations: Conversation[]
  messages: Array<{
    id: string
    conversationId: string
    direction: MessageDirection
    text: string
    sentAt: number
  }>
}

export type PersistedStateV2 = {
  schemaVersion: 2
  updatedAt: number
  activeTab: TabKey
  selectedConversationId: string | null
  selectedContactId: string | null
  settings: Settings
  me: User
  contacts: Contact[]
  conversations: Conversation[]
  messages: Message[]
}

export type AppState = {
  persisted: PersistedStateV2
  toasts: ToastItem[]
}
