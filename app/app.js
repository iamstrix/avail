/*
 * avail owner app. A plain web app the owner adds to their phone's home screen.
 * It only talks to n8n (the "avail · Owner app" workflow). n8n talks to the Sheet,
 * the AI and Facebook. In demo mode it runs the same engine in the browser instead.
 */
(() => {
  'use strict';
  const A = AVAIL;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('avail.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('avail.' + k, JSON.stringify(v)); } catch (e) { /* private window */ } }
  };
  const ICON = {
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
  };
  const TAKEN = ['saved', 'receipt', 'booked', 'blocked'];
  const STATUS_WORDS = { empty: 'Empty', promo: 'On promo', saved: 'Saved for a guest, waiting for the downpayment', receipt: 'Downpayment sent, check your GCash', booked: 'Booked', blocked: 'Closed' };

  const S = {
    view: 'calendar', month: null, data: null, loading: false, error: '', busy: '',
    picked: new Set(), draft: null, sheet: null, dismissed: new Set(),
    conn: { url: LS.get('url', ''), key: LS.get('key', ''), demo: LS.get('demo', null) }
  };
  const isDemo = () => S.conn.demo === true || (S.conn.demo === null && !S.conn.url);

  /* ---------------- Talking to n8n ---------------- */
  async function api(action, payload) {
    if (isDemo()) {
      const r = await Demo.call(action, payload || {});
      if (r && r.ok === false) throw new Error(r.error || 'Something went wrong.');
      return r;
    }
    if (!S.conn.url) throw new Error('Add your n8n address in Settings first.');
    let res;
    try {
      // text/plain keeps this a "simple" request, so no extra CORS round trip is needed.
      res = await fetch(S.conn.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: S.conn.key, action }, payload || {})) });
    } catch (e) {
      throw new Error('Can’t reach n8n. Check your internet connection and the n8n address in Settings.');
    }
    let j = null;
    try { j = await res.json(); } catch (e) { j = null; }
    if (res.status === 401) throw new Error('Wrong owner key. Check it in Settings.');
    if (res.status === 404) throw new Error('n8n says this address doesn’t exist. Is the “avail · Owner app” workflow published, and is the address right?');
    if (!res.ok || !j) throw new Error((j && j.error) || `n8n answered with an error (${res.status}).`);
    if (j.ok === false) throw new Error(j.error === 'bad key' ? 'n8n can’t open the Google Sheet: the Sheet key in n8n is wrong.' : (j.error || 'Something went wrong.'));
    return j;
  }

  /* ---------------- Dates ---------------- */
  const pad = n => String(n).padStart(2, '0');
  const lastDay = m => { const [y, mo] = m.split('-').map(Number); return `${m}-${pad(new Date(Date.UTC(y, mo, 0)).getUTCDate())}`; };
  const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
  const monthName = m => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  function untilText(stamp) {
    const t = Date.parse(stamp);
    if (!Number.isFinite(t)) return '';
    const day = A.todayIso(t), today = A.todayIso();
    const time = new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
    return day === today ? `today, ${time}` : day === A.addDays(today, 1) ? `tomorrow, ${time}` : `${A.short(day)}, ${time}`;
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /* ---------------- Loading ---------------- */
  async function loadMonth(quiet) {
    const today = (S.data && S.data.today) || A.todayIso();
    S.month = S.month || today.slice(0, 7);
    S.loading = true;
    if (!quiet) { S.error = ''; render(); } else renderTop();
    try {
      const from = `${S.month}-01`, to = lastDay(S.month);
      S.data = await api('state', { from, to });
      S.error = '';
      for (const d of [...S.picked]) { const x = dayOf(d); if (!x || !['empty', 'promo'].includes(x.status)) S.picked.delete(d); }
    } catch (e) {
      S.error = e.message;
    }
    S.loading = false;
    render();
  }
  const dayOf = date => S.data && (S.data.days.find(x => x.date === date) || S.data.waiting.find(x => x.date === date));

  /* ---------------- Rendering ---------------- */
  function renderTop() {
    $('#mode').hidden = !isDemo();
    $('#resortName').textContent = S.data ? S.data.settings.resortName : '';
    $('#refresh').classList.toggle('spin', S.loading);
    document.querySelectorAll('.tabs [data-view]').forEach(b => {
      const on = b.dataset.view === (S.view === 'draft' ? 'calendar' : S.view);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function render() {
    renderTop();
    const main = $('#main');
    main.innerHTML = S.view === 'draft' ? viewDraft() : S.view === 'promos' ? viewPromos() : S.view === 'settings' ? viewSettings() : viewCalendar();
    renderPick();
  }
  const errorBox = (msg, compact) => `<div class="error" role="alert"><div>${esc(msg)}</div>${compact ? '' : '<div class="btnrow"><button type="button" class="btn" data-act="refresh">Try again</button><button type="button" class="btn" data-act="tab" data-view="settings">Settings</button></div>'}</div>`;

  function viewCalendar() {
    const d = S.data;
    if (!d) return S.error ? `<div class="head"><div class="monthrow"><h2>Calendar</h2></div></div>${errorBox(S.error)}` : '<div class="head"><div class="monthrow"><h2>Loading…</h2></div></div><div class="pad"><div class="skeleton" style="height:380px"></div></div>';
    const m = S.month;
    const days = d.days.filter(x => x.date.slice(0, 7) === m);
    if (!days.length) return errorBox('No days came back for this month. Try refreshing.');
    const booked = days.filter(x => x.status === 'booked');
    const income = booked.reduce((s, x) => s + (Number(x.total) || Number(x.price) || 0), 0);
    const emptyWd = days.filter(x => x.date >= d.today && x.status === 'empty' && x.rate === 'weekday').length;
    let html = `<div class="head"><div class="monthrow">
        <button type="button" class="iconbtn" data-act="month" data-n="-1" aria-label="Previous month">${ICON.left}</button>
        <h2>${esc(monthName(m))}</h2>
        <button type="button" class="iconbtn" data-act="month" data-n="1" aria-label="Next month">${ICON.right}</button>
      </div><p>${plural(booked.length, 'day')} booked · ${A.peso(income)} · ${plural(emptyWd, 'empty weekday')} left</p></div>`;
    if (S.error) html += errorBox(S.error, true);
    if (isDemo() && S.conn.demo === null) html += `<div class="note" style="margin:0 16px 12px">You’re looking at sample bookings. To use your real calendar, add your n8n address in <button type="button" class="btn ghost" style="min-height:0;padding:0;color:var(--pink-text)" data-act="tab" data-view="settings">Settings</button>.</div>`;
    for (const w of d.waiting.filter(x => x.status === 'receipt' && !S.dismissed.has(x.date))) {
      html += `<div class="alert"><p><b>${esc(w.guest)}</b> sent a ${A.peso(w.down)} downpayment for <b>${A.nice(w.date)}</b>. Check your GCash, then confirm.</p>
        <div class="btnrow"><button type="button" class="btn navy" data-act="op" data-op="confirm" data-date="${w.date}"${S.busy ? ' disabled' : ''}>Confirm booking</button><button type="button" class="btn amber" data-act="day" data-date="${w.date}">Details</button></div></div>`;
    }
    const saved = d.waiting.filter(x => x.status === 'saved');
    if (saved.length) {
      html += `<div class="waiting"><h4>Waiting for a downpayment</h4>${saved.map(w => `<button type="button" class="rowbtn" data-act="day" data-date="${w.date}"><span class="tag">Saved</span><span class="grow"><b>${A.nice(w.date)}</b> · ${esc(w.guest)}<small>${A.peso(w.total)}, ${A.peso(w.down)} downpayment · saved until ${esc(untilText(w.savedUntil))}</small></span></button>`).join('')}</div>`;
    }
    html += grid(days, d.today);
    html += `<div class="cal"><div class="legend">
        <span><i style="background:var(--navy)"></i>Booked</span>
        <span><i style="background:var(--amber-soft);border:1px solid var(--amber)"></i>Saved / check GCash</span>
        <span><i style="background:var(--pink-soft)"></i>On promo</span>
        <span><i style="border:1px solid #C9CFE0"></i>Empty</span>
      </div></div>
      <p class="hint">Tap empty days to post a promo for them. Tap any other day to see who it’s for.</p>`;
    if (S.picked.size) html += '<div class="spacer"></div>';
    return html;
  }
  function grid(days, today) {
    let cells = '';
    for (let i = 0; i < A.weekday(days[0].date); i++) cells += '<span class="day blank" aria-hidden="true"></span>';
    for (const x of days) cells += cell(x, today);
    return `<div class="cal"><div class="dow" aria-hidden="true">${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(w => `<span>${w}</span>`).join('')}</div><div class="grid">${cells}</div></div>`;
  }
  const pickable = (x, today) => x.date >= today && (x.status === 'empty' || x.status === 'promo');
  function cell(x, today) {
    const past = x.date < today, picked = S.picked.has(x.date), pk = pickable(x, today);
    const small = picked ? 'Picked'
      : x.status === 'booked' ? 'Booked' : x.status === 'saved' ? 'Saved' : x.status === 'receipt' ? 'GCash'
      : x.status === 'promo' ? (x.perk === 'late' ? 'Late out' : 'Promo') : x.status === 'blocked' ? 'Closed'
      : (!past && x.holiday ? 'Holiday' : '');
    const cls = ['day', x.status, past && 'past', picked && 'picked', x.date === today && 'today', x.holiday && 'holiday'].filter(Boolean).join(' ');
    const desc = `${A.nice(x.date)}${x.holiday ? ' (' + x.holiday + ')' : ''}: ${picked ? 'picked' : past && x.status === 'empty' ? 'past' : STATUS_WORDS[x.status]}${x.guest ? ', ' + x.guest : ''}`;
    return `<button type="button" class="${cls}" data-act="${pk ? 'pick' : 'day'}" data-date="${x.date}" aria-label="${esc(desc)}"${pk ? ` aria-pressed="${picked}"${S.busy ? ' disabled' : ''}` : ''}><b>${Number(x.date.slice(8))}</b><small>${esc(small)}</small></button>`;
  }
  function renderPick() {
    const el = $('#pick');
    if (S.view !== 'calendar' || !S.picked.size || !S.data) { el.hidden = true; el.innerHTML = ''; return; }
    const dates = [...S.picked].sort();
    const items = dates.map(dayOf).filter(Boolean);
    const wd = items.filter(x => x.rate === 'weekday').length, we = items.length - wd;
    const set = S.data.settings;
    const price = !we ? `${wd === 1 ? 'a weekday' : 'all weekdays'} · ${A.peso(set.weekday)}${wd > 1 ? ' each' : ''}`
      : !wd ? `${we === 1 ? 'weekend or holiday' : 'weekends and holidays'} · ${A.peso(set.weekend)}${we > 1 ? ' each' : ''}`
      : `${A.peso(set.weekday)} weekdays · ${A.peso(set.weekend)} weekends`;
    const one = items.length === 1 ? items[0] : null;
    el.innerHTML = `<div><b>${plural(items.length, 'day')} picked</b><span>${esc(A.dayRanges(dates).join(', '))} · ${price}</span></div>
      <div class="btnrow"><button type="button" class="btn" data-act="clear" title="Remove promos from selected promo days and clear the selection"${S.busy ? ' disabled' : ''}>${S.busy === 'clear' ? 'Clearing…' : 'Clear'}</button><button type="button" class="btn pink" data-act="draft"${S.busy ? ' disabled' : ''}>Draft post →</button></div>
      ${one ? `<div class="more"><button type="button" class="btn" data-act="walkin" data-date="${one.date}">Mark as booked</button><button type="button" class="btn" data-act="op" data-op="block" data-date="${one.date}">Close this day</button>${one.status === 'promo' ? `<button type="button" class="btn" data-act="op" data-op="unpromo" data-date="${one.date}">Remove promo</button>` : ''}</div>` : ''}`;
    el.hidden = false;
  }

  /* ---------------- Draft a promo post ---------------- */
  async function clearPicked() {
    if (S.busy) return;
    const promos = [...S.picked].filter(date => dayOf(date)?.status === 'promo');
    if (!promos.length) { S.picked.clear(); render(); return; }
    S.busy = 'clear'; render();
    const failed = [];
    let cleared = 0;
    // Each existing owner action checks the current status before clearing its perk.
    // Keep concurrency bounded when an owner selects many promo dates.
    for (let i = 0; i < promos.length; i += 4) {
      const results = await Promise.all(promos.slice(i, i + 4).map(async date => {
        try {
          const r = await api('booking', { op: 'unpromo', date });
          if (r.echo?.error) throw new Error(r.echo.error);
          const result = (r.results || []).find(x => x.date === date);
          if (!result?.ok) throw new Error('This day changed. Check its current status.');
          return { date };
        } catch (err) { return { date, error: err.message || 'Could not remove the promo.' }; }
      }));
      for (const result of results) {
        if (result.error) failed.push(result);
        else cleared++;
      }
    }
    S.picked.clear();
    for (const result of failed) S.picked.add(result.date);
    S.busy = '';
    await loadMonth(true);
    toast(`${plural(cleared, 'promo')} cleared.${failed.length ? ` Couldn’t clear ${A.short(failed[0].date)}: ${failed[0].error}` : ''}`, failed.length ? 7000 : 3500);
  }

  function startDraft() {
    const set = S.data.settings;
    S.draft = { days: [...S.picked].sort(), perk: set.perks.includes('breakfast') ? 'breakfast' : set.perks[0], result: null, text: '', loading: false, error: '' };
    S.view = 'draft';
    render();
    window.scrollTo(0, 0);
    writeDraft();
  }
  async function writeDraft() {
    const dr = S.draft;
    if (!dr) return;
    dr.loading = true; dr.error = ''; dr.result = null;
    render();
    try {
      const r = await api('draft', { days: dr.days, perk: dr.perk });
      if (S.draft !== dr) return;
      dr.result = r; dr.text = r.text;
    } catch (e) {
      dr.error = e.message;
    }
    dr.loading = false;
    render();
  }
  function lateProblems(days) {
    const picked = new Set(days), out = [];
    for (const d of days) {
      const next = A.addDays(d, 1), x = dayOf(next);
      if (picked.has(next)) out.push(`${A.short(d)} (${A.short(next)} is also picked)`);
      else if (x && TAKEN.includes(x.status)) out.push(`${A.short(d)} (${A.short(next)} is ${x.status === 'blocked' ? 'closed' : 'taken'})`);
    }
    return out;
  }
  function viewDraft() {
    const dr = S.draft, set = S.data.settings;
    const late = lateProblems(dr.days);
    const option = (key, title, sub) => `<button type="button" class="opt${dr.perk === key ? ' on' : ''}" data-act="perk" data-perk="${key}" aria-pressed="${dr.perk === key}"${dr.loading ? ' disabled' : ''}><span class="dot"></span><span><b>${title}</b><small>${sub}</small></span></button>`;
    const lateSub = !late.length ? 'Guests can stay longer, since the next day is free'
      : late.length === dr.days.length ? `Not possible for these days, because the next day is picked or taken: ${esc(late.join(', '))}. They’ll get free breakfast instead.`
      : `Free breakfast instead on ${esc(late.join(', '))}`;
    const items = dr.days.map(dayOf).filter(Boolean);
    const wd = items.filter(x => x.rate === 'weekday').length;
    const price = !wd ? `${A.peso(set.weekend)} a night` : wd === items.length ? `${A.peso(set.weekday)} a night` : `${A.peso(set.weekday)} on weekdays, ${A.peso(set.weekend)} on weekends and holidays`;
    let html = `<div class="screen">
      <div class="back"><button type="button" class="iconbtn" data-act="back" aria-label="Back to the calendar">${ICON.left}</button><h2>New promo post</h2></div>
      <div class="field"><span class="label">Days</span><div class="chips">${A.dayRanges(dr.days).map(r => `<span class="chip">${esc(r)}</span>`).join('')}</div></div>
      <div class="field"><span class="label">Perk for booking these days</span>
        ${set.perks.includes('breakfast') ? option('breakfast', 'Free breakfast', 'For the whole group') : ''}
        ${set.perks.includes('late') ? option('late', 'Late checkout', lateSub) : ''}
      </div>
      <div class="note">${price}, the regular price. No discount: the perk is the offer.${set.quoteExtra ? ' ' + esc(set.quoteExtra) : ''}</div>`;
    if (dr.loading) html += '<div class="skeleton" role="status" aria-label="Writing the post"></div>';
    if (dr.error) html += `<div class="error" role="alert">${esc(dr.error)}<div class="btnrow"><button type="button" class="btn" data-act="write">Try again</button></div></div>`;
    if (dr.result) {
      const r = dr.result;
      const by = r.by === 'ai' ? 'Written by the AI (Groq). The prices come from your price list, not the AI.'
        : r.by === 'demo' ? 'Demo mode: written from the post template.'
        : `Written from the post template${r.problems && r.problems.length ? ` (the AI draft didn’t pass the checks: ${esc(r.problems.join(', '))})` : ''}.`;
      const skipped = r.plan && r.plan.skipped && r.plan.skipped.length ? `<div class="note">Left out: ${esc(r.plan.skipped.map(s => `${A.short(s.date)} (${s.why})`).join(', '))}.</div>` : '';
      html += `${skipped}<div class="post">
          <div class="who"><div class="avatar" aria-hidden="true">${esc((set.resortName || 'R').replace(/[^A-Za-z]/g, '').charAt(0) || 'R')}</div><div><b>${esc(set.resortName)}</b><small>Facebook post · draft</small></div></div>
          <label class="label" for="postText">Edit anything before posting</label>
          <textarea id="postText">${esc(dr.text)}</textarea>
          <p class="by">${by}</p>
        </div>
        <div class="btnrow"><button type="button" class="btn pink" data-act="publish" data-fb="1"${S.busy ? ' disabled' : ''}>Publish to Facebook</button></div>
        <div class="btnrow"><button type="button" class="btn" data-act="publish" data-fb="0"${S.busy ? ' disabled' : ''}>Copy it, I’ll post it myself</button><button type="button" class="btn ghost" data-act="write"${S.busy ? ' disabled' : ''}>Write another</button></div>`;
    }
    return html + '</div>';
  }
  async function publish(toFacebook) {
    const dr = S.draft;
    if (!dr || !dr.result) return;
    const text = ($('#postText') && $('#postText').value.trim()) || dr.text;
    if (!toFacebook) await copy(text);
    S.busy = 'publish'; render();
    try {
      const r = await api('publish', { days: dr.days, perk: dr.perk, text, toFacebook });
      const e = r.echo || {};
      const done = (e.days || []);
      const what = done.length ? `${A.dayRanges(done).join(', ')} ${done.length > 1 ? 'are' : 'is'} now on promo.` : 'Those days weren’t open anymore.';
      let msg;
      if (toFacebook && e.posted) msg = `Posted on your Facebook page. ${what}`;
      else if (toFacebook) { await copy(text); msg = `Couldn’t post to Facebook${e.facebookError ? ` (${String(e.facebookError).replace(/\.$/, '')})` : ''}. The post is copied: paste it on your page. ${what}`; }
      else msg = `Post copied. Paste it on your Facebook page. ${what}`;
      S.picked.clear(); S.draft = null; S.view = 'calendar';
      toast(msg, 7000);
      await loadMonth(true);
    } catch (err) {
      toast(err.message, 6000);
    } finally {
      S.busy = ''; render();
    }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      t.remove();
      return ok;
    }
  }

  /* ---------------- Promos ---------------- */
  function viewPromos() {
    const d = S.data;
    let html = '<div class="head"><div class="monthrow"><h2>Promos</h2></div><p>Posts you made for empty days, and how they’re doing.</p></div>';
    if (!d) return html + (S.error ? errorBox(S.error) : '<div class="pad"><div class="skeleton"></div></div>');
    if (!d.promos.length) return html + '<p class="empty-msg">No promo posts yet. Pick empty days on the calendar to make one.</p>';
    const label = { promo: 'Open', empty: 'Open', saved: 'Saved', receipt: 'Paid?', booked: 'Booked', blocked: 'Closed' };
    for (const p of d.promos) {
      const booked = p.days.filter(x => x.status === 'booked').length;
      html += `<div class="card${p.live ? '' : ' ended'}">
        <div class="titlerow"><h3>${esc(A.dayRanges(p.days.map(x => x.date)).join(', '))}</h3><span class="tag ${p.live ? 'pink' : 'grey'}">${p.live ? 'Live' : 'Ended'}</span></div>
        <p>${p.perk === 'late' ? 'Late checkout' : p.perk === 'mixed' ? 'Late checkout or free breakfast' : 'Free breakfast'} · ${booked} of ${p.days.length} booked${p.created ? ' · posted ' + esc(A.short(p.created.slice(0, 10))) : ''}</p>
        <div class="promo-days">${p.days.map(x => `<span class="${x.status}">${Number(x.date.slice(8))}<em>${label[x.status] || ''}</em></span>`).join('')}</div>
        <div class="posttext" id="pt-${esc(p.id)}">${esc(p.text)}</div>
        <div class="btnrow"><button type="button" class="btn" data-act="expand" data-id="pt-${esc(p.id)}">Show the post</button><button type="button" class="btn" data-act="copytext" data-id="${esc(p.id)}">Copy text</button>${p.facebookPost ? `<a class="btn" href="https://www.facebook.com/${encodeURIComponent(p.facebookPost)}" target="_blank" rel="noopener">On Facebook</a>` : ''}</div>
      </div>`;
    }
    return html;
  }

  /* ---------------- Settings ---------------- */
  function viewSettings() {
    const set = S.data && S.data.settings;
    const demo = isDemo();
    let html = '<div class="head"><div class="monthrow"><h2>Settings</h2></div><p>Your prices and how this app connects to avail.</p></div>';
    html += `<form class="card form" data-form="conn">
        <h3>Connection</h3>
        <label class="toggle">Use sample data (demo)<input type="checkbox" name="demo"${demo ? ' checked' : ''}></label>
        <label class="field"><span>n8n address</span><input name="url" type="url" inputmode="url" autocomplete="off" placeholder="https://your-name.app.n8n.cloud/webhook/avail-owner" value="${esc(S.conn.url)}"><small>The production URL of the “Owner app request” node in the avail · Owner app workflow.</small></label>
        <label class="field"><span>Owner key</span><input name="key" type="password" autocomplete="off" value="${esc(S.conn.key)}"><small>The same word you put as ownerKey in that workflow’s Config node.</small></label>
        <div class="btnrow"><button type="submit" class="btn navy">Save and connect</button>${demo ? '<button type="button" class="btn" data-act="resetdemo">Reset sample data</button>' : ''}</div>
        ${S.error && S.view === 'settings' ? `<p class="status bad">${esc(S.error)}</p>` : S.data ? `<p class="status ok">${demo ? 'Showing sample data saved on this phone only.' : 'Connected to n8n.'}</p>` : ''}
      </form>`;
    if (!set) return html;
    const num = (name, label, value, money, hint) => `<label class="field"><span>${label}</span><span class="${money ? 'money' : ''}"><input name="${name}" type="number" inputmode="numeric" min="0" step="1" value="${esc(value)}" required></span>${hint ? `<small>${hint}</small>` : ''}</label>`;
    html += `<form class="card form" data-form="prices">
        <h3>Prices</h3>
        <div class="two">${num('weekday_price', 'Weekday overnight', set.weekday, true)}${num('weekend_price', 'Weekend & holiday', set.weekend, true)}</div>
        <div class="two">${num('included_guests', 'Guests included', set.included)}${num('extra_guest_fee', 'Each extra guest', set.extraFee, true)}</div>
        <div class="two">${num('daytour_small_price', 'Day tour, small group', set.dtSmall, true)}${num('daytour_small_under', 'Small group means under', set.dtUnder)}</div>
        ${num('daytour_per_person', 'Day tour per person (bigger groups)', set.dtPer, true)}
        <h3>Booking rules</h3>
        <div class="two">${num('downpayment_percent', 'Downpayment (%)', set.downPct)}${num('hold_hours', 'Hours to pay', set.holdHours, false, 'How long a day stays saved')}</div>
        <div class="two"><label class="field"><span>GCash number</span><input name="gcash_number" value="${esc(set.gcashNumber)}" inputmode="tel"></label><label class="field"><span>GCash name</span><input name="gcash_name" value="${esc(set.gcashName)}"></label></div>
        <h3>Promo perks</h3>
        <label class="toggle">Free breakfast<input type="checkbox" name="perk_breakfast"${set.perks.includes('breakfast') ? ' checked' : ''}></label>
        <label class="toggle">Late checkout (only when the next day is free)<input type="checkbox" name="perk_late"${set.perks.includes('late') ? ' checked' : ''}></label>
        <label class="field"><span>Always mention</span><input name="quote_extra" value="${esc(set.quoteExtra)}"><small>Added to every price reply and post. For example: Libre rin po ang videoke.</small></label>
        <button type="submit" class="btn navy wide"${S.busy ? ' disabled' : ''}>Save prices</button>
        <p class="note">avail works out every price from these numbers. The AI never sets a price.</p>
      </form>`;
    return html;
  }
  async function saveConn(form) {
    S.conn.url = form.url.value.trim();
    S.conn.key = form.key.value.trim();
    S.conn.demo = form.demo.checked;
    LS.set('url', S.conn.url); LS.set('key', S.conn.key); LS.set('demo', S.conn.demo);
    if (!S.conn.demo && !S.conn.url) { S.error = 'Add the n8n address, or turn on sample data.'; render(); return; }
    S.data = null; S.month = null; S.picked.clear(); S.dismissed.clear();
    await loadMonth();
    if (!S.error) toast(isDemo() ? 'Showing sample data.' : 'Connected to n8n.');
  }
  async function savePrices(form) {
    const f = name => form[name] && form[name].value;
    const perks = [form.perk_breakfast.checked && 'breakfast', form.perk_late.checked && 'late'].filter(Boolean);
    if (!perks.length) { toast('Turn on at least one perk.'); return; }
    const settings = {
      weekday_price: f('weekday_price'), weekend_price: f('weekend_price'), included_guests: f('included_guests'), extra_guest_fee: f('extra_guest_fee'),
      daytour_small_price: f('daytour_small_price'), daytour_small_under: f('daytour_small_under'), daytour_per_person: f('daytour_per_person'),
      downpayment_percent: f('downpayment_percent'), hold_hours: f('hold_hours'), gcash_number: f('gcash_number'), gcash_name: f('gcash_name'),
      quote_extra: f('quote_extra'), perks: perks.join(',')
    };
    S.busy = 'settings'; render();
    try {
      const r = await api('settings', { settings });
      const errs = (r.echo && r.echo.errors) || [];
      toast(errs.length ? `Saved, except: ${errs.join(', ')}` : 'Prices saved. Replies and posts use them right away.');
      await loadMonth(true);
    } catch (e) { toast(e.message, 6000); } finally { S.busy = ''; render(); }
  }

  /* ---------------- Day details and owner actions ---------------- */
  function renderSheet() {
    const el = $('#sheet');
    if (!S.sheet) { el.hidden = true; el.innerHTML = ''; return; }
    const x = dayOf(S.sheet.date);
    if (!x) { S.sheet = null; el.hidden = true; return; }
    const today = S.data.today, set = S.data.settings;
    let body = '';
    if (S.sheet.type === 'walkin') {
      const q = x.rate === 'weekday' ? set.weekday : set.weekend;
      body = `<h3>Mark ${A.nice(x.date)} as booked</h3>
        <p class="note">For bookings that didn’t come through Messenger, like walk-ins or phone calls. This keeps avail from offering the day to anyone else.</p>
        <form class="form" data-form="walkin">
          <label class="field"><span>Guest or group name</span><input name="guest" required autocomplete="off" placeholder="Cruz family"></label>
          <div class="two"><label class="field"><span>Guests</span><input name="pax" type="number" min="1" inputmode="numeric" placeholder="${set.included}"></label>
          <label class="field"><span>Type</span><select name="type"><option value="overnight">Overnight</option><option value="daytour">Day tour</option></select></label></div>
          <label class="field"><span>Price</span><span class="money"><input name="price" type="number" min="0" inputmode="numeric" placeholder="${q}"></span><small>Leave empty to use your price list.</small></label>
          <div class="btnrow"><button type="button" class="btn" data-act="close">Cancel</button><button type="submit" class="btn navy">Mark as booked</button></div>
        </form>`;
    } else {
      const facts = [['Status', STATUS_WORDS[x.status] || x.status]];
      if (x.holiday) facts.push(['Holiday', x.holiday]);
      if (x.guest) facts.push(['Guest', x.guest + (x.messenger ? ' (Messenger)' : '')]);
      if (x.type && x.guest) facts.push(['Type', x.type === 'daytour' ? 'Day tour' : 'Overnight']);
      if (x.pax) facts.push(['Guests', String(x.pax)]);
      if (x.total) facts.push(['Price', A.peso(x.total)]);
      if (x.down && ['saved', 'receipt'].includes(x.status)) facts.push(['Downpayment', A.peso(x.down)]);
      if (x.savedUntil) facts.push(['Saved until', untilText(x.savedUntil)]);
      if (x.perk) facts.push(['Promo perk', x.perk === 'late' ? 'Late checkout' : 'Free breakfast']);
      if (x.note) facts.push(['Note', x.note]);
      if (!x.guest) facts.push(['Price', `${A.peso(x.price)} overnight (${x.rate})`]);
      const photo = x.receipt && /^https?:\/\//.test(x.receipt) ? `<a href="${esc(x.receipt)}" target="_blank" rel="noopener"><img src="${esc(x.receipt)}" alt="GCash receipt from ${esc(x.guest)}"></a>` : '';
      const btn = (op, label, cls) => `<button type="button" class="btn ${cls || ''}" data-act="op" data-op="${op}" data-date="${x.date}"${S.busy ? ' disabled' : ''}>${label}</button>`;
      let actions = '';
      if (x.status === 'receipt') actions = btn('confirm', 'Confirm booking', 'navy') + `<button type="button" class="btn amber" data-act="notyet" data-date="${x.date}">Not yet</button>` + btn('release', 'Release the day', 'danger');
      else if (x.status === 'saved') actions = btn('confirm', 'Confirm booking', 'navy') + btn('release', 'Release the day', 'danger');
      else if (x.status === 'booked' && x.date >= today) actions = btn('release', 'Cancel this booking', 'danger');
      else if (x.status === 'blocked') actions = btn('unblock', 'Open this day again', 'navy');
      else if (x.date >= today && (x.status === 'empty' || x.status === 'promo')) actions = `<button type="button" class="btn navy" data-act="walkin" data-date="${x.date}">Mark as booked</button>` + btn('block', 'Close this day') + (x.status === 'promo' ? btn('unpromo', 'Remove promo') : '');
      body = `<h3>${A.nice(x.date)}</h3>
        <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${photo}
        ${x.status === 'receipt' ? '<p class="note">Open your GCash app and check that the money arrived before you confirm. The guest gets a confirmation on Messenger.</p>' : ''}
        <div class="btnrow">${actions}</div>
        <button type="button" class="btn ghost wide" data-act="close">Close</button>`;
    }
    el.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="Day details">${body}</div>`;
    el.hidden = false;
    const first = el.querySelector('input, button.navy, button');
    if (first) first.focus();
  }
  const DONE = {
    confirm: (d, n) => `${A.short(d)} is booked.${n ? ' The guest got a confirmation on Messenger.' : ''}`,
    release: (d, n) => `${A.short(d)} is free again.${n ? ' The guest was told on Messenger.' : ''}`,
    book: d => `${A.short(d)} is marked as booked.`,
    block: d => `${A.short(d)} is closed.`,
    unblock: d => `${A.short(d)} is open again.`,
    unpromo: d => `${A.short(d)} is no longer on promo.`
  };
  async function op(name, date, extra) {
    if (name === 'release') {
      const x = dayOf(date);
      if (!window.confirm(x && x.status === 'booked' ? `Cancel the booking on ${A.nice(date)}?` : `Release ${A.nice(date)}? ${x && x.guest ? x.guest + ' will lose the saved day.' : ''}`)) return;
    }
    S.busy = 'op'; render(); renderSheet();
    try {
      const r = await api('booking', Object.assign({ op: name, date }, extra || {}));
      const e = r.echo || {};
      if (e.error) throw new Error(e.error);
      const res = (r.results || [])[0];
      if (res && !res.ok) throw new Error(`${A.nice(date)} changed a moment ago (it’s now ${res.status}). The calendar is refreshed.`);
      toast(DONE[name] ? DONE[name](date, e.notice) : 'Done.');
      S.picked.delete(date); S.sheet = null; S.dismissed.delete(date);
    } catch (err) {
      toast(err.message, 6000);
    } finally {
      S.busy = '';
      renderSheet();
      await loadMonth(true);
    }
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3500);
  }

  /* ---------------- Events ---------------- */
  document.addEventListener('click', e => {
    if (e.target.id === 'sheet') { S.sheet = null; renderSheet(); return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act, date = b.dataset.date;
    if (act === 'tab') { S.view = b.dataset.view; if (S.view !== 'draft') S.draft = null; S.sheet = null; renderSheet(); render(); window.scrollTo(0, 0); if (!S.data && !S.loading) loadMonth(); }
    else if (act === 'refresh') loadMonth(!!S.data);
    else if (act === 'month') { S.month = shiftMonth(S.month, Number(b.dataset.n)); S.picked.clear(); loadMonth(true); }
    else if (act === 'pick') { if (S.picked.has(date)) S.picked.delete(date); else S.picked.add(date); render(); }
    else if (act === 'clear') clearPicked();
    else if (act === 'day') { S.sheet = { type: 'day', date }; renderSheet(); }
    else if (act === 'walkin') { S.sheet = { type: 'walkin', date }; renderSheet(); }
    else if (act === 'close') { S.sheet = null; renderSheet(); }
    else if (act === 'notyet') { S.dismissed.add(date); S.sheet = null; renderSheet(); render(); }
    else if (act === 'op') op(b.dataset.op, date);
    else if (act === 'draft') startDraft();
    else if (act === 'back') { S.view = 'calendar'; S.draft = null; render(); }
    else if (act === 'perk') { if (S.draft && S.draft.perk !== b.dataset.perk) { S.draft.perk = b.dataset.perk; writeDraft(); } }
    else if (act === 'write') writeDraft();
    else if (act === 'publish') publish(b.dataset.fb === '1');
    else if (act === 'expand') { const t = document.getElementById(b.dataset.id); if (t) { t.classList.toggle('open'); b.textContent = t.classList.contains('open') ? 'Hide the post' : 'Show the post'; } }
    else if (act === 'copytext') { const p = S.data.promos.find(x => x.id === b.dataset.id); if (p) copy(p.text).then(ok => toast(ok ? 'Post copied.' : 'Couldn’t copy. Select the text and copy it.')); }
    else if (act === 'resetdemo') { Demo.reset(); S.data = null; S.picked.clear(); loadMonth(); toast('Sample data is back to the start.'); }
  });
  document.addEventListener('submit', e => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    if (kind === 'conn') saveConn(form);
    else if (kind === 'prices') savePrices(form);
    else if (kind === 'walkin') op('book', S.sheet.date, { guest: form.guest.value.trim(), pax: form.pax.value, type: form.type.value, price: form.price.value || undefined });
  });
  document.addEventListener('input', e => { if (e.target.id === 'postText' && S.draft) S.draft.text = e.target.value; });
  document.addEventListener('change', e => {
    if (e.target.name === 'demo' && e.target.closest('[data-form="conn"]')) saveConn(e.target.form);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) { S.sheet = null; renderSheet(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.view === 'calendar' && !S.busy && !S.sheet) loadMonth(true); });
  setInterval(() => { if (document.visibilityState === 'visible' && S.view === 'calendar' && !S.loading && !S.busy && !S.sheet) loadMonth(true); }, 60000);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  render();
  loadMonth();
})();
