// Builds the three n8n workflows from engine.js, so the code inside n8n is the tested code.
//
//   node backend/n8n/build.mjs            → backend/n8n/workflows/*.json (to import into n8n)
//   node backend/n8n/build.mjs --test DIR → test copies pointing at local fake services
//
// After changing engine.js, run this again and re-import the workflows.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = fs.readFileSync(path.join(here, '..', 'engine', 'engine.js'), 'utf8')
  .replace(/^if \(typeof module[^\n]*\n?/m, '')
  .trim();

const args = process.argv.slice(2);
const testDir = args[0] === '--test' ? args[1] : null;

// Credentials are matched by name when you import, so create these three in n8n first.
const CREDS = {
  sheet: { type: 'httpQueryAuth', name: 'avail Sheet key' },
  groq: { type: 'httpHeaderAuth', name: 'avail Groq' },
  facebook: { type: 'httpQueryAuth', name: 'avail Facebook page' }
};

const PROD = {
  sheetUrl: 'https://script.google.com/macros/s/PASTE-YOUR-DEPLOYMENT-ID/exec',
  groqUrl: 'https://api.groq.com/openai/v1/chat/completions',
  groqModel: 'openai/gpt-oss-120b',
  graphUrl: 'https://graph.facebook.com/v23.0',
  pageId: 'PASTE-YOUR-PAGE-ID',
  ntfyUrl: 'https://ntfy.sh',
  ntfyTopic: '',
  ownerAppUrl: 'https://YOUR-GITHUB-NAME.github.io/avail/app/',
  ownerKey: 'CHANGE-ME-TO-A-LONG-RANDOM-WORD',
  verifyToken: 'CHANGE-ME-TOO'
};
// Your own values (Sheet URL, page ID, keys) can go in config.local.json next to this file.
// It's ignored by git. The build then also writes my-workflows/ (also ignored) with those values
// filled into the Config nodes, so you don't retype them. workflows/ always keeps the blanks.
const localFile = path.join(here, 'config.local.json');
const LOCAL = fs.existsSync(localFile) ? JSON.parse(fs.readFileSync(localFile, 'utf8')) : null;
const MOCK = 'http://127.0.0.1:5690';
const TEST = {
  sheetUrl: `${MOCK}/sheet`,
  groqUrl: `${MOCK}/groq/openai/v1/chat/completions`,
  groqModel: 'openai/gpt-oss-120b',
  graphUrl: `${MOCK}/graph/v23.0`,
  pageId: 'PAGE1',
  ntfyUrl: `${MOCK}/ntfy`,
  ntfyTopic: 'avail-test',
  ownerAppUrl: 'http://127.0.0.1:8765/app/',
  ownerKey: 'owner-test-key',
  verifyToken: 'verify-test'
};

/* ------------------------------------------------------------------ */
/* Small helpers that write n8n node JSON                              */
/* ------------------------------------------------------------------ */
function uuid(seed) {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
class Flow {
  constructor(name, id) { this.name = name; this.id = id; this.nodes = []; this.connections = {}; }
  add(name, def, pos) {
    this.nodes.push(Object.assign({ id: uuid(this.name + name), name, position: pos }, def));
    return name;
  }
  link(from, to, output = 0) {
    const c = this.connections[from] || (this.connections[from] = { main: [] });
    while (c.main.length <= output) c.main.push([]);
    c.main[output].push({ node: to, type: 'main', index: 0 });
  }
  chain(...names) { for (let i = 0; i < names.length - 1; i++) this.link(names[i], names[i + 1]); }
  json(withId) {
    const out = { name: this.name, nodes: this.nodes, connections: this.connections, settings: { executionOrder: 'v1' }, pinData: {} };
    if (withId) out.id = this.id;
    return out;
  }
}
const webhook = (flow, method, pathName, responseMode) => ({
  type: 'n8n-nodes-base.webhook', typeVersion: 2.1, webhookId: uuid(flow + pathName + method),
  parameters: { httpMethod: method, path: pathName, responseMode, options: {} }
});
// Code node: the node's own job first, the shared engine below it.
const code = (job, eachItem) => ({
  type: 'n8n-nodes-base.code', typeVersion: 2,
  parameters: Object.assign(eachItem ? { mode: 'runOnceForEachItem' } : {}, {
    jsCode: `// ── What this node does ──────────────────────────────────────────\nfunction run() {\n${job.trim().split('\n').map(l => '  ' + l).join('\n')}\n}\n\n// ── avail engine (the same in every node; edit backend/engine/engine.js, then rebuild) ──\n${ENGINE}\n\nreturn run();\n`
  })
});
const configNode = cfg => ({
  type: 'n8n-nodes-base.code', typeVersion: 2,
  parameters: { jsCode: `// avail settings for this workflow. Fill these in after importing (see SETUP.md).\n// Secrets (Sheet key, Groq key, Facebook page token) are NOT here: they live in n8n Credentials.\nconst CONFIG = ${JSON.stringify(cfg, null, 2)};\nreturn [{ json: CONFIG }];\n` }
});
const cfgRef = k => `$('Config').first().json.${k}`;
function http(o) {
  const p = { method: o.method || 'GET', url: o.url };
  if (o.cred) Object.assign(p, { authentication: 'genericCredentialType', genericAuthType: CREDS[o.cred].type });
  if (o.query) Object.assign(p, { sendQuery: true, queryParameters: { parameters: o.query.map(([name, value]) => ({ name, value })) } });
  if (o.body) Object.assign(p, { sendBody: true, specifyBody: 'json', jsonBody: o.body });
  p.options = { timeout: o.timeout || 30000 };
  const node = { type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, parameters: p };
  if (o.cred) node.credentials = { [CREDS[o.cred].type]: { id: null, name: CREDS[o.cred].name } };
  if (o.continueOnFail) node.onError = 'continueRegularOutput';
  if (o.retry) Object.assign(node, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 });
  return node;
}
const cond = (left, op) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: uuid(left + JSON.stringify(op)), leftValue: left, rightValue: op.right === undefined ? '' : op.right, operator: op.operator }],
    combinator: 'and'
  }
});
const ifTrue = left => ({
  type: 'n8n-nodes-base.if', typeVersion: 2.2,
  parameters: Object.assign(cond(left, { operator: { type: 'boolean', operation: 'true', singleValue: true } }), { options: {} })
});
const switchOn = (left, keys) => ({
  type: 'n8n-nodes-base.switch', typeVersion: 3.2,
  parameters: {
    rules: { values: keys.map(k => Object.assign(cond(left, { right: k, operator: { type: 'string', operation: 'equals' } }), { renameOutput: true, outputKey: k })) },
    options: { fallbackOutput: 'extra' }
  }
});
const CORS = { entries: [{ name: 'Access-Control-Allow-Origin', value: '*' }] };
const respond = (opts = {}) => ({
  type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
  parameters: Object.assign(
    opts.text !== undefined ? { respondWith: 'text', responseBody: opts.text } : opts.json !== undefined ? { respondWith: 'json', responseBody: opts.json } : { respondWith: 'firstIncomingItem' },
    { options: Object.assign({ responseHeaders: CORS }, opts.code !== undefined ? { responseCode: opts.code } : {}) }
  )
});
const sheetRead = query => http({ url: `={{ ${cfgRef('sheetUrl')} }}`, cred: 'sheet', query: [['action', 'state'], ...(query || [])], retry: true });
const sheetWrite = bodyExpr => http({ method: 'POST', url: `={{ ${cfgRef('sheetUrl')} }}`, cred: 'sheet', body: `={{ JSON.stringify(${bodyExpr}) }}`, retry: true });
const messengerSend = (psidExpr, textExpr) => http({
  method: 'POST', url: `={{ ${cfgRef('graphUrl')} }}/me/messages`, cred: 'facebook', continueOnFail: true,
  body: `={{ JSON.stringify({ recipient: { id: ${psidExpr} }, messaging_type: 'RESPONSE', message: { text: String(${textExpr}).slice(0, 2000) } }) }}`
});
const ownerAlert = () => http({
  method: 'POST', url: `={{ ${cfgRef('ntfyUrl')} }}`, continueOnFail: true,
  body: `={{ JSON.stringify({ topic: ${cfgRef('ntfyTopic')}, title: $json.alert.title, message: $json.alert.text, click: ${cfgRef('ownerAppUrl')}, tags: ['palm_tree'] }) }}`
});
const X = (col, row) => [col * 260, row * 200];

