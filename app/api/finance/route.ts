import { getD1, getDb } from '../../../db';
import { eq } from 'drizzle-orm';
import { appSettings, contentItems, payableUnits, payments, rateRules, shoots } from '../../../db/schema';
import { actorWith, forbidden, sameOrigin } from '../../../lib/actor';
import { getAccess } from '../../permissions';
import { applySettingsSave, q, type D1 } from '../../../lib/content-writes';
import { emptyReelPay, parseReelPay, REEL_PAY_KEY, reelPayRows } from '../../../lib/reel-pay';
import { balances, parseMoney, RATE_MODELS, suggestAccruals } from '../../../lib/finance';
import { isIsoDate, isUuid } from '../../../lib/content-values';
import { SHOOT_TEAM } from '../../../lib/shoot-team';
import { normalizeShootStatus } from '../../../lib/shoot-status';

export const dynamic = 'force-dynamic';
const NAMES = SHOOT_TEAM.map(m => m[0]);
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const bad = (error: string, status = 400) => Response.json({ error }, { status });

async function loadAll() {
  const db = getDb();
  const [rules, units, pays, items, shootRows] = await Promise.all([
    db.select().from(rateRules), db.select().from(payableUnits), db.select().from(payments), db.select().from(contentItems), db.select().from(shoots),
  ]);
  return { rules, units, pays, items, shoots: shootRows.map(s => ({ ...s, status: normalizeShootStatus(s.status) })) };
}

