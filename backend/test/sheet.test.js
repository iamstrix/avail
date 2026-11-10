// Tests for the Google Sheet data API (Code.gs), run in a fake Apps Script.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./fake-gas.js');

function fresh() {
  const g = createGas({ now: '2026-11-10T14:14:00Z' });
  g.setup();
  return g;
}

test('setup makes every tab, sample settings and an API key', () => {
  const g = fresh();
  assert.ok(g.key() && g.key().length >= 20);
  const settings = Object.fromEntries(g.tab('Settings').map(r => [r.key, r.value]));
  assert.equal(settings.weekday_price, '7000');
  assert.ok(g.tab('Rules').some(r => r.topic === 'videoke'));
  assert.ok(g.tab('Holidays').some(r => r.date === '2026-11-30'));
  g.setup(); // running it twice doesn't duplicate anything
  assert.equal(g.tab('Settings').filter(r => r.key === 'weekday_price').length, 1);
});

test('the key is required', () => {
  const g = fresh();
  assert.deepEqual(g.get({ action: 'state' }), { ok: false, error: 'bad key' });
  assert.equal(g.post({ key: 'wrong' }, { action: 'apply' }).ok, false);
  assert.equal(g.get({ key: g.key(), action: 'ping' }).ok, true);
});

test('state returns settings, days in range, waiting days and the guest chat', () => {
  const g = fresh();
  g.addRows('Days', [
    { date: '2026-11-12', status: 'booked', guest: 'Ana' },
    { date: '2027-02-01', status: 'saved', psid: 'G1', saved_until: '2026-11-11T20:00:00+08:00' },
    { date: '2027-03-01', status: 'booked', psid: 'G2' },
    { date: '2026-10-01', status: 'booked' }
  ]);
  g.addRows('Chats', [{ psid: 'G2', name: 'Ben', last_date: '2026-11-20' }]);
  const s = g.get({ key: g.key(), action: 'state', from: '2026-11-01', to: '2026-11-30', psid: 'G2' });
  assert.equal(s.today, '2026-11-10');
  assert.equal(s.settings.weekend_price, '10000');
  assert.deepEqual(s.days.map(d => d.date).sort(), ['2026-11-12', '2027-02-01', '2027-03-01']);
  assert.equal(s.chat.name, 'Ben');
  assert.ok(!('_row' in s.days[0]));
});

test('dates typed by hand (real Date cells) come back as YYYY-MM-DD', () => {
  const g = fresh();
  g.addRows('Days', [{ date: new Date(Date.UTC(2026, 10, 19, -8)), status: 'blocked', note: 'Typed by hand' }]);
  const s = g.get({ key: g.key(), from: '2026-11-01', to: '2026-11-30' });
  assert.equal(s.days[0].date, '2026-11-19');
});

test('two guests can’t save the same day', () => {
  const g = fresh();
  const save = psid => g.post({ key: g.key() }, { action: 'apply', changes: [{ date: '2026-11-12', ifStatusIn: ['empty', 'promo'], set: { status: 'saved', psid, saved_until: '2026-11-11T22:14:00+08:00' } }] });
  assert.equal(save('G1').results[0].ok, true);
  const second = save('G2').results[0];
  assert.equal(second.ok, false);
  assert.equal(second.status, 'saved');
  assert.equal(g.tab('Days')[0].psid, 'G1');
});

test('an expired save counts as free, and ifPsid protects other guests’ days', () => {
  const g = fresh();
  g.addRows('Days', [{ date: '2026-11-12', status: 'saved', psid: 'G1', perk: 'breakfast', saved_until: '2026-11-10T20:00:00+08:00' }]);
  const wrong = g.post({ key: g.key() }, { action: 'apply', changes: [{ date: '2026-11-12', ifStatusIn: ['promo'], ifPsid: 'G9', set: { status: 'promo' } }] });
  assert.equal(wrong.results[0].why, 'someone else');
  const res = g.post({ key: g.key() }, { action: 'apply', changes: [{ date: '2026-11-12', ifStatusIn: ['empty', 'promo'], set: { status: 'saved', psid: 'G2', saved_until: '2026-11-11T22:14:00+08:00' } }] });
  assert.equal(res.results[0].ok, true);
  assert.equal(g.tab('Days')[0].perk, 'breakfast'); // the promo perk stays with the day
});

test('apply writes chats, promos, settings and the log, and echoes data back', () => {
  const g = fresh();
  const res = g.post({ key: g.key() }, {
    action: 'apply',
    chats: [{ psid: 'G1', set: { name: 'Ana', last_date: '2026-11-12' } }, { psid: 'G1', set: { last_pax: 15 } }],
    promos: [{ id: 'P1', days: '2026-11-11,2026-11-12', perk: 'breakfast', text: 'Promo!' }],
    settings: { weekday_price: '7500', new_key: 'x' },
    logs: [{ psid: 'G1', from: 'guest', text: 'hi' }],
    echo: { reply: 'hello' }
  });
  assert.deepEqual(res.echo, { reply: 'hello' });
  assert.deepEqual(g.tab('Chats').map(r => [r.psid, r.name, r.last_date, r.last_pax]), [['G1', 'Ana', '2026-11-12', 15]]);
  assert.equal(g.tab('Promos')[0].created, '2026-11-10T22:14:00+08:00');
  assert.equal(g.tab('Settings').find(r => r.key === 'weekday_price').value, '7500');
  assert.equal(g.tab('Log').length, 1);
});