/* ------------------------------------------------------------------ */
/* Workflow 1: guest messages on Messenger                             */
/* ------------------------------------------------------------------ */
function messenger(cfg) {
  const f = new Flow('avail · Messenger', 'availMessenger01');
  f.add('Facebook checks the webhook', webhook(f.name, 'GET', 'avail-messenger', 'responseNode'), X(0, -2));
  f.add('Check the verify token', code(`
const q = $json.query || {};
const ok = q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === VERIFY_TOKEN;
return [{ json: { ok, challenge: ok ? String(q['hub.challenge'] || '') : 'wrong verify token' } }];`.replace('VERIFY_TOKEN', JSON.stringify(cfg.verifyToken))), X(1, -2));
  f.add('Answer Facebook', respond({ text: '={{ $json.challenge }}', code: '={{ $json.ok ? 200 : 403 }}' }), X(2, -2));
  f.chain('Facebook checks the webhook', 'Check the verify token', 'Answer Facebook');

  f.add('Guest message comes in', webhook(f.name, 'POST', 'avail-messenger', 'onReceived'), X(0, 0));
  f.add('Config', configNode({ sheetUrl: cfg.sheetUrl, groqUrl: cfg.groqUrl, groqModel: cfg.groqModel, graphUrl: cfg.graphUrl, ntfyUrl: cfg.ntfyUrl, ntfyTopic: cfg.ntfyTopic, ownerAppUrl: cfg.ownerAppUrl }), X(1, 0));
  f.add('Read the messages', code(`
const body = $('Guest message comes in').first().json.body || {};
const to = AVAIL.addDays(AVAIL.todayIso(), 200);
return AVAIL.readMessengerEvents(body).map(m => ({ json: Object.assign(m, { to }) }));`), X(2, 0));
  f.add('Sheet: read', sheetRead([['to', '={{ $json.to }}'], ['psid', '={{ $json.psid }}']]), X(3, 0));
  f.add('Facebook: guest name', http({ url: `={{ ${cfgRef('graphUrl')} }}/{{ $('Read the messages').item.json.psid }}`, cred: 'facebook', query: [['fields', 'first_name,last_name']], continueOnFail: true, timeout: 10000 }), X(4, 0));
  f.add('Text message?', ifTrue(`={{ $('Read the messages').item.json.kind === 'text' }}`), X(5, 0));
  f.add('Ask the AI', code(`
const msg = $('Read the messages').item.json;
const ctx = AVAIL.buildCtx($('Sheet: read').item.json);
const messages = AVAIL.parsePrompt(ctx, msg.text);
return { json: { request: AVAIL.aiRequest($('Config').first().json.groqModel, messages, 'guest_message', AVAIL.PARSE_SCHEMA, 0) } };`, true), X(6, -1));
  f.add('AI reads the message', http({ method: 'POST', url: `={{ ${cfgRef('groqUrl')} }}`, cred: 'groq', body: '={{ JSON.stringify($json.request) }}', continueOnFail: true, timeout: 20000 }), X(7, -1));
  f.add('Decide the reply', code(`
const msg = Object.assign({}, $('Read the messages').item.json, { name: AVAIL.profileName($('Facebook: guest name').item.json) });
const ctx = AVAIL.buildCtx($('Sheet: read').item.json);
const parsed = AVAIL.normalizeParsed(ctx, AVAIL.readAiJson($json), msg.text);
const d = AVAIL.decide(ctx, parsed, msg);
return { json: { apply: { action: 'apply', changes: d.changes, chats: d.chat ? [d.chat] : [], echo: d } } };`, true), X(8, -1));
  f.add('Photo or sticker', code(`
const msg = $('Read the messages').item.json;
const ctx = AVAIL.buildCtx($('Sheet: read').item.json);
const d = msg.kind === 'image' ? AVAIL.decideReceipt(ctx, msg) : { psid: msg.psid, reply: '', changes: [], chat: null, alert: null };
return { json: { apply: { action: 'apply', changes: d.changes, chats: [], echo: d } } };`, true), X(7, 1));
  f.add('Sheet: save', sheetWrite('$json.apply'), X(9, 0));
  f.add('Final reply', code(`
const msg = $('Read the messages').item.json;
if (!$json.ok) {
  return { json: { psid: msg.psid, text: msg.text || '', reply: msg.kind === 'text' ? 'Pasensya na po, may konting problema sa system namin. Babalikan ko po kayo agad dito.' : '',
    alert: { title: 'avail could not reach the Sheet', text: 'A guest message could not be handled. Check Messenger and the Sheet.' }, by: 'error' } };
}
const d = $json.echo || {};
const f = AVAIL.finalReply(d, $json.results);
return { json: { psid: msg.psid, text: msg.text || (msg.kind === 'image' ? '[photo]' : ''), reply: f.reply || '', conflict: f.conflict, alert: d.alert || null, by: d.parsed ? d.parsed.by : msg.kind } };`, true), X(10, 0));
  f.add('Has a reply?', ifTrue('={{ !!$json.reply }}'), X(11, -1));
  f.add('Send the reply', messengerSend('$json.psid', '$json.reply'), X(12, -1));
  f.add('Log the chat', code(`
const logs = [];
for (const it of $input.all()) {
  const m = it.json;
  logs.push({ psid: m.psid, from: 'guest', text: m.text, note: 'read by ' + m.by });
  if (m.reply) logs.push({ psid: m.psid, from: 'avail', text: m.reply, note: m.conflict ? 'day was taken a moment earlier' : '' });
}
return [{ json: { apply: { action: 'apply', logs } } }];`), X(11, 0));
  f.add('Sheet: log', sheetWrite('$json.apply'), X(12, 0));
  f.add('Alert the owner?', ifTrue(`={{ !!$json.alert && !!${cfgRef('ntfyTopic')} }}`), X(11, 1));
  f.add('Tell the owner', ownerAlert(), X(12, 1));

  f.chain('Guest message comes in', 'Config', 'Read the messages', 'Sheet: read', 'Facebook: guest name', 'Text message?');
  f.link('Text message?', 'Ask the AI', 0);
  f.link('Text message?', 'Photo or sticker', 1);
  f.chain('Ask the AI', 'AI reads the message', 'Decide the reply', 'Sheet: save');
  f.link('Photo or sticker', 'Sheet: save');
  f.link('Sheet: save', 'Final reply');
  f.link('Final reply', 'Has a reply?');
  f.link('Final reply', 'Log the chat');
  f.link('Final reply', 'Alert the owner?');
  f.link('Has a reply?', 'Send the reply', 0);
  f.link('Log the chat', 'Sheet: log');
  f.link('Alert the owner?', 'Tell the owner', 0);
  return f;
}

