export type EventType = 'pee' | 'poo' | 'food' | 'water' | 'sleep' | 'wake'
export type Screen = 'today' | 'learn' | 'train' | 'log'

export interface ChecklistItem {
  id: string
  text: string
}

export interface Article {
  id: string
  path: string
  title: string
  topic: string
  caution: string
  body: string
  text: string
  checklistItems: ChecklistItem[]
}

export interface ArticleBundle {
  generatedAt: string
  articles: Article[]
}

export interface PuppyEvent {
  id?: number
  type: EventType
  occurredAt: string
  amount?: number
  note?: string
}

export interface ChecklistProgress {
  id: string
  completed: boolean
  completedAt?: string
}

export interface Preference {
  key: string
  value: unknown
}
