import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { db, getPreference, setPreference } from './db'
import { eventsToday, formatRelativeTime, labelForEvent, mostRecent, nextPottyAt, searchArticles } from './domain'
import type { Article, ArticleBundle, ChecklistProgress, EventType, PuppyEvent, Screen } from './types'

const screens: Array<{ id: Screen; label: string; icon: string }> = [
  { id: 'today', label: 'Today', icon: '⌂' },
  { id: 'learn', label: 'Learn', icon: '⌕' },
  { id: 'train', label: 'Train', icon: '✓' },
  { id: 'log', label: 'Log', icon: '+' }
]

const quickEvents: Array<{ type: EventType; icon: string }> = [
  { type: 'pee', icon: '💧' },
  { type: 'poo', icon: '●' },
  { type: 'food', icon: '◒' },
  { type: 'water', icon: '◡' },
  { type: 'sleep', icon: '☾' },
  { type: 'wake', icon: '☀' }
]

function App() {
  const [articles, setArticles] = useState<Article[]>([])
  const [screen, setScreen] = useState<Screen>('today')
  const [selectedArticleId, setSelectedArticleId] = useState<string>()
  const [query, setQuery] = useState('')
  const [events, setEvents] = useState<PuppyEvent[]>([])
  const [progress, setProgress] = useState<Map<string, ChecklistProgress>>(new Map())
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState<string>()
  const readerRef = useRef<HTMLElement>(null)
  const scrollSaveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    async function load() {
      try {
        const [bundleResponse, savedScreen, savedArticle, savedEvents, savedProgress] = await Promise.all([
          fetch('./content/articles.json'),
          getPreference<Screen>('lastScreen', 'today'),
          getPreference<string | undefined>('lastArticleId', undefined),
          db.events.orderBy('occurredAt').reverse().toArray(),
          db.checklistProgress.toArray()
        ])
        if (!bundleResponse.ok) throw new Error('The training library could not be loaded.')
        const bundle = await bundleResponse.json() as ArticleBundle
        setArticles(bundle.articles)
        setScreen(savedScreen)
        setSelectedArticleId(savedArticle && bundle.articles.some(({ id }) => id === savedArticle) ? savedArticle : undefined)
        setEvents(savedEvents)
        setProgress(new Map(savedProgress.map((item) => [item.id, item])))
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'The app could not load its saved data.')
      } finally {
        setReady(true)
      }
    }
    void load()
  }, [])

  const selectedArticle = articles.find(({ id }) => id === selectedArticleId)
  const checklistArticle = articles.find(({ checklistItems }) => checklistItems.length > 0)
  const results = useMemo(() => searchArticles(articles, query).slice(0, query ? 60 : 30), [articles, query])
  const todayEvents = useMemo(() => eventsToday(events), [events])
  const nextPotty = useMemo(() => nextPottyAt(events), [events])
  const completedCount = checklistArticle?.checklistItems.filter(({ id }) => progress.get(id)?.completed).length ?? 0

  const navigate = useCallback((destination: Screen) => {
    setScreen(destination)
    if (destination !== 'learn') setSelectedArticleId(undefined)
    void setPreference('lastScreen', destination)
  }, [])

  const openArticle = useCallback(async (article: Article) => {
    setScreen('learn')
    setSelectedArticleId(article.id)
    await Promise.all([
      setPreference('lastScreen', 'learn'),
      setPreference('lastArticleId', article.id)
    ])
    window.setTimeout(async () => {
      const offset = await getPreference<number>(`readerScroll:${article.id}`, 0)
      readerRef.current?.scrollTo({ top: offset })
    }, 0)
  }, [])

  const saveReaderPosition = useCallback(() => {
    if (!selectedArticleId || !readerRef.current) return
    window.clearTimeout(scrollSaveTimer.current)
    const offset = readerRef.current.scrollTop
    scrollSaveTimer.current = window.setTimeout(() => {
      void setPreference(`readerScroll:${selectedArticleId}`, offset)
    }, 120)
  }, [selectedArticleId])

  useEffect(() => {
    if (!selectedArticleId || !readerRef.current) return
    void getPreference<number>(`readerScroll:${selectedArticleId}`, 0).then((offset) => {
      readerRef.current?.scrollTo({ top: offset })
    })
  }, [selectedArticleId, ready])

  const addEvent = useCallback(async (type: EventType) => {
    try {
      const event: PuppyEvent = { type, occurredAt: new Date().toISOString() }
      const id = await db.events.add(event)
      setEvents((current) => [{ ...event, id }, ...current])
      setMessage(`${labelForEvent(type)} logged`)
      window.setTimeout(() => setMessage(undefined), 1800)
    } catch {
      setMessage('Could not save that event. Check available device storage and try again.')
    }
  }, [])

  const toggleChecklist = useCallback(async (id: string) => {
    const completed = !progress.get(id)?.completed
    const item: ChecklistProgress = {
      id,
      completed,
      completedAt: completed ? new Date().toISOString() : undefined
    }
    try {
      await db.checklistProgress.put(item)
      setProgress((current) => new Map(current).set(id, item))
    } catch {
      setMessage('Could not save training progress. Please try again.')
    }
  }, [progress])

  const removeEvent = useCallback(async (event: PuppyEvent) => {
    if (event.id === undefined) return
    try {
      await db.events.delete(event.id)
      setEvents((current) => current.filter(({ id }) => id !== event.id))
      setMessage(`${labelForEvent(event.type)} entry removed`)
      window.setTimeout(() => setMessage(undefined), 1800)
    } catch {
      setMessage('Could not remove that entry. Please try again.')
    }
  }, [])

  if (!ready) return <main className="loading"><div className="loader" /><p>Preparing your puppy companion…</p></main>

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Puppy companion</p>
          <h1>{screen === 'today' ? 'Good day, pup' : screens.find(({ id }) => id === screen)?.label}</h1>
        </div>
        <div className="avatar" aria-hidden="true">🐾</div>
      </header>

      {message && <div className="toast" role="status">{message}</div>}

      <main className="main-content">
        {screen === 'today' && (
          <section className="page today-page">
            <div className="hero-card">
              <p className="card-kicker">Next potty check</p>
              <strong>{nextPotty ? nextPotty.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Log the first pee'}</strong>
              <span>{nextPotty ? (nextPotty.getTime() <= Date.now() ? 'It may be time to head outside.' : 'Based on a 60-minute starter interval.') : 'We’ll estimate the next check from there.'}</span>
            </div>

            <section className="section-block">
              <div className="section-heading"><h2>Quick log</h2><button onClick={() => navigate('log')}>History</button></div>
              <div className="quick-grid">
                {quickEvents.slice(0, 4).map(({ type, icon }) => (
                  <button className="quick-button" key={type} onClick={() => void addEvent(type)}>
                    <span>{icon}</span>{labelForEvent(type)}
                  </button>
                ))}
              </div>
            </section>

            <section className="summary-grid">
              {(['pee', 'poo', 'food'] as EventType[]).map((type) => {
                const latest = mostRecent(events, type)
                return <article className="mini-card" key={type}><span>{labelForEvent(type)}</span><strong>{todayEvents.filter((event) => event.type === type).length}</strong><small>{latest ? formatRelativeTime(latest.occurredAt) : 'none yet'}</small></article>
              })}
            </section>

            <button className="training-card" onClick={() => navigate('train')}>
              <span><small>Training plan</small><strong>{completedCount} of {checklistArticle?.checklistItems.length ?? 23} skills complete</strong></span>
              <span className="arrow">→</span>
            </button>

            <section className="section-block">
              <div className="section-heading"><h2>Continue learning</h2><button onClick={() => navigate('learn')}>See all</button></div>
              {articles.filter(({ path }) => path.includes('training/articles')).slice(0, 3).map((article) => (
                <button className="article-row" key={article.id} onClick={() => void openArticle(article)}>
                  <span><small>{article.topic}</small><strong>{article.title}</strong></span><span>›</span>
                </button>
              ))}
            </section>
          </section>
        )}

        {screen === 'learn' && !selectedArticle && (
          <section className="page learn-page">
            <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search training, care, breeds…" autoFocus /></label>
            <p className="result-count">{query ? `${results.length} best matches` : `${articles.length} offline articles`}</p>
            <div className="article-list">
              {results.map((article) => (
                <button className="article-card" key={article.id} onClick={() => void openArticle(article)}>
                  <small>{article.topic}</small><strong>{article.title}</strong><p>{article.text.slice(0, 145)}…</p>
                </button>
              ))}
              {!results.length && <div className="empty-state"><strong>No matches</strong><p>Try a shorter phrase or a different training word.</p></div>}
            </div>
          </section>
        )}

        {screen === 'learn' && selectedArticle && (
          <section className="reader" ref={readerRef} onScroll={saveReaderPosition}>
            <button className="back-button" onClick={() => { setSelectedArticleId(undefined); void setPreference('lastArticleId', undefined) }}>← Library</button>
            <p className="eyebrow">{selectedArticle.topic}</p>
            {selectedArticle.caution && <p className="caution">Archived guidance: {selectedArticle.caution}</p>}
            <article dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(selectedArticle.body) as string) }} />
          </section>
        )}

        {screen === 'train' && (
          <section className="page train-page">
            <div className="progress-card"><span>{completedCount}/{checklistArticle?.checklistItems.length ?? 0}</span><div><strong>Perfect puppy manners</strong><p>Tap a skill when your puppy can do it consistently.</p></div></div>
            <div className="progress-track"><span style={{ width: `${checklistArticle?.checklistItems.length ? completedCount / checklistArticle.checklistItems.length * 100 : 0}%` }} /></div>
            <div className="checklist">
              {checklistArticle?.checklistItems.map((item, index) => {
                const complete = progress.get(item.id)?.completed ?? false
                return <label className={`check-item ${complete ? 'complete' : ''}`} key={item.id}><input type="checkbox" checked={complete} onChange={() => void toggleChecklist(item.id)} /><span className="checkmark">{complete ? '✓' : index + 1}</span><span>{item.text}</span></label>
              })}
            </div>
          </section>
        )}

        {screen === 'log' && (
          <section className="page log-page">
            <div className="quick-grid log-grid">
              {quickEvents.map(({ type, icon }) => <button className="quick-button" key={type} onClick={() => void addEvent(type)}><span>{icon}</span>{labelForEvent(type)}</button>)}
            </div>
            <div className="section-heading"><h2>Recent activity</h2><span>{events.length} total</span></div>
            <div className="timeline">
              {events.slice(0, 100).map((event) => (
                <article key={event.id}><span className={`event-dot ${event.type}`} /> <div><strong>{labelForEvent(event.type)}</strong><small>{new Date(event.occurredAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small></div><span>{formatRelativeTime(event.occurredAt)}</span><button className="delete-event" aria-label={`Remove ${labelForEvent(event.type)} entry`} onClick={() => void removeEvent(event)}>×</button></article>
              ))}
              {!events.length && <div className="empty-state"><strong>No activity yet</strong><p>Use a button above to start today’s log.</p></div>}
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {screens.map((item) => <button key={item.id} className={screen === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span>{item.icon}</span>{item.label}</button>)}
      </nav>
    </div>
  )
}

export default App
