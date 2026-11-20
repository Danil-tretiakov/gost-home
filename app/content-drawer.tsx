'use client';
import { useEffect, useState } from 'react';
import { SHOOT_TEAM } from '../lib/shoot-team';
import { allowedTransitions, CONTENT_STATUSES, CONTENT_STATUS_LABELS, CONTENT_TYPE_LABELS, type ContentStatus } from '../lib/content-status';
import { api, bangkokToday, type ContentDraft, type ContentItem, type Shoot } from './workspace-types';

type Version = { id: string; number: number; driveUrl: string; note: string; createdAt: string; createdBy: string };
type Comment = { id: string; versionId: string | null; kind: 'comment' | 'approved' | 'changes_requested'; body: string; actor: string; at: string };
type StatusEvent = { id: string; fromStatus: string | null; toStatus: ContentStatus; comment: string; actor: string; at: string };
type Props = {
  draft: ContentDraft; shoots: Shoot[]; canEdit: boolean;
  /** Reviewer (руководитель): may comment and decide on items waiting for feedback. */
  canReview?: boolean;
  /** Team member allowed to see versions and comments. */
  canReadInternal?: boolean;
  onClose: () => void; onSaved: (item: ContentItem) => void; onOpenShoot?: (id: string) => void;
};

/** One editor for a Reels/YouTube item, used from every section so all of them show the same record. */
export default function ContentDrawer({ draft: initial, shoots, canEdit, canReview = canEdit, canReadInternal = canEdit, onClose, onSaved, onOpenShoot }: Props) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<StatusEvent[] | null>(initial.revision === undefined ? [] : null);
  const [pending, setPending] = useState<ContentStatus | null>(null);
  const [comment, setComment] = useState('');
  const [publishedAt, setPublishedAt] = useState(bangkokToday());
  const [versions, setVersions] = useState<{ versions: Version[]; comments: Comment[] } | null>(null);
  const [versionsTick, setVersionsTick] = useState(0);
  const isNew = draft.revision === undefined;

  useEffect(() => {
    if (isNew) return;
    let alive = true;
    api<StatusEvent[]>(`/api/content/history?id=${draft.id}`).then(h => { if (alive) setHistory(h); }).catch(() => { if (alive) setHistory(null); });
    return () => { alive = false; };
  }, [draft.id, draft.revision, isNew]);
  useEffect(() => {
    if (isNew || !canReadInternal) return;
    let alive = true;
    api<{ versions: Version[]; comments: Comment[] }>(`/api/content/versions?id=${draft.id}`).then(v => { if (alive) setVersions(v); }).catch(() => { if (alive) setVersions(null); });
    return () => { alive = false; };
  }, [draft.id, isNew, canReadInternal, versionsTick, draft.revision]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const saved = await api<ContentItem>('/api/content', { method: 'POST', json: draft });
      onSaved(saved); setDraft({ ...saved });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function changeStatus(to: ContentStatus) {
    if (draft.revision === undefined) return;
    setBusy(true); setError('');
    try {
      const saved = await api<ContentItem>('/api/content/status', { method: 'POST', json: { id: draft.id, revision: draft.revision, to, comment, publishedAt: to === 'published' ? publishedAt : undefined } });
      onSaved(saved); setDraft({ ...saved }); setPending(null); setComment('');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const linkedShoot = shoots.find(s => s.id === draft.shootId);
  // Editors get every allowed move; a reviewer only approves an item waiting for feedback (the server enforces the same).
  // Requesting changes is not a status move any more — it's a comment that flips the turn (see the VersionsBox form below).
  const transitions = canEdit ? allowedTransitions(draft.productionStatus)
    : canReview && draft.productionStatus === 'awaiting_feedback' ? (['approved'] as ContentStatus[]) : [];
  const needsInput = (s: ContentStatus) => s === 'published';
  const latest = versions?.versions[versions.versions.length - 1];
  const lastReturn = versions?.comments.filter(c => c.kind === 'changes_requested').at(-1);
  // true: the reviewer already asked for changes on the newest version — waiting on the author. false: a fresh version is waiting on the reviewer's decision.
  const needsNewVersion = !!latest && lastReturn?.versionId === latest.id;
  const showMontage = (['editing', 'awaiting_feedback', 'changes_requested', 'approved', 'published'] as ContentStatus[]).includes(draft.productionStatus);
  const liveTurn = draft.productionStatus === 'awaiting_feedback' ? (latest ? (needsNewVersion ? 'author' : 'reviewer') : null) : null;
  useEffect(() => {
    // The versions/comments fetch (not the item fetch) is what tells us whose turn it is, so push it back into the
    // shared item list here — otherwise the content-plan table and Согласование keep showing the turn as it was
    // when the drawer opened, until the next full reload.
    if (isNew || draft.reviewTurn === liveTurn) return;
    const next = { ...draft, reviewTurn: liveTurn } as ContentItem;
    setDraft(next); onSaved(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTurn]);

  return <div className="drawer-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="content-title">
      <div className="drawer-head">
        <div><div className="eyebrow">{CONTENT_TYPE_LABELS[draft.type].toUpperCase()} · {isNew ? 'НОВЫЙ РОЛИК' : CONTENT_STATUS_LABELS[draft.productionStatus].toUpperCase()}</div>
          <h2 id="content-title">{isNew ? 'Новый ролик' : draft.title}</h2></div>
        <button aria-label="Закрыть" disabled={busy} onClick={onClose}>✕</button>
      </div>

      {!isNew && <section className="status-box" aria-label="Этап производства">
        <div className="status-now">
          <select className={'stage-select s-' + draft.productionStatus} disabled={busy || transitions.length === 0}
            value={pending ?? draft.productionStatus}
            onChange={e => { const to = e.target.value as ContentStatus; if (to === draft.productionStatus) { setPending(null); return; } needsInput(to) ? setPending(to) : changeStatus(to); }}>
            <option value={draft.productionStatus}>{CONTENT_STATUS_LABELS[draft.productionStatus]}</option>
            {transitions.map(s => <option key={s} value={s}>{CONTENT_STATUS_LABELS[s]}</option>)}
          </select>
          {draft.productionStatus === 'awaiting_feedback' && latest && <span className={'turn-badge ' + (needsNewVersion ? 'turn-author' : 'turn-reviewer')}>{needsNewVersion ? 'Ждём от автора' : 'Ждёт решения'}</span>}
          {draft.publishedAt && <small>опубликовано {new Date(draft.publishedAt + 'T12:00').toLocaleDateString('ru')}</small>}
        </div>
        {pending && <div className="status-confirm">
          {pending === 'published' && <label>Фактическая дата публикации<input type="date" value={publishedAt} max={bangkokToday()} onChange={e => setPublishedAt(e.target.value)} /></label>}
          <label>Комментарий (необязательно)<textarea rows={3} maxLength={5000} value={comment} onChange={e => setComment(e.target.value)} /></label>
          <div className="row-actions"><button type="button" onClick={() => setPending(null)}>Отмена</button>
            <button type="button" className="primary" disabled={busy} onClick={() => changeStatus(pending)}>{transitionLabel(draft.productionStatus, pending)}</button></div>
        </div>}
      </section>}

      {!isNew && canReadInternal && showMontage && <VersionsBox contentId={draft.id} revision={draft.revision!} data={versions} disabled={busy} canAdd={canEdit} canComment={canEdit || canReview}
        canRequestChanges={canReview && draft.productionStatus === 'awaiting_feedback'}
        onAdded={r => { const next = { ...draft, revision: r.revision, driveUrl: r.driveUrl, updatedAt: r.updatedAt, updatedBy: r.updatedBy } as ContentItem; setDraft(next); onSaved(next); setVersionsTick(t => t + 1); }}
        onCommented={() => setVersionsTick(t => t + 1)} />}

      <form onSubmit={save}>
        <fieldset disabled={!canEdit || busy} className="edit-fields">
          <div className={isNew ? 'fields' : 'fields two'}>
            <label>Тип<select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value as ContentDraft['type'] })}><option value="reel">Reels</option><option value="youtube">YouTube</option></select></label>
            <label>Дата публикации (план)<input type="date" value={draft.plannedPublishDate ?? ''} onChange={e => setDraft({ ...draft, plannedPublishDate: e.target.value || null })} /></label>
            {isNew && <label>Этап<select value={draft.productionStatus} onChange={e => setDraft({ ...draft, productionStatus: e.target.value as ContentStatus })}>
              {CONTENT_STATUSES.filter(s => s !== 'published' && s !== 'paused' && s !== 'cancelled' && s !== 'changes_requested').map(s => <option key={s} value={s}>{CONTENT_STATUS_LABELS[s]}</option>)}
            </select></label>}
          </div>
          <label>Название<input required maxLength={200} placeholder="Например: Обзор виллы с Юлей" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
          <div className="fields">
            <label>Основной ведущий<select value={draft.primaryMember} onChange={e => setDraft({ ...draft, primaryMember: e.target.value, participants: draft.participants.filter(p => p !== e.target.value) })}>
              {SHOOT_TEAM.map(([name]) => <option key={name}>{name}</option>)}</select></label>
          </div>
          {linkedShoot && onOpenShoot && <button type="button" className="link-button" onClick={() => onOpenShoot(linkedShoot.id!)}>Открыть съёмку «{linkedShoot.title}» →</button>}
          <fieldset className="chips"><legend>Дополнительные участники · в долю плана не входят</legend>
            {SHOOT_TEAM.filter(([n]) => n !== draft.primaryMember).map(([name, , color]) => <label key={name} className={'chip ' + (draft.participants.includes(name) ? 'on' : '')} style={{ ['--c' as string]: color }}>
              <input type="checkbox" checked={draft.participants.includes(name)} onChange={e => setDraft({ ...draft, participants: e.target.checked ? [...draft.participants, name] : draft.participants.filter(p => p !== name) })} />{name}</label>)}
          </fieldset>
          <label>Объекты и локации (для внутренней работы, через запятую)<input maxLength={2000} value={draft.places.join(', ')} onChange={e => setDraft({ ...draft, places: e.target.value.split(',').map(s => s.trimStart()) })} /></label>
          <label>{isNew ? 'Ссылка на монтаж (Google Диск)' : 'Ссылка на текущий монтаж (новая версия добавляется выше)'}<input type="url" inputMode="url" placeholder="https://drive.google.com/…" maxLength={1000} value={draft.driveUrl} onChange={e => setDraft({ ...draft, driveUrl: e.target.value })} /></label>
          {draft.driveUrl && /^https:\/\//.test(draft.driveUrl) && <a className="link-button" href={draft.driveUrl} target="_blank" rel="noreferrer noopener">Открыть монтаж ↗</a>}
          <label>Сценарий, описание, референсы<textarea rows={6} maxLength={10000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        </fieldset>
        {error && <p role="alert" className="error">{error}</p>}
        {canEdit && <div className="form-actions"><button type="button" disabled={busy} onClick={onClose}>Закрыть</button><button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : isNew ? 'Создать ролик' : 'Сохранить'}</button></div>}
      </form>

      {!isNew && <section className="history" aria-label="История">
        <h3>История этапов</h3>
        {history === null ? <p className="hint">История недоступна</p> : history.length === 0 ? <p className="hint">Пока без изменений</p> :
          <ol>{[...history].reverse().map(h => <li key={h.id}><span>{new Date(h.at).toLocaleString('ru', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            <b>{CONTENT_STATUS_LABELS[h.toStatus] ?? h.toStatus}</b><small>{h.actor}</small>{h.comment && <p>{h.comment}</p>}</li>)}</ol>}
        {'updatedAt' in draft && <p className="hint">Изменено {new Date((draft as ContentItem).updatedAt).toLocaleString('ru', { timeZone: 'Asia/Bangkok' })} · {(draft as ContentItem).updatedBy}</p>}
      </section>}
    </section>
  </div>;
}

export function transitionLabel(from: ContentStatus, to: ContentStatus): string {
  if (to === 'awaiting_feedback') return from === 'changes_requested' ? 'Изменения внесены' : 'Отправить на согласование';
  if (to === 'approved') return from === 'published' ? 'Снять отметку публикации' : 'Согласовать';
  if (to === 'changes_requested') return 'На доработку';
  if (to === 'published') return 'Отметить публикацию';
  if (to === 'editing') return from === 'changes_requested' ? 'Взять в правки' : from === 'awaiting_feedback' ? 'Вернуть в монтаж' : 'В монтаж';
  if (to === 'shot') return from === 'planned' ? 'Отметить «Съёмка»' : 'Назад: съёмка';
  if (to === 'planned') return from === 'paused' || from === 'cancelled' ? 'Вернуть в план' : 'Назад: сценарий';
  if (to === 'paused') return 'Пауза';
  if (to === 'cancelled') return 'Отменить';
  return CONTENT_STATUS_LABELS[to];
}

type Added = { versionId: string; revision: number; driveUrl: string; updatedAt: string; updatedBy: string };
const KIND_LABEL = { comment: 'Комментарий', approved: 'Согласовано', changes_requested: 'На доработку' } as const;

/** Edit versions and the feedback thread. A new version after "На доработку" starts a new approval round. */
function VersionsBox({ contentId, revision, data, disabled, canAdd, canComment, canRequestChanges, onAdded, onCommented }: { contentId: string; revision: number; data: { versions: Version[]; comments: Comment[] } | null; disabled: boolean; canAdd: boolean; canComment: boolean; canRequestChanges: boolean; onAdded: (r: Added) => void; onCommented: () => void }) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const fmt = (iso: string) => new Date(iso).toLocaleString('ru', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  async function addVersion(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await api<Added>('/api/content/versions', { method: 'POST', json: { contentId, revision, driveUrl: url, note } }); setUrl(''); setNote(''); setAdding(false); onAdded(r); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function submitComment(kind: 'comment' | 'changes_requested') {
    if (!text.trim()) return; setBusy(true); setError('');
    try { await api('/api/content/feedback', { method: 'POST', json: { contentId, versionId: data?.versions.at(-1)?.id ?? null, body: text, kind } }); setText(''); onCommented(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const num = (id: string | null) => data?.versions.find(v => v.id === id)?.number;
  return <section className="versions" aria-label="Версии монтажа">
    <div className="versions-head"><h3>Версии монтажа</h3>{canAdd && !adding && <button type="button" className="small" disabled={disabled || busy} onClick={() => setAdding(true)}>＋ Версия</button>}</div>
    {data === null ? <p className="hint">Загружаем…</p> : data.versions.length === 0 ? <p className="hint">Версий нет. Добавьте ссылку на монтаж, чтобы отправить ролик на согласование.</p> :
      <ol className="version-list">{[...data.versions].reverse().map(v => <li key={v.id}><b>v{v.number}</b><a href={v.driveUrl} target="_blank" rel="noreferrer noopener">Открыть ↗</a>
        <small>{fmt(v.createdAt)} · {v.createdBy}</small>{v.note && <p>{v.note}</p>}</li>)}</ol>}
    {adding && <form className="version-form" onSubmit={addVersion}>
      <label>Ссылка https://<input type="url" required maxLength={1000} placeholder="https://drive.google.com/…" value={url} onChange={e => setUrl(e.target.value)} /></label>
      <label>Что изменилось<input maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="row-actions"><button type="button" className="small" onClick={() => setAdding(false)}>Отмена</button><button className="small primary" disabled={busy}>Добавить версию</button></div></form>}
    {data && data.comments.length > 0 && <ol className="comments">{data.comments.map(c => <li key={c.id} className={'k-' + c.kind}>
      <span>{KIND_LABEL[c.kind]}{num(c.versionId) ? ` · v${num(c.versionId)}` : ''}</span><small>{fmt(c.at)} · {c.actor}</small>{c.body && <p>{c.body}</p>}</li>)}</ol>}
    {data && canComment && <form className="comment-form" onSubmit={e => { e.preventDefault(); submitComment('comment'); }}>
      <input maxLength={5000} placeholder={canRequestChanges ? 'Комментарий или что поправить' : 'Комментарий к последней версии'} aria-label="Комментарий" value={text} onChange={e => setText(e.target.value)} />
      <button className="small" disabled={busy || !text.trim()}>Отправить</button>
      {canRequestChanges && <button type="button" className="small warn" disabled={busy || !text.trim()} onClick={() => submitComment('changes_requested')}>Нужны правки</button>}
    </form>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
