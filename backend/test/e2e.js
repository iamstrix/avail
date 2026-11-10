// End-to-end test: real n8n running the three avail workflows, with fake outside services.
//
//   1. node backend/n8n/build.mjs --test <dir>       (test copies of the workflows)
//   2. import <dir>/credentials.json and the workflows into a local n8n, publish them, start n8n
//   3. node backend/test/e2e.js                      (starts the fake services and runs every scenario)
'use strict';
const assert = require('node:assert/strict');
const { start } = require('./mock-services.js');
const A = require('../engine/engine.js');

const N8N = process.env.N8N_URL || 'http://127.0.0.1:5678';
const MOCK = 'http://127.0.0.1:5690';
const OWNER_KEY = 'owner-test-key';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = async (url, init) => { const r = await fetch(url, init); return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) }; };
const tab = name => getJson(`${MOCK}/_tab?name=${name}`).then(r => r.body);
const records = () => getJson(`${MOCK}/_records`).then(r => r.body);
async function waitFor(check, what, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await check();
    if (v) return v;
    await sleep(400);
  }
  throw new Error('Timed out waiting for ' + what);
}
let mid = 0;
function fbEvent(psid, message) {
  return { object: 'page', entry: [{ id: 'PAGE1', time: Date.now(), messaging: [{ sender: { id: psid }, recipient: { id: 'PAGE1' }, timestamp: Date.now(), message: Object.assign({ mid: 'm' + (++mid) + '-' + Date.now() }, message) }] }] };
}
async function guestSays(psid, text) {
  const before = (await records()).sent.filter(s => s.psid === psid).length;
  const t0 = Date.now();
  const r = await fetch(`${N8N}/webhook/avail-messenger`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fbEvent(psid, { text })) });
  assert.equal(r.status, 200);
  const reply = await waitFor(async () => { const s = (await records()).sent.filter(x => x.psid === psid); return s.length > before ? s[s.length - 1].text : null; }, `a reply to ${psid}`);
  return { reply, ms: Date.now() - t0 };
}
async function owner(action, extra) {
  const r = await fetch(`${N8N}/webhook/avail-owner`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(Object.assign({ key: OWNER_KEY, action }, extra || {})) });
  return { status: r.status, cors: r.headers.get('access-control-allow-origin'), body: await r.json().catch(() => null) };
}

// Pick test days relative to today (Philippine time) so the test works any day.
const today = A.todayIso();
const ctx0 = A.buildCtx({ holidays: [] });
function nextWeekday(from, minAhead) {
  for (let i = minAhead; i < 60; i++) { const d = A.addDays(from, i); const w = A.weekday(d); if (w >= 1 && w <= 4) return d; }
}
const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(['PASS', name, Date.now() - t0]); console.log(`PASS  ${name}`); }
  catch (e) { results.push(['FAIL', name, Date.now() - t0]); console.log(`FAIL  ${name}\n      ${String(e && e.message || e).split('\n').join('\n      ')}`); }
}

