import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['lib/calendar-links.ts'], bundle: true, write: false, platform: 'neutral', format: 'esm', target: 'es2022' });
const { appleCalendarSubscriptionUrl } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const id = '24409564-a4d4-450d-a2cb-0fd0d48fa331';
assert.equal(appleCalendarSubscriptionUrl('https://gost-home.example', id), `webcal://gost-home.example/events/${id}/subscription.ics`);
assert.equal(appleCalendarSubscriptionUrl('http://127.0.0.1:8787', id), `webcal://127.0.0.1:8787/events/${id}/subscription.ics`);
assert.equal(appleCalendarSubscriptionUrl('https://example.com/other?x=1#abc', id), `webcal://example.com/events/${id}/subscription.ics`);
assert.throws(() => appleCalendarSubscriptionUrl('javascript:alert(1)', id));
assert.throws(() => appleCalendarSubscriptionUrl('https://user:password@example.com', id));
assert.throws(() => appleCalendarSubscriptionUrl('https://example.com', '../other'));
console.log('PASS: Apple Calendar scheme, current host/port, isolated event URL, invalid input');
