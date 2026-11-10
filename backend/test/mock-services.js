// Fake versions of every outside service, for testing the n8n workflows on one computer:
//   /sheet   → the real Code.gs, running in a fake Apps Script
//   /groq    → a stand-in AI that answers in the same JSON shape as Groq
//   /graph   → Facebook (Messenger Send API and page posts), recorded instead of sent
//   /ntfy    → owner phone alerts, recorded
// Run on its own: node backend/test/mock-services.js   (port 5690)
'use strict';
const http = require('http');
const { URL } = require('url');
const { createGas } = require('./fake-gas.js');
const A = require('../engine/engine.js');

const SHEET_KEY = 'test-sheet-key';
const GROQ_KEY = 'Bearer test-groq-key';
const PAGE_TOKEN = 'test-page-token';

function mockParse(messages) {
  const system = messages[0].content, text = messages[1].content;
  const today = (system.match(/\((\d{4}-\d{2}-\d{2})\) in the Philippines/) || [])[1];
  const topics = ((system.match(/asks about: ([^\n]+?)\. Use only/) || [])[1] || '').split(', ').filter(Boolean);
  const ctx = A.buildCtx({ rules: topics.map(t => ({ topic: t, keywords: t, answer: 'x' })) }, `${today}T04:00:00Z`);
  const p = A.fallbackParse(ctx, text);
  return { intent: p.intent, dates: p.dates, type: p.type, pax: p.pax, topics: p.topics, name: '' };
}
function mockPost(messages) {
  const facts = messages[1].content;
  const days = (facts.match(/mention them exactly\): ([^\n]+)\./) || [])[1] || 'these days';
  const priceLine = (facts.match(/no discount: ([^\n]+?)\. Good for/) || [])[1] || '';
  const perk = /late checkout/.test(facts) && !/breakfast/.test(facts) ? 'may late checkout pa kayo' : 'may free breakfast pa para sa buong grupo';
  return { post: `Bakante pa po ang ${days} sa resort namin! ${priceLine.replace(' per night', '')} lang po ang overnight, good for up to 20 guests, at ${perk}. Message lang po kami dito para ma-save ang date, first come, first served! 🌴` };
}

function start(port) {
  let gas;
  const rec = { sent: [], posts: [], alerts: [], ai: [] };
  const flags = { groqFail: false };
  function reset() {
    gas = createGas();
    gas.setup();
    gas.setKey(SHEET_KEY);
    gas.setSetting('gcash_name', 'M. Santos');
    for (const k of Object.keys(rec)) rec[k].length = 0;
    flags.groqFail = false;
  }
  reset();

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const q = Object.fromEntries(url.searchParams);
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = { _raw: raw }; }
      const p = url.pathname;
      try {
        if (p === '/sheet' && req.method === 'GET') return send(200, gas.get(q));
        if (p === '/sheet' && req.method === 'POST') return send(200, gas.post(q, body));
        if (p.startsWith('/groq/')) {
          if (req.headers.authorization !== GROQ_KEY) return send(401, { error: { message: 'Invalid API Key' } });
          if (flags.groqFail) return send(503, { error: { message: 'Service unavailable (test)' } });
          const name = body.response_format && body.response_format.json_schema && body.response_format.json_schema.name;
          const out = name === 'guest_message' ? mockParse(body.messages) : mockPost(body.messages);
          rec.ai.push({ name, out });
          return send(200, { id: 'chatcmpl-test', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(out) }, finish_reason: 'stop' }] });
        }
        if (p.startsWith('/graph/')) {
          if (q.access_token !== PAGE_TOKEN) return send(400, { error: { message: 'Invalid OAuth access token', code: 190 } });
          if (req.method === 'GET' && p.split('/').length === 4) {
            const psid = p.split('/')[3];
            const names = { G100: ['Ana', 'Reyes'], G300: ['Carlo', 'Dizon'] };
            const [first_name, last_name] = names[psid] || ['Guest', psid];
            return send(200, { first_name, last_name, id: psid });
          }
          if (p.endsWith('/me/messages')) { rec.sent.push({ psid: body.recipient && body.recipient.id, text: body.message && body.message.text }); return send(200, { recipient_id: body.recipient && body.recipient.id, message_id: 'mid.' + rec.sent.length }); }
          if (p.endsWith('/feed')) { rec.posts.push({ page: p.split('/')[3], message: body.message }); return send(200, { id: `${p.split('/')[3]}_${1000 + rec.posts.length}` }); }
        }
        if (p === '/ntfy') { rec.alerts.push(body); return send(200, { id: 'alert' + rec.alerts.length }); }
        if (p === '/_records') return send(200, rec);
        if (p === '/_reset') { reset(); return send(200, { ok: true }); }
        if (p === '/_flags') { Object.assign(flags, body); return send(200, flags); }
        if (p === '/_tab') return send(200, gas.tab(q.name));
        if (p === '/_rows') { gas.addRows(body.tab, body.rows); return send(200, { ok: true }); }
        if (p === '/_setting') { gas.setSetting(body.key, body.value); return send(200, { ok: true }); }
        return send(404, { error: 'not found ' + p });
      } catch (err) {
        return send(500, { error: String(err && err.stack || err) });
      }
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, rec, flags, reset, gas: () => gas })));
}

if (require.main === module) {
  start(Number(process.env.PORT) || 5690).then(() => console.log('fake services on http://127.0.0.1:5690'));
}
module.exports = { start };
