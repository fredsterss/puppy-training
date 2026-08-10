import type { Article, EventType, PuppyEvent } from './types'

const eventLabels: Record<EventType, string> = {
  pee: 'Pee',
  poo: 'Poo',
  food: 'Food',
  water: 'Water',
  sleep: 'Sleep',
  wake: 'Wake'
}

export function labelForEvent(type: EventType): string {
  return eventLabels[type]
}

export function searchArticles(articles: Article[], rawQuery: string): Article[] {
  const terms = rawQuery.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return articles

  return articles
    .map((article) => {
      const title = article.title.toLocaleLowerCase()
      const text = article.text.toLocaleLowerCase()
      const topic = article.topic.toLocaleLowerCase()
      if (!terms.every((term) => title.includes(term) || text.includes(term) || topic.includes(term))) {
        return { article, score: -1 }
      }
      const score = terms.reduce((total, term) => {
        if (title === term) return total + 20
        if (title.includes(term)) return total + 8
        if (topic.includes(term)) return total + 3
        return total + 1
      }, 0)
      return { article, score }
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title))
    .map(({ article }) => article)
}

export function mostRecent(events: PuppyEvent[], type: EventType): PuppyEvent | undefined {
  return events
    .filter((event) => event.type === type)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]
}

export function nextPottyAt(events: PuppyEvent[], intervalMinutes = 60): Date | undefined {
  const lastPee = mostRecent(events, 'pee')
  if (!lastPee) return undefined
  return new Date(new Date(lastPee.occurredAt).getTime() + intervalMinutes * 60_000)
}

export function formatRelativeTime(isoDate: string, now = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(isoDate).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function eventsToday(events: PuppyEvent[], now = new Date()): PuppyEvent[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return events.filter((event) => new Date(event.occurredAt).getTime() >= start)
}
