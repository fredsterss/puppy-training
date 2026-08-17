import type { Article, ArticleView, ArticleViewFilter, EventType, PuppyEvent } from './types'

const eventLabels: Record<EventType, string> = {
  pee: 'Pee',
  poo: 'Poo',
  food: 'Ate',
  accident: 'Accident',
  water: 'Water',
  sleep: 'Sleep',
  wake: 'Wake'
}

export function labelForEvent(type: EventType): string {
  return eventLabels[type]
}

export function normalizeTags(rawTags: string): string[] {
  const seen = new Set<string>()
  return rawTags
    .split(',')
    .map((tag) => tag.trim().replace(/^#+/, '').replace(/\s+/g, ' '))
    .filter((tag) => {
      const key = tag.toLocaleLowerCase()
      if (!tag || seen.has(key)) return false
      seen.add(key)
      return true
    })
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

export function filterArticlesByView(
  articles: Article[],
  views: ReadonlyMap<string, ArticleView>,
  filter: ArticleViewFilter
): Article[] {
  if (filter === 'all') return articles
  if (filter === 'unread') return articles.filter(({ id }) => !views.has(id))

  const viewed = articles.filter(({ id }) => views.has(id))
  if (filter === 'recent') {
    return viewed.sort((a, b) => views.get(b.id)!.lastViewedAt.localeCompare(views.get(a.id)!.lastViewedAt))
  }
  return viewed
}

export function formatViewSummary(view: ArticleView, now = new Date()): string {
  const noun = view.viewCount === 1 ? 'view' : 'views'
  return `${view.viewCount} ${noun} · ${formatRelativeTime(view.lastViewedAt, now)}`
}

export function mostRecent(events: PuppyEvent[], type: EventType): PuppyEvent | undefined {
  return events
    .filter((event) => event.type === type)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]
}

export function puppyAgeInMonths(birthDate: Date, now = new Date()): number {
  if (now.getTime() < birthDate.getTime()) return 0

  let months = (now.getFullYear() - birthDate.getFullYear()) * 12 + now.getMonth() - birthDate.getMonth()
  if (now.getDate() < birthDate.getDate()) months -= 1
  return Math.max(0, months)
}

export function bladderHoldHours(birthDate: Date, now = new Date()): number {
  return puppyAgeInMonths(birthDate, now) + 1
}

export function nextPottyAt(events: PuppyEvent[], birthDate: Date, now = new Date()): Date | undefined {
  const lastPee = mostRecent(events, 'pee')
  if (!lastPee) return undefined
  return new Date(new Date(lastPee.occurredAt).getTime() + bladderHoldHours(birthDate, now) * 60 * 60_000)
}

export function formatPottyCountdown(deadline: Date, now = new Date()): string {
  const remainingSeconds = Math.ceil((deadline.getTime() - now.getTime()) / 1_000)
  const overdue = remainingSeconds <= 0
  let seconds = Math.abs(remainingSeconds)
  const hours = Math.floor(seconds / 3_600)
  seconds %= 3_600
  const minutes = Math.floor(seconds / 60)
  seconds %= 60
  const parts = [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${seconds}s`].filter(Boolean).join(' ')
  return overdue ? `Outside now · overdue by ${parts}` : `${parts} remaining`
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
