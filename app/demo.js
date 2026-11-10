/*
 * Demo mode: the whole avail backend, running inside the browser with sample bookings.
 * It answers exactly like the real n8n "Owner app" workflow, using the same engine.js,
 * so the app can be shown without internet, n8n or a Facebook page.
 * Nothing here is sent anywhere. Posts are written from the template (no AI in demo mode).
 */
const Demo = (() => {
  'use strict';
  const A = AVAIL;
  const KEY = 'avail.demo.v1';
  let db = null;

  const SETTINGS = {
    resort_name: 'Miranda’s Resort', location: 'Panlinlang, Arayat, Pampanga',
    weekday_price: '7000', weekend_price: '10000', included_guests: '20', extra_guest_fee: '500',
    daytour_small_price: '2000', daytour_small_under: '10', daytour_per_person: '300',
    downpayment_percent: '50', hold_hours: '24', gcash_number: '0917 000 0000', gcash_name: 'M. Santos',
    perks: 'breakfast,late', breakfast_text: 'free breakfast para sa buong grupo', late_text: 'late checkout',
    quote_extra: 'Libre rin po ang videoke.'
  };
  const HOLIDAYS = [
    ['2026-11-01', 'All Saints’ Day'], ['2026-11-02', 'All Souls’ Day'], ['2026-11-30', 'Bonifacio Day'],
    ['2026-12-08', 'Immaculate Conception'], ['2026-12-24', 'Christmas Eve'], ['2026-12-25', 'Christmas Day'],
    ['2026-12-30', 'Rizal Day'], ['2026-12-31', 'New Year’s Eve'], ['2027-01-01', 'New Year’s Day'],
    ['2027-02-06', 'Chinese New Year'], ['2027-03-25', 'Maundy Thursday'], ['2027-03-26', 'Good Friday'],
    ['2027-03-27', 'Black Saturday'], ['2027-04-09', 'Araw ng Kagitingan'], ['2027-05-01', 'Labor Day']
  ].map(([date, name]) => ({ date, name }));

  function nextWeekday(from, w) { let d = A.addDays(from, 1); while (A.weekday(d) !== w) d = A.addDays(d, 1); return d; }
  function seed() {
    const t = A.todayIso(), now = Date.now();
    const sat = nextWeekday(t, 6), sun = A.addDays(sat, 1);
    const wed = nextWeekday(A.addDays(t, 2), 3);
    const promoA = nextWeekday(A.addDays(t, 8), 2), promoB = A.addDays(promoA, 1);
    const days = [
      { date: A.addDays(sat, -7), status: 'booked', guest: 'Dela Cruz family', type: 'overnight', pax: 18, price: 10000 },
      { date: sat, status: 'booked', guest: 'Barkada outing', type: 'overnight', pax: 24, price: 12000 },
      { date: sun, status: 'receipt', guest: 'Ana Reyes', psid: 'demo-ana', type: 'overnight', pax: 20, price: 10000, receipt: 'photo' },
      { date: wed, status: 'saved', guest: 'Ben Cruz', psid: 'demo-ben', type: 'overnight', pax: 15, price: 7000, saved_until: A.stamp(now + 20 * 3600000) },
      { date: A.addDays(sat, 7), status: 'booked', guest: 'Company outing', type: 'overnight', pax: 30, price: 15000 },
      { date: promoA, status: 'promo', perk: 'breakfast' },
      { date: promoB, status: 'promo', perk: 'breakfast' },
      { date: A.addDays(sat, 13), status: 'blocked', note: 'Pool cleaning' },
      { date: A.addDays(sat, 14), status: 'booked', guest: 'Birthday party', type: 'overnight', pax: 20, price: 10000 }
    ];
    const promos = [{
      id: 'P-demo-1', days: `${promoA},${promoB}`, perk: 'breakfast', created: A.stamp(now - 26 * 3600000), facebook_post: '',
      text: `Promo days sa Miranda’s Resort! Bakante pa po ang ${A.dayRanges([promoA, promoB]).join('')}. Mag-book ng overnight sa mga araw na ito at may free breakfast para sa buong grupo kayo! ₱7,000 lang po ang overnight, good for up to 20 guests. Libre rin po ang videoke. Message lang po kami dito para ma-save ang date!`
    }];
    return { settings: Object.assign({}, SETTINGS), days, holidays: HOLIDAYS, rules: [], promos, chats: [] };
  }
  function load() {
    if (db) return db;
    try { const raw = localStorage.getItem(KEY); if (raw) db = JSON.parse(raw); } catch (e) { db = null; }
    if (!db || !db.days) db = seed();
    return db;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* private window: keep it in memory */ } }
  function reset() { db = seed(); save(); }

  // Same rules as Code.gs: check the day is still what we expect, then write.
  function effective(row) {
    if (!row) return 'empty';
    const st = String(row.status || 'empty');
    if (st === 'saved' && row.saved_until && Date.parse(row.saved_until) <= Date.now()) return row.perk ? 'promo' : 'empty';
    return st;
  }
  function apply(body) {
    const results = [];
    for (const c of body.changes || []) {
      let row = db.days.find(r => r.date === c.date);
      const st = effective(row);
      if (c.ifStatusIn && !c.ifStatusIn.includes(st)) { results.push({ date: c.date, ok: false, status: st, why: 'status' }); continue; }
      if (c.ifPsid && String(row ? row.psid || '' : '') !== String(c.ifPsid)) { results.push({ date: c.date, ok: false, status: st, why: 'someone else' }); continue; }
      if (!row) { row = { date: c.date }; db.days.push(row); }
      Object.assign(row, c.set || {});
      results.push({ date: c.date, ok: true, status: row.status });
    }
    for (const p of body.promos || []) db.promos.push(Object.assign({ created: A.stamp(Date.now()) }, p));
    if (body.settings) for (const [k, v] of Object.entries(body.settings)) db.settings[k] = String(v);
    save();
    return { ok: true, now: A.stamp(Date.now()), results, echo: body.echo === undefined ? null : body.echo };
  }

  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function call(action, p) {
    load();
    await wait(250);
    p = p || {};
    const ctx = A.buildCtx({ settings: db.settings, days: db.days, holidays: db.holidays, rules: db.rules, promos: db.promos });
    if (action === 'state') return A.calendarView(ctx, p.from, p.to);
    if (action === 'draft') {
      const plan = A.planPromo(ctx, p.days, p.perk);
      if (!plan.days.length) return { ok: false, error: 'None of those days are open anymore.', plan };
      await wait(600);
      return Object.assign({ ok: true, plan }, A.finishPost(ctx, plan, null), { by: 'demo', problems: [] });
    }
    if (action === 'publish') {
      const plan = A.planPromo(ctx, p.days, p.perk);
      const text = String(p.text || '').trim() || A.templatePost(ctx, plan);
      const out = A.promoChanges(ctx, plan, text, '');
      return apply({ changes: out.changes, promos: plan.days.length ? out.promos : [], echo: { posted: false, facebookPost: '', facebookError: p.toFacebook ? 'Demo mode: nothing is posted to Facebook.' : '', days: plan.days, skipped: plan.skipped, perks: plan.perks } });
    }
    if (action === 'booking') {
      const out = A.ownerAction(ctx, Object.assign({}, p, { action: p.op }));
      return apply({ changes: out.changes, echo: { op: p.op, date: p.date, error: out.error, notice: out.notice } });
    }
    if (action === 'settings') {
      const out = A.settingsChange(p.settings);
      return apply({ settings: out.settings, echo: { errors: out.errors } });
    }
    return { ok: false, error: 'Unknown action' };
  }
  return { call, reset };
})();