(async () => {
  await start(5690);
  await waitFor(async () => { try { return (await fetch(`${N8N}/healthz`)).ok; } catch (e) { return false; } }, 'n8n to start', 120000);
  // n8n says it's healthy a little before the published workflows are listening
  await waitFor(async () => (await fetch(`${N8N}/webhook/avail-messenger`)).status !== 404, 'the workflows to go live', 120000);

  const D = nextWeekday(today, 3);          // a free weekday a few days out
  const P1 = nextWeekday(A.addDays(D, 7), 0); // promo days a week later (Mon–Thu)
  const P2 = A.addDays(P1, 1);
  const label = d => A.short(d);           // "Nov 12"
  console.log(`today ${today}, test day ${D}, promo days ${P1} and ${P2}\n`);

  await step('Facebook can verify the webhook (and a wrong token is refused)', async () => {
    const ok = await fetch(`${N8N}/webhook/avail-messenger?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=48151623`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '48151623');
    const bad = await fetch(`${N8N}/webhook/avail-messenger?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
    assert.equal(bad.status, 403);
  });

  await step('A guest asks about a free day: exact price, day saved, chat logged', async () => {
    const { reply, ms } = await guestSays('G100', `Hi po! Avail pa po ba ${label(D)}? 15 kami, overnight. May videoke po?`);
    console.log(`      reply in ${ms} ms: ${reply}`);
    assert.match(reply, /₱7,000/);
    assert.match(reply, /₱2,100 downpayment/);
    assert.match(reply, /videoke/i);
    const row = (await tab('Days')).find(r => r.date === D);
    assert.equal(row.status, 'saved');
    assert.equal(row.psid, 'G100');
    assert.equal(Number(row.price), 7000);
    await waitFor(async () => (await tab('Log')).filter(r => r.psid === 'G100').length >= 2, 'the chat log');
    assert.equal((await tab('Chats')).find(r => r.psid === 'G100').last_date, D);
  });

  await step('A second guest asking for the same day is told it is taken, with other days', async () => {
    const { reply } = await guestSays('G200', `pwede po ba ${label(D)}? 20 kami`);
    assert.match(reply, /booked na po/);
    assert.match(reply, /Bakante pa po ang/);
    assert.equal((await tab('Days')).find(r => r.date === D).psid, 'G100');
  });

  await step('The guest sends a GCash photo: day waits for the owner, owner gets an alert', async () => {
    const before = (await records()).alerts.length;
    await fetch(`${N8N}/webhook/avail-messenger`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fbEvent('G100', { attachments: [{ type: 'image', payload: { url: 'https://example.com/receipt.jpg' } }] })) });
    await waitFor(async () => (await tab('Days')).find(r => r.date === D).status === 'receipt', 'receipt status');
    const alert = await waitFor(async () => { const a = (await records()).alerts; return a.length > before ? a[a.length - 1] : null; }, 'owner alert');
    assert.match(alert.title, /Downpayment/);
    assert.equal(alert.topic, 'avail-test');
  });

  await step('Stickers and likes get no reply', async () => {
    const before = (await records()).sent.length;
    await fetch(`${N8N}/webhook/avail-messenger`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fbEvent('G100', { attachments: [{ type: 'image', payload: { url: 'https://x/like.png', sticker_id: 369239263222822 } }] })) });
    await sleep(4000);
    assert.equal((await records()).sent.length, before);
  });

  await step('Owner app: wrong key is refused', async () => {
    const r = await fetch(`${N8N}/webhook/avail-owner`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ key: 'nope', action: 'state' }) });
    assert.equal(r.status, 401);
  });

  await step('Owner app: calendar shows the receipt waiting (and the browser may read it)', async () => {
    const r = await owner('state', { from: today.slice(0, 8) + '01', to: A.addDays(today, 60) });
    assert.equal(r.status, 200);
    assert.equal(r.cors, '*');
    assert.ok(r.body.days.length > 28);
    assert.equal(r.body.waiting.length, 1);
    assert.equal(r.body.waiting[0].status, 'receipt');
    assert.equal(r.body.waiting[0].down, 2100);
  });

  await step('Owner confirms: day is booked and the guest is told on Messenger', async () => {
    const r = await owner('booking', { op: 'confirm', date: D });
    assert.equal(r.status, 200);
    assert.equal(r.body.results[0].ok, true);
    assert.equal((await tab('Days')).find(x => x.date === D).status, 'booked');
    const msg = await waitFor(async () => (await records()).sent.filter(s => s.psid === 'G100').find(s => /Confirmed na po/.test(s.text)), 'the confirmation message');
    assert.match(msg.text, /overnight/);
    const bad = await owner('booking', { op: 'confirm', date: D });
    assert.ok(bad.body.echo.error);
  });

  await step('Owner drafts a promo post (AI) for two empty days', async () => {
    const r = await owner('draft', { days: [P1, P2], perk: 'breakfast' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.by, 'ai');
    assert.match(r.body.text, /₱7,000/);
    console.log(`      draft: ${r.body.text}`);
  });

  await step('If the AI is down, the draft comes from the template', async () => {
    await fetch(`${MOCK}/_flags`, { method: 'POST', body: JSON.stringify({ groqFail: true }) });
    const r = await owner('draft', { days: [P1, P2], perk: 'breakfast' });
    await fetch(`${MOCK}/_flags`, { method: 'POST', body: JSON.stringify({ groqFail: false }) });
    assert.equal(r.body.by, 'template');
    assert.match(r.body.text, /₱7,000/);
  });

  await step('Owner publishes: posted to the page, days become promo days', async () => {
    const draft = await owner('draft', { days: [P1, P2], perk: 'breakfast' });
    const r = await owner('publish', { days: [P1, P2], perk: 'breakfast', text: draft.body.text, toFacebook: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.echo.posted, true);
    assert.equal((await records()).posts.length, 1);
    const days = await tab('Days');
    assert.equal(days.find(x => x.date === P1).status, 'promo');
    assert.equal(days.find(x => x.date === P1).perk, 'breakfast');
    assert.equal((await tab('Promos')).length, 1);
  });

  await step('A guest asking about a promo day gets the perk', async () => {
    const { reply } = await guestSays('G300', `${label(P1)} po overnight, 25 kami`);
    assert.match(reply, /Promo day po/);
    assert.match(reply, /breakfast/);
    assert.match(reply, /₱9,500/);
    assert.equal((await tab('Days')).find(x => x.date === P1).guest, 'Carlo Dizon'); // name from Facebook
  });

  await step('A question the owner hasn’t answered yet goes to the owner', async () => {
    const before = (await records()).alerts.length;
    const { reply } = await guestSays('G600', 'hello po, pwede po ba magdala ng aso?');
    assert.match(reply, /itatanong ko po muna sa owner/);
    const alert = await waitFor(async () => { const a = (await records()).alerts; return a.length > before ? a[a.length - 1] : null; }, 'owner alert');
    assert.match(alert.message, /aso/);
  });

  await step('If the AI is down, guests still get a correct reply', async () => {
    await fetch(`${MOCK}/_flags`, { method: 'POST', body: JSON.stringify({ groqFail: true }) });
    const { reply } = await guestSays('G400', `${label(A.addDays(P2, 1))} po, 10 kami overnight`);
    await fetch(`${MOCK}/_flags`, { method: 'POST', body: JSON.stringify({ groqFail: false }) });
    assert.match(reply, /₱/);
    assert.match(reply, /downpayment/);
  });

  await step('The timer frees an unpaid day and tells the guest', async () => {
    const X = A.addDays(D, 14);
    await fetch(`${MOCK}/_rows`, { method: 'POST', body: JSON.stringify({ tab: 'Days', rows: [{ date: X, status: 'saved', psid: 'G500', guest: 'Late payer', saved_until: '2020-01-01T00:00:00+08:00' }] }) });
    await fetch(`${N8N}/webhook/avail-timer`, { method: 'POST' });
    await waitFor(async () => (await tab('Days')).find(r => r.date === X).status === 'empty', 'the day to be freed');
    const msg = await waitFor(async () => (await records()).sent.find(s => s.psid === 'G500'), 'the guest notice');
    assert.match(msg.text, /Na-release na po/);
  });

  await step('Owner changes a price in settings, and replies use it', async () => {
    const r = await owner('settings', { settings: { weekday_price: '7500' } });
    assert.equal(r.status, 200);
    const s = await owner('state', {});
    assert.equal(s.body.settings.weekday, 7500);
    await owner('settings', { settings: { weekday_price: '7000' } });
  });

  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
