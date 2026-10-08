'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ProjectSummary, BrowseResponse } from '@/types/api';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// List pieces shared by Apps (/dashboard) and Explore (/community, /browse): a small phone-shaped preview, a row per app,
// and the Explore list with search, categories and sort as on Android.

/** A project as /api/projects/my returns it: the summary plus its build status. */
export type OwnedProject = ProjectSummary & { status?: string | null };

// ---- time

/** "3 hours ago" in the reader's language. */
export function useRelativeTime() {
  const locale = useLocale();
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), [locale]);
  return (iso: string | null | undefined) => {
    if (!iso) return '';
    const secs = (new Date(iso).getTime() - Date.now()) / 1000;
    if (!Number.isFinite(secs)) return '';
    const abs = Math.abs(secs);
    if (abs < 60) return rtf.format(0, 'second');
    if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(secs / 3600), 'hour');
    if (abs < 86400 * 30) return rtf.format(Math.round(secs / 86400), 'day');
    if (abs < 86400 * 365) return rtf.format(Math.round(secs / (86400 * 30)), 'month');
    return rtf.format(Math.round(secs / (86400 * 365)), 'year');
  };
}

export function shortAddress(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// ---- thumbnail

const THUMB_VIRTUAL_WIDTH = 390; // the live app is laid out at phone width, then scaled down into the thumbnail

/**
 * A small portrait preview of the app: its thumbnail image, else the live published page scaled down, else its initial.
 * The iframe is decorative (no pointer events, not focusable).
 */
export function AppThumb({ project, width = 60, building = false }: { project: ProjectSummary; width?: number; building?: boolean }) {
  const height = Math.round(width * 4 / 3);
  const [loaded, setLoaded] = useState(false);
  const scale = width / THUMB_VIRTUAL_WIDTH;
  const initial = (project.title || '?').trim().charAt(0).toUpperCase() || '?';
  const live = !building && !project.thumbnail_url && project.published_url;

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-lg border border-border bg-surface"
      style={{ width, height }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex items-center justify-center bg-accent/10">
        {!building && <span className="font-display font-semibold text-accent-hover" style={{ fontSize: Math.round(width * 0.4) }}>{initial}</span>}
      </div>
      {!building && project.thumbnail_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={project.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      )}
      {live && (
        <div
          className={cn('pointer-events-none absolute left-0 top-0 origin-top-left bg-white', loaded ? 'opacity-100' : 'opacity-0')}
          style={{ width: THUMB_VIRTUAL_WIDTH, height: height / scale, transform: `scale(${scale})` }}
        >
          <iframe
            src={project.published_url!}
            title=""
            className="h-full w-full border-0"
            loading="lazy"
            sandbox="allow-scripts allow-same-origin"
            tabIndex={-1}
            onLoad={() => setLoaded(true)}
          />
        </div>
      )}
      {building && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}
    </div>
  );
}

// ---- status

export type AppStatus = 'building' | 'failed' | 'published' | 'ready';

export function appStatus(p: OwnedProject): AppStatus {
  if (p.status === 'building' || p.status === 'pending') return 'building';
  if (p.status === 'failed') return 'failed';
  if (p.published_url) return 'published';
  return 'ready';
}

export function StatusLine({ project }: { project: OwnedProject }) {
  const t = useTranslations('apps');
  const s = appStatus(project);
  if (s === 'building') {
    return (
      <p className="flex items-center gap-2 text-sm text-accent-hover">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-hover" />
        {t('status.building')}
        <span className="text-muted">{t('status.buildingHint')}</span>
      </p>
    );
  }
  if (s === 'failed') {
    return (
      <p className="flex items-center gap-2 text-sm text-danger">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" />
        {t('status.failed')}
      </p>
    );
  }
  if (s === 'published') {
    return (
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
        <span className="shrink-0 text-success">{t('status.published')}</span>
        <a
          href={project.published_url!}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="truncate text-accent-hover hover:underline"
        >
          {shortAddress(project.published_url!)}
        </a>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-subtle" />
      {t('status.ready')}
    </p>
  );
}

// ---- owner row (Apps)

export function ProjectRow({ project, onOpen, onDelete }: { project: OwnedProject; onOpen: () => void; onDelete: () => void }) {
  const t = useTranslations('apps');
  const ago = useRelativeTime();
  const building = appStatus(project) === 'building';
  return (
    <li className="group relative flex items-center gap-4 border-b border-border py-4">
      <AppThumb project={project} building={building} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-display text-[17px] font-semibold">
          {/* the whole row is the link target; the delete button sits above it */}
          <button onClick={onOpen} className="text-left after:absolute after:inset-0 after:content-['']">
            {project.title}
          </button>
        </h2>
        {project.description && <p className="truncate text-sm text-muted">{project.description}</p>}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
          <div className="relative z-10 min-w-0 max-w-full"><StatusLine project={project} /></div>
          <span className="text-xs text-subtle">{t('updated', { time: ago(project.updated_at || project.created_at) })}</span>
        </div>
      </div>
      <button
        onClick={onDelete}
        className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-subtle transition hover:bg-danger/10 hover:text-danger"
        aria-label={t('deleteLabel', { title: project.title })}
        title={t('delete')}
      >
        <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </li>
  );
}

// ---- Explore

/** Client-side categories, the same words and rules as Android's ui/browse/ProjectCategory.kt. */
export const CATEGORIES = ['all', 'games', 'tools', 'sites', 'trackers'] as const;
export type Category = (typeof CATEGORIES)[number];

const gameWords = ['game', 'quiz', 'trivia', 'puzzle', 'snake', 'tetris', 'arcade', 'platformer', 'shooter', 'chess', 'simulator', 'multiplayer', 'runner', 'surfers', 'flappy', '2048', 'sudoku', 'wordle', 'tic tac toe', 'tic-tac-toe', 'memory match', 'لعبة', 'игра', 'jeu', 'jouer', 'juego', 'jugar', 'gioco', 'giocare', 'jogo', 'jogar', 'rompecabezas', 'casse-tete', 'casse-tête'];
const trackerWords = ['tracker', 'tracking', 'todo', 'to-do', 'to do', 'habit', 'budget', 'expense', 'journal', 'planner', 'checklist', 'diary', 'suivi', 'suivre', 'depenses', 'dépenses', 'habitude', 'tâches', 'taches', 'liste de', 'seguimiento', 'rastreador', 'gastos', 'hábito', 'habito', 'tareas', 'presupuesto', 'traccia', 'spese', 'abitudini', 'attività', 'compiti', 'bilancio', 'rastreio', 'despesas', 'hábitos', 'tarefas', 'orçamento', 'orcamento', 'diário'];
const siteWords = ['website', 'web site', 'landing', 'portfolio', 'blog', 'homepage', 'home page', 'site', 'restaurant', 'shop', 'store', 'business page', 'personal page', 'resume', 'cv', 'site web', 'site vitrine', 'boutique', 'sitio web', 'página web', 'pagina web', 'tienda', 'sito web', 'negozio', 'loja', 'página', 'cardápio'];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// whole words with an optional plural s/x, so "jeu" does not hit "jeune" and "store" does not hit "restore"
const wordRe = (words: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(esc).join('|')})[sx]?(?![\\p{L}\\p{N}])`, 'u');
const gameRe = wordRe(gameWords);
const trackerRe = wordRe(trackerWords);
const siteRe = wordRe(siteWords);

export function classifyProject(p: ProjectSummary): Exclude<Category, 'all'> {
  const text = `${p.title} ${p.description ?? ''}`.toLowerCase();
  if (gameRe.test(text)) return 'games';
  if (trackerRe.test(text)) return 'trackers';
  if (siteRe.test(text)) return 'sites';
  return 'tools';
}

function trackView(projectId: string) {
  api.post(`/api/projects/${projectId}/view`, {}).catch(() => {});
}

function compact(n: number) {
  if (!n || n < 0) return '0';
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

function ExploreRow({
  project,
  onOpen,
  onRemix,
  userId,
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onRemix?: () => void;
  userId?: string | null;
}) {
  const t = useTranslations('apps.explore');
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(project.like_count || 0);
  const [liking, setLiking] = useState(false);

  async function toggleLike() {
    if (!userId || liking) return;
    setLiking(true);
    try {
      const path = `/api/projects/${project.id}/like`;
      const r = liked
        ? await api.delete<{ likeCount: number }>(path, { userId })
        : await api.post<{ likeCount: number }>(path, { userId });
      setLiked(!liked);
      setLikes(r.likeCount);
    } catch {
      // a like is best-effort
    } finally {
      setLiking(false);
    }
  }

  return (
    <li className="relative flex items-center gap-4 border-b border-border py-4">
      <AppThumb project={project} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-display text-[17px] font-semibold">
          <button onClick={onOpen} className="text-left after:absolute after:inset-0 after:content-['']">
            {project.title}
          </button>
        </h2>
        {project.description && <p className="line-clamp-2 text-sm text-muted">{project.description}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
          {project.creator_name && <span className="truncate">{t('byCreator', { name: project.creator_name })}</span>}
          {(project.view_count || 0) > 0 && <span>{t('views', { count: project.view_count, shown: compact(project.view_count) })}</span>}
          {(project.fork_count || 0) > 0 && <span>{t('remixes', { count: project.fork_count, shown: compact(project.fork_count) })}</span>}
          {!project.published_url && <span className="text-subtle">{t('notLive')}</span>}
        </p>
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        {userId !== undefined && (
          <button
            onClick={toggleLike}
            disabled={!userId || liking}
            aria-pressed={liked}
            aria-label={liked ? t('unlike') : t('like')}
            title={liked ? t('unlike') : t('like')}
            className={cn('hidden h-10 min-w-10 items-center justify-center gap-1 rounded-lg px-2 text-sm transition hover:bg-surface sm:flex', liked ? 'text-accent-hover' : 'text-subtle hover:text-foreground')}
          >
            <svg className="h-[18px] w-[18px]" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
            {likes > 0 && compact(likes)}
          </button>
        )}
        {onRemix && (
          <button
            onClick={onRemix}
            className="h-10 rounded-lg border border-border px-3 text-sm font-medium text-foreground transition hover:bg-surface"
          >
            {t('remix')}
          </button>
        )}
      </div>
    </li>
  );
}

const PAGE = 20;

/**
 * Explore: search, categories and sort, then one row per public app. A row opens the live app in a new tab when it is
 * published, or calls onOpenUnpublished otherwise.
 */
export function ExploreList({
  defaultSort,
  userId,
  onRemix,
  onOpenUnpublished,
}: {
  defaultSort: 'newest' | 'popular';
  /** undefined hides the like button (signed-out visitors); null shows it disabled */
  userId?: string | null;
  onRemix: (projectId: string) => void;
  onOpenUnpublished?: (projectId: string) => void;
}) {
  const t = useTranslations('apps.explore');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sort, setSort] = useState<'newest' | 'popular'>(defaultSort);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, query]);

  async function load(reset: boolean, retry = 0): Promise<void> {
    setIsLoading(true);
    setLoadError(false);
    const from = reset ? 0 : offset;
    try {
      const q = query ? `&search=${encodeURIComponent(query)}` : '';
      const data = await api.get<BrowseResponse>(`/api/projects/browse?limit=${PAGE}&offset=${from}&sort=${sort}${q}`);
      setProjects((prev) => (reset ? data.projects : [...prev, ...data.projects]));
      setHasMore(data.hasMore);
      setOffset(from + PAGE);
    } catch {
      // the API can be cold-starting: try once more on a first load
      if (reset && retry < 1) {
        await new Promise((r) => setTimeout(r, 1500));
        return load(reset, retry + 1);
      }
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }

  const visible = category === 'all' ? projects : projects.filter((p) => classifyProject(p) === category);

  function open(p: ProjectSummary) {
    trackView(p.id);
    if (p.published_url) window.open(p.published_url, '_blank', 'noopener');
    else onOpenUnpublished?.(p.id);
  }

  return (
    <div>
      <form
        role="search"
        onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}
        className="relative"
      >
        <svg className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); if (!e.target.value) setQuery(''); }}
          placeholder={t('search')}
          aria-label={t('search')}
          className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[15px] text-foreground placeholder:text-subtle focus:border-accent focus:outline-none"
        />
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label={t('categoriesLabel')}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                'h-9 shrink-0 rounded-lg border px-3.5 text-sm transition',
                category === c ? 'border-accent bg-accent/15 font-medium text-accent-hover' : 'border-border text-muted hover:bg-surface hover:text-foreground'
              )}
            >
              {t(`category.${c}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-sm" role="group" aria-label={t('sortLabel')}>
          {(['newest', 'popular'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={cn('h-9 rounded-lg px-3 transition', sort === s ? 'bg-surface font-medium text-foreground' : 'text-muted hover:text-foreground')}
            >
              {t(`sort.${s}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2">
        {isLoading && projects.length === 0 ? (
          <div className="flex justify-center py-20">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : loadError && projects.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-muted">{t('loadFailed')}</p>
            <button onClick={() => void load(true)} className="mt-4 h-10 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-surface">
              {t('retry')}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-muted">{query ? t('emptySearch') : t('emptyCategory')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-x-10 xl:grid-cols-2">
            {visible.map((p) => (
              <ExploreRow key={p.id} project={p} userId={userId} onOpen={() => open(p)} onRemix={() => onRemix(p.id)} />
            ))}
          </ul>
        )}
        {hasMore && projects.length > 0 && (
          <div className="mt-6 text-center">
            <button
              onClick={() => void load(false)}
              disabled={isLoading}
              className="h-10 rounded-lg border border-border px-5 text-sm font-medium transition hover:bg-surface disabled:opacity-50"
            >
              {isLoading ? t('loading') : t('loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
