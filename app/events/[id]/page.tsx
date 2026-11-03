import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getShootById } from '../../../lib/get-shoot';
import { eventTimes } from '../../../lib/event-calendar';
import { normalizeShootValues } from '../../../lib/shoot-values';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const shoot = await getShootById((await params).id);
    return { title: shoot ? `${shoot.title} — Gost Home` : 'Съёмка — Gost Home', description: 'Детали съёмки Gost Home и добавление события в календарь.', robots: { index: false, follow: false } };
  } catch { return { title: 'Съёмка — Gost Home', robots: { index: false, follow: false } }; }
}
export default async function EventPage({ params }: Props) {
  let shoot;
  try { shoot = await getShootById((await params).id); }
  catch { return <main className="invitation"><div className="invite-card"><p className="eyebrow">GOST HOME / СЪЁМКА</p><h1>Не удалось загрузить событие</h1><p>Попробуйте обновить страницу чуть позже.</p><a className="invite-back" href="/">Открыть расписание</a></div></main>; }
  if (!shoot) notFound();
  const { start, end } = eventTimes(shoot);
  const cancelled = shoot.status === 'Отменено';
  const finished = end.getTime() <= Date.now();
  const started = start.getTime() <= Date.now();
  const active = !cancelled && !started;
  const date = new Intl.DateTimeFormat('ru', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = new Intl.DateTimeFormat('ru', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(start) === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(end);
  const projects = normalizeShootValues(shoot.project);
  const locations = normalizeShootValues(shoot.location);
  return <main className="invitation">
    <a className="invite-brand" href="/">GOST HOME<span>CONTENT STUDIO</span></a>
    <article className="invite-card">
      {active ? <section className="invite-add"><a className="primary invite-button" href={`/events/${encodeURIComponent(shoot.id)}/calendar.ics`}>＋ ДОБАВИТЬ В КАЛЕНДАРЬ</a><p className="invite-reminder">◷ Напоминание за 24 часа до начала</p></section> : <div className="invite-inactive">{cancelled ? 'Съёмка отменена. Добавление в календарь недоступно.' : finished ? 'Эта съёмка уже завершилась.' : 'Съёмка уже началась.'}</div>}
      <div className="invite-top"><span className="eyebrow">ПРИГЛАШЕНИЕ НА СЪЁМКУ</span><span className="invite-badge">{cancelled ? 'Отменена' : finished ? 'Завершилась' : started ? 'Идёт сейчас' : shoot.status}</span></div>
      <h1>{shoot.title}</h1>
      <p className="invite-date">{date.format(start)}</p>
      <p className="invite-time">{time.format(start)} — {sameDay ? time.format(end) : `${date.format(end)}, ${time.format(end)}`}</p>
      <p className="invite-zone">Время Бангкока · UTC+7</p>
      <dl className="invite-details"><div><dt>Формат</dt><dd>{shoot.format}</dd></div><div><dt>Участники</dt><dd>{shoot.participants.join(' · ')}</dd></div>{projects.length > 0 && <div><dt>Проекты</dt><dd>{projects.map(value => <span className="invite-tag" key={value}>{value}</span>)}</dd></div>}{locations.length > 0 && <div><dt>Локации</dt><dd>{locations.map(value => <span className="invite-tag" key={value}>{value}</span>)}</dd></div>}</dl>
      <section className="invite-notes" aria-labelledby="preparation-title"><h2 id="preparation-title">Заметки и подготовка</h2>{shoot.notes.trim() ? <p>{shoot.notes}</p> : <p className="invite-notes-empty">Дополнительная подготовка не указана.</p>}</section>
      <p className="invite-footnote">Здесь показано актуальное расписание. Добавленное вручную событие не обновляется автоматически — при переносе съёмки проверьте дату по этой ссылке.</p>
    </article>
    <a className="invite-back" href="/">← Всё расписание Gost Home</a>
  </main>;
}
