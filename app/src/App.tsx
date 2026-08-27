import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { cloudConfigured, createPhoneInvite, loadMembership, subscribeToHousehold, syncEvents, unsubscribeFromHousehold } from './cloud'
import { db, getPreference, setPreference } from './db'
import { bladderHoldHours, buildPottyDetailChanges, eventsToday, filterArticlesByView, formatPottyCountdown, formatRelativeTime, formatViewSummary, labelForEvent, labelForPooConsistency, mostRecent, nextPottyAt, pooConsistencyOptions, puppyAgeInMonths, searchArticles } from './domain'
import type { Article, ArticleBundle, ArticleView, ArticleViewFilter, ChecklistProgress, EventType, HouseholdMembership, PooConsistency, PuppyEvent, Screen } from './types'

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

const viewFilters: Array<{ id: ArticleViewFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'viewed', label: 'Viewed' },
  { id: 'unread', label: 'Unread' },
  { id: 'recent', label: 'Recent' }
]

const puppyBirthDate = new Date(2026, 5, 8)

function toLocalDateTimeInput(isoDate: string): string {
  const date = new Date(isoDate)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function App() {
  const [articles, setArticles] = useState<Article[]>([])
  const [screen, setScreen] = useState<Screen>('today')
  const [selectedArticleId, setSelectedArticleId] = useState<string>()
  const [query, setQuery] = useState('')
  const [events, setEvents] = useState<PuppyEvent[]>([])
  const [progress, setProgress] = useState<Map<string, ChecklistProgress>>(new Map())
  const [articleViews, setArticleViews] = useState<Map<string, ArticleView>>(new Map())
  const [viewFilter, setViewFilter] = useState<ArticleViewFilter>('all')
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState<string>()
  const [editingPottyId, setEditingPottyId] = useState<number>()
  const [pottyIsAccident, setPottyIsAccident] = useState(false)
  const [pottyTags, setPottyTags] = useState('')
  const [pottyConsistency, setPottyConsistency] = useState<PooConsistency>('normal')
  const [editingEventId, setEditingEventId] = useState<number>()
  const [eventTime, setEventTime] = useState('')
  const [membership, setMembership] = useState<HouseholdMembership>()
  const [now, setNow] = useState(() => new Date())
  const readerRef = useRef<HTMLElement>(null)
  const scrollSaveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    async function load() {
      try {
        const [bundleResponse, savedScreen, savedArticle, savedEvents, savedProgress, savedViews] = await Promise.all([
          fetch('./content/articles.json'),
          getPreference<Screen>('lastScreen', 'today'),
          getPreference<string | undefined>('lastArticleId', undefined),
          db.events.orderBy('occurredAt').reverse().toArray(),
          db.checklistProgress.toArray(),
          db.articleViews.toArray()
        ])
        if (!bundleResponse.ok) throw new Error('The training library could not be loaded.')
        const bundle = await bundleResponse.json() as ArticleBundle
        setArticles(bundle.articles)
        setScreen(savedScreen)
        setSelectedArticleId(savedArticle && bundle.articles.some(({ id }) => id === savedArticle) ? savedArticle : undefined)
        setEvents(savedEvents.filter((event) => !event.deletedAt))
        setProgress(new Map(savedProgress.map((item) => [item.id, item])))
        setArticleViews(new Map(savedViews.map((item) => [item.articleId, item])))
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'The app could not load its saved data.')
      } finally {
        setReady(true)
      }
    }
    void load()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const selectedArticle = articles.find(({ id }) => id === selectedArticleId)
  const checklistArticle = articles.find(({ checklistItems }) => checklistItems.length > 0)
  const filteredArticles = useMemo(() => {
    const searched = searchArticles(articles, query)
    return filterArticlesByView(searched, articleViews, viewFilter)
  }, [articles, articleViews, query, viewFilter])
  const results = useMemo(() => filteredArticles.slice(0, query ? 60 : 30), [filteredArticles, query])
  const continueArticles = useMemo(() => {
    const recent = filterArticlesByView(articles, articleViews, 'recent').slice(0, 3)
    return recent.length ? recent : articles.filter(({ path }) => path.includes('training/articles')).slice(0, 3)
  }, [articles, articleViews])
  const todayEvents = useMemo(() => eventsToday(events), [events])
  const puppyAgeMonths = puppyAgeInMonths(puppyBirthDate, now)
  const pottyIntervalHours = bladderHoldHours(puppyBirthDate, now)
  const nextPotty = useMemo(() => nextPottyAt(events, puppyBirthDate, now), [events, now])
  const completedCount = checklistArticle?.checklistItems.filter(({ id }) => progress.get(id)?.completed).length ?? 0
  const articleCountNoun = viewFilter === 'all' ? 'offline article' : `${viewFilter} article`

  const refreshCloudEvents = useCallback(async (activeMembership: HouseholdMembership) => {
    try {
      const syncedEvents = await syncEvents(activeMembership)
      setEvents(syncedEvents)
    } catch { /* Local writes stay pending and retry when connectivity returns. */ }
  }, [])

  useEffect(() => {
    if (!ready || !cloudConfigured) return
    let active = true
    let channel: ReturnType<typeof subscribeToHousehold> | undefined
    let connecting = false
    const connect = async () => {
      if (connecting || !active) return
      connecting = true
      try {
        const savedMembership = await loadMembership()
        if (!active || !savedMembership) return
        setMembership(savedMembership)
        await refreshCloudEvents(savedMembership)
        if (!active || channel) return
        channel = subscribeToHousehold(savedMembership, () => void refreshCloudEvents(savedMembership))
      } catch { /* The app remains fully usable offline. */ }
      finally { connecting = false }
    }
    const reconnect = () => void connect()
    void connect()
    window.addEventListener('online', reconnect)
    return () => {
      active = false
      window.removeEventListener('online', reconnect)
      void unsubscribeFromHousehold(channel)
    }
  }, [ready, refreshCloudEvents])

  const addPhone = useCallback(async () => {
    try {
      const invite = await createPhoneInvite()
      setMembership(invite.membership)
      await refreshCloudEvents(invite.membership)
      if (navigator.share) {
        await navigator.share({ title: 'Puppy Companion', text: 'Open this private link and add Puppy Companion to your Home Screen.', url: invite.url })
        setMessage('Private phone invitation shared')
      } else {
        await navigator.clipboard.writeText(invite.url)
        setMessage('Private phone invitation copied')
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setMessage(error instanceof Error ? error.message : 'Could not add that phone. Try again.')
    }
  }, [refreshCloudEvents])

  const navigate = useCallback((destination: Screen) => {
    setScreen(destination)
    if (destination !== 'learn') setSelectedArticleId(undefined)
    void setPreference('lastScreen', destination)
  }, [])

  const openArticle = useCallback(async (article: Article) => {
    setScreen('learn')
    setSelectedArticleId(article.id)
    try {
      const view = await db.transaction('rw', db.articleViews, async () => {
        const existing = await db.articleViews.get(article.id)
        const next: ArticleView = {
          articleId: article.id,
          viewCount: (existing?.viewCount ?? 0) + 1,
          lastViewedAt: new Date().toISOString()
        }
        await db.articleViews.put(next)
        return next
      })
      setArticleViews((current) => new Map(current).set(article.id, view))
      await Promise.all([
        setPreference('lastScreen', 'learn'),
        setPreference('lastArticleId', article.id)
      ])
    } catch {
      setMessage('The article opened, but its view history could not be saved.')
    }
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
      const now = new Date().toISOString()
      const event: PuppyEvent = { syncId: crypto.randomUUID(), type, occurredAt: now, consistency: type === 'poo' ? 'normal' : undefined, updatedAt: now, syncState: 'pending' }
      const id = await db.events.add(event)
      setEvents((current) => [{ ...event, id }, ...current])
      setMessage(`${labelForEvent(type)} logged`)
      window.setTimeout(() => setMessage(undefined), 1800)
      if (membership) void refreshCloudEvents(membership)
    } catch {
      setMessage('Could not save that event. Check available device storage and try again.')
    }
  }, [membership, refreshCloudEvents])

  const editPottyDetails = useCallback((event: PuppyEvent) => {
    if ((event.type !== 'pee' && event.type !== 'poo') || event.id === undefined) return
    setEditingPottyId(event.id)
    setPottyIsAccident(event.isAccident ?? false)
    setPottyTags((event.tags ?? []).join(', '))
    setPottyConsistency(event.consistency ?? 'normal')
  }, [])

  const savePottyDetails = useCallback(async () => {
    if (editingPottyId === undefined) return
    const current = events.find(({ id }) => id === editingPottyId)
    if (!current) return
    try {
      const updatedAt = new Date().toISOString()
      const changes = buildPottyDetailChanges(current, pottyIsAccident, pottyTags, pottyConsistency, updatedAt)
      await db.events.update(editingPottyId, changes)
      setEvents((items) => items.map((event) => event.id === editingPottyId ? { ...event, ...changes } : event))
      setEditingPottyId(undefined)
      setMessage(`${labelForEvent(current.type)} details saved`)
      window.setTimeout(() => setMessage(undefined), 1800)
      if (membership) void refreshCloudEvents(membership)
    } catch {
      setMessage('Could not save those details. Please try again.')
    }
  }, [editingPottyId, events, membership, pottyConsistency, pottyIsAccident, pottyTags, refreshCloudEvents])

  const editEventTime = useCallback((event: PuppyEvent) => {
    if (event.id === undefined) return
    setEditingEventId(event.id)
    setEventTime(toLocalDateTimeInput(event.occurredAt))
  }, [])

  const saveEventTime = useCallback(async () => {
    if (editingEventId === undefined) return
    const date = new Date(eventTime)
    if (!eventTime || Number.isNaN(date.getTime())) {
      setMessage('Choose a valid date and time.')
      return
    }
    const occurredAt = date.toISOString()
    try {
      const updatedAt = new Date().toISOString()
      await db.events.update(editingEventId, { occurredAt, updatedAt, syncState: 'pending' })
      setEvents((current) => current
        .map((event) => event.id === editingEventId ? { ...event, occurredAt, updatedAt, syncState: 'pending' as const } : event)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)))
      setEditingEventId(undefined)
      setEventTime('')
      setMessage('Activity time updated')
      window.setTimeout(() => setMessage(undefined), 1800)
      if (membership) void refreshCloudEvents(membership)
    } catch {
      setMessage('Could not update that time. Please try again.')
    }
  }, [editingEventId, eventTime, membership, refreshCloudEvents])

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
      const deletedAt = new Date().toISOString()
      await db.events.update(event.id, { deletedAt, updatedAt: deletedAt, syncState: 'pending' })
      setEvents((current) => current.filter(({ id }) => id !== event.id))
      setMessage(`${labelForEvent(event.type)} entry removed`)
      window.setTimeout(() => setMessage(undefined), 1800)
      if (membership) void refreshCloudEvents(membership)
    } catch {
      setMessage('Could not remove that entry. Please try again.')
    }
  }, [membership, refreshCloudEvents])

  if (!ready) return <main className="loading"><div className="loader" /><p>Preparing your puppy companion…</p></main>

  return (
    <div className={`app-shell ${selectedArticle ? 'reader-open' : ''}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Puppy companion</p>
          <h1>{screen === 'today' ? 'Good day, pup' : screens.find(({ id }) => id === screen)?.label}</h1>
        </div>
        <button className="add-phone-button" onClick={() => void addPhone()}>+ Add phone</button>
      </header>

      {message && <div className="toast" role="status">{message}</div>}

      <main className="main-content">
        {screen === 'today' && (
          <section className="page today-page">
            <div className="hero-card">
              <p className="card-kicker">Next potty check</p>
              <strong>{nextPotty ? nextPotty.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Log the first pee'}</strong>
              <span>{nextPotty ? `${formatPottyCountdown(nextPotty, now)} · ${pottyIntervalHours}-hour limit at ${puppyAgeMonths} ${puppyAgeMonths === 1 ? 'month' : 'months'} old.` : `We’ll use her ${pottyIntervalHours}-hour age-based limit from there.`}</span>
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
                const summary = todayEvents.filter((event) => event.type === type).length
                return <article className="mini-card" key={type}><span>{labelForEvent(type)}</span><strong>{summary}</strong><small>{latest ? formatRelativeTime(latest.occurredAt) : 'none yet'}</small></article>
              })}
            </section>

            <button className="training-card" onClick={() => navigate('train')}>
              <span><small>Training plan</small><strong>{completedCount} of {checklistArticle?.checklistItems.length ?? 23} skills complete</strong></span>
              <span className="arrow">→</span>
            </button>

            <section className="section-block">
              <div className="section-heading"><h2>Continue learning</h2><button onClick={() => navigate('learn')}>See all</button></div>
              {continueArticles.map((article) => (
                <button className="article-row" key={article.id} onClick={() => void openArticle(article)}>
                  <span><small>{articleViews.has(article.id) ? `Last viewed ${formatRelativeTime(articleViews.get(article.id)!.lastViewedAt)}` : article.topic}</small><strong>{article.title}</strong></span><span>›</span>
                </button>
              ))}
            </section>
          </section>
        )}

        {screen === 'learn' && !selectedArticle && (
          <section className="page learn-page">
            <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search training, care, breeds…" autoFocus /></label>
            <div className="filter-row" aria-label="Filter learning articles">
              {viewFilters.map((filter) => <button key={filter.id} className={viewFilter === filter.id ? 'active' : ''} onClick={() => setViewFilter(filter.id)}>{filter.label}</button>)}
            </div>
            <p className="result-count">{query ? `${filteredArticles.length} ${filteredArticles.length === 1 ? 'match' : 'matches'}` : `${filteredArticles.length} ${articleCountNoun}${filteredArticles.length === 1 ? '' : 's'}`}</p>
            <div className="article-list">
              {results.map((article) => (
                <button className="article-card" key={article.id} onClick={() => void openArticle(article)}>
                  <small>{article.topic}</small><strong>{article.title}</strong><p>{article.text.slice(0, 145)}…</p>
                  <span className={`view-meta ${articleViews.has(article.id) ? 'seen' : ''}`}>{articleViews.has(article.id) ? formatViewSummary(articleViews.get(article.id)!) : 'Not viewed'}</span>
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
            {articleViews.has(selectedArticle.id) && <p className="reader-view-meta">{formatViewSummary(articleViews.get(selectedArticle.id)!)}</p>}
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
                <article
                  key={event.id}
                  className={event.type === 'pee' || event.type === 'poo' ? 'potty-entry' : undefined}
                  onClick={event.type === 'pee' || event.type === 'poo' ? () => editPottyDetails(event) : undefined}
                  onKeyDown={event.type === 'pee' || event.type === 'poo' ? (keyEvent) => {
                    if (keyEvent.target !== keyEvent.currentTarget) return
                    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                      keyEvent.preventDefault()
                      editPottyDetails(event)
                    }
                  } : undefined}
                  role={event.type === 'pee' || event.type === 'poo' ? 'button' : undefined}
                  tabIndex={event.type === 'pee' || event.type === 'poo' ? 0 : undefined}
                  aria-label={event.type === 'pee' || event.type === 'poo' ? `Edit ${labelForEvent(event.type).toLowerCase()} details${event.isAccident ? ', marked as an accident' : ''}` : undefined}
                >
                  <span className={`event-dot ${event.type}`} />
                  <div><strong>{labelForEvent(event.type)}</strong><div className="event-badges">{event.type === 'poo' && <span className="poo-consistency saved">{labelForPooConsistency(event.consistency ?? 'normal')}</span>}{event.isAccident && <span className="accident-badge">Accident</span>}</div><button className="edit-time" onClick={(clickEvent) => { clickEvent.stopPropagation(); editEventTime(event) }}>{new Date(event.occurredAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · Edit</button>{event.isAccident && Boolean(event.tags?.length) && <div className="tag-list">{event.tags?.map((tag) => <span key={tag}>#{tag}</span>)}</div>}</div>
                  <span>{formatRelativeTime(event.occurredAt)}</span>
                  <button className="delete-event" aria-label={`Remove ${labelForEvent(event.type)} entry`} onClick={(clickEvent) => { clickEvent.stopPropagation(); void removeEvent(event) }}>×</button>
                </article>
              ))}
              {!events.length && <div className="empty-state"><strong>No activity yet</strong><p>Use a button above to start today’s log.</p></div>}
            </div>
          </section>
        )}
      </main>

      {editingEventId !== undefined && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setEditingEventId(undefined)}>
          <form className="time-sheet" aria-label="Edit activity time" onSubmit={(event) => { event.preventDefault(); void saveEventTime() }} onClick={(event) => event.stopPropagation()}>
            <div className="sheet-heading"><div><p className="eyebrow">Activity history</p><h2>Edit time</h2></div><button type="button" aria-label="Close time editor" onClick={() => setEditingEventId(undefined)}>×</button></div>
            <label>Date and time<input type="datetime-local" value={eventTime} onChange={(event) => setEventTime(event.target.value)} required /></label>
            <button className="primary-button" type="submit">Save time</button>
          </form>
        </div>
      )}

      {editingPottyId !== undefined && (() => {
        const pottyEvent = events.find(({ id }) => id === editingPottyId)
        if (!pottyEvent) return null
        return <div className="sheet-backdrop" role="presentation" onClick={() => setEditingPottyId(undefined)}>
          <form className="potty-sheet" aria-label={`Edit ${pottyEvent.type} details`} onSubmit={(event) => { event.preventDefault(); void savePottyDetails() }} onClick={(event) => event.stopPropagation()}>
            <div className="sheet-heading"><div><p className="eyebrow">Potty event</p><h2>{labelForEvent(pottyEvent.type)} details</h2></div><button type="button" aria-label="Close potty details" onClick={() => setEditingPottyId(undefined)}>×</button></div>
            {pottyEvent.type === 'poo' && <fieldset><legend>Consistency</legend><div className="consistency-options">{pooConsistencyOptions.map(({ value, label }) => <button className={pottyConsistency === value ? 'selected' : ''} key={value} type="button" onClick={() => setPottyConsistency(value)}>{label}</button>)}</div></fieldset>}
            <label className="accident-toggle"><span><strong>Accident</strong><small>Mark this potty event as an accident</small></span><input type="checkbox" checked={pottyIsAccident} onChange={(event) => setPottyIsAccident(event.target.checked)} /></label>
            {pottyIsAccident && <label>Tags, separated by commas<input value={pottyTags} onChange={(event) => setPottyTags(event.target.value)} placeholder="rug, upstairs, after nap" autoFocus /></label>}
            <button className="primary-button" type="submit">Save details</button>
          </form>
        </div>
      })()}

      <nav className="bottom-nav" aria-label="Primary navigation">
        {screens.map((item) => <button key={item.id} className={screen === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span>{item.icon}</span>{item.label}</button>)}
      </nav>
    </div>
  )
}

export default App