/** Finance data is never part of public reads: this route answers only to users with the separate finance permission. */
export async function GET(req: Request) {
  if (!(await actorWith('finance'))) return forbidden(req);
  const params = new URL(req.url).searchParams;
  if (params.get('view') === 'reels') {
    try {
      const db = getDb();
      const [[row], items] = await Promise.all([db.select().from(appSettings).where(eq(appSettings.key, REEL_PAY_KEY)).limit(1), db.select().from(contentItems)]);
      let store = emptyReelPay();
      try { store = (row && parseReelPay(JSON.parse(row.value))) || store; } catch { /* keep empty */ }
      return Response.json({ store, revision: row?.revision ?? 0, rows: reelPayRows(items, store), updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null }, { headers: { 'Cache-Control': 'no-store' } });
    } catch { return bad('Не удалось загрузить счётчик', 503); }
  }
  const period = params.get('period') ?? '';
  if (!PERIOD.test(period)) return bad('Неверный период');
  try {
    const d = await loadAll();
    return Response.json({
      rules: d.rules, units: d.units.filter(u => u.period === period), payments: d.pays,
      balancesAll: balances(d.units, d.pays),
      suggestions: suggestAccruals(period, d.rules, d.items, d.shoots, d.units),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return bad('Не удалось загрузить финансы', 503); }
}

const audit = (db: D1, action: string, entityId: string, actor: string, now: string, after: unknown, before: unknown = null) =>
  q(db)`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) VALUES (${crypto.randomUUID()}, 'finance', ${entityId}, ${action}, ${actor}, ${now}, ${before === null ? null : JSON.stringify(before)}, ${JSON.stringify(after)})`;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden(req);
  // Recording pay needs the finance permission and a working role; a viewer with finance only reads.
  const a = await getAccess();
  const actor = a.caps.finance && (a.caps.edit || a.caps.review) ? a.name ?? a.email : null;
  if (!actor) return forbidden(req);
  let x: Record<string, unknown>;
  try { x = await req.json(); } catch { return bad('Неверный запрос'); }
  const db = getD1() as unknown as D1;
  const sql = q(db);
  const now = new Date().toISOString();
  const reason = typeof x.reason === 'string' ? x.reason.trim().slice(0, 500) : '';
  const note = typeof x.note === 'string' ? x.note.trim().slice(0, 500) : '';
  try {
    switch (x.action) {
      case 'reels.save': {
        // Hand-kept counts for «Осталось оплатить»; revision-guarded, audited, never part of public settings.
        const store = parseReelPay(x.store);
        if (!store || !Number.isInteger(x.revision) || (x.revision as number) < 0) return bad('Проверьте числа: целые от 0');
        const [before] = await getDb().select().from(appSettings).where(eq(appSettings.key, REEL_PAY_KEY)).limit(1);
        const ok = await applySettingsSave(db, { key: REEL_PAY_KEY, value: JSON.stringify(store), revision: x.revision as number, actor, before: before?.value ?? null });
        return ok ? Response.json({ store, revision: (x.revision as number) + 1 }) : bad('Счётчик уже изменён. Обновите.', 409);
      }
      case 'rule.create': {
        const amount = parseMoney(x.amount);
        if (!NAMES.includes(x.member as string) || !(RATE_MODELS as readonly string[]).includes(x.model as string) || amount === null || !isIsoDate(x.validFrom)) return bad('Проверьте участника, модель, сумму и дату начала');
        const id = crypto.randomUUID();
        await db.batch([
          sql`INSERT INTO rate_rules (id, member, model, amount_minor, currency, valid_from, valid_to, note, active, created_at, created_by, revision) VALUES (${id}, ${x.member}, ${x.model}, ${amount}, 'THB', ${x.validFrom}, NULL, ${note}, 1, ${now}, ${actor}, 1)`,
          audit(db, 'rule.create', id, actor, now, { member: x.member, model: x.model, amountMinor: amount, validFrom: x.validFrom }),
        ]);
        return Response.json({ id }, { status: 201 });
      }
      case 'rule.deactivate': {
        if (!isUuid(x.id) || !Number.isInteger(x.revision)) return bad('Неверный запрос');
        const auditId = crypto.randomUUID();
        const r = await db.batch([
          sql`UPDATE rate_rules SET active = 0, valid_to = COALESCE(valid_to, ${now.slice(0, 10)}), revision = revision + 1 WHERE id = ${x.id} AND revision = ${x.revision} AND active = 1`,
          sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) SELECT ${auditId}, 'finance', ${x.id}, 'rule.deactivate', ${actor}, ${now}, NULL, ${JSON.stringify({ reason })} WHERE changes() = 1`,
        ]);
        return changed(r[0]) ? Response.json({ ok: true }) : bad('Тариф уже изменён. Обновите.', 409);
      }
      case 'accrue': {
        // Accrue exactly the suggestions the server computes now; the unique basis key ignores anything already recorded.
        const period = x.period as string;
        if (!PERIOD.test(period) || !Array.isArray(x.keys) || !x.keys.length) return bad('Выберите начисления');
        const d = await loadAll();
        const wanted = new Set((x.keys as unknown[]).filter(k => typeof k === 'string'));
        const units = suggestAccruals(period, d.rules, d.items, d.shoots, d.units).filter(u => wanted.has(`${u.member}|${u.basis}|${u.basisKey}`));
        if (!units.length) return bad('Эти начисления уже записаны или больше не подходят. Обновите.', 409);
        await db.batch([
          ...units.map(u => sql`INSERT INTO payable_units (id, member, basis, basis_key, content_id, shoot_date, period, rate_rule_id, amount_minor, currency, description, voided_at, void_reason, created_at, created_by)
            VALUES (${crypto.randomUUID()}, ${u.member}, ${u.basis}, ${u.basisKey}, ${u.contentId}, ${u.shootDate}, ${u.period}, ${u.rateRuleId}, ${u.amountMinor}, ${u.currency}, ${u.description}, NULL, NULL, ${now}, ${actor})
            ON CONFLICT(member, basis, basis_key) DO NOTHING`),
          audit(db, 'accrue', period, actor, now, units),
        ]);
        return Response.json({ accrued: units.length }, { status: 201 });
      }
      case 'unit.oneoff': {
        const amount = parseMoney(x.amount);
        const period = x.period as string;
        const description = typeof x.description === 'string' ? x.description.trim().slice(0, 300) : '';
        if (!NAMES.includes(x.member as string) || amount === null || !PERIOD.test(period) || !description) return bad('Укажите участника, сумму и за что начисление');
        const id = crypto.randomUUID();
        await db.batch([
          sql`INSERT INTO payable_units (id, member, basis, basis_key, content_id, shoot_date, period, rate_rule_id, amount_minor, currency, description, voided_at, void_reason, created_at, created_by)
            VALUES (${id}, ${x.member}, 'one_off', ${id}, ${isUuid(x.contentId) ? x.contentId : null}, NULL, ${period}, NULL, ${amount}, 'THB', ${description}, NULL, NULL, ${now}, ${actor})`,
          audit(db, 'unit.oneoff', id, actor, now, { member: x.member, amountMinor: amount, period, description }),
        ]);
        return Response.json({ id }, { status: 201 });
      }
      case 'unit.void':
      case 'payment.void': {
        if (!isUuid(x.id) || !reason) return bad('Укажите причину исправления');
        const table = x.action === 'unit.void' ? 'payable_units' : 'payments';
        const auditId = crypto.randomUUID();
        const r = await db.batch([
          db.prepare(`UPDATE ${table} SET voided_at = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL`).bind(now, reason, x.id),
          sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) SELECT ${auditId}, 'finance', ${x.id}, ${x.action}, ${actor}, ${now}, NULL, ${JSON.stringify({ reason })} WHERE changes() = 1`,
        ]);
        return changed(r[0]) ? Response.json({ ok: true }) : bad('Запись уже исправлена', 409);
      }
      case 'payment.create': {
        const amount = parseMoney(x.amount);
        if (!NAMES.includes(x.member as string) || amount === null || !isIsoDate(x.paidAt)) return bad('Укажите участника, сумму и дату выплаты');
        const id = isUuid(x.id) ? x.id : crypto.randomUUID();
        await db.batch([
          sql`INSERT INTO payments (id, member, amount_minor, currency, paid_at, note, voided_at, void_reason, created_at, created_by) VALUES (${id}, ${x.member}, ${amount}, 'THB', ${x.paidAt}, ${note}, NULL, NULL, ${now}, ${actor}) ON CONFLICT(id) DO NOTHING`,
          sql`INSERT INTO audit_events (id, entity, entity_id, action, actor, at, before, after) SELECT ${crypto.randomUUID()}, 'finance', ${id}, 'payment.create', ${actor}, ${now}, NULL, ${JSON.stringify({ member: x.member, amountMinor: amount, paidAt: x.paidAt, note })} WHERE changes() = 1`,
        ]);
        return Response.json({ id }, { status: 201 });
      }
      default: return bad('Неизвестное действие');
    }
  } catch { return bad('Не удалось сохранить. Ничего не изменено.', 503); }
}

function changed(r: unknown) { return ((r as { meta?: { changes?: number } }).meta?.changes ?? 0) === 1; }
