/*
 * avail engine: the plain-code part of avail. No AI in here.
 *
 *   - prices (weekday, weekend and holiday rates, extra guests, day tours, downpayment)
 *   - promo plans (which perk each day gets, late checkout only if the next day is free)
 *   - post templates and the checks every AI-written post must pass
 *   - what to reply to a guest, and which day to save for them
 *   - owner actions (confirm, release, walk-in booking, block)
 *   - the hourly clean-up of unpaid saved days
 *
 * The AI (Groq) only turns a guest's message into data (date, type, number of people,
 * topics) and writes post drafts. Every price and every decision comes from here.
 *
 * This same file runs in the tests and inside the n8n Code nodes (build.mjs pastes it in).
 * All dates use Philippine time (UTC+8, no daylight saving).
 */
const AVAIL = (() => {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Dates                                                               */
  /* ------------------------------------------------------------------ */
  const DAY = 86400000, PH = 8 * 3600000;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = n => String(n).padStart(2, '0');
  const str = v => String(v === null || v === undefined ? '' : v).trim();
  const toMs = t => (t === null || t === undefined || t === '') ? Date.now() : typeof t === 'number' ? t : Date.parse(t);
  const isoOfUtc = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const msOfIso = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };

  function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOfUtc(msOfIso(s)) === s; }
  function normDate(v) { const s = str(v).slice(0, 10); return isIso(s) ? s : null; }
  function todayIso(now) { return isoOfUtc(toMs(now) + PH); }
  function addDays(s, n) { return isoOfUtc(msOfIso(s) + n * DAY); }
  function weekday(s) { return new Date(msOfIso(s)).getUTCDay(); }
  function daysInMonth(s) { const [y, m] = s.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function nice(s) { const d = new Date(msOfIso(s)); return `${WDAY[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; }
  function short(s) { const d = new Date(msOfIso(s)); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; }
  function stamp(t) {
    const p = new Date(toMs(t) + PH);
    return `${isoOfUtc(p.getTime())}T${pad(p.getUTCHours())}:${pad(p.getUTCMinutes())}:${pad(p.getUTCSeconds())}+08:00`;
  }
  function clock(t) {
    const p = new Date(toMs(t) + PH);
    let h = p.getUTCHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${pad(p.getUTCMinutes())} ${ap}`;
  }
  // "mamayang 6:00 PM", "bukas, 6:00 PM" or "Nov 14, 6:00 PM"
  function whenText(t, now) {
    const d = todayIso(t), today = todayIso(now);
    if (d === today) return `mamayang ${clock(t)}`;
    if (d === addDays(today, 1)) return `bukas, ${clock(t)}`;
    return `${short(d)}, ${clock(t)}`;
  }
  function dayRanges(list) {
    const days = [...new Set(list)].filter(isIso).sort();
    const out = [];
    for (const s of days) {
      const last = out[out.length - 1];
      if (last && addDays(last.end, 1) === s) last.end = s; else out.push({ start: s, end: s });
    }
    return out.map(r => {
      if (r.start === r.end) return short(r.start);
      return r.start.slice(0, 7) === r.end.slice(0, 7) ? `${short(r.start)}–${Number(r.end.slice(8))}` : `${short(r.start)}–${short(r.end)}`;
    });
  }
  function joinList(a, word) {
    word = word || 'and';
    if (a.length <= 1) return a[0] || '';
    return a.slice(0, -1).join(', ') + ` ${word} ` + a[a.length - 1];
  }
  const peso = n => '₱' + Math.round(Number(n) || 0).toLocaleString('en-US');
  function num(v, fallback) {
    const s = String(v === null || v === undefined ? '' : v).replace(/[₱,\s]/g, '');
    const n = Number(s);
    return s !== '' && Number.isFinite(n) ? n : fallback;
  }

  /* ------------------------------------------------------------------ */
  /* The calendar and settings                                           */
  /* ------------------------------------------------------------------ */
  const STATUSES = ['empty', 'promo', 'saved', 'receipt', 'booked', 'blocked'];
  const TAKEN = ['saved', 'receipt', 'booked', 'blocked'];
  const OPEN = ['empty', 'promo'];
  const PERKS = ['breakfast', 'late'];
  const CLEAR = { guest: '', psid: '', type: '', pax: '', price: '', saved_until: '', receipt: '' };
  const isTaken = st => TAKEN.includes(st);

  // state = what the Sheet's data API returns (settings, days, holidays, rules, chat, promos)
  function buildCtx(state, now) {
    state = state || {};
    const s = state.settings || {};
    const perks = str(s.perks || 'breakfast,late').toLowerCase().split(',').map(x => x.trim()).filter(x => PERKS.includes(x));
    const set = {
      resortName: str(s.resort_name) || 'the resort',
      location: str(s.location),
      weekday: num(s.weekday_price, 7000),
      weekend: num(s.weekend_price, 10000),
      included: num(s.included_guests, 20),
      extraFee: num(s.extra_guest_fee, 500),
      dtSmall: num(s.daytour_small_price, 2000),
      dtUnder: num(s.daytour_small_under, 10),
      dtPer: num(s.daytour_per_person, 300),
      downPct: num(s.downpayment_percent, 50),
      holdHours: num(s.hold_hours, 24),
      gcashNumber: str(s.gcash_number),
      gcashName: str(s.gcash_name),
      perks: perks.length ? perks : ['breakfast'],
      perkText: {
        breakfast: str(s.breakfast_text) || 'free breakfast para sa buong grupo',
        late: str(s.late_text) || 'late checkout'
      },
      quoteExtra: s.quote_extra === undefined ? 'Libre rin po ang videoke.' : str(s.quote_extra)
    };
    const days = new Map();
    for (const r of state.days || []) {
      const d = normDate(r.date);
      if (d) days.set(d, Object.assign({}, r, { date: d }));
    }
    const holidays = new Map();
    for (const h of state.holidays || []) {
      const d = normDate(h.date);
      if (d) holidays.set(d, str(h.name) || 'Holiday');
    }
    const rules = (state.rules || []).map(r => ({
      topic: str(r.topic).toLowerCase(),
      keywords: str(r.keywords).toLowerCase().split(',').map(x => x.trim()).filter(Boolean),
      answer: str(r.answer)
    })).filter(r => r.topic);
    const nowMs = toMs(now !== undefined ? now : state.now);
    return { set, days, holidays, rules, nowMs, today: todayIso(nowMs), chat: state.chat || null, promos: state.promos || [] };
  }

  const rowOf = (ctx, d) => ctx.days.get(d) || null;
  function expired(ctx, r) {
    const t = Date.parse(str(r.saved_until));
    return Number.isFinite(t) && t <= ctx.nowMs;
  }
  // What a day is right now. Saved days whose time ran out count as free again.
  function statusOf(ctx, d) {
    const r = rowOf(ctx, d);
    if (!r) return 'empty';
    let st = str(r.status).toLowerCase();
    if (!STATUSES.includes(st)) st = 'empty';
    if (st === 'saved' && expired(ctx, r)) return str(r.perk) ? 'promo' : 'empty';
    return st;
  }
  function guestRows(ctx, psid) {
    if (!str(psid)) return [];
    return [...ctx.days.values()].filter(r => str(r.psid) === str(psid) && r.date >= ctx.today).sort((a, b) => a.date < b.date ? -1 : 1);
  }

  /* ------------------------------------------------------------------ */
  /* Prices (code, never AI)                                             */
  /* ------------------------------------------------------------------ */
  const isHoliday = (ctx, d) => ctx.holidays.has(d);
  function rateOf(ctx, d) {
    if (isHoliday(ctx, d)) return 'holiday';
    const w = weekday(d);
    return w === 0 || w === 6 ? 'weekend' : 'weekday';
  }
  const basePrice = (ctx, d) => rateOf(ctx, d) === 'weekday' ? ctx.set.weekday : ctx.set.weekend;
  const downOf = (ctx, total) => Math.round(total * ctx.set.downPct / 100);
  function quote(ctx, d, type, pax) {
    pax = Math.max(0, Math.floor(num(pax, 0)));
    if (type === 'daytour') {
      const total = pax >= ctx.set.dtUnder ? pax * ctx.set.dtPer : ctx.set.dtSmall;
      return { date: d, type: 'daytour', pax, base: total, extra: 0, total, rate: rateOf(ctx, d), down: downOf(ctx, total) };
    }
    const base = basePrice(ctx, d);
    const extra = Math.max(0, pax - ctx.set.included);
    const total = base + extra * ctx.set.extraFee;
    return { date: d, type: 'overnight', pax, base, extra, total, rate: rateOf(ctx, d), down: downOf(ctx, total) };
  }
  // The promo perk a guest gets on day d, checked right now.
  // Late checkout falls back to breakfast if the next day got taken.
  function perkLive(ctx, d) {
    const r = rowOf(ctx, d);
    const p = r ? str(r.perk).toLowerCase() : '';
    if (!PERKS.includes(p)) return null;
    if (p === 'late' && isTaken(statusOf(ctx, addDays(d, 1)))) return 'breakfast';
    return p;
  }

  /* ------------------------------------------------------------------ */
  /* Promo posts                                                         */
  /* ------------------------------------------------------------------ */
  function isPayday(d) {
    const day = Number(d.slice(8));
    return (day >= 15 && day <= 18) || day >= Math.min(30, daysInMonth(d)) || day <= 3;
  }
  function planPromo(ctx, days, choice) {
    const want = [...new Set((days || []).map(normDate).filter(Boolean))].sort();
    const ok = [], skipped = [];
    for (const d of want) {
      const st = statusOf(ctx, d);
      if (d < ctx.today) skipped.push({ date: d, why: 'past' });
      else if (!OPEN.includes(st)) skipped.push({ date: d, why: st });
      else ok.push(d);
    }
    choice = PERKS.includes(choice) && ctx.set.perks.includes(choice) ? choice : ctx.set.perks[0];
    const picked = new Set(ok), perks = {}, lateBlocked = [];
    for (const d of ok) {
      if (choice !== 'late') { perks[d] = 'breakfast'; continue; }
      const next = addDays(d, 1), nextSt = statusOf(ctx, next);
      if (picked.has(next)) { perks[d] = 'breakfast'; lateBlocked.push({ date: d, why: `${short(next)} is also in this promo` }); }
      else if (isTaken(nextSt)) { perks[d] = 'breakfast'; lateBlocked.push({ date: d, why: `${short(next)} is ${nextSt}` }); }
      else perks[d] = 'late';
    }
    return {
      days: ok, skipped, choice, perks, lateBlocked,
      weekdayDays: ok.filter(d => rateOf(ctx, d) === 'weekday'),
      weekendDays: ok.filter(d => rateOf(ctx, d) !== 'weekday'),
      holidays: ok.filter(d => isHoliday(ctx, d)).map(d => ({ date: d, name: ctx.holidays.get(d) })),
      payday: ok.some(isPayday)
    };
  }
  function priceLine(ctx, plan) {
    const wd = plan.weekdayDays.length, we = plan.weekendDays.length;
    if (wd && !we) return `${peso(ctx.set.weekday)} lang po ang overnight`;
    if (we && !wd) return `${peso(ctx.set.weekend)} po ang overnight`;
    return `${peso(ctx.set.weekday)} tuwing weekdays at ${peso(ctx.set.weekend)} tuwing weekends at holidays ang overnight`;
  }
  function perkSentence(ctx, plan) {
    const keys = [...new Set(plan.days.map(d => plan.perks[d]))];
    if (keys.length === 1) return `may ${ctx.set.perkText[keys[0]]} kayo`;
    const late = plan.days.filter(d => plan.perks[d] === 'late');
    const bf = plan.days.filter(d => plan.perks[d] === 'breakfast');
    return `may ${ctx.set.perkText.late} kayo sa ${joinList(dayRanges(late), 'at')}, at ${ctx.set.perkText.breakfast} sa ${joinList(dayRanges(bf), 'at')}`;
  }
  function templatePost(ctx, plan) {
    const hook = plan.payday ? ' Sakto sa sweldo!' : '';
    const hol = plan.holidays.length ? ` (kasama ang ${joinList(plan.holidays.map(h => h.name), 'at')})` : '';
    const extra = ctx.set.quoteExtra ? ` ${ctx.set.quoteExtra}` : '';
    return `Promo days sa ${ctx.set.resortName}!${hook} Bakante pa po ang ${joinList(dayRanges(plan.days), 'at')}${hol}. ` +
      `Mag-book ng overnight sa mga araw na ito at ${perkSentence(ctx, plan)}! ` +
      `${priceLine(ctx, plan)}, good for up to ${ctx.set.included} guests.${extra} ` +
      `Sa inyo lang ang buong resort, isang grupo lang bawat araw, kaya first come, first served. ` +
      `Message lang po kami dito para ma-save ang date!`;
  }
  const POST_SCHEMA = {
    type: 'object',
    properties: { post: { type: 'string' } },
    required: ['post'],
    additionalProperties: false
  };
  function postPrompt(ctx, plan) {
    const S = ctx.set;
    const perkFacts = [...new Set(Object.values(plan.perks))].map(k => {
      const on = plan.days.filter(d => plan.perks[d] === k);
      return `${k === 'late' ? 'late checkout' : 'free breakfast for the whole group'} on ${joinList(dayRanges(on))}`;
    }).join('; ');
    const wd = plan.weekdayDays.length, we = plan.weekendDays.length;
    const price = wd && !we ? `${peso(S.weekday)} per night`
      : we && !wd ? `${peso(S.weekend)} per night`
      : `${peso(S.weekday)} on weekdays, ${peso(S.weekend)} on weekends and holidays`;
    const facts = [
      `Resort: ${S.resortName}${S.location ? `, ${S.location}` : ''}. The whole resort is private to one group per day.`,
      `Days to promote (mention them exactly): ${joinList(dayRanges(plan.days))}.`,
      `Overnight price, the regular price with no discount: ${price}. Good for up to ${S.included} guests, ${peso(S.extraFee)} per extra guest.`,
      `Perk for booking these days: ${perkFacts}.`,
      plan.holidays.length ? `Holidays among these days: ${plan.holidays.map(h => `${short(h.date)} (${h.name})`).join(', ')}.` : null,
      plan.payday ? 'Some of these days are right after payday (the 15th or 30th). You may mention it casually, like "sakto sa sweldo".' : null,
      S.quoteExtra ? `Also true, you may mention it: ${S.quoteExtra}` : null,
      'To book: message the Facebook page. First come, first served.'
    ].filter(Boolean);
    const system = [
      'You write short Facebook posts for a small private pool resort in the Philippines that wants to fill empty days.',
      'Write in natural, friendly Taglish, the way a Filipino resort owner posts. 3 to 5 sentences. No hashtags. At most 2 emoji.',
      'Use only the facts given. Write prices exactly as given, with the peso sign and comma (for example ₱7,000).',
      'Never mention a discount, sale, promo price, percent off, or any price or amenity that is not in the facts. The perk is the offer.',
      'Return only JSON: {"post": "..."}'
    ].join('\n');
    return [{ role: 'system', content: system }, { role: 'user', content: facts.map(f => '- ' + f).join('\n') }];
  }
  // Every AI-written post must pass these checks or the template is used instead.
  function checkPost(ctx, plan, text) {
    const t = str(text), problems = [];
    if (t.length < 60) problems.push('too short');
    if (t.length > 1500) problems.push('too long');
    const has = n => t.includes(peso(n).slice(1)) || t.includes(String(n));
    if (plan.weekdayDays.length && !has(ctx.set.weekday)) problems.push(`doesn't say ${peso(ctx.set.weekday)}`);
    if (plan.weekendDays.length && !has(ctx.set.weekend)) problems.push(`doesn't say ${peso(ctx.set.weekend)}`);
    if (/%|discount|diskwento|\bless\b|bawas|\bsale\b|\boff\b/i.test(t)) problems.push('mentions a discount');
    const used = new Set(Object.values(plan.perks));
    if (used.has('breakfast') && !/breakfast|almusal/i.test(t)) problems.push('missing the breakfast perk');
    if (used.has('late') && !/check.?out/i.test(t)) problems.push('missing late checkout');
    const allowed = new Set([ctx.set.weekday, ctx.set.weekend, ctx.set.extraFee].map(String));
    for (const m of t.matchAll(/₱\s?([\d,]+)/g)) {
      const v = m[1].replace(/,/g, '');
      if (!allowed.has(v)) problems.push(`unknown price ₱${m[1]}`);
    }
    return { ok: problems.length === 0, problems };
  }
  function finishPost(ctx, plan, aiText) {
    const check = checkPost(ctx, plan, aiText);
    if (aiText && check.ok) return { text: str(aiText), by: 'ai', problems: [] };
    return { text: templatePost(ctx, plan), by: 'template', problems: aiText ? check.problems : ['the AI did not answer'] };
  }

  /* ------------------------------------------------------------------ */
  /* Reading guest messages (AI first, simple rules as a backup)         */
  /* ------------------------------------------------------------------ */
  const BUILTIN_TOPICS = ['price', 'capacity', 'daytour', 'payment', 'promo'];
  const topicList = ctx => [...new Set([...BUILTIN_TOPICS, ...ctx.rules.map(r => r.topic)])];
  const INTENTS = ['ask_date', 'ask_promo', 'book', 'question', 'greeting', 'thanks', 'cancel', 'other'];
  const PARSE_SCHEMA = {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: INTENTS },
      dates: { type: 'array', items: { type: 'string' } },
      type: { type: 'string', enum: ['overnight', 'daytour', 'unknown'] },
      pax: { type: 'integer' },
      topics: { type: 'array', items: { type: 'string' } },
      name: { type: 'string' }
    },
    required: ['intent', 'dates', 'type', 'pax', 'topics', 'name'],
    additionalProperties: false
  };
  function parsePrompt(ctx, text) {
    const last = ctx.chat && normDate(ctx.chat.last_date);
    const memory = last && last >= ctx.today
      ? `Earlier in this chat the guest asked about ${nice(last)} (${last})${str(ctx.chat.last_type) ? ', ' + str(ctx.chat.last_type) : ''}${num(ctx.chat.last_pax, 0) ? ', ' + num(ctx.chat.last_pax, 0) + ' people' : ''}.`
      : 'There is no earlier date in this chat.';
    const system = [
      'You read Facebook Messenger messages sent to a small private pool resort in the Philippines and turn them into data. You never reply to the guest.',
      'Messages are in English, Tagalog or Taglish, often short and informal ("avail pa po?", "hm po", "sa 12", "15 kami", "pm sent").',
      `Today is ${nice(ctx.today)} (${ctx.today}) in the Philippines.`,
      memory,
      'Fill in:',
      '- intent: "ask_promo" if they ask which dates have promos or whether a date has a promo/perk ("kailan date may promo?", "may promo ba Nov 20?"); this is only an inquiry, never a request to reserve. "ask_date" for other questions about a specific day (is it free, how much); "book" if they explicitly want to reserve or say yes to an offer ("sige po", "game", "kunin na namin", "book na"); "question" for other questions (rules, amenities, location, payment); "greeting" for a hello only; "thanks" for thanks or ok; "cancel" if they cancel; "other" for anything else.',
      '- dates: every check-in date they mention, as YYYY-MM-DD, always the nearest date that is today or later. "bukas" = tomorrow. "sa Sabado" = the coming Saturday. If only a day number is given ("sa 12"), use the next date with that day number. For an overnight range like "Nov 12-13", return only the check-in date. Empty list if they give no date, including when they say yes to the earlier offer.',
      'Never copy a date from earlier chat into dates. A general promo inquiry such as "kailan date may promo?" has dates: []. The application looks up live promo dates and decides how to use chat context.',
      '- type: "daytour" for day tour, day use or "umaga lang"; "overnight" for overnight or a stay; otherwise "unknown".',
      '- pax: total number of people (adults plus kids) as an integer. "15 + 3 kids" = 18. 0 if not said.',
      `- topics: which of these the message asks about: ${topicList(ctx).join(', ')}. Use only these words. Empty list if none.`,
      '- name: the guest\'s own name if they say it, otherwise "".',
      'Return only the JSON object.'
    ].join('\n');
    return [{ role: 'system', content: system }, { role: 'user', content: str(text).slice(0, 1500) }];
  }
  function aiRequest(model, messages, name, schema, temperature) {
    return {
      model,
      messages,
      temperature: temperature === undefined ? 0 : temperature,
      max_completion_tokens: 1500,
      reasoning_effort: 'low',
      include_reasoning: false,
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }
    };
  }
  function readAiJson(resp) {
    try {
      const c = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
      return c ? JSON.parse(c) : null;
    } catch (e) { return null; }
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const WEEKDAYS = { linggo: 0, sunday: 0, sun: 0, lunes: 1, monday: 1, mon: 1, martes: 2, tuesday: 2, tue: 2, tues: 2, miyerkules: 3, wednesday: 3, wed: 3, huwebes: 4, thursday: 4, thu: 4, thurs: 4, biyernes: 5, friday: 5, fri: 5, sabado: 6, saturday: 6, sat: 6 };
  function nextDate(ctx, month, day) {
    const y = Number(ctx.today.slice(0, 4));
    for (const yy of [y, y + 1]) {
      const s = `${yy}-${pad(month + 1)}-${pad(day)}`;
      if (isIso(s) && s >= ctx.today) return s;
    }
    return null;
  }
  function nextDayNumber(ctx, day) {
    for (let i = 0; i < 400; i++) {
      const d = addDays(ctx.today, i);
      if (Number(d.slice(8)) === day) return d;
    }
    return null;
  }
  // Backup reader: used when the AI is down or answers something unusable.
  function fallbackParse(ctx, text) {
    const t = ' ' + str(text).toLowerCase().replace(/\s+/g, ' ') + ' ';
    const dates = [];
    let m;
    const reMD = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})(?!\d)/g;
    while ((m = reMD.exec(t))) { const d = nextDate(ctx, MONTHS.indexOf(m[1]), Number(m[2])); if (d) dates.push(d); }
    const reDM = /\b(\d{1,2})\s*(?:de\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g;
    while ((m = reDM.exec(t))) { const d = nextDate(ctx, MONTHS.indexOf(m[2]), Number(m[1])); if (d) dates.push(d); }
    const reNum = /\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g;
    while ((m = reNum.exec(t))) { const d = nextDate(ctx, Number(m[1]) - 1, Number(m[2])); if (d) dates.push(d); }
    if (!dates.length) {
      if (/\b(bukas|tomorrow|tmrw)\b/.test(t)) dates.push(addDays(ctx.today, 1));
      else if (/\b(tonight|ngayong gabi|today|ngayon)\b/.test(t)) dates.push(ctx.today);
    }
    if (!dates.length) {
      const w = t.match(/\b(linggo|lunes|martes|miyerkules|huwebes|biyernes|sabado|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
      if (w) {
        let add = (WEEKDAYS[w[1]] - weekday(ctx.today) + 7) % 7;
        if (add === 0) add = 7;
        dates.push(addDays(ctx.today, add));
      }
    }
    if (!dates.length) {
      const n = t.match(/\b(?:sa|on|ng|date|petsa)\s+(\d{1,2})(?!\d)(?!\s*(?:kami|pax|tao|katao|guests?|people|persons?|adults?|bata|kids?))/);
      if (n) { const d = nextDayNumber(ctx, Number(n[1])); if (d) dates.push(d); }
    }
    let pax = 0;
    const pm = t.match(/(\d{1,3})\s*(?:na\s+)?(kami|pax|tao|katao|guests?|people|persons?|adults?|heads?)\b/);
    if (pm) pax = Number(pm[1]);
    const kids = t.match(/\+\s*(\d{1,3})\s*(kids?|bata|children|chikiting)/);
    if (pax && kids) pax += Number(kids[1]);
    const type = /day\s?tour|day\s?trip|day\s?use|umaga lang|morning swim|swimming lang/.test(t) ? 'daytour'
      : /overnight|over night|mag-?stay|magdamag|22\s?h/.test(t) ? 'overnight' : 'unknown';
    const topics = [];
    if (/magkano|how much|\bhm\b|presyo|price|rate\b|rates/.test(t)) topics.push('price');
    if (/kasya|capacity|\bmax\b|maximum/.test(t)) topics.push('capacity');
    if (type === 'daytour' && !dates.length) topics.push('daytour');
    if (/gcash|\bbayad|payment|downpayment|\bdp\b|paano mag/.test(t)) topics.push('payment');
    if (/\b(promos?|promotions?|perks?|offers?|discounts?|free breakfast|late checkout|libreng almusal)\b/.test(t)) topics.push('promo');
    for (const r of ctx.rules) if (r.keywords.some(k => k && t.includes(k))) topics.push(r.topic);
    let intent;
    if (/\bcancel|hindi na (kami )?tuloy|di na (kami )?tuloy|hindi na kami/.test(t)) intent = 'cancel';
    else if (topics.includes('promo') && !/\b(book|reserve|reserba|sige|game|kunin|tuloy|go na|g na)\b/.test(t)) intent = 'ask_promo';
    else if (/\b(book|reserve|reserba|sige|game|kunin|tuloy|go na|g na)\b/.test(t)) intent = 'book';
    else if (dates.length) intent = 'ask_date';
    else if (topics.length) intent = 'question';
    else if (/salamat|thank|\bty\b|\bok\b|okay|noted/.test(t)) intent = 'thanks';
    else if (/\b(hi|hello|hey|good (morning|afternoon|evening)|magandang)\b/.test(t)) intent = 'greeting';
    else intent = 'other';
    return { intent, dates: [...new Set(dates)].slice(0, 3), type, pax, topics: [...new Set(topics)], name: '', by: 'rules' };
  }
  // Cleans up whatever the AI returned. Falls back to the simple reader if it's unusable.
  function normalizeParsed(ctx, raw, text) {
    const fb = fallbackParse(ctx, text);
    if (!raw || typeof raw !== 'object' || !INTENTS.includes(raw.intent)) return fb;
    let dates = (Array.isArray(raw.dates) ? raw.dates : []).map(normDate).filter(Boolean).map(d => {
      if (d >= ctx.today) return d;
      const next = `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
      return isIso(next) && next >= ctx.today && next <= addDays(ctx.today, 400) ? next : null;
    }).filter(d => d && d <= addDays(ctx.today, 400));
    if (!dates.length && fb.dates.length && /\d/.test(str(text))) dates = fb.dates;
    // A promo question must not inherit an unrelated booking date invented from chat memory.
    if (fb.intent === 'ask_promo') {
      if (fb.dates.length) dates = fb.dates;
      else if (!/\d|\b(bukas|tomorrow|tmrw|tonight|today|ngayon|linggo|lunes|martes|miyerkules|huwebes|biyernes|sabado|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(str(text))) dates = [];
    }
    const known = new Set(topicList(ctx));
    // The owner's own keywords (Rules tab) always count, even if the AI missed them.
    const ruleTopics = new Set(['promo', ...ctx.rules.map(r => r.topic)]);
    const topics = [...(Array.isArray(raw.topics) ? raw.topics : []).map(x => str(x).toLowerCase()).filter(x => known.has(x)), ...fb.topics.filter(x => ruleTopics.has(x))];
    let intent = fb.intent === 'ask_promo' ? 'ask_promo' : raw.intent;
    if (topics.length && ['greeting', 'other', 'thanks'].includes(intent)) intent = 'question';
    return {
      intent,
      dates: [...new Set(dates)].slice(0, 3),
      type: ['overnight', 'daytour'].includes(raw.type) ? raw.type : fb.type,
      pax: Number.isInteger(raw.pax) && raw.pax > 0 && raw.pax < 500 ? raw.pax : fb.pax,
      topics: [...new Set(topics)],
      name: str(raw.name).slice(0, 60),
      by: 'ai'
    };
  }

  /* ------------------------------------------------------------------ */
  /* Replying to guests                                                  */
  /* ------------------------------------------------------------------ */
  function topicAnswers(ctx, topics, hasDate) {
    const S = ctx.set, text = [], unknown = [];
    const gcash = S.gcashNumber ? ` (${S.gcashNumber}${S.gcashName ? ', ' + S.gcashName : ''})` : '';
    for (const tp of topics || []) {
      if (tp === 'promo') continue; // Live calendar perks are answered by promoReply/offerText.
      else if (tp === 'price') { if (!hasDate) text.push(`${peso(S.weekday)} po ang overnight tuwing weekdays at ${peso(S.weekend)} tuwing weekends at holidays, good for up to ${S.included} guests (${peso(S.extraFee)} bawat dagdag na guest).`); }
      else if (tp === 'capacity') { if (!hasDate) text.push(`Good for up to ${S.included} guests po ang presyo, at ${peso(S.extraFee)} bawat dagdag na guest.`); }
      else if (tp === 'daytour') { if (!hasDate) text.push(`Day tour po: ${peso(S.dtSmall)} para sa grupo na mas kaunti sa ${S.dtUnder}, o ${peso(S.dtPer)} bawat isa kung ${S.dtUnder} pataas. Pwede lang po kapag walang naka-book na overnight sa araw na iyon.`); }
      else if (tp === 'payment') text.push(`GCash po ang bayad${gcash}. ${S.downPct}% downpayment para ma-save ang date, tapos i-send lang dito ang screenshot ng receipt.`);
      else {
        const r = ctx.rules.find(x => x.topic === tp);
        if (r && r.answer) { if (!(hasDate && S.quoteExtra && S.quoteExtra.toLowerCase().includes(tp))) text.push(r.answer); }
        else unknown.push(tp);
      }
    }
    return { text: [...new Set(text)], unknown };
  }
  function alternatives(ctx, d, exclude) {
    const skip = new Set(exclude || [d]);
    const ok = x => x > ctx.today && !skip.has(x) && OPEN.includes(statusOf(ctx, x));
    const promos = [];
    for (let i = -14; i <= 45; i++) { const x = addDays(d, i); if (ok(x) && statusOf(ctx, x) === 'promo') promos.push(x); }
    promos.sort((a, b) => Math.abs(msOfIso(a) - msOfIso(d)) - Math.abs(msOfIso(b) - msOfIso(d)));
    const out = promos.slice(0, 3);
    for (let i = 1; i <= 21 && out.length < 3; i++) {
      for (const x of [addDays(d, i), addDays(d, -i)]) if (out.length < 3 && ok(x) && !out.includes(x)) out.push(x);
    }
    return { dates: out.sort(), promo: out.some(x => statusOf(ctx, x) === 'promo') };
  }
  function sorryText(ctx, d, st, type, exclude) {
    const what = st === 'blocked' ? `sarado po kami sa ${nice(d)}` : `booked na po ang ${nice(d)}`;
    let s = `Pasensya na po, ${what}${type === 'daytour' && st !== 'blocked' ? ', kaya hindi na rin po pwede ang day tour' : ''}.`;
    const alt = alternatives(ctx, d, exclude);
    if (alt.dates.length) s += ` Bakante pa po ang ${joinList(alt.dates.map(nice), 'at')}${alt.promo ? ' (may promo perk pa sa ilan)' : ''}. Gusto niyo po ba ang isa dito?`;
    else s += ' Anong ibang date po ang pwede sa inyo?';
    return s;
  }
  function offerText(ctx, q, perk, untilMs, o) {
    const S = ctx.set, parts = [];
    if (q.type === 'daytour') {
      parts.push(`Pwede po ang day tour sa ${nice(q.date)}!`);
      parts.push(q.pax >= S.dtUnder ? `${q.pax} × ${peso(S.dtPer)} = ${peso(q.total)} po.` : `${peso(S.dtSmall)} po para sa grupo na mas kaunti sa ${S.dtUnder}.`);
    } else {
      parts.push(o.own ? `Naka-save na po sa inyo ang ${nice(q.date)}.` : `Hello po! Free pa po ang ${nice(q.date)}.`);
      let line;
      if (q.extra) line = `${peso(q.base)} po ang overnight para sa up to ${S.included} guests, plus ${q.extra} extra × ${peso(S.extraFee)}, kaya ${peso(q.total)} po lahat`;
      else if (q.pax) line = `${peso(q.total)} po ang overnight para sa ${q.pax} kayo (good for up to ${S.included} guests)`;
      else line = `${peso(q.total)} po ang overnight, good for up to ${S.included} guests (${peso(S.extraFee)} bawat dagdag na guest)`;
      if (q.rate === 'holiday') line += `. Holiday rate po ito (${ctx.holidays.get(q.date)})`;
      parts.push(line + '.');
      if (perk) parts.push(`Promo day po ito, kaya kasama na ang ${S.perkText[perk]}!`);
    }
    if (S.quoteExtra) parts.push(S.quoteExtra);
    const gcash = S.gcashNumber ? ` sa GCash (${S.gcashNumber}${S.gcashName ? ', ' + S.gcashName : ''})` : ' sa GCash';
    parts.push(`${o.own ? 'Naka-save po' : 'Sine-save ko po muna'} ang ${short(q.date)} para sa inyo hanggang ${whenText(untilMs, ctx.nowMs)}. Para ma-confirm, pa-send po ng ${peso(q.down)} downpayment${gcash}, tapos i-send dito ang screenshot ng receipt.`);
    if (o.released && o.released.length) parts.push(`(Na-release ko na po ang dati ninyong naka-save na ${joinList(o.released.map(short), 'at')}.)`);
    return parts.join(' ');
  }
  function releaseChange(ctx, d, psid) {
    const r = rowOf(ctx, d) || {};
    return { date: d, ifStatusIn: ['saved', 'promo', 'empty'], ifPsid: psid, set: Object.assign({ status: str(r.perk) ? 'promo' : 'empty' }, CLEAR) };
  }
  const guestLabel = r => str(r.guest) || 'A guest';

  function promoReply(ctx, dates, type, psid) {
    if (type === 'daytour') return 'Para sa overnight bookings po ang mga promo perk namin. Wala pong naka-set na promo para sa day tour.';
    if (dates.length) return dates.map(d => {
      const row = rowOf(ctx, d) || {}, st = statusOf(ctx, d);
      const ownSave = st === 'saved' && str(row.psid) === psid;
      if (!OPEN.includes(st) && !ownSave) return `${nice(d)}: Hindi na po available ang date na ito para sa bagong reservation.`;
      const perk = perkLive(ctx, d);
      return perk ? `${nice(d)}: May ${ctx.set.perkText[perk]} po para sa overnight booking${ownSave ? ' na naka-save sa inyo' : ''}. Regular rate pa rin po ang presyo.`
        : `${nice(d)}: Wala pong promo perk na naka-set sa date na ito. Regular rate po ang overnight.`;
    }).join('\n');
    const all = [...ctx.days.keys()].filter(d => d >= ctx.today && OPEN.includes(statusOf(ctx, d)) && perkLive(ctx, d)).sort();
    if (!all.length) return 'Wala pa pong available na upcoming promo dates sa calendar namin ngayon. Anong date po ang gusto ninyo para ma-check ang availability at regular rate?';
    const shown = all.slice(0, 10);
    return `${all.length > shown.length ? 'Ilan po sa available promo dates' : 'Ito po ang available promo dates'} para sa overnight:\n` +
      shown.map(d => `• ${nice(d)} — ${ctx.set.perkText[perkLive(ctx, d)]}`).join('\n') +
      '\nRegular rate pa rin po ang presyo; dagdag na perk ang promo. Aling date po ang gusto ninyo?';
  }

  // msg = { psid, text, name? }  p = normalizeParsed(...)
  function decide(ctx, p, msg) {
    const S = ctx.set, psid = str(msg.psid);
    const out = { psid, reply: '', changes: [], chat: null, alert: null, saveDate: null, conflictReply: '', parsed: p };
    const chat = ctx.chat || {};
    const lastDate = normDate(chat.last_date);
    let dates = (p.dates || []).filter(d => d >= ctx.today);
    const pastAsked = (p.dates || []).filter(d => d < ctx.today);
    if (p.intent === 'ask_promo' || ((p.topics || []).includes('promo') && p.intent !== 'book' && p.intent !== 'cancel')) {
      // Only an explicit reference to the previous date may reuse it for a promo lookup.
      if (!dates.length && lastDate && lastDate >= ctx.today && /\b(that (date|day)|same (date|day)|(?:date|araw|petsa)(?:\s+po)?\s+(?:na\s+)?(?:iyon|yun|yon)|doon|dun)\b/i.test(str(msg.text))) dates = [lastDate];
      const extra = topicAnswers(ctx, (p.topics || []).filter(t => t !== 'promo'), dates.length > 0);
      out.reply = [promoReply(ctx, dates, p.type, psid), ...extra.text].join(' ');
      if (dates.length) out.chat = { psid, set: { last_date: dates[0], last_type: p.type === 'daytour' ? 'daytour' : 'overnight', last_pax: p.pax || '' } };
      return out;
    }
    const wantsLast = p.intent === 'book' || p.intent === 'ask_date' || (p.topics || []).includes('price') || p.pax > 0;
    if (!dates.length && !pastAsked.length && wantsLast && lastDate && lastDate >= ctx.today) dates = [lastDate];
    const sameAsLast = dates[0] && dates[0] === lastDate;
    const type = p.type !== 'unknown' ? p.type : (sameAsLast && str(chat.last_type)) || 'overnight';
    const pax = p.pax || (sameAsLast ? num(chat.last_pax, 0) : 0);
    const name = str(p.name) || str(chat.name) || str(msg.name);
    const answers = topicAnswers(ctx, p.topics, dates.length > 0);
    const parts = [];
    const handoff = topics => {
      parts.push(`${topics.length ? `Tungkol naman po sa ${joinList(topics, 'at')}, i` : 'I'}tatanong ko po muna sa owner at babalikan ko kayo dito.`);
      out.alert = { title: 'A guest asked something avail can’t answer', text: `${name || 'A guest'} asked: “${str(msg.text).slice(0, 300)}”. Reply in Messenger.` };
    };
    const mine = guestRows(ctx, psid);

    if (p.intent === 'cancel') {
      const saved = mine.filter(r => statusOf(ctx, r.date) === 'saved');
      const paid = mine.filter(r => ['receipt', 'booked'].includes(statusOf(ctx, r.date)));
      for (const r of saved) out.changes.push(releaseChange(ctx, r.date, psid));
      if (saved.length) parts.push(`Sige po, na-cancel na po ang ${joinList(saved.map(r => short(r.date)), 'at')}. Message lang po ulit kung gusto niyo ng ibang araw.`);
      if (paid.length) {
        parts.push(`Para po sa ${joinList(paid.map(r => short(r.date)), 'at')}, ipapaalam ko po ito sa owner at babalikan ko kayo.`);
        out.alert = { title: 'A guest wants to cancel a paid booking', text: `${guestLabel(paid[0])} wants to cancel ${joinList(paid.map(r => nice(r.date)), 'and')}. Reply in Messenger.` };
      }
      if (!saved.length && !paid.length) parts.push('Sige po, walang problema. Message lang po kayo kapag may date na kayo.');
      out.chat = { psid, set: { name, last_date: '', last_type: '', last_pax: '' } };
      out.reply = parts.join(' ');
      return out;
    }

    if (!dates.length) {
      if (pastAsked.length) parts.push(`Lumipas na po ang ${short(pastAsked[0])}. Anong ibang date po kayo?`);
      if (answers.text.length) parts.push(...answers.text);
      if (answers.unknown.length) handoff(answers.unknown);
      else if (p.intent === 'question' && !answers.text.length) handoff([]);
      if (!pastAsked.length) {
        if (p.intent === 'thanks' && !answers.text.length && !out.alert) parts.push('Walang anuman po! Message lang po kayo anytime.');
        else if (!answers.text.length && !out.alert) parts.push(`Hello po! Salamat sa pag-message sa ${S.resortName}. Anong date po kayo pupunta, at overnight o day tour po? Halimbawa: “Nov 18, overnight, 15 kami”.`);
        else if (p.intent !== 'thanks') parts.push('Anong date po kayo pupunta?');
      }
      if (name && name !== str(chat.name)) out.chat = { psid, set: { name } };
      out.reply = parts.join(' ');
      return out;
    }

    // A date was given: find the first one this guest can have.
    const canHave = d => OPEN.includes(statusOf(ctx, d)) || (statusOf(ctx, d) === 'saved' && str((rowOf(ctx, d) || {}).psid) === psid);
    const d0 = dates.find(canHave);
    const notes = dates.filter(d => d !== d0 && !canHave(d) && (!d0 || d < d0));
    if (!d0) {
      const d = dates[0], st = statusOf(ctx, d), r = rowOf(ctx, d) || {};
      if (str(r.psid) === psid && st === 'receipt') parts.push(`Natanggap na po namin ang receipt ninyo para sa ${nice(d)}. Hinihintay na lang po ang confirmation ng owner.`);
      else if (str(r.psid) === psid && st === 'booked') parts.push(`Confirmed na po ang booking ninyo sa ${nice(d)}. See you po!`);
      else parts.push(sorryText(ctx, d, st, type, dates));
      if (answers.text.length) parts.push(...answers.text);
      if (answers.unknown.length) handoff(answers.unknown);
      out.chat = { psid, set: { name, last_date: '', last_type: type === 'daytour' ? 'daytour' : '', last_pax: pax || '' } };
      out.reply = parts.join(' ');
      return out;
    }
    if (notes.length) parts.push(`Booked na po ang ${joinList(notes.map(short), 'at')}.`);

    const row = rowOf(ctx, d0) || {};
    const own = statusOf(ctx, d0) === 'saved' && str(row.psid) === psid;
    if (type === 'daytour' && !pax) {
      parts.push(`Pwede po ang day tour sa ${nice(d0)}! ${peso(S.dtSmall)} po para sa grupo na mas kaunti sa ${S.dtUnder}, o ${peso(S.dtPer)} bawat isa kung ${S.dtUnder} pataas.${S.quoteExtra ? ' ' + S.quoteExtra : ''} Ilan po kayo?`);
      if (answers.text.length) parts.push(...answers.text);
      if (answers.unknown.length) handoff(answers.unknown);
      out.chat = { psid, set: { name, last_date: d0, last_type: 'daytour', last_pax: '' } };
      out.reply = parts.join(' ');
      return out;
    }

    const q = quote(ctx, d0, type, pax);
    const perk = type === 'overnight' && str(row.perk) ? perkLive(ctx, d0) : null;
    const until = own && Number.isFinite(Date.parse(str(row.saved_until))) ? Date.parse(str(row.saved_until)) : ctx.nowMs + S.holdHours * 3600000;
    out.changes.push({
      date: d0,
      ifStatusIn: own ? ['saved'] : OPEN,
      ifPsid: own ? psid : undefined,
      set: { status: 'saved', guest: name || `Guest ${psid.slice(-4)}`, psid, type: q.type, pax: pax || '', price: q.total, saved_until: stamp(until), receipt: '' }
    });
    const released = [];
    for (const r of mine) {
      if (r.date !== d0 && statusOf(ctx, r.date) === 'saved') { out.changes.push(releaseChange(ctx, r.date, psid)); released.push(r.date); }
    }
    parts.push(offerText(ctx, q, perk, until, { own, released }));
    if (answers.text.length) parts.push(...answers.text);
    if (answers.unknown.length) handoff(answers.unknown);
    out.saveDate = d0;
    out.conflictReply = `Pasensya na po, kakakuha lang po ng ibang guest ang ${nice(d0)}. ` + sorryText(ctx, d0, 'booked', type, dates).replace(/^Pasensya na po, booked na po ang [^.]+\.\s*/, '');
    out.chat = { psid, set: { name, last_date: d0, last_type: q.type, last_pax: pax || '' } };
    out.reply = parts.join(' ');
    return out;
  }

  // A photo from a guest: most likely their GCash receipt.
  function decideReceipt(ctx, msg) {
    const psid = str(msg.psid);
    const out = { psid, reply: '', changes: [], chat: null, alert: null, saveDate: null, conflictReply: '' };
    const rows = guestRows(ctx, psid).filter(r => ['saved', 'receipt'].includes(str(r.status).toLowerCase()));
    const saved = rows.find(r => str(r.status).toLowerCase() === 'saved');
    const r = saved || rows[0];
    if (r && saved) {
      out.changes.push({ date: r.date, ifStatusIn: ['saved', 'promo', 'empty'], ifPsid: psid, set: { status: 'receipt', receipt: str(msg.imageUrl) || 'photo', saved_until: '' } });
      out.reply = `Salamat po! Natanggap na po namin ang screenshot para sa ${nice(r.date)}. I-che-check lang po ng owner ang GCash at magko-confirm po kami agad dito.`;
      out.alert = { title: `Downpayment for ${nice(r.date)}`, text: `${guestLabel(r)} sent a GCash receipt (${peso(downOf(ctx, num(r.price, basePrice(ctx, r.date))))} expected). Check GCash, then confirm in avail.`, image: str(msg.imageUrl) };
    } else if (r) {
      out.reply = `Salamat po! Natanggap na po namin ito para sa ${nice(r.date)}. Hinihintay na lang po ang confirmation ng owner.`;
      out.alert = { title: `Another photo for ${nice(r.date)}`, text: `${guestLabel(r)} sent another photo. Check Messenger.`, image: str(msg.imageUrl) };
    } else {
      out.reply = 'Salamat po! Para saang date po ito? Pakisabi lang po para ma-check namin.';
      out.alert = { title: 'Photo from a guest', text: 'A guest sent a photo but has no saved day. Check Messenger.', image: str(msg.imageUrl) };
    }
    return out;
  }

  // Facebook's webhook body → one item per guest message.
  function readMessengerEvents(body) {
    const out = [], seen = new Set();
    for (const e of (body && body.entry) || []) {
      for (const m of e.messaging || []) {
        const psid = m.sender && str(m.sender.id);
        if (!psid) continue;
        if (m.postback) { out.push({ psid, kind: 'text', text: str(m.postback.title || m.postback.payload) || 'Hi', mid: '', pageId: str(e.id) }); continue; }
        const msg = m.message;
        if (!msg || msg.is_echo) continue;
        if (msg.mid) { if (seen.has(msg.mid)) continue; seen.add(msg.mid); }
        const img = (msg.attachments || []).find(a => a && a.type === 'image' && !(a.payload && a.payload.sticker_id));
        if (str(msg.text)) out.push({ psid, kind: 'text', text: str(msg.text).slice(0, 2000), mid: str(msg.mid), pageId: str(e.id) });
        else if (img) out.push({ psid, kind: 'image', imageUrl: str(img.payload && img.payload.url), mid: str(msg.mid), pageId: str(e.id) });
        else out.push({ psid, kind: 'other', mid: str(msg.mid), pageId: str(e.id) });
      }
    }
    return out;
  }
  // Facebook's profile lookup ({ first_name, last_name }) → "Ana Reyes". Empty if it failed.
  function profileName(resp) {
    if (!resp || resp.error) return '';
    return [str(resp.first_name), str(resp.last_name)].filter(Boolean).join(' ').slice(0, 60);
  }
  function sendBody(psid, text) {
    return { recipient: { id: str(psid) }, messaging_type: 'RESPONSE', message: { text: str(text).slice(0, 2000) } };
  }
  // After the Sheet answers: if someone else saved the day first, say so instead.
  function finalReply(decision, results) {
    const d = decision || {};
    const failed = (results || []).find(r => r && r.date === d.saveDate && !r.ok);
    if (d.saveDate && failed) return { reply: d.conflictReply, conflict: true };
    return { reply: d.reply, conflict: false };
  }

  /* ------------------------------------------------------------------ */
  /* The owner's app                                                     */
  /* ------------------------------------------------------------------ */
  function publicSettings(ctx) {
    const S = ctx.set;
    return {
      resortName: S.resortName, weekday: S.weekday, weekend: S.weekend, included: S.included, extraFee: S.extraFee,
      dtSmall: S.dtSmall, dtUnder: S.dtUnder, dtPer: S.dtPer, downPct: S.downPct, holdHours: S.holdHours,
      gcashNumber: S.gcashNumber, gcashName: S.gcashName, perks: S.perks, perkText: S.perkText, quoteExtra: S.quoteExtra
    };
  }
  function dayView(ctx, d) {
    const r = rowOf(ctx, d) || {}, st = statusOf(ctx, d);
    const v = { date: d, status: st, rate: rateOf(ctx, d), price: basePrice(ctx, d) };
    if (isHoliday(ctx, d)) v.holiday = ctx.holidays.get(d);
    if (st === 'promo') v.perk = perkLive(ctx, d) || str(r.perk);
    else if (['saved', 'receipt', 'booked'].includes(st) && str(r.perk)) v.perk = str(r.perk);
    if (['saved', 'receipt', 'booked'].includes(st)) {
      Object.assign(v, { guest: str(r.guest) || 'Guest', type: str(r.type) || 'overnight', pax: num(r.pax, 0), total: num(r.price, v.price), messenger: !!str(r.psid) });
      v.down = downOf(ctx, v.total);
    }
    if (st === 'saved') v.savedUntil = str(r.saved_until);
    if (st === 'receipt') v.receipt = str(r.receipt);
    if (str(r.note)) v.note = str(r.note);
    return v;
  }
  function calendarView(ctx, from, to) {
    from = normDate(from) || `${ctx.today.slice(0, 8)}01`;
    to = normDate(to) || addDays(from, 41);
    const days = [];
    for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) days.push(dayView(ctx, d));
    const waiting = [...ctx.days.keys()].filter(d => d >= ctx.today && ['saved', 'receipt'].includes(statusOf(ctx, d))).sort().map(d => dayView(ctx, d));
    const promos = (ctx.promos || []).slice().reverse().slice(0, 12).map(p => {
      const list = str(p.days).split(',').map(normDate).filter(Boolean);
      return {
        id: str(p.id), text: str(p.text), perk: str(p.perk), created: str(p.created), facebookPost: str(p.facebook_post),
        days: list.map(d => ({ date: d, status: statusOf(ctx, d) })),
        live: list.some(d => d >= ctx.today && statusOf(ctx, d) === 'promo')
      };
    });
    return { ok: true, today: ctx.today, from, to, settings: publicSettings(ctx), days, waiting, promos };
  }
  // Owner taps in the app: confirm, release, book (walk-in), block, unblock, unpromo.
  function ownerAction(ctx, b) {
    b = b || {};
    const out = { changes: [], notice: null, error: null };
    const d = normDate(b.date);
    if (!d) { out.error = 'Pick a day first.'; return out; }
    const r = rowOf(ctx, d) || {}, st = statusOf(ctx, d), a = str(b.action);
    const back = str(r.perk) && d >= ctx.today ? 'promo' : 'empty';
    const fail = msg => { out.error = msg; return out; };
    if (a === 'confirm') {
      if (!['saved', 'receipt'].includes(st)) return fail(`${nice(d)} has nothing waiting to confirm.`);
      out.changes.push({ date: d, ifStatusIn: ['saved', 'receipt'], set: { status: 'booked', saved_until: '' } });
      if (str(r.psid)) out.notice = { psid: str(r.psid), text: `Confirmed na po ang ${str(r.type) === 'daytour' ? 'day tour' : 'overnight'} ninyo sa ${nice(d)}! Salamat po, see you!` };
    } else if (a === 'release') {
      if (!['saved', 'receipt', 'booked'].includes(st)) return fail(`${nice(d)} isn't saved or booked.`);
      out.changes.push({ date: d, ifStatusIn: [st], set: Object.assign({ status: back }, CLEAR) });
      if (str(r.psid) && st !== 'booked') out.notice = { psid: str(r.psid), text: `Hello po! Na-release na po ang ${nice(d)}. Kung gusto niyo pa rin pong mag-book, message lang po ulit dito.` };
    } else if (a === 'book') {
      if (!OPEN.includes(st)) return fail(`${nice(d)} is already ${st}.`);
      const type = b.type === 'daytour' ? 'daytour' : 'overnight';
      const pax = Math.max(0, Math.floor(num(b.pax, 0)));
      const price = num(b.price, quote(ctx, d, type, pax).total);
      out.changes.push({ date: d, ifStatusIn: OPEN, set: { status: 'booked', guest: str(b.guest) || 'Walk-in', psid: '', type, pax: pax || '', price, saved_until: '', receipt: '', note: str(b.note) } });
    } else if (a === 'block') {
      if (!OPEN.includes(st)) return fail(`${nice(d)} is already ${st}.`);
      out.changes.push({ date: d, ifStatusIn: OPEN, set: Object.assign({ status: 'blocked', note: str(b.note) || 'Closed' }, CLEAR) });
    } else if (a === 'unblock') {
      if (st !== 'blocked') return fail(`${nice(d)} isn't closed.`);
      out.changes.push({ date: d, ifStatusIn: ['blocked'], set: { status: back, note: '' } });
    } else if (a === 'unpromo') {
      if (st !== 'promo') return fail(`${nice(d)} isn't a promo day.`);
      out.changes.push({ date: d, ifStatusIn: ['promo'], set: { status: 'empty', perk: '' } });
    } else return fail('Unknown action.');
    return out;
  }
  function promoChanges(ctx, plan, text, facebookPost) {
    const changes = plan.days.map(d => ({ date: d, ifStatusIn: OPEN, set: { status: 'promo', perk: plan.perks[d] } }));
    const kinds = [...new Set(Object.values(plan.perks))];
    const promo = {
      id: 'P' + stamp(ctx.nowMs).replace(/\D/g, '').slice(0, 14),
      days: plan.days.join(','),
      perk: kinds.length === 1 ? kinds[0] : 'mixed',
      text: str(text),
      facebook_post: str(facebookPost)
    };
    return { changes, promos: [promo] };
  }
  const SETTING_KEYS = {
    weekday_price: 'n', weekend_price: 'n', included_guests: 'n', extra_guest_fee: 'n',
    daytour_small_price: 'n', daytour_small_under: 'n', daytour_per_person: 'n',
    downpayment_percent: 'n', hold_hours: 'n',
    gcash_number: 's', gcash_name: 's', perks: 's', quote_extra: 's', resort_name: 's', location: 's'
  };
  function settingsChange(values) {
    const out = {}, errors = [];
    for (const [k, v] of Object.entries(values || {})) {
      if (!SETTING_KEYS[k]) continue;
      if (SETTING_KEYS[k] === 'n') {
        const n = num(v, NaN);
        if (!Number.isFinite(n) || n < 0) { errors.push(`${k} must be a number`); continue; }
        out[k] = String(n);
      } else out[k] = str(v).slice(0, 300);
    }
    if (out.perks !== undefined) out.perks = out.perks.split(',').map(x => x.trim().toLowerCase()).filter(x => PERKS.includes(x)).join(',') || 'breakfast';
    return { settings: out, errors };
  }

  /* ------------------------------------------------------------------ */
  /* The hourly timer                                                    */
  /* ------------------------------------------------------------------ */
  function expireSaves(ctx) {
    const changes = [], notices = [];
    for (const [d, r] of ctx.days) {
      if (str(r.status).toLowerCase() !== 'saved' || !expired(ctx, r)) continue;
      changes.push({ date: d, ifStatusIn: ['promo', 'empty'], ifPsid: str(r.psid) || undefined, set: Object.assign({ status: str(r.perk) && d >= ctx.today ? 'promo' : 'empty' }, CLEAR) });
      if (str(r.psid) && d >= ctx.today) notices.push({ date: d, psid: str(r.psid), text: `Hello po! Na-release na po ang ${nice(d)} dahil hindi po umabot ang downpayment. Kung gusto niyo pa rin, message lang po ulit at titingnan namin kung bakante pa.` });
    }
    return { changes, notices };
  }

  return {
    // dates and text
    todayIso, addDays, weekday, nice, short, stamp, whenText, dayRanges, joinList, peso, normDate, isIso,
    // calendar and prices
    buildCtx, statusOf, rateOf, quote, perkLive,
    // promos
    planPromo, templatePost, postPrompt, checkPost, finishPost, promoChanges, POST_SCHEMA,
    // guests
    parsePrompt, PARSE_SCHEMA, aiRequest, readAiJson, fallbackParse, normalizeParsed, decide, decideReceipt,
    readMessengerEvents, profileName, sendBody, finalReply,
    // owner
    calendarView, dayView, ownerAction, settingsChange,
    // timer
    expireSaves
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AVAIL;