/* ------------------------------------------------------------------ */
/* Workflow 2: the owner's app                                         */
/* ------------------------------------------------------------------ */
function ownerApi(cfg) {
  const f = new Flow('avail · Owner app', 'availOwnerApp01');
  f.add('Owner app request', webhook(f.name, 'POST', 'avail-owner', 'responseNode'), X(0, 0));
  f.add('Config', configNode({ sheetUrl: cfg.sheetUrl, groqUrl: cfg.groqUrl, groqModel: cfg.groqModel, graphUrl: cfg.graphUrl, pageId: cfg.pageId, ownerKey: cfg.ownerKey }), X(1, 0));
  f.add('Check the key', code(`
let body = $('Owner app request').first().json.body;
if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
body = body || {};
const cfg = $('Config').first().json;
const ok = !!cfg.ownerKey && cfg.ownerKey !== 'CHANGE-ME-TO-A-LONG-RANDOM-WORD' && body.key === cfg.ownerKey;
const action = String(body.action || 'state');
const today = AVAIL.todayIso();
let from = AVAIL.normDate(body.from), to = AVAIL.normDate(body.to);
const dates = [].concat(body.days || [], body.date || []).map(AVAIL.normDate).filter(Boolean).sort();
if (!from) from = dates.length ? AVAIL.addDays(dates[0], -1) : today.slice(0, 8) + '01';
if (!to) to = dates.length ? AVAIL.addDays(dates[dates.length - 1], 2) : AVAIL.addDays(from, 41);
delete body.key;
return [{ json: { ok, action, body, from, to } }];`), X(2, 0));
  f.add('Key OK?', ifTrue('={{ $json.ok }}'), X(3, 0));
  f.add('Wrong key', respond({ json: '={{ JSON.stringify({ ok: false, error: "Wrong owner key. Check the key in the app settings." }) }}', code: 401 }), X(4, 1));
  f.add('Sheet: read', sheetRead([['from', '={{ $json.from }}'], ['to', '={{ $json.to }}']]), X(4, 0));
  f.add('Which action?', switchOn(`={{ $('Check the key').item.json.action }}`, ['state', 'draft', 'publish', 'booking', 'settings']), X(5, 0));

  // state
  f.add('Calendar', code(`
const r = $('Check the key').item.json;
return { json: AVAIL.calendarView(AVAIL.buildCtx($json), r.from, r.to) };`, true), X(6, -3));
  f.add('Send the calendar', respond(), X(7, -3));
  // draft
  f.add('Plan the post', code(`
const r = $('Check the key').item.json;
const ctx = AVAIL.buildCtx($json);
const plan = AVAIL.planPromo(ctx, r.body.days, r.body.perk);
const request = AVAIL.aiRequest($('Config').first().json.groqModel, AVAIL.postPrompt(ctx, plan), 'facebook_post', AVAIL.POST_SCHEMA, 0.7);
return { json: { plan, request } };`, true), X(6, -2));
  f.add('AI writes the post', http({ method: 'POST', url: `={{ ${cfgRef('groqUrl')} }}`, cred: 'groq', body: '={{ JSON.stringify($json.request) }}', continueOnFail: true, timeout: 30000 }), X(7, -2));
  f.add('Check the post', code(`
const plan = $('Plan the post').item.json.plan;
const ctx = AVAIL.buildCtx($('Sheet: read').item.json);
if (!plan.days.length) return { json: { ok: false, error: 'None of those days are open anymore.', plan } };
const ai = AVAIL.readAiJson($json);
const post = AVAIL.finishPost(ctx, plan, ai && ai.post);
return { json: Object.assign({ ok: true, plan }, post) };`, true), X(8, -2));
  f.add('Send the draft', respond(), X(9, -2));
  // publish
  f.add('Plan publish', code(`
const r = $('Check the key').item.json;
const ctx = AVAIL.buildCtx($json);
const plan = AVAIL.planPromo(ctx, r.body.days, r.body.perk);
const text = String(r.body.text || '').trim() || AVAIL.templatePost(ctx, plan);
const cfg = $('Config').first().json;
const toFacebook = !!r.body.toFacebook && plan.days.length > 0 && !!cfg.pageId && cfg.pageId !== 'PASTE-YOUR-PAGE-ID';
return { json: { plan, text, toFacebook } };`, true), X(6, -1));
  f.add('Post to Facebook?', ifTrue('={{ $json.toFacebook }}'), X(7, -1));
  f.add('Facebook: publish post', http({ method: 'POST', url: `={{ ${cfgRef('graphUrl')} }}/{{ ${cfgRef('pageId')} }}/feed`, cred: 'facebook', body: '={{ JSON.stringify({ message: $json.text }) }}', continueOnFail: true }), X(8, -1.5));
  f.add('Save promo days', code(`
const p = $('Plan publish').item.json;
const ctx = AVAIL.buildCtx($('Sheet: read').item.json);
const fbId = typeof $json.id === 'string' ? $json.id : '';
const fbError = $json.error ? String($json.error.message || JSON.stringify($json.error)).slice(0, 300) : '';
const out = AVAIL.promoChanges(ctx, p.plan, p.text, fbId);
return { json: { apply: { action: 'apply', changes: out.changes, promos: p.plan.days.length ? out.promos : [], echo: { posted: !!fbId, facebookPost: fbId, facebookError: fbError, days: p.plan.days, skipped: p.plan.skipped, perks: p.plan.perks } } } };`, true), X(9, -1));
  f.add('Sheet: save promo', sheetWrite('$json.apply'), X(10, -1));
  f.add('Send the publish result', respond(), X(11, -1));
  // booking
  f.add('Booking change', code(`
const r = $('Check the key').item.json;
// The app sends { action: 'booking', op: 'confirm' | 'release' | 'book' | 'block' | 'unblock' | 'unpromo', date, ... }
const out = AVAIL.ownerAction(AVAIL.buildCtx($json), Object.assign({}, r.body, { action: r.body.op }));
return { json: { apply: { action: 'apply', changes: out.changes, echo: { op: r.body.op, date: r.body.date, error: out.error, notice: out.notice } } } };`, true), X(6, 0));
  f.add('Sheet: save booking', sheetWrite('$json.apply'), X(7, 0));
  f.add('Send the booking result', respond(), X(8, 0));
  f.add('Tell the guest?', ifTrue('={{ !!($json.echo && $json.echo.notice) && ($json.results || []).length > 0 && ($json.results || []).every(r => r.ok) }}'), X(9, 0));
  f.add('Messenger: tell the guest', messengerSend('$json.echo.notice.psid', '$json.echo.notice.text'), X(10, 0));
  // settings
  f.add('Settings change', code(`
const r = $('Check the key').item.json;
const out = AVAIL.settingsChange(r.body.settings);
return { json: { apply: { action: 'apply', settings: out.settings, echo: { errors: out.errors } } } };`, true), X(6, 1));
  f.add('Sheet: save settings', sheetWrite('$json.apply'), X(7, 1));
  f.add('Send the settings result', respond(), X(8, 1));
  // anything else
  f.add('Unknown action', respond({ json: '={{ JSON.stringify({ ok: false, error: "Unknown action" }) }}', code: 400 }), X(6, 2));

  f.chain('Owner app request', 'Config', 'Check the key', 'Key OK?');
  f.link('Key OK?', 'Sheet: read', 0);
  f.link('Key OK?', 'Wrong key', 1);
  f.link('Sheet: read', 'Which action?');
  f.link('Which action?', 'Calendar', 0);
  f.link('Which action?', 'Plan the post', 1);
  f.link('Which action?', 'Plan publish', 2);
  f.link('Which action?', 'Booking change', 3);
  f.link('Which action?', 'Settings change', 4);
  f.link('Which action?', 'Unknown action', 5);
  f.chain('Calendar', 'Send the calendar');
  f.chain('Plan the post', 'AI writes the post', 'Check the post', 'Send the draft');
  f.chain('Plan publish', 'Post to Facebook?');
  f.link('Post to Facebook?', 'Facebook: publish post', 0);
  f.link('Post to Facebook?', 'Save promo days', 1);
  f.chain('Facebook: publish post', 'Save promo days', 'Sheet: save promo', 'Send the publish result');
  f.chain('Booking change', 'Sheet: save booking', 'Send the booking result', 'Tell the guest?');
  f.link('Tell the guest?', 'Messenger: tell the guest', 0);
  f.chain('Settings change', 'Sheet: save settings', 'Send the settings result');
  return f;
}

