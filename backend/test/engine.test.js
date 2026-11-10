// Tests for the plain-code engine. Run: node --test backend/test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../engine/engine.js');

// Tuesday, Nov 10, 2026, 10:14 PM in the Philippines
const NOW = '2026-11-10T14:14:00Z';

const SETTINGS = {
  resort_name: 'Miranda’s Resort', location: 'Panlinlang, Arayat, Pampanga',
  weekday_price: '7000', weekend_price: '10,000', included_guests: '20', extra_guest_fee: '500',
  daytour_small_price: '2000', daytour_small_under: '10', daytour_per_person: '300',
  downpayment_percent: '50', hold_hours: '24', gcash_number: '0917 000 0000', gcash_name: 'M. Santos',
  perks: 'breakfast,late', quote_extra: 'Libre rin po ang videoke.'
};
const RULES = [
  { topic: 'videoke', keywords: 'videoke, karaoke', answer: 'Libre po ang videoke para sa lahat ng booking.' },
  { topic: 'pets', keywords: 'aso, pusa, pet, pets, dog', answer: '' },
  { topic: 'checkin', keywords: 'check in, check-in, anong oras', answer: '2:00 PM po ang check-in.' }
];
const HOLIDAYS = [{ date: '2026-11-30', name: 'Bonifacio Day' }, { date: '2026-12-25', name: 'Christmas Day' }];

function ctxWith(days, extra) {
  return A.buildCtx(Object.assign({ settings: SETTINGS, rules: RULES, holidays: HOLIDAYS, days: days || [] }, extra || {}), NOW);
}

test('dates use Philippine time', () => {
  assert.equal(A.todayIso(NOW), '2026-11-10');
  assert.equal(A.todayIso('2026-11-10T16:30:00Z'), '2026-11-11'); // 12:30 AM in Manila
  assert.equal(A.nice('2026-11-12'), 'Thu, Nov 12');
  assert.equal(A.dayRanges(['2026-11-13', '2026-11-11', '2026-11-12', '2026-11-20']).join(' / '), 'Nov 11–13 / Nov 20');
  assert.equal(A.whenText(Date.parse(NOW) + 24 * 3600000, NOW), 'bukas, 10:14 PM');
});

test('prices: weekdays, weekends, holidays, extra guests, day tours', () => {
  const c = ctxWith();
  assert.deepEqual([A.quote(c, '2026-11-12', 'overnight', 15).total, A.quote(c, '2026-11-12', 'overnight', 15).down], [7000, 3500]);
  assert.equal(A.quote(c, '2026-11-12', 'overnight', 25).total, 9500);
  assert.equal(A.quote(c, '2026-11-14', 'overnight', 0).total, 10000); // Saturday
  assert.equal(A.quote(c, '2026-11-14', 'overnight', 15).down, 5000);
  const hol = A.quote(c, '2026-11-30', 'overnight', 0); // Monday, but a holiday
  assert.equal(hol.total, 10000);
  assert.equal(hol.down, 5000);
  assert.equal(hol.rate, 'holiday');
  assert.equal(A.quote(c, '2026-11-12', 'daytour', 8).total, 2000);
  assert.equal(A.quote(c, '2026-11-12', 'daytour', 12).total, 3600);
});

test('saved days whose time ran out count as free again', () => {
  const c = ctxWith([
    { date: '2026-11-12', status: 'saved', psid: '1', saved_until: '2026-11-10T20:00:00+08:00' },
    { date: '2026-11-13', status: 'saved', psid: '2', saved_until: '2026-11-11T20:00:00+08:00', perk: 'breakfast' },
    { date: '2026-11-17', status: 'saved', psid: '3', saved_until: '2026-11-10T21:00:00+08:00', perk: 'late' }
  ]);
  assert.equal(A.statusOf(c, '2026-11-12'), 'empty');
  assert.equal(A.statusOf(c, '2026-11-13'), 'saved');
  assert.equal(A.statusOf(c, '2026-11-17'), 'promo');
});

