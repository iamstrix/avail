/** @OnlyCurrentDoc */
/**
 * avail · Google Sheet data API (Google Apps Script)
 *
 * The Sheet is avail's database: prices, the calendar, house rules, holidays.
 * This script lets n8n read it and write to it safely (one change at a time,
 * so two guests can never save the same day).
 *
 * How to install (see SETUP.md for screenshots-level detail):
 *   1. Make a new Google Sheet. Extensions → Apps Script. Paste this file. Save.
 *   2. Run setup() once (Run button). It makes the tabs and shows the API key.
 *   3. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone.
 *   4. Copy the web app URL into n8n's Config node, and the key into the
 *      "avail Sheet key" credential.
 *
 * No AI and no prices are worked out here. That's n8n's job (engine.js).
 */

var TZ = 'Asia/Manila';

var TABS = {
  Settings: ['key', 'value', 'what it means'],
  Days:     ['date', 'status', 'guest', 'psid', 'type', 'pax', 'price', 'perk', 'saved_until', 'receipt', 'note', 'updated'],
  Promos:   ['id', 'days', 'perk', 'text', 'facebook_post', 'created'],
  Holidays: ['date', 'name'],
  Rules:    ['topic', 'keywords', 'answer'],
  Chats:    ['psid', 'name', 'last_date', 'last_type', 'last_pax', 'updated'],
  Log:      ['time', 'psid', 'from', 'text', 'note']
};

// Columns kept as plain text so Sheets doesn't turn "2026-11-12" into a date.
var TEXT_COLS = {
  Settings: ['key', 'value'],
  Days:     ['date', 'psid', 'saved_until', 'updated'],
  Promos:   ['id', 'days', 'facebook_post', 'created'],
  Holidays: ['date'],
  Chats:    ['psid', 'last_date', 'updated'],
  Log:      ['time', 'psid']
};

var STATUSES = ['empty', 'promo', 'saved', 'receipt', 'booked', 'blocked'];

/* ------------------------------------------------------------------ */
/* Web app entry points                                                */
/* ------------------------------------------------------------------ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!keyOk_(p.key)) return json_({ ok: false, error: 'bad key' });
  try {
    if (p.action === 'ping') return json_({ ok: true, now: stamp_(new Date()) });
    return json_(state_(p, new Date()));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  if (!keyOk_(p.key || body.key)) return json_({ ok: false, error: 'bad key' });
  try {
    if (body.action === 'state') return json_(state_(body, new Date()));
    if (body.action === 'apply') return json_(apply_(body, new Date()));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

function state_(p, now) {
  var today = today_(now);
  var from = normDate_(p.from) || today;
  var to = normDate_(p.to) || addDays_(from, 120);
  var lo = addDays_(from, -1), hi = addDays_(to, 2);
  var psid = String(p.psid || '');

  var settings = {};
  readTable_(sheet_('Settings')).rows.forEach(function (r) {
    var k = String(r.key || '').trim();
    if (k) settings[k] = r.value;
  });

  var days = readTable_(sheet_('Days')).rows.filter(function (r) {
    var d = r.date;
    if (!d) return false;
    if (d >= lo && d <= hi) return true;
    if (d < today) return false;
    var st = String(r.status || '').toLowerCase();
    return st === 'saved' || st === 'receipt' || (psid && String(r.psid) === psid);
  });

  var chat = null;
  if (psid) {
    readTable_(sheet_('Chats')).rows.forEach(function (r) { if (String(r.psid) === psid) chat = r; });
  }

  var promos = readTable_(sheet_('Promos')).rows.slice(-30);

  return {
    ok: true,
    now: stamp_(now),
    today: today,
    from: from,
    to: to,
    settings: settings,
    days: days.map(clean_),
    holidays: readTable_(sheet_('Holidays')).rows.map(clean_),
    rules: readTable_(sheet_('Rules')).rows.map(clean_),
    chat: chat ? clean_(chat) : null,
    promos: promos.map(clean_)
  };
}

/* ------------------------------------------------------------------ */
/* Write: every change is checked first, under one lock                */
/* ------------------------------------------------------------------ */

