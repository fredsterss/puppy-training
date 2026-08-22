import { describe, expect, it } from 'vitest'
import { bladderHoldHours, eventsToday, filterArticlesByView, formatPottyCountdown, formatRelativeTime, formatViewSummary, labelForEvent, labelForPooConsistency, nextPottyAt, normalizeTags, pooConsistencyOptions, puppyAgeInMonths, searchArticles } from './domain'
import type { Article, ArticleView, PuppyEvent } from './types'

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

describe('article view history', () => {
  const views = new Map<string, ArticleView>([
    ['crate', { articleId: 'crate', viewCount: 2, lastViewedAt: '2026-08-10T11:00:00Z' }],
    ['food', { articleId: 'food', viewCount: 1, lastViewedAt: '2026-08-10T11:30:00Z' }]
  ])

  it('filters viewed and unread articles', () => {
    expect(filterArticlesByView(articles, views, 'viewed').map(({ id }) => id)).toEqual(['crate', 'food'])
    expect(filterArticlesByView(articles, views, 'unread').map(({ id }) => id)).toEqual(['breed'])
  })

  it('sorts recent articles newest first', () => {
    expect(filterArticlesByView(articles, views, 'recent').map(({ id }) => id)).toEqual(['food', 'crate'])
  })

  it('formats count and last viewed time', () => {
    expect(formatViewSummary(views.get('crate')!, new Date('2026-08-10T12:00:00Z'))).toBe('2 views · 1h 0m ago')
    expect(formatViewSummary(views.get('food')!, new Date('2026-08-10T12:00:00Z'))).toBe('1 view · 30m ago')
  })
})

describe('care summaries', () => {
  const now = new Date('2026-08-10T12:00:00Z')
  const birthDate = new Date(2026, 5, 8)
  const events: PuppyEvent[] = [
    { syncId: 'pee-1', type: 'pee', occurredAt: '2026-08-10T11:20:00Z', updatedAt: '2026-08-10T11:20:00Z', syncState: 'synced' },
    { syncId: 'poo-1', type: 'poo', occurredAt: '2026-08-09T23:55:00Z', updatedAt: '2026-08-09T23:55:00Z', syncState: 'synced' }
  ]

  it('uses completed months plus one hour for the bladder interval', () => {
    expect(puppyAgeInMonths(birthDate, now)).toBe(2)
    expect(bladderHoldHours(birthDate, now)).toBe(3)
    expect(puppyAgeInMonths(birthDate, new Date(2026, 8, 7, 23, 59, 59))).toBe(2)
    expect(puppyAgeInMonths(birthDate, new Date(2026, 8, 8))).toBe(3)
  })
  it('derives the next check from the latest pee and age-based interval', () => expect(nextPottyAt(events, birthDate, now)?.toISOString()).toBe('2026-08-10T14:20:00.000Z'))
  it('does not invent a time before the first pee', () => expect(nextPottyAt([], birthDate, now)).toBeUndefined())
  it('formats a live remaining or overdue countdown', () => {
    const deadline = new Date('2026-08-10T14:20:00Z')
    expect(formatPottyCountdown(deadline, now)).toBe('2h 20m 0s remaining')
    expect(formatPottyCountdown(deadline, new Date('2026-08-10T14:20:08Z'))).toBe('Outside now · overdue by 8s')
  })
  it('formats elapsed time at minute and hour boundaries', () => {
    expect(formatRelativeTime('2026-08-10T11:59:45Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-08-10T11:42:00Z', now)).toBe('18m ago')
    expect(formatRelativeTime('2026-08-10T10:35:00Z', now)).toBe('1h 25m ago')
  })
  it('filters events using the local day boundary', () => {
    const localNoon = new Date(2026, 7, 10, 12)
    const today = new Date(2026, 7, 10, 1).toISOString()
    const yesterday = new Date(2026, 7, 9, 23, 59).toISOString()
    expect(eventsToday([
      { syncId: 'today', type: 'pee', occurredAt: today, updatedAt: today, syncState: 'synced' },
      { syncId: 'yesterday', type: 'poo', occurredAt: yesterday, updatedAt: yesterday, syncState: 'synced' }
    ], localNoon)).toHaveLength(1)
  })
  it('labels a food timestamp as eaten', () => expect(labelForEvent('food')).toBe('Ate'))
  it('offers and labels the supported poo consistencies', () => {
    expect(pooConsistencyOptions.map(({ value }) => value)).toEqual(['firm', 'normal', 'soft', 'watery'])
    expect(labelForPooConsistency('soft')).toBe('Soft')
  })
  it('normalizes arbitrary accident tags', () => {
    expect(normalizeTags(' rug, #upstairs, Rug, after nap ')).toEqual(['rug', 'upstairs', 'after nap'])
  })
})