test('promo plan: late checkout only when the next day is free', () => {
  const c = ctxWith([{ date: '2026-11-14', status: 'booked' }]);
  const late = A.planPromo(c, ['2026-11-13', '2026-11-11', '2026-11-12'], 'late');
  assert.deepEqual(late.days, ['2026-11-11', '2026-11-12', '2026-11-13']);
  assert.deepEqual(Object.values(late.perks), ['breakfast', 'breakfast', 'breakfast']);
  assert.equal(late.lateBlocked.length, 3);
  const ok = A.planPromo(c, ['2026-11-17'], 'late');
  assert.equal(ok.perks['2026-11-17'], 'late');
  const skip = A.planPromo(c, ['2026-11-09', '2026-11-14', '2026-11-16'], 'breakfast');
  assert.deepEqual(skip.days, ['2026-11-16']);
  assert.deepEqual(skip.skipped.map(s => s.why), ['past', 'booked']);
  assert.equal(skip.payday, true); // the 16th is right after payday
});

test('template posts pass the same checks as AI posts', () => {
  const c = ctxWith();
  const plan = A.planPromo(c, ['2026-11-11', '2026-11-12', '2026-11-13'], 'breakfast');
  const post = A.templatePost(c, plan);
  assert.match(post, /₱7,000/);
  assert.match(post, /breakfast/);
  assert.deepEqual(A.checkPost(c, plan, post), { ok: true, problems: [] });
  const mixed = A.planPromo(c, ['2026-11-13', '2026-11-14'], 'breakfast');
  assert.ok(A.checkPost(c, mixed, A.templatePost(c, mixed)).ok);
});

test('AI posts with a wrong price, a discount or no perk are replaced', () => {
  const c = ctxWith();
  const plan = A.planPromo(c, ['2026-11-11', '2026-11-12'], 'breakfast');
  assert.ok(!A.checkPost(c, plan, 'Promo! Nov 11–12 for only ₱5,000 per night, may free breakfast pa kayo. Message us!').ok);
  assert.ok(!A.checkPost(c, plan, 'Promo! Nov 11–12, 20% off: ₱7,000 per night with free breakfast. Message us to book!').ok);
  assert.ok(!A.checkPost(c, plan, 'Promo days sa Miranda’s! Nov 11–12, ₱7,000 per night, private resort. Message us!').ok);
  const good = 'Bakante pa po ang Nov 11–12 sa Miranda’s Resort! ₱7,000 lang ang overnight, at may free breakfast pa para sa buong grupo. Message lang po!';
  assert.deepEqual(A.finishPost(c, plan, good), { text: good, by: 'ai', problems: [] });
  assert.equal(A.finishPost(c, plan, null).by, 'template');
});

test('backup reader understands common Taglish messages', () => {
  const c = ctxWith();
  const a = A.fallbackParse(c, 'Hi po! Avail pa po ba Nov 12? 15 kami, overnight. May videoke po?');
  assert.deepEqual([a.intent, a.dates, a.pax, a.type], ['ask_date', ['2026-11-12'], 15, 'overnight']);
  assert.ok(a.topics.includes('videoke'));
  const b = A.fallbackParse(c, 'day tour po sa 12, 8 kami');
  assert.deepEqual([b.dates, b.pax, b.type], [['2026-11-12'], 8, 'daytour']);
  assert.deepEqual(A.fallbackParse(c, 'pwede po bukas?').dates, ['2026-11-11']);
  assert.deepEqual(A.fallbackParse(c, 'sa sabado po').dates, ['2026-11-14']);
  assert.deepEqual(A.fallbackParse(c, 'Jan 5 po').dates, ['2027-01-05']);
  assert.equal(A.fallbackParse(c, 'Dec 5, 15 kami + 3 kids').pax, 18);
  assert.equal(A.fallbackParse(c, 'sige po book na').intent, 'book');
  assert.equal(A.fallbackParse(c, 'hello po').intent, 'greeting');
});

