// Statement parsing and categorizing. Pure functions, no DOM, so it also runs under Node for tests.
// Transaction ids match the original Python app (sha1 of date|description|amount|account|n), so
// transaction_overrides exported from the Python version keep working.
"use strict";
const Engine = (() => {

  // ------------------------------------------------------------ small helpers mirroring Python str methods

  const isCased = c => c.toLowerCase() !== c.toUpperCase();
  function title(s){  // str.title()
    let out = "", prev = false;
    for (const c of s){ const k = isCased(c); out += k ? (prev ? c.toLowerCase() : c.toUpperCase()) : c; prev = k; }
    return out;
  }
  const capitalize = s => s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
  const isLower = c => isCased(c) && c === c.toLowerCase();
  const reEscape = s => s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
  const pad = n => String(n).padStart(2, "0");

  // ------------------------------------------------------------ sha1 (crypto.subtle is async and missing on file://)

  function sha1hex(str){
    const bytes = new TextEncoder().encode(str);
    const len = bytes.length, words = new Uint32Array(((len + 8 >> 6) + 1) * 16);
    for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
    words[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
    words[words.length - 1] = len * 8;
    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    const w = new Uint32Array(80);
    for (let i = 0; i < words.length; i += 16){
      for (let t = 0; t < 16; t++) w[t] = words[i + t];
      for (let t = 16; t < 80; t++){ const x = w[t-3] ^ w[t-8] ^ w[t-14] ^ w[t-16]; w[t] = (x << 1) | (x >>> 31); }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let t = 0; t < 80; t++){
        const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
        const k = t < 20 ? 0x5A827999 : t < 40 ? 0x6ED9EBA1 : t < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
        const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = tmp;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    return [h0, h1, h2, h3, h4].map(h => h.toString(16).padStart(8, "0")).join("");
  }
  // Python "%.2f": keeps the sign of -0.0
  const f2 = v => Object.is(v, -0) ? "-0.00" : v.toFixed(2);

  // ------------------------------------------------------------ parsing

  const M = "(1[0-2]|0[1-9]|[1-9])", D = "(3[01]|[12]\\d|0[1-9]|[1-9])";
  const ABBR = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const FULL = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const yy = s => { const n = +s; return n < 69 ? 2000 + n : 1900 + n; };  // strptime %y pivot
  const mon = (list, s) => list.indexOf(s.toLowerCase()) + 1;
  const DATE_FORMATS = [  // same order as the Python DATE_FORMATS
    [new RegExp(`^${M}/${D}/(\\d{4})$`), m => [+m[3], +m[1], +m[2]]],          // %m/%d/%Y
    [new RegExp(`^${M}/${D}/(\\d{2})$`), m => [yy(m[3]), +m[1], +m[2]]],       // %m/%d/%y
    [new RegExp(`^(\\d{4})-${M}-${D}$`), m => [+m[1], +m[2], +m[3]]],          // %Y-%m-%d
    [new RegExp(`^(\\d{4})/${M}/${D}$`), m => [+m[1], +m[2], +m[3]]],          // %Y/%m/%d
    [new RegExp(`^${M}-${D}-(\\d{4})$`), m => [+m[3], +m[1], +m[2]]],          // %m-%d-%Y
    [new RegExp(`^([a-z]{3})\\s+${D},\\s+(\\d{4})$`, "i"), m => [+m[3], mon(ABBR, m[1]), +m[2]]],  // %b %d, %Y
    [new RegExp(`^${D}\\s+([a-z]{3})\\s+(\\d{4})$`, "i"), m => [+m[3], mon(ABBR, m[2]), +m[1]]],   // %d %b %Y
    [new RegExp(`^([a-z]+)\\s+${D},\\s+(\\d{4})$`, "i"), m => [+m[3], mon(FULL, m[1]), +m[2]]],    // %B %d, %Y
    [/^(\d{4})(1[0-2]|0[1-9])(3[01]|[12]\d|0[1-9])$/, m => [+m[1], +m[2], +m[3]]],               // %Y%m%d
  ];
  function parseDate(s){
    s = (s || "").trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]/.test(s)) s = s.slice(0, 10);  // drop time part
    for (const [rx, get] of DATE_FORMATS){
      const m = rx.exec(s); if (!m) continue;
      const [y, mo, d] = get(m);
      if (mo < 1 || y < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) continue;
      return `${String(y).padStart(4, "0")}-${pad(mo)}-${pad(d)}`;
    }
    return null;
  }

  function parseAmount(s){
    s = (s || "").trim();
    if (!s) return null;
    const neg = (s.startsWith("(") && s.endsWith(")")) || s.startsWith("-") || s.toUpperCase().endsWith("DR");
    s = s.replace(/[^\d.]/g, "");
    if (!s || s === "." || !/^\d*\.?\d*$/.test(s)) return null;
    const v = parseFloat(s);
    return neg ? -v : v;
  }

  // RFC 4180 / Python csv "excel" dialect
  function csvRows(text){
    const rows = []; let row = [], field = "", q = false, i = 0;
    const n = text.length;
    while (i < n){
      const c = text[i];
      if (q){
        if (c === '"'){ if (text[i+1] === '"'){ field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"' && field === ""){ q = true; i++; continue; }
      if (c === ","){ row.push(field); field = ""; i++; continue; }
      if (c === "\r" || c === "\n"){
        row.push(field); rows.push(row.length === 1 && row[0] === "" ? [] : row); row = []; field = "";
        i += (c === "\r" && text[i+1] === "\n") ? 2 : 1; continue;
      }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function pick(headers, names){
    for (const n of names){ const i = headers.indexOf(n); if (i >= 0) return i; }  // exact match first
    for (const n of names) for (let i = 0; i < headers.length; i++) if (headers[i].includes(n)) return i;
    return null;
  }

  function readCSV(text){
    const rows = csvRows(text.replace(/^﻿/, ""));
    let hi = null;
    for (let i = 0; i < Math.min(40, rows.length); i++){  // some banks put summary lines above the header
      const low = rows[i].map(c => c.trim().toLowerCase());
      if (low.some(c => c.includes("date")) &&
          low.some(c => ["amount", "debit", "credit", "withdraw", "deposit"].some(k => c.includes(k)))){ hi = i; break; }
    }
    if (hi === null) throw new Error("couldn't find a header row with Date + Amount columns");
    const h = rows[hi].map(c => c.trim().toLowerCase());
    const di = pick(h, ["transaction date", "trans. date", "trans date", "date", "posted date", "posting date", "post date"]);
    const de = pick(h, ["description", "payee", "merchant", "name", "details", "memo", "transaction"]);
    const ai = pick(h, ["amount"]);
    const dbi = pick(h, ["debit", "withdrawal", "withdrawals", "money out"]);
    const cri = pick(h, ["credit", "deposit", "deposits", "money in"]);
    const ci = pick(h, ["category"]);
    const ti = pick(h, ["type"]);  // e.g. Apple Card: Purchase / Payment / Refund
    if (di === null || de === null || (ai === null && dbi === null && cri === null))
      throw new Error("missing Date / Description / Amount columns: " + rows[hi].join(", "));
    const cell = (r, i) => (i !== null && i < r.length) ? r[i] : "";

    const out = [];
    for (const r of rows.slice(hi + 1)){
      const d = parseDate(cell(r, di)), desc = cell(r, de).trim();
      if (!d || !desc) continue;
      let v;
      if (ai !== null) v = parseAmount(cell(r, ai));
      else {  // separate debit / credit columns: sign is unambiguous
        const dv = parseAmount(cell(r, dbi)), cv = parseAmount(cell(r, cri));
        if (dv === null && cv === null) continue;
        v = Math.abs(cv || 0) - Math.abs(dv || 0);
      }
      if (v === null) continue;
      out.push({date: d, description: desc, amount: v, bank_category: cell(r, ci).trim(),
                _type: ti !== null ? cell(r, ti).trim().toLowerCase() : ""});
    }
    if (ai !== null && out.length){  // single "Amount" column: banks disagree on sign
      if (ti !== null && out.every(t => ["purchase", "payment", "refund", "return"].includes(t._type))){
        for (const t of out) t.amount = t._type === "purchase" ? -Math.abs(t.amount) : Math.abs(t.amount);
      } else {
        // Clues, strongest first, for "positive means money out" (a card charge):
        //  1. Amex's export (has "Card Member" / "Appears On Your Statement As") always lists charges as positive.
        //  2. Card payments ("ONLINE PAYMENT - THANK YOU") are money in, so if they're negative, flip.
        //  3. Otherwise, mostly positive. Statement credits (e.g. Amex offers) can outnumber charges,
        //     so this is only the fallback.
        const amex = h.some(c => c === "card member" || c.includes("appears on your statement"));
        const thanks = out.filter(t => /thank\s*you/i.test(t.description) && t.amount !== 0);
        const flip = amex ? true
          : thanks.length ? thanks.filter(t => t.amount < 0).length > thanks.length / 2
          : out.filter(t => t.amount > 0).length > out.length / 2;
        if (flip) for (const t of out) t.amount = -t.amount;
      }
    }
    for (const t of out) delete t._type;
    return out;
  }

  function accountFromName(name){
    const stem = name.replace(/\.[^.]*$/, "") || name;
    const m = /^(.+?)\s+transactions\s+\w.*$/i.exec(stem);  // Apple: "<Card> Transactions <date> - <date>"
    if (m) return m[1];
    return stem.replace(/[_-]?\d{4,}.*$/, "") || stem;  // "Chase_CFU_Activity_20261120" -> "Chase_CFU_Activity"
  }

  // ------------------------------------------------------------ categorizing

  const STRIP_PREFIX = /^(?:PURCHASE AUTHORIZED ON \d\d\/\d\d|POS PURCHASE|POS DEBIT|POS|DEBIT CARD PURCHASE|CHECKCARD \d{4}|CHECK CARD|DBT CRD \d+|RECURRING PAYMENT|RECURRING|ACH DEBIT|ACH CREDIT)\s*-?\s*/;
  const STRIP_PROC = /^(?:SQ|TST|SP|PP|PAYPAL|DD|IC|PY|BT|CKO|GOOGLE|APPLE PAY)\s?\*\s*/;
  const US_STATES = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY " +
                             "NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split(" "));

  function cleanMerchant(desc){
    let s = desc.toUpperCase().trim();
    s = s.replace(STRIP_PREFIX, "").replace(STRIP_PROC, "");
    s = s.split(/\s{2,}|\s#|#|\*|\s\d{3,}|\s-\s/)[0];
    const hasState = /\s[A-Z]{2}$/.test(desc.toUpperCase().trim());  // "... NEW YORK NY"
    s = s.replace(/\b\d+\b/g, " ").replace(/[^A-Z&' .]/g, " ");
    let words = s.split(/\s+/).filter(Boolean);
    if (hasState && words.length > 2){
      if (US_STATES.has(words[words.length - 1])) words = words.slice(0, -1);
      words = words.slice(0, 2);  // city name usually follows the merchant
    }
    words = words.slice(0, 3);
    const c = w => (!/[AEIOUY]/.test(w) || w.includes("&")) ? w : capitalize(w);
    return words.map(c).join(" ") || desc.slice(0, 30);
  }

  const P2P = /\b(zelle|venmo|cash app|paypal)\b(?:\s+(?:payment|transfer|instant|pmt))*\s+(to|from)\s+(.+)/i;
  function p2pPayee(desc){  // 'Zelle payment to Jane Doe ABC12xyz34' -> 'Zelle to Jane Doe'
    const m = P2P.exec(desc);
    if (!m) return null;
    const words = [];
    for (const w of m[3].trim().split(/\s+/)){
      if (["conf", "ref", "id", "on", "memo", "web"].includes(w.toLowerCase().replace(/[#:]+$/, ""))) break;
      if (/\d/.test(w) || !/[A-Za-z]/.test(w)) continue;  // confirmation codes, '#'
      words.push(w);
    }
    if (!words.length) return null;
    const name = words.slice(0, 4).map(w => [...w.slice(1)].some(isLower) ? w : capitalize(w)).join(" ");
    return `${title(m[1]).replace("Paypal", "PayPal")} ${m[2].toLowerCase()} ${name}`;
  }

  function merchantFor(desc, rules){
    const p = p2pPayee(desc);  // person-to-person: the person is the "merchant"
    if (p) return p;
    const up = desc.toUpperCase();
    for (const [key, name] of Object.entries(rules.merchant_aliases)) if (up.includes(key.toUpperCase())) return name;
    return cleanMerchant(desc);
  }

  // Defaults ship with the app; the user only owns their overrides, so rule improvements reach everyone.
  function buildRules(defaults, user = {}){
    const rules = JSON.parse(JSON.stringify(defaults));
    rules.merchant_overrides = {...(rules.merchant_overrides || {}), ...(user.merchant_overrides || {})};
    rules.transaction_overrides = {...(rules.transaction_overrides || {}), ...(user.transaction_overrides || {})};
    for (const k of ["merchant_aliases", "category_aliases", "category_info"]) rules[k] = rules[k] || {};
    rules.exclude_from_spending = rules.exclude_from_spending || ["Transfers", "Income", "Ignored"];
    if (!rules.exclude_from_spending.includes("Ignored")) rules.exclude_from_spending.push("Ignored");
    rules.compiled = (rules.rules || []).map(r =>
      [r.category, new RegExp(r.keywords.map(k => "(?<![a-z])" + reEscape(k.toLowerCase())).join("|"))]);
    return rules;
  }

  // Own keys only: a category or file named "constructor" mustn't pick up Object.prototype members.
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
  const canon = (cat, rules) => own(rules.category_aliases, cat) || cat;

  function categoryFor(t, merchant, rules){
    let cat = own(rules.merchant_overrides, merchant);
    if (cat === undefined){
      const low = t.description.toLowerCase();
      const hit = rules.compiled.find(([, rx]) => rx.test(low));
      if (hit) cat = hit[0];
    }
    if (cat === undefined) cat = t.bank_category ? title(t.bank_category) : (t.amount > 0 ? "Income" : "Uncategorized");
    return canon(cat, rules);
  }

  // ------------------------------------------------------------ everything the UI needs, from files + rules

  function compute(files, rules){
    const seenIds = new Set(), transactions = [], errors = [], perFile = Object.create(null);
    for (const f of [...files].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)){
      let txs;
      try { txs = readCSV(f.text); } catch (e){ errors.push({file: f.name, error: e.message}); continue; }
      const account = accountFromName(f.name), seen = {};
      perFile[f.name] = txs.length;
      for (const t of txs){
        const base = `${t.date}|${t.description}|${f2(t.amount)}|${account}`;
        const n = seen[base] || 0; seen[base] = n + 1;  // same charge twice in one file is real, keep both
        const id = sha1hex(`${base}|${n}`).slice(0, 16);
        if (seenIds.has(id)) continue;  // overlapping exports of the same account: first file wins
        seenIds.add(id);
        const merchant = merchantFor(t.description, rules);
        const over = own(rules.transaction_overrides, id);
        transactions.push({id, ...t, account, merchant, source: f.name, overridden: over !== undefined,
                           category: over !== undefined ? canon(over, rules) : categoryFor(t, merchant, rules)});
      }
    }
    transactions.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    const named = new Set([...rules.rules.map(r => r.category), "Uncategorized", "Income", "Transfers", "Ignored",
                           ...Object.values(rules.merchant_overrides), ...Object.values(rules.transaction_overrides)]
                          .map(c => canon(c, rules)));
    for (const t of transactions) named.add(t.category);  // bank categories with no rule still need to be selectable
    return {transactions, errors, perFile, categories: [...named].sort(),
            exclude: rules.exclude_from_spending, category_info: rules.category_info};
  }

  return {parseDate, parseAmount, csvRows, readCSV, accountFromName, cleanMerchant, p2pPayee, merchantFor,
          buildRules, categoryFor, canon, compute, sha1hex};
})();
if (typeof module !== "undefined") module.exports = Engine;
