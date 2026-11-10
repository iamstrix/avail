'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGas } = require('./fake-gas.js');

// Exercise the generated n8n decision node against the actual Sheet script,
// including the screenshot's incorrect AI output and remembered booking.
const flow = JSON.parse(fs.readFileSync(path.join(__dirname, '../n8n/workflows/avail-messenger.json'), 'utf8'));
const node = flow.nodes.find(n => n.name === 'Decide the reply');
const runDecision = new Function('$', '$json', node.parameters.jsCode);

function fixture() {
  const sheet = createGas({ now: '2026-11-10T06:30:00Z' });
  sheet.setup();
  sheet.addRows('Days', [
    { date: '2026-11-14', status: 'booked', psid: 'G1', type: 'overnight', pax: 15, price: 10000 },
    { date: '2026-11-20', status: 'promo', perk: 'breakfast' }
  ]);
  sheet.addRows('Chats', [{ psid: 'G1', last_date: '2026-11-14', last_type: 'overnight', last_pax: 15 }]);
  return sheet;
}

function inquire(sheet, text, parsed) {
  const state = sheet.get({ key: sheet.key(), psid: 'G1' });
  const inputs = {
    'Read the messages': { psid: 'G1', text, kind: 'text' },
    'Facebook: guest name': { first_name: 'Ana', last_name: 'Reyes' },
    'Sheet: read': state
  };
  const select = name => ({ item: { json: inputs[name] } });
  const response = { choices: [{ message: { content: JSON.stringify(parsed) } }] };
  return runDecision(select, response).json.apply;
}

test('generated Messenger workflow answers the screenshot promo question without changing bookings', () => {
  const sheet = fixture();
  const before = { days: sheet.tab('Days'), chats: sheet.tab('Chats') };
  const apply = inquire(sheet, 'kailan date may promo?', {
    intent: 'book', dates: ['2026-11-14'], type: 'overnight', pax: 15, topics: [], name: ''
  });
  assert.match(apply.echo.reply, /Nov 20.*breakfast/);
  assert.doesNotMatch(apply.echo.reply, /Confirmed|Nov 14|downpayment/);
  assert.deepEqual(apply.changes, []);
  assert.deepEqual(apply.chats, []);
  assert.equal(sheet.post({ key: sheet.key() }, apply).ok, true);
  assert.deepEqual(sheet.tab('Days'), before.days);
  assert.deepEqual(sheet.tab('Chats'), before.chats);
});

test('generated Messenger workflow reads a specific date perk from the Sheet without reserving', () => {
  const sheet = fixture();
  const apply = inquire(sheet, 'May promo ba Nov 20?', {
    intent: 'ask_date', dates: ['2026-11-20'], type: 'unknown', pax: 0, topics: [], name: ''
  });
  assert.match(apply.echo.reply, /Nov 20.*breakfast/);
  assert.deepEqual(apply.changes, []);
  assert.equal(sheet.post({ key: sheet.key() }, apply).ok, true);
  assert.equal(sheet.tab('Days').find(r => r.date === '2026-11-20').status, 'promo');
  assert.equal(sheet.tab('Chats').find(r => r.psid === 'G1').last_date, '2026-11-20');
});