test('AI answers are cleaned up before use', () => {
  const c = ctxWith();
  const p = A.normalizeParsed(c, { intent: 'ask_date', dates: ['2026-11-12', 'bad', '2025-12-05'], type: 'overnight', pax: 15, topics: ['videoke', 'spaceship'], name: 'Ana' }, 'Nov 12 or Dec 5');
  assert.deepEqual(p.dates, ['2026-11-12', '2026-12-05']);
  assert.deepEqual(p.topics, ['videoke']);
  assert.equal(p.by, 'ai');
  assert.equal(A.normalizeParsed(c, { nope: true }, 'Nov 12 po').by, 'rules');
  assert.deepEqual(A.normalizeParsed(c, { intent: 'ask_date', dates: [], type: 'unknown', pax: 0, topics: [], name: '' }, 'Nov 12 po?').dates, ['2026-11-12']);
});

test('the owner’s own keywords count even when the AI misses a topic', () => {
  const c = ctxWith();
  const p = A.normalizeParsed(c, { intent: 'greeting', dates: [], type: 'unknown', pax: 0, topics: [], name: '' }, 'hello po, pwede magdala ng aso?');
  assert.deepEqual(p.topics, ['pets']);
  assert.equal(p.intent, 'question');
  const d = A.decide(c, p, { psid: 'G1', text: 'hello po, pwede magdala ng aso?' });
  assert.match(d.reply, /itatanong ko po muna sa owner/);
  assert.equal(A.profileName({ first_name: 'Ana', last_name: 'Reyes' }), 'Ana Reyes');
  assert.equal(A.profileName({ error: { message: 'nope' } }), '');
});

test('the guest’s Facebook name is used for the saved day', () => {
  const c = ctxWith();
  const d = A.decide(c, A.fallbackParse(c, 'Nov 12 po'), { psid: '123456789', name: 'Ana Reyes' });
  assert.equal(d.changes[0].set.guest, 'Ana Reyes');
  const anon = A.decide(c, A.fallbackParse(c, 'Nov 12 po'), { psid: '123456789' });
  assert.equal(anon.changes[0].set.guest, 'Guest 6789');
});

test('a guest asking about a free day gets the exact price and the day is saved', () => {
  const c = ctxWith();
  const p = A.fallbackParse(c, 'Hi po! Avail pa po ba Nov 12? 15 kami, overnight. May videoke po?');
  const d = A.decide(c, p, { psid: 'G1', text: 'x' });
  assert.match(d.reply, /Free pa po ang Thu, Nov 12/);
  assert.match(d.reply, /₱7,000/);
  assert.match(d.reply, /₱3,500 downpayment/);
  assert.match(d.reply, /bukas, 10:14 PM/);
  assert.equal(d.changes.length, 1);
  assert.equal(d.changes[0].set.status, 'saved');
  assert.deepEqual(d.changes[0].ifStatusIn, ['empty', 'promo']);
  assert.equal(d.saveDate, '2026-11-12');
  assert.equal(d.chat.set.last_date, '2026-11-12');
  assert.match(d.conflictReply, /kakakuha lang po ng ibang guest/);
});

test('promo days add the perk; late checkout drops to breakfast if the next day is taken', () => {
  const free = ctxWith([{ date: '2026-11-17', status: 'promo', perk: 'late' }]);
  const r1 = A.decide(free, A.fallbackParse(free, 'Nov 17 po overnight'), { psid: 'G1' });
  assert.match(r1.reply, /late checkout/);
  const taken = ctxWith([{ date: '2026-11-17', status: 'promo', perk: 'late' }, { date: '2026-11-18', status: 'booked' }]);
  const r2 = A.decide(taken, A.fallbackParse(taken, 'Nov 17 po overnight'), { psid: 'G1' });
  assert.match(r2.reply, /breakfast/);
  assert.doesNotMatch(r2.reply, /late checkout/);
});