/* ------------------------------------------------------------------ */
/* Workflow 3: the hourly timer                                        */
/* ------------------------------------------------------------------ */
function timer(cfg) {
  const f = new Flow('avail · Timer', 'availTimer00001');
  f.add('Every hour', { type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } } }, X(0, 0));
  f.add('Run now', webhook(f.name, 'POST', 'avail-timer', 'onReceived'), X(0, 1));
  f.add('Config', configNode({ sheetUrl: cfg.sheetUrl, graphUrl: cfg.graphUrl }), X(1, 0));
  f.add('Sheet: read', sheetRead(), X(2, 0));
  f.add('Find unpaid days', code(`
const x = AVAIL.expireSaves(AVAIL.buildCtx($input.first().json));
if (!x.changes.length) return [];
return [{ json: { apply: { action: 'apply', changes: x.changes, echo: { notices: x.notices } } } }];`), X(3, 0));
  f.add('Sheet: free the days', sheetWrite('$json.apply'), X(4, 0));
  f.add('Messages to send', code(`
const res = $input.first().json;
const ok = new Set((res.results || []).filter(r => r.ok).map(r => r.date));
return ((res.echo && res.echo.notices) || []).filter(n => ok.has(n.date)).map(n => ({ json: n }));`), X(5, 0));
  f.add('Tell the guests', messengerSend('$json.psid', '$json.text'), X(6, 0));
  f.chain('Every hour', 'Config', 'Sheet: read', 'Find unpaid days', 'Sheet: free the days', 'Messages to send', 'Tell the guests');
  f.link('Run now', 'Config');
  return f;
}

