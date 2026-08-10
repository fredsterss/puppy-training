import Dexie, { type EntityTable } from 'dexie'
import type { ArticleView, ChecklistProgress, Preference, PuppyEvent } from './types'

class PuppyDatabase extends Dexie {
  events!: EntityTable<PuppyEvent, 'id'>
  checklistProgress!: EntityTable<ChecklistProgress, 'id'>
  preferences!: EntityTable<Preference, 'key'>
  articleViews!: EntityTable<ArticleView, 'articleId'>

  constructor() {
    super('puppy-companion')
    this.version(1).stores({
      events: '++id, type, occurredAt',
      checklistProgress: 'id, completed, completedAt',
      preferences: 'key'
    })
    this.version(2).stores({
      events: '++id, type, occurredAt',
      checklistProgress: 'id, completed, completedAt',
      preferences: 'key',
      articleViews: 'articleId, lastViewedAt'
    })
  }
}

export const db = new PuppyDatabase()

export async function getPreference<T>(key: string, fallback: T): Promise<T> {
  const item = await db.preferences.get(key)
  return item ? item.value as T : fallback
}

export async function setPreference<T>(key: string, value: T): Promise<void> {
  await db.preferences.put({ key, value })
}