test('a general promo question cannot confirm the previous booking, even if the AI returns it', () => {
  const text = 'kailan date may promo?';
  const c = ctxWith([
    { date: '2026-11-14', status: 'booked', psid: 'G1' },
    { date: '2026-11-20', status: 'promo', perk: 'breakfast' }
  ], { chat: { psid: 'G1', last_date: '2026-11-14', last_type: 'overnight', last_pax: '15' } });
  const p = A.normalizeParsed(c, { intent: 'book', dates: ['2026-11-14'], type: 'overnight', pax: 15, topics: [], name: '' }, text);
  assert.equal(p.intent, 'ask_promo');
  assert.deepEqual(p.dates, []);
  assert.ok(p.topics.includes('promo'));
  const d = A.decide(c, p, { psid: 'G1', text });
  assert.match(d.reply, /Fri, Nov 20.*free breakfast/);
  assert.doesNotMatch(d.reply, /Nov 14|Confirmed|downpayment|GCash/);
  assert.deepEqual(d.changes, []);
  assert.equal(d.chat, null);
  assert.equal(d.saveDate, null);
});

test('promo discovery lists only current available calendar perks, including expired holds', () => {
  const c = ctxWith([
    { date: '2026-11-09', status: 'promo', perk: 'breakfast' },
    { date: '2026-11-11', status: 'booked', perk: 'breakfast' },
    { date: '2026-11-12', status: 'saved', perk: 'breakfast', psid: 'G2', saved_until: '2026-11-11T22:14:00+08:00' },
    { date: '2026-11-13', status: 'saved', perk: 'breakfast', psid: 'G2', saved_until: '2026-11-10T21:00:00+08:00' },
    { date: '2026-11-14', status: 'receipt', perk: 'breakfast' },
    { date: '2026-11-15', status: 'blocked', perk: 'breakfast' },
    { date: '2026-11-16', status: 'empty' },
    { date: '2026-11-17', status: 'promo', perk: 'late' },
    { date: '2026-11-18', status: 'booked' },
    { date: '2026-11-20', status: 'promo', perk: 'late' }
  ]);
  const text = 'What dates have promos?';
  const d = A.decide(c, A.fallbackParse(c, text), { psid: 'G1', text });
  assert.match(d.reply, /Nov 13.*free breakfast/);
  assert.match(d.reply, /Nov 17.*free breakfast/);
  assert.match(d.reply, /Nov 20.*late checkout/);
  assert.doesNotMatch(d.reply, /Nov (9|11|12|14|15|16|18)\b/);
  assert.deepEqual(d.changes, []);
});

test('a date-specific promo inquiry reads its perk without saving the date', () => {
  const c = ctxWith([{ date: '2026-11-20', status: 'promo', perk: 'breakfast' }]);
  const text = 'May promo po ba Nov 20? 15 kami overnight';
  const d = A.decide(c, A.fallbackParse(c, text), { psid: 'G1', text });
  assert.match(d.reply, /Nov 20.*free breakfast/);
  assert.deepEqual(d.changes, []);
  assert.equal(d.saveDate, null);
  assert.equal(d.chat.set.last_date, '2026-11-20');
  const noPromo = A.decide(c, A.fallbackParse(c, 'may promo ba Nov 19?'), { psid: 'G1', text: 'may promo ba Nov 19?' });
  assert.match(noPromo.reply, /Nov 19: Wala pong promo perk/);
  assert.doesNotMatch(noPromo.reply, /free breakfast/);
  assert.deepEqual(noPromo.changes, []);
});

test('promo lookup honors the current hold and late-checkout restriction', () => {
  const text = 'may promo ba Nov 20?';
  const c = ctxWith([
    { date: '2026-11-20', status: 'saved', perk: 'late', psid: 'G1', saved_until: '2026-11-11T22:14:00+08:00' },
    { date: '2026-11-21', status: 'booked' }
  ]);
  const mine = A.decide(c, A.fallbackParse(c, text), { psid: 'G1', text });
  assert.match(mine.reply, /free breakfast.*naka-save sa inyo/);
  assert.doesNotMatch(mine.reply, /late checkout|Confirmed/);
  assert.deepEqual(mine.changes, []);
  const other = A.decide(c, A.fallbackParse(c, text), { psid: 'G2', text });
  assert.match(other.reply, /Hindi na po available/);
  assert.doesNotMatch(other.reply, /free breakfast|Confirmed/);
});