/* ------------------------------------------------------------------ */
function writeFlows(cfg, outDir, withIds) {
  fs.mkdirSync(outDir, { recursive: true });
  const flows = { 'avail-messenger.json': messenger(cfg), 'avail-owner-app.json': ownerApi(cfg), 'avail-timer.json': timer(cfg) };
  for (const [file, flow] of Object.entries(flows)) {
    fs.writeFileSync(path.join(outDir, file), JSON.stringify(flow.json(withIds), null, 2));
    console.log(`wrote ${path.join(outDir, file)} (${flow.nodes.length} nodes)`);
  }
}
const outDir = testDir || path.join(here, 'workflows');
if (testDir) writeFlows(TEST, testDir, true);
else {
  writeFlows(PROD, outDir, false);
  if (LOCAL) writeFlows(Object.assign({}, PROD, LOCAL), path.join(here, 'my-workflows'), false);
}
if (testDir) {
  const creds = [
    { id: 'credSheet000001', name: CREDS.sheet.name, type: CREDS.sheet.type, data: { name: 'key', value: 'test-sheet-key' } },
    { id: 'credGroq0000001', name: CREDS.groq.name, type: CREDS.groq.type, data: { name: 'Authorization', value: 'Bearer test-groq-key' } },
    { id: 'credFacebook001', name: CREDS.facebook.name, type: CREDS.facebook.type, data: { name: 'access_token', value: 'test-page-token' } }
  ];
  fs.writeFileSync(path.join(outDir, 'credentials.json'), JSON.stringify(creds, null, 2));
  console.log('wrote test credentials');
}
