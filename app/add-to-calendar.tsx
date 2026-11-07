export default function AddToCalendar({ id }: { id: string }) {
  return <section className="invite-add">
    <a className="primary invite-button" href={`/events/${encodeURIComponent(id)}/calendar.ics`}>＋ ДОБАВИТЬ В КАЛЕНДАРЬ</a>
    <p className="invite-reminder">◷ Напоминание за 24 часа до начала</p>
  </section>;
}
