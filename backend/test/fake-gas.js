// A tiny stand-in for Google Apps Script, so Code.gs can run in Node for tests.
// It keeps each tab as a 2D array of values, like a real Sheet.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'sheet', 'Code.gs'), 'utf8');

function formatDate(d, tz, fmt) {
  const offset = tz === 'Asia/Manila' ? 8 : 0;
  const p = new Date(d.getTime() + offset * 3600000);
  const two = n => String(n).padStart(2, '0');
  const parts = {
    yyyy: String(p.getUTCFullYear()), MM: two(p.getUTCMonth() + 1), dd: two(p.getUTCDate()),
    HH: two(p.getUTCHours()), mm: two(p.getUTCMinutes()), ss: two(p.getUTCSeconds())
  };
  return fmt.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (m, lit) => lit !== undefined ? lit : parts[m]);
}

function createGas(options) {
  options = options || {};
  let fixedNow = options.now ? Date.parse(options.now) : null;
  const sheets = new Map();

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sh.data[this.r - 1 + i] || [];
        const vals = [];
        for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; vals.push(v === undefined ? '' : v); }
        out.push(vals);
      }
      return out;
    }
    setValues(values) {
      values.forEach((vals, i) => {
        const idx = this.r - 1 + i;
        while (this.sh.data.length <= idx) this.sh.data.push([]);
        vals.forEach((v, j) => { this.sh.data[idx][this.c - 1 + j] = v; });
      });
      return this;
    }
    setNumberFormat() { return this; }
    setFontWeight() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
    getLastRow() { return this.data.length; }
    getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
    getMaxRows() { return 1000; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
    appendRow(values) { this.data.push(values.slice()); return this; }
    setFrozenRows() { return this; }
  }
  const spreadsheet = {
    getSheetByName: n => sheets.get(n) || null,
    insertSheet: n => { const s = new Sheet(n); sheets.set(n, s); return s; }
  };
  const props = new Map();

  const RealDate = Date;
  function FakeDate(...args) {
    if (!new.target) return new RealDate(fixedNow === null ? RealDate.now() : fixedNow).toString();
    if (args.length === 0) return new RealDate(fixedNow === null ? RealDate.now() : fixedNow);
    return new RealDate(...args);
  }
  FakeDate.now = () => (fixedNow === null ? RealDate.now() : fixedNow);
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  Object.defineProperty(FakeDate, Symbol.hasInstance, { value: x => x instanceof RealDate });

  const sandbox = {
    Date: FakeDate,
    JSON, Math, String, Number, Object, Array, isNaN,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, getUi: () => { throw new Error('no UI in tests'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      createTextOutput: s => ({ text: s, setMimeType() { return this; }, getContent() { return this.text; } }),
      MimeType: { JSON: 'application/json' }
    },
    Utilities: { formatDate, getUuid: () => crypto.randomUUID() },
    Logger: { log() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: 'Code.gs' });

  const api = {
    sandbox,
    setNow(t) { fixedNow = t === null ? null : Date.parse(t); },
    setup() { return sandbox.setup(); },
    key() { return props.get('API_KEY'); },
    setKey(k) { props.set('API_KEY', String(k)); },
    get(params) { return JSON.parse(sandbox.doGet({ parameter: params || {} }).getContent()); },
    post(params, body) { return JSON.parse(sandbox.doPost({ parameter: params || {}, postData: { contents: JSON.stringify(body || {}) } }).getContent()); },
    tab(name) {
      const sh = sheets.get(name);
      if (!sh || !sh.data.length) return [];
      const [h, ...rows] = sh.data;
      return rows.map(r => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? '' : r[i]])));
    },
    addRows(name, rows) {
      const sh = sheets.get(name);
      const h = sh.data[0];
      for (const r of rows) sh.appendRow(h.map(k => (r[k] === undefined ? '' : r[k])));
    },
    setSetting(k, v) {
      const sh = sheets.get('Settings');
      const row = sh.data.find((r, i) => i > 0 && r[0] === k);
      if (row) row[1] = String(v); else sh.appendRow([k, String(v), '']);
    }
  };
  return api;
}

module.exports = { createGas, formatDate };