test('old promo posts never make a removed calendar promo appear active', () => {
  const c = ctxWith([], { promos: [{ days: '2026-11-20', perk: 'breakfast', text: 'Old promo' }] });
  const text = 'kailan date may promo?';
  const d = A.decide(c, A.fallbackParse(c, text), { psid: 'G1', text });
  assert.match(d.reply, /Wala pa pong available na upcoming promo dates/);
  assert.doesNotMatch(d.reply, /Nov 20|free breakfast/);
  assert.deepEqual(d.changes, []);
});

test('only an explicit reference reuses the last date for a promo inquiry', () => {
  const c = ctxWith([{ date: '2026-11-20', status: 'promo', perk: 'breakfast' }], {
    chat: { psid: 'G1', last_date: '2026-11-20', last_type: 'overnight' }
  });
  const text = 'may promo ba sa date na yun?';
  const d = A.decide(c, A.fallbackParse(c, text), { psid: 'G1', text });
  assert.match(d.reply, /Nov 20.*free breakfast/);
  assert.equal(d.chat.set.last_date, '2026-11-20');
  assert.deepEqual(d.changes, []);
});

test('asking for a day-tour promo never promises an overnight perk', () => {
  const c = ctxWith([{ date: '2026-11-20', status: 'promo', perk: 'breakfast' }]);
  const text = 'may promo ba Nov 20 day tour?';
  const d = A.decide(c, A.fallbackParse(c, text), { psid: 'G1', text });
  assert.match(d.reply, /Wala pong naka-set na promo para sa day tour/);
  assert.doesNotMatch(d.reply, /free breakfast/);
  assert.deepEqual(d.changes, []);
});

test('an explicit booking request still saves the date and includes its promo perk', () => {
  const c = ctxWith([{ date: '2026-11-20', status: 'promo', perk: 'breakfast' }]);
  const text = 'book na po Nov 20 overnight 15 kami, may promo?';
  const d = A.decide(c, A.fallbackParse(c, text), { psid: 'G1', text });
  assert.match(d.reply, /free breakfast/);
  assert.equal(d.saveDate, '2026-11-20');
  assert.equal(d.changes[0].set.status, 'saved');
  assert.equal(d.alert, null);
});

test('booked days get a sorry with nearby free days, promo days first', () => {
  const c = ctxWith([{ date: '2026-11-14', status: 'booked' }, { date: '2026-11-20', status: 'promo', perk: 'breakfast' }]);
  const d = A.decide(c, A.fallbackParse(c, 'pwede po ba Nov 14? barkada kami'), { psid: 'G2' });
  assert.match(d.reply, /booked na po ang Sat, Nov 14/);
  assert.match(d.reply, /Fri, Nov 20/);
  assert.match(d.reply, /promo perk/);
  assert.equal(d.changes.length, 0);
});

test('one saved day per guest: asking for another day frees the old one', () => {
  const c = ctxWith([{ date: '2026-11-15', status: 'saved', psid: 'G3', guest: 'Ana', saved_until: '2026-11-11T09:00:00+08:00' }]);
  const d = A.decide(c, A.fallbackParse(c, 'Nov 12 na lang po'), { psid: 'G3' });
  assert.equal(d.changes.length, 2);
  assert.equal(d.changes[1].date, '2026-11-15');
  assert.equal(d.changes[1].set.status, 'empty');
  assert.match(d.reply, /Na-release ko na po ang dati ninyong naka-save na Nov 15/);
});

test('"sige po" after an offer saves the day they asked about', () => {
  const c = ctxWith([], { chat: { psid: 'G4', last_date: '2026-11-12', last_type: 'overnight', last_pax: '25' } });
  const d = A.decide(c, A.fallbackParse(c, 'sige po book na namin'), { psid: 'G4' });
  assert.equal(d.saveDate, '2026-11-12');
  assert.match(d.reply, /₱9,500/);
});

