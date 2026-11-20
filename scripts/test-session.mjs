// Own sign-in for Cloudflare hosting: signed session tokens, password check, cookie parsing.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const out = await build({ entryPoints: ['lib/session.ts'], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022' });
const f = new URL('../node_modules/.cache/session_test.mjs', import.meta.url);
mkdirSync(new URL('.', f), { recursive: true }); writeFileSync(f, out.outputFiles[0].text);
const S = await import(f.href + '?' + Date.now());

const secret = 'x'.repeat(40), other = 'y'.repeat(40), now = Date.UTC(2026, 10, 19);
const email = 'owner@example.com';
const t = await S.signSession(secret, email, now);
assert.match(t, /^v1\.[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]+$/);
assert.equal(await S.verifySession(secret, t, now), email);
assert.equal(await S.verifySession(secret, t, now + 29 * 86_400_000), email);
assert.equal(await S.verifySession(secret, t, now + 31 * 86_400_000), null, 'expired');
assert.equal(await S.verifySession(other, t, now), null, 'other secret');
const [v, e, exp, sig] = t.split('.');
const forgedEmail = Buffer.from('attacker@example.com').toString('base64url');
assert.equal(await S.verifySession(secret, [v, forgedEmail, exp, sig].join('.'), now), null, 'changed email');
assert.equal(await S.verifySession(secret, [v, e, String(Number(exp) + 999999), sig].join('.'), now), null, 'extended expiry');
assert.equal(await S.verifySession(secret, [v, e, exp, sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA')].join('.'), now), null, 'changed signature');
for (const bad of [null, undefined, '', 'v1', 'v2.' + t.slice(3), t + '.x', 'v1.%%%.1.%%%', 'a'.repeat(2000)]) assert.equal(await S.verifySession(secret, bad, now), null, String(bad).slice(0, 20));

assert.equal(await S.passwordMatches(secret, 'correct horse battery', 'correct horse battery'), true);
assert.equal(await S.passwordMatches(secret, 'correct horse batter', 'correct horse battery'), false);
assert.equal(await S.passwordMatches(secret, 12345, '12345'), false);
assert.equal(await S.passwordMatches(secret, 'z'.repeat(501), 'z'.repeat(501)), false);

assert.equal(S.strongSecret('a'.repeat(31)), false); assert.equal(S.strongSecret('a'.repeat(32)), true); assert.equal(S.strongSecret(undefined), false);
for (const [pw, ok] of [['abc12345', true], ['Pop12345', true], ['abc1234', false], ['abcdefgh', false], ['12345678', false], ['пароль123', false], [12345678, false], ['a1'.repeat(101), false]]) assert.equal(S.strongPassword(pw), ok, String(pw));

const salt = S.newSalt(), h = await S.hashPassword(secret, salt, 'Pop12345');
assert.notEqual(salt, S.newSalt());
assert.equal(await S.storedPasswordMatches(secret, 'Pop12345', salt, h), true);
assert.equal(await S.storedPasswordMatches(secret, 'pop12345', salt, h), false);
assert.equal(await S.storedPasswordMatches(other, 'Pop12345', salt, h), false, 'hash depends on the server secret');
assert.equal(await S.storedPasswordMatches(secret, 'Pop12345', S.newSalt(), h), false, 'hash depends on the salt');
assert.equal(await S.storedPasswordMatches(secret, null, salt, h), false);
assert.equal(await S.sameSecret(secret, 'tok', 'tok'), true); assert.equal(await S.sameSecret(secret, 'tok', 'tok2'), false); assert.equal(await S.sameSecret(secret, undefined, 'x'), false);

assert.equal(S.readCookie('a=1; gh_session=abc.def; b=2', 'gh_session'), 'abc.def');
assert.equal(S.readCookie('xgh_session=1', 'gh_session'), null);
assert.equal(S.readCookie(null, 'gh_session'), null);
const c = S.sessionCookie(t);
for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(c.includes(flag), flag);
assert.ok(S.clearSessionCookie().includes('Max-Age=0'));
console.log('session tests passed');