function apply_(body, now) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var results = [];

    if (body.changes && body.changes.length) {
      var daysSheet = sheet_('Days');
      var days = readTable_(daysSheet);
      body.changes.forEach(function (c) {
        var date = normDate_(c.date);
        if (!date) { results.push({ date: c.date, ok: false, why: 'bad date' }); return; }
        var row = find_(days, 'date', date);
        var now_status = effectiveStatus_(row, now);
        if (c.ifStatusIn && c.ifStatusIn.indexOf(now_status) < 0) {
          results.push({ date: date, ok: false, status: now_status, why: 'status' });
          return;
        }
        if (c.ifPsid && String(row ? row.psid : '') !== String(c.ifPsid)) {
          results.push({ date: date, ok: false, status: now_status, why: 'someone else' });
          return;
        }
        if (!row) row = { date: date };
        var set = c.set || {};
        Object.keys(set).forEach(function (k) {
          if (k !== 'date' && days.headers.indexOf(k) >= 0) row[k] = set[k] === null || set[k] === undefined ? '' : set[k];
        });
        if (row.status && STATUSES.indexOf(String(row.status)) < 0) row.status = 'empty';
        row.updated = stamp_(now);
        write_(daysSheet, days, row);
        results.push({ date: date, ok: true, status: row.status });
      });
    }

    if (body.chats && body.chats.length) {
      var chatSheet = sheet_('Chats');
      var chats = readTable_(chatSheet);
      body.chats.forEach(function (c) {
        if (!c || !c.psid) return;
        var row = find_(chats, 'psid', String(c.psid)) || { psid: String(c.psid) };
        Object.keys(c.set || {}).forEach(function (k) {
          if (k !== 'psid' && chats.headers.indexOf(k) >= 0) row[k] = c.set[k] === null || c.set[k] === undefined ? '' : c.set[k];
        });
        row.updated = stamp_(now);
        write_(chatSheet, chats, row);
      });
    }

    if (body.promos && body.promos.length) {
      var promoSheet = sheet_('Promos');
      var promos = readTable_(promoSheet);
      body.promos.forEach(function (p) {
        var row = {};
        promos.headers.forEach(function (h) { row[h] = p[h] === undefined || p[h] === null ? '' : p[h]; });
        if (!row.created) row.created = stamp_(now);
        write_(promoSheet, promos, row);
      });
    }

    if (body.settings && typeof body.settings === 'object') {
      var setSheet = sheet_('Settings');
      var settings = readTable_(setSheet);
      Object.keys(body.settings).forEach(function (k) {
        var row = find_(settings, 'key', k) || { key: k, 'what it means': '' };
        row.value = String(body.settings[k]);
        write_(setSheet, settings, row);
      });
    }

    if (body.logs && body.logs.length) {
      var logSheet = sheet_('Log');
      var logs = readTable_(logSheet);
      body.logs.forEach(function (l) {
        write_(logSheet, logs, {
          time: stamp_(now), psid: String(l.psid || ''), from: String(l.from || ''),
          text: String(l.text || '').slice(0, 2000), note: String(l.note || '').slice(0, 500)
        });
      });
    }

    return { ok: true, now: stamp_(now), results: results, echo: body.echo === undefined ? null : body.echo };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* One-time setup                                                      */
/* ------------------------------------------------------------------ */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = TABS[name];
    (TEXT_COLS[name] || []).forEach(function (h) {
      sh.getRange(1, headers.indexOf(h) + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
    if (sh.getLastRow() === 0) sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  });
  seed_(ss);
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_KEY')) props.setProperty('API_KEY', Utilities.getUuid().replace(/-/g, ''));
  var key = props.getProperty('API_KEY');
  Logger.log('avail API key: ' + key);
  try { SpreadsheetApp.getUi().alert('avail is set up.\n\nAPI key (paste it into the n8n credential "avail Sheet key"):\n\n' + key); } catch (e) { /* not run from the editor */ }
  return key;
}