test('questions without an answer go to the owner', () => {
  const c = ctxWith();
  const d = A.decide(c, { intent: 'question', dates: [], type: 'unknown', pax: 0, topics: ['pets', 'checkin'], name: '' }, { psid: 'G5', text: 'pwede po aso? anong oras check in?' });
  assert.match(d.reply, /2:00 PM po ang check-in/);
  assert.match(d.reply, /itatanong ko po muna sa owner/);
  assert.ok(d.alert);
});

test('day tours ask for the group size before saving', () => {
  const c = ctxWith();
  const d = A.decide(c, A.fallbackParse(c, 'day tour po sa Nov 12'), { psid: 'G6' });
  assert.match(d.reply, /Ilan po kayo/);
  assert.equal(d.changes.length, 0);
  const c2 = ctxWith([], { chat: { psid: 'G6', last_date: '2026-11-12', last_type: 'daytour' } });
  const d2 = A.decide(c2, A.fallbackParse(c2, '12 kami po'), { psid: 'G6' });
  assert.match(d2.reply, /12 × ₱300 = ₱3,600/);
  assert.equal(d2.saveDate, '2026-11-12');
});

test('cancelling frees a saved day; paid ones go to the owner', () => {
  const c = ctxWith([
    { date: '2026-11-12', status: 'saved', psid: 'G7', saved_until: '2026-11-11T22:00:00+08:00' },
    { date: '2026-11-20', status: 'receipt', psid: 'G7', guest: 'Ben' }
  ]);
  const d = A.decide(c, A.fallbackParse(c, 'cancel na po namin'), { psid: 'G7' });
  assert.equal(d.changes.length, 1);
  assert.match(d.reply, /na-cancel na po ang Nov 12/);
  assert.ok(d.alert);
});

test('a photo from a guest with a saved day becomes a receipt for the owner to check', () => {
  const c = ctxWith([{ date: '2026-11-12', status: 'saved', psid: 'G8', guest: 'Ana', price: 7000, saved_until: '2026-11-11T22:14:00+08:00' }]);
  const d = A.decideReceipt(c, { psid: 'G8', imageUrl: 'https://img/1.jpg' });
  assert.equal(d.changes[0].set.status, 'receipt');
  assert.match(d.alert.text, /₱3,500 expected/);
  const none = A.decideReceipt(ctxWith(), { psid: 'G9', imageUrl: 'x' });
  assert.match(none.reply, /Para saang date po ito/);
});

test('reading Facebook webhook events', () => {
  const body = { object: 'page', entry: [{ id: 'PAGE', messaging: [
    { sender: { id: '1' }, message: { mid: 'm1', text: 'hello' } },
    { sender: { id: '1' }, message: { mid: 'm1', text: 'hello' } },
    { sender: { id: '2' }, message: { mid: 'm2', attachments: [{ type: 'image', payload: { url: 'https://x/r.jpg' } }] } },
    { sender: { id: '3' }, message: { mid: 'm3', attachments: [{ type: 'image', payload: { url: 'https://x/like.png', sticker_id: 369239263222822 } }] } },
    { sender: { id: 'PAGE' }, message: { mid: 'm4', text: 'our reply', is_echo: true } },
    { sender: { id: '4' }, postback: { title: 'Get Started', payload: 'GET_STARTED' } },
    { sender: { id: '5' }, delivery: { mids: ['m1'] } }
  ] }] };
  const ev = A.readMessengerEvents(body);
  assert.deepEqual(ev.map(e => [e.psid, e.kind]), [['1', 'text'], ['2', 'image'], ['3', 'other'], ['4', 'text']]);
});

