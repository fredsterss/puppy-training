import { describe, expect, it } from 'vitest'
import { eventsToday, formatRelativeTime, nextPottyAt, searchArticles } from './domain'
import type { Article, PuppyEvent } from './types'

const articles: Article[] = [
  { id: 'crate', path: '', title: 'Crate Training', topic: 'Core training', caution: '', body: '', text: 'Teach quiet behavior in a crate.', checklistItems: [] },
  { id: 'food', path: '', title: 'Healthy Food', topic: 'Nutrition', caution: '', body: '', text: 'Feeding a puppy safely.', checklistItems: [] },
  { id: 'breed', path: '', title: 'Havanese', topic: 'Breed reference', caution: '', body: '', text: 'A companion dog profile.', checklistItems: [] }
]

describe('searchArticles', () => {
  it('returns all articles for an empty query', () => expect(searchArticles(articles, '')).toEqual(articles))
  it('requires every query term to match', () => expect(searchArticles(articles, 'crate quiet').map(({ id }) => id)).toEqual(['crate']))
  it('ranks title matches over body matches', () => expect(searchArticles(articles, 'food').map(({ id }) => id)).toEqual(['food']))
  it('returns an empty list for no match', () => expect(searchArticles(articles, 'parrot')).toEqual([]))
})

describe('care summaries', () => {
  const now = new Date('2026-08-10T12:00:00Z')
  const events: PuppyEvent[] = [
    { type: 'pee', occurredAt: '2026-08-10T11:20:00Z' },
    { type: 'poo', occurredAt: '2026-08-09T23:55:00Z' }
  ]

  it('derives the next check from the most recent pee', () => expect(nextPottyAt(events)?.toISOString()).toBe('2026-08-10T12:20:00.000Z'))
  it('does not invent a time before the first pee', () => expect(nextPottyAt([])).toBeUndefined())
  it('formats elapsed time at minute and hour boundaries', () => {
    expect(formatRelativeTime('2026-08-10T11:59:45Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-08-10T11:42:00Z', now)).toBe('18m ago')
    expect(formatRelativeTime('2026-08-10T10:35:00Z', now)).toBe('1h 25m ago')
  })
  it('filters events using the local day boundary', () => {
    const localNoon = new Date(2026, 7, 10, 12)
    const today = new Date(2026, 7, 10, 1).toISOString()
    const yesterday = new Date(2026, 7, 9, 23, 59).toISOString()
    expect(eventsToday([{ type: 'pee', occurredAt: today }, { type: 'poo', occurredAt: yesterday }], localNoon)).toHaveLength(1)
  })
})