function seed_(ss) {
  var settings = ss.getSheetByName('Settings');
  if (settings.getLastRow() <= 1) {
    [
      ['resort_name', 'Miranda’s Resort', 'Name used in replies and posts'],
      ['location', 'Panlinlang, Arayat, Pampanga', 'Used in posts'],
      ['weekday_price', '7000', 'Overnight, Monday to Friday (pesos)'],
      ['weekend_price', '10000', 'Overnight, Saturday, Sunday and holidays (pesos)'],
      ['included_guests', '20', 'Guests included in the overnight price'],
      ['extra_guest_fee', '500', 'Per guest above the included number'],
      ['daytour_small_price', '2000', 'Day tour for a small group (flat)'],
      ['daytour_small_under', '10', 'Groups smaller than this pay the flat day tour price'],
      ['daytour_per_person', '300', 'Day tour per person for bigger groups'],
      ['downpayment_percent', '30', 'Downpayment to save a day, as a percent of the price'],
      ['hold_hours', '24', 'How long a day stays saved without a downpayment'],
      ['gcash_number', '0917 000 0000', 'Where guests send the downpayment'],
      ['gcash_name', '', 'Name guests should see in GCash'],
      ['perks', 'breakfast,late', 'Perks offered on promo days'],
      ['breakfast_text', 'free breakfast para sa buong grupo', 'How the breakfast perk is said'],
      ['late_text', 'late checkout', 'How the late checkout perk is said'],
      ['quote_extra', 'Libre rin po ang videoke.', 'Added to every price reply and post']
    ].forEach(function (r) { settings.appendRow(r); });
  }

  var rules = ss.getSheetByName('Rules');
  if (rules.getLastRow() <= 1) {
    [
      ['videoke', 'videoke, karaoke, sound system', 'Libre po ang videoke para sa lahat ng booking.'],
      ['location', 'saan, location, address, map, waze, direksyon', 'Nasa Panlinlang, Arayat, Pampanga po kami.'],
      ['checkin', 'check in, check-in, checkin, anong oras', ''],
      ['checkout', 'check out, check-out, checkout', ''],
      ['pets', 'aso, pusa, pet, pets, dog, cat', ''],
      ['food', 'pagkain, luto, lutuan, kusina, food, cook, ihaw, grill', ''],
      ['corkage', 'corkage, alak, drinks, inumin, beer', ''],
      ['parking', 'parking, park, sasakyan, kotse, van', ''],
      ['pool', 'pool, lalim, malalim, swimming, langoy', '']
    ].forEach(function (r) { rules.appendRow(r); });
  }

  var holidays = ss.getSheetByName('Holidays');
  if (holidays.getLastRow() <= 1) {
    [
      ['2026-11-01', 'All Saints’ Day'], ['2026-11-02', 'All Souls’ Day'], ['2026-11-30', 'Bonifacio Day'],
      ['2026-12-08', 'Immaculate Conception'], ['2026-12-24', 'Christmas Eve'], ['2026-12-25', 'Christmas Day'],
      ['2026-12-30', 'Rizal Day'], ['2026-12-31', 'New Year’s Eve'],
      ['2027-01-01', 'New Year’s Day'], ['2027-02-06', 'Chinese New Year'], ['2027-03-25', 'Maundy Thursday'],
      ['2027-03-26', 'Good Friday'], ['2027-03-27', 'Black Saturday'], ['2027-04-09', 'Araw ng Kagitingan'],
      ['2027-05-01', 'Labor Day'], ['2027-06-12', 'Independence Day'], ['2027-08-21', 'Ninoy Aquino Day'],
      ['2027-08-30', 'National Heroes Day'], ['2027-11-01', 'All Saints’ Day'], ['2027-11-02', 'All Souls’ Day'],
      ['2027-11-30', 'Bonifacio Day'], ['2027-12-08', 'Immaculate Conception'], ['2027-12-24', 'Christmas Eve'],
      ['2027-12-25', 'Christmas Day'], ['2027-12-30', 'Rizal Day'], ['2027-12-31', 'New Year’s Eve']
    ].forEach(function (r) { holidays.appendRow(r); });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function keyOk_(key) {
  var want = PropertiesService.getScriptProperties().getProperty('API_KEY');
  return !!want && String(key || '') === want;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '". Run setup() first.');
  return sh;
}

function readTable_(sh) {
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = { _row: i + 1 }, empty = true;
    for (var j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      var v = cell_(values[i][j], headers[j]);
      if (v !== '') empty = false;
      r[headers[j]] = v;
    }
    if (!empty) rows.push(r);
  }
  return { headers: headers, rows: rows, sheet: sh };
}

function cell_(v, header) {
  if (v instanceof Date) {
    var dateOnly = header === 'date' || header === 'last_date';
    return Utilities.formatDate(v, TZ, dateOnly ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss") + (dateOnly ? '' : '+08:00');
  }
  if (header === 'date' || header === 'last_date') return normDate_(v) || '';
  return v === null || v === undefined ? '' : v;
}

function find_(table, col, value) {
  for (var i = 0; i < table.rows.length; i++) if (String(table.rows[i][col]) === String(value)) return table.rows[i];
  return null;
}

function write_(sh, table, row) {
  var values = table.headers.map(function (h) { return row[h] === undefined || row[h] === null ? '' : row[h]; });
  if (row._row) {
    sh.getRange(row._row, 1, 1, values.length).setValues([values]);
  } else {
    sh.appendRow(values);
    row._row = sh.getLastRow();
    table.rows.push(row);
  }
}

function clean_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) { if (k !== '_row') o[k] = r[k]; });
  return o;
}

// "saved" days whose time ran out count as free again (promo if they had a perk).
function effectiveStatus_(row, now) {
  if (!row) return 'empty';
  var st = String(row.status || '').toLowerCase().trim();
  if (STATUSES.indexOf(st) < 0) st = 'empty';
  if (st === 'saved' && row.saved_until) {
    var t = Date.parse(String(row.saved_until));
    if (!isNaN(t) && t <= now.getTime()) return String(row.perk || '').trim() ? 'promo' : 'empty';
  }
  return st;
}

function normDate_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  var p = s.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2] ? s : null;
}

function addDays_(s, n) {
  var p = s.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function today_(now) {
  return Utilities.formatDate(now || new Date(), TZ, 'yyyy-MM-dd');
}

function stamp_(d) {
  return Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ss") + '+08:00';
}