test('owner actions', () => {
  const c = ctxWith([
    { date: '2026-11-12', status: 'receipt', psid: 'G1', type: 'overnight', perk: 'breakfast' },
    { date: '2026-11-13', status: 'saved', psid: 'G2', saved_until: '2026-11-11T22:00:00+08:00' },
    { date: '2026-11-21', status: 'blocked', note: 'Pool cleaning' },
    { date: '2026-11-24', status: 'promo', perk: 'breakfast' }
  ]);
  const ok = A.ownerAction(c, { action: 'confirm', date: '2026-11-12' });
  assert.equal(ok.changes[0].set.status, 'booked');
  assert.match(ok.notice.text, /Confirmed na po ang overnight ninyo sa Thu, Nov 12/);
  const rel = A.ownerAction(c, { action: 'release', date: '2026-11-13' });
  assert.equal(rel.changes[0].set.status, 'empty');
  assert.ok(rel.notice);
  assert.equal(A.ownerAction(c, { action: 'release', date: '2026-11-12' }).changes[0].set.status, 'promo');
  const walkin = A.ownerAction(c, { action: 'book', date: '2026-11-25', guest: 'Cruz family', pax: 22 });
  assert.equal(walkin.changes[0].set.price, 8000);
  assert.equal(A.ownerAction(c, { action: 'unblock', date: '2026-11-21' }).changes[0].set.status, 'empty');
  assert.equal(A.ownerAction(c, { action: 'unpromo', date: '2026-11-24' }).changes[0].set.perk, '');
  assert.ok(A.ownerAction(c, { action: 'confirm', date: '2026-11-25' }).error);
  assert.ok(A.ownerAction(c, { action: 'block', date: '2026-11-12' }).error);
});

test('the timer frees unpaid days and tells the guest', () => {
  const c = ctxWith([
    { date: '2026-11-12', status: 'saved', psid: 'G1', saved_until: '2026-11-10T20:00:00+08:00' },
    { date: '2026-11-17', status: 'saved', psid: 'G2', saved_until: '2026-11-10T21:00:00+08:00', perk: 'late' },
    { date: '2026-11-13', status: 'saved', psid: 'G3', saved_until: '2026-11-11T21:00:00+08:00' }
  ]);
  const x = A.expireSaves(c);
  assert.deepEqual(x.changes.map(ch => [ch.date, ch.set.status]), [['2026-11-12', 'empty'], ['2026-11-17', 'promo']]);
  assert.equal(x.notices.length, 2);
});

test('if another guest saved the day a moment earlier, the reply changes', () => {
  const c = ctxWith();
  const d = A.decide(c, A.fallbackParse(c, 'Nov 12 po'), { psid: 'G1' });
  assert.equal(A.finalReply(d, [{ date: '2026-11-12', ok: true }]).reply, d.reply);
  const lost = A.finalReply(d, [{ date: '2026-11-12', ok: false, status: 'saved' }]);
  assert.ok(lost.conflict);
  assert.match(lost.reply, /kakakuha lang po ng ibang guest/);
});

test('calendar view for the owner app', () => {
  const c = ctxWith([
    { date: '2026-11-12', status: 'receipt', psid: 'G1', guest: 'Ana', price: 7000, receipt: 'https://img' },
    { date: '2026-11-17', status: 'promo', perk: 'late' },
    { date: '2026-11-18', status: 'booked', guest: 'Ben', price: 7000 }
  ], { promos: [{ id: 'P1', days: '2026-11-16,2026-11-17', perk: 'late', text: 'Promo!' }] });
  const v = A.calendarView(c, '2026-11-01', '2026-11-30');
  assert.equal(v.days.length, 30);
  const d17 = v.days.find(d => d.date === '2026-11-17');
  assert.equal(d17.perk, 'breakfast'); // the 18th is booked, so no late checkout
  assert.equal(v.waiting.length, 1);
  assert.equal(v.waiting[0].down, 3500);
  assert.equal(v.days.find(d => d.date === '2026-11-30').holiday, 'Bonifacio Day');
  assert.equal(v.promos[0].live, true);
});

test('settings from the app are checked', () => {
  const s = A.settingsChange({ weekday_price: '7,500', hold_hours: 'abc', perks: 'late, spa', hacker: 'x' });
  assert.deepEqual(s.settings, { weekday_price: '7500', perks: 'late' });
  assert.equal(s.errors.length, 1);
});
