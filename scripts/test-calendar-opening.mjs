import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['lib/calendar-opening.ts'], bundle: true, write: false, platform: 'neutral', format: 'esm', target: 'es2022' });
const { calendarOpeningLink } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const id = '1d127b52-8a1c-42dc-887b-e02be242245f';
const origin = 'https://gost-home.example';
for (const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Version/26.0 Mobile Safari/604.1', 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) CriOS/142.0 Mobile Safari/604.1', 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 'iPad']) {
  assert.deepEqual(calendarOpeningLink(id, origin, ua), { href: `${origin.replace(/^https:/, 'x-safari-https:')}/events/${id}/calendar.ics`, viaSafari: true });
}
for (const ua of ['', 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1.15', 'Mozilla/5.0 (Linux; Android 16) Chrome/142']) {
  assert.deepEqual(calendarOpeningLink(id, origin, ua), { href: `/events/${id}/calendar.ics`, viaSafari: false });
}
assert.equal(calendarOpeningLink(id, 'https://example.com:444/path?redirect=https://other.example#test', 'iPhone').href, `x-safari-https://example.com:444/events/${id}/calendar.ics`);
assert.throws(() => calendarOpeningLink('../other', origin, 'iPhone'));
assert.throws(() => calendarOpeningLink(id, 'javascript:alert(1)', 'iPhone'));
assert.throws(() => calendarOpeningLink(id, 'https://user:pass@example.com', 'iPhone'));
console.log('PASS: iPhone Safari handoff, other browsers retain one-event import, correct host/path, invalid inputs');
