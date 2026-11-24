// Tests for web/engine.js: parsing, categorizing, transaction IDs and recurring charges.
// Run with:  node --test            (Node 18+, no dependencies)
// After an intended change to the sample data or default rules, refresh the snapshot with:
//   UPDATE_SNAPSHOTS=1 node --test
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../web/engine.js");
const DEFAULT_RULES = require("../web/default-rules.js");

const ROOT = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const rules = (user = {}) => E.buildRules(DEFAULT_RULES, user);
const rows = txs => txs.map(t => [t.date, t.description, t.amount]);
const csv = lines => lines.join("\n") + "\n";

// ---------------------------------------------------------------- small parsers

test("parseDate: formats banks use", () => {
  assert.equal(E.parseDate("11/18/2026"), "2026-11-18");
  assert.equal(E.parseDate("1/5/2026"), "2026-01-05");
  assert.equal(E.parseDate("11/18/26"), "2026-11-18");
  assert.equal(E.parseDate("2026-11-18"), "2026-11-18");
  assert.equal(E.parseDate("2026-11-18T10:22:00"), "2026-11-18");
  assert.equal(E.parseDate("2026/11/18"), "2026-11-18");
  assert.equal(E.parseDate(" 11-18-2026 "), "2026-11-18");
});

test("parseDate: rejects non-dates and impossible dates", () => {
  for (const s of ["", "Date", "02/30/2026", "13/01/2026", "12.34", "Beginning balance"]) assert.equal(E.parseDate(s), null, s);
});

test("parseAmount: signs, currency symbols, separators", () => {
  assert.equal(E.parseAmount("19.18"), 19.18);
  assert.equal(E.parseAmount("-19.18"), -19.18);
  assert.equal(E.parseAmount("$1,234.56"), 1234.56);
  assert.equal(E.parseAmount("(42.00)"), -42);
  assert.equal(E.parseAmount("12.00 DR"), -12);
  assert.equal(E.parseAmount(""), null);
  assert.equal(E.parseAmount("n/a"), null);
});

test("csvRows: quotes, embedded commas and newlines, CRLF", () => {
  assert.deepEqual(E.csvRows('a,"b, c","d ""q"""\r\n1,"two\nlines",3\n'),
                   [["a", "b, c", 'd "q"'], ["1", "two\nlines", "3"]]);
});

test("accountFromName: account names from typical export file names", () => {
  assert.equal(E.accountFromName("Apple Card Transactions Jan 01 2026 - Nov 01 2026.csv"), "Apple Card");
  assert.equal(E.accountFromName("Chase_CFU_Activity_20261120.csv"), "Chase_CFU_Activity");
  assert.equal(E.accountFromName("Amex Delta.csv"), "Amex Delta");
});

// ---------------------------------------------------------------- readCSV: automatic detection + sign conventions

test("readCSV: purchases already negative (Chase style) stay as they are", () => {
  const txs = E.readCSV(csv(["Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    "11/15/2026,11/15/2026,STARBUCKS STORE 12345,Food & Drink,Sale,-4.17,",
    "11/14/2026,11/14/2026,Payment Thank You-Mobile,,Payment,500.00,"]));
  assert.deepEqual(rows(txs), [["2026-11-15", "STARBUCKS STORE 12345", -4.17], ["2026-11-14", "Payment Thank You-Mobile", 500]]);
  assert.equal(txs[0].bank_category, "Food & Drink");
});

test("readCSV: Amex with one autopay per charge gets flipped (regression)", () => {
  // Equal numbers of positive and negative rows used to defeat the majority guess.
  const txs = E.readCSV(csv(["Date,Description,Amount",
    "01/20/2026,NETFLIX.COM         866-579-7172        CA,19.18",
    "01/10/2026,AUTOPAY PAYMENT - THANK YOU,-19.18"]));
  assert.deepEqual(txs.map(t => t.amount), [-19.18, 19.18]);
});

test("readCSV: Amex's full export (Card Member column) is always flipped", () => {
  const txs = E.readCSV(csv(["Date,Description,Card Member,Account #,Amount",
    "03/20/2026,NETFLIX.COM,J DOE,-12345,19.18",
    "03/21/2026,AMEX OFFER CREDIT,J DOE,-12345,-5.00",
    "03/22/2026,DELTA CREDIT,J DOE,-12345,-10.00"]));
  assert.deepEqual(txs.map(t => t.amount), [-19.18, 5, 10]);
});

test("readCSV: no payment rows, mostly positive -> flipped", () => {
  const txs = E.readCSV(csv(["Date,Description,Amount", "01/01/2026,A,10", "01/02/2026,B,20", "01/03/2026,REFUND,-5"]));
  assert.deepEqual(txs.map(t => t.amount), [-10, -20, 5]);
});

test("readCSV: Apple Card's Type column decides the sign", () => {
  const txs = E.readCSV(csv(["Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)",
    "11/18/2026,11/19/2026,NYCT PAYGO,MTA,Transportation,Purchase,3.00",
    "11/17/2026,11/17/2026,ACH DEPOSIT INTERNET TRANSFER,Payment,Payment,Payment,-100.00",
    "11/16/2026,11/16/2026,STORE RETURN,Store,Shopping,Refund,-20.00"]));
  assert.deepEqual(txs.map(t => t.amount), [-3, 100, 20]);
});

test("readCSV: separate debit/credit columns, header below a summary block", () => {
  const txs = E.readCSV(csv(["Account Summary,,,", "Beginning balance,,,12000.00", "",
    "Date,Description,Debit,Credit,Balance",
    "2026-01-01,RENT PAYMENT,3100.00,,", "2026-01-15,ACME PAYROLL DIRECT DEP,,5200.00,"]));
  assert.deepEqual(rows(txs), [["2026-01-01", "RENT PAYMENT", -3100], ["2026-01-15", "ACME PAYROLL DIRECT DEP", 5200]]);
});

test("readCSV: unrecognized layouts throw (the UI then asks which column is which)", () => {
  assert.throws(() => E.readCSV(read("testdata/wells_fargo_checking.csv")), /header row/);
  assert.throws(() => E.readCSV(csv(["Date,Amount", "01/01/2026,5"])), /missing Date \/ Description \/ Amount/);
});

test("readCSV: Bank of America files are detected automatically", () => {
  const checking = E.readCSV(read("testdata/bank_of_america_checking.csv"));
  assert.equal(checking.length, 130);  // the "Beginning balance" row has no amount and is skipped
  assert.ok(checking.find(t => /PAYROLL/.test(t.description)).amount > 0);
  const card = E.readCSV(read("testdata/bank_of_america_credit_card.csv"));
  assert.ok(card.find(t => t.description === "NETFLIX.COM").amount < 0);
  assert.ok(card.find(t => t.description === "PAYMENT - THANK YOU").amount > 0);
});

// ---------------------------------------------------------------- user-chosen column layouts

test("guessMap: headerless Wells Fargo file", () => {
  const g = E.guessMap(read("testdata/wells_fargo_checking.csv"));
  assert.deepEqual(g.map, {header: -1, date: 0, desc: 4, amount: 1, debit: -1, credit: -1, category: -1, sign: "negative"});
  const txs = E.readCSV(read("testdata/wells_fargo_checking.csv"), g.map);
  assert.equal(txs.length, 140);
  assert.ok(txs.find(t => /PAYROLL/.test(t.description)).amount > 0);
  assert.ok(txs.find(t => /KROGER/.test(t.description)).amount < 0);
});

test("guessMap: odd header names, money-out/money-in pair, purchases positive", () => {
  const pair = E.guessMap(csv(["Booked,Text,Out,In,Saldo", "2026-10-30,KROGER,45.12,,1000",
                               "2026-10-29,PAYROLL,,2100,1045.12", "2026-10-28,NETFLIX,12.00,,1054.88"]));
  assert.equal(pair.map.debit, 2); assert.equal(pair.map.credit, 3); assert.equal(pair.map.amount, -1);
  const pos = E.guessMap(csv(["When,What,How much", "10/30/2026,KROGER,45.12",
                              "10/29/2026,AUTOPAY PAYMENT - THANK YOU,-500", "10/28/2026,NETFLIX,12.00"]));
  assert.equal(pos.map.sign, "positive");
});

test("layoutKey: two exports from the same bank share a key, so the mapping is reused", () => {
  const a = E.guessMap(csv(['"10/30/2026","-45.12","*","","KROGER"']));
  const b = E.guessMap(read("testdata/wells_fargo_checking.csv"));
  assert.equal(a.key, b.key);
  assert.notEqual(E.guessMap(read("testdata/bank_of_america_credit_card.csv")).key, b.key);
});

test("readCSV with a map: sign option, debit/credit columns, nothing found", () => {
  const text = csv(["x,y,z", "01/02/2026,COFFEE,4.50", "01/03/2026,PAYMENT,-100"]);
  const m = {header: 0, date: 0, desc: 1, amount: 2, debit: -1, credit: -1, category: -1, sign: "positive"};
  assert.deepEqual(E.readCSV(text, m).map(t => t.amount), [-4.5, 100]);
  assert.deepEqual(E.readCSV(text, {...m, sign: "negative"}).map(t => t.amount), [4.5, -100]);
  const dc = csv(["d,desc,out,in", "01/02/2026,COFFEE,4.50,", "01/03/2026,PAY,,100"]);
  assert.deepEqual(E.readCSV(dc, {...m, amount: -1, debit: 2, credit: 3}).map(t => t.amount), [-4.5, 100]);
  assert.throws(() => E.readCSV(text, {...m, date: 1}), /no transactions/);
});

// ---------------------------------------------------------------- merchants

test("merchantFor: cleans up raw descriptions", () => {
  const r = rules(), m = d => E.merchantFor(d, r);
  assert.equal(m("WHOLEFDS JCY 10234 JERSEY CITY NJ"), "Whole Foods");                 // alias
  assert.equal(m("TST* SHAKE SHACK 1123 CHICAGO IL"), "Shake Shack");                  // processor prefix
  assert.equal(m("SPYHOUSE COFFEE MINNEAPOLIS MN"), "Spyhouse Coffee");               // city + state dropped
  assert.equal(m("PURCHASE AUTHORIZED ON 10/29 BARISTA PARLOR NASHVILLE TN S000000000000000 CARD 0000"), "Barista Parlor");
  assert.equal(m("DUKE ENERGY DES:BILL PAY ID:XXXXX00000 INDN:SAMPLE USER CO ID:XXXXX00000 WEB"), "Duke Energy");
  assert.equal(m("Zelle payment to Jane Doe ABC12xyz34"), "Zelle to Jane Doe");        // person-to-person
});

// ---------------------------------------------------------------- categories

test("categoryFor: precedence and fallbacks", () => {
  const t = (description, amount = -10, bank_category = "") => ({description, amount, bank_category});
  const cat = (tx, r = rules()) => E.categoryFor(tx, E.merchantFor(tx.description, r), r);
  assert.equal(cat(t("NETFLIX.COM")), "Subscriptions");                                  // keyword rule
  assert.equal(cat(t("ENRITE GAS 0000000 LITTLE FALLS NJ")), "Transport & Gas");
  assert.equal(cat(t("WASHINGTON GAS LIGHT CO")), "Utilities");                           // earlier rule wins
  assert.equal(cat(t("UNKNOWN PLACE", -10, "automotive")), "Car");                       // bank category, title-cased + aliased
  assert.equal(cat(t("UNKNOWN PLACE", 25)), "Income");
  assert.equal(cat(t("UNKNOWN PLACE")), "Uncategorized");
  assert.equal(cat(t("NETFLIX.COM"), rules({merchant_overrides: {Netflix: "Entertainment"}})), "Entertainment");
  assert.equal(cat(t("ZELLE TO MARTA LOPEZ")), "Person to Person");                       // not mistaken for MARTA transit
  assert.equal(cat(t("ATM IN CULVER CITY CA")), "Uncategorized");                         // not mistaken for Culver's
});

test("categoryFor: keywords only match at the start of a word", () => {
  const r = rules(), cat = d => E.categoryFor({description: d, amount: -1, bank_category: ""}, E.merchantFor(d, r), r);
  assert.equal(cat("TIBET PHO WOODSTOCK NY"), "Dining");
  assert.equal(cat("SOMETHINGPHO STORE"), "Uncategorized");
});

// ---------------------------------------------------------------- compute: IDs, dedupe, overrides

const AMEX = csv(["Date,Description,Amount", "01/20/2026,NETFLIX.COM,19.18", "01/10/2026,AUTOPAY PAYMENT - THANK YOU,-19.18"]);

test("compute: transaction IDs match the Python version (don't change the recipe)", () => {
  const ids = Object.fromEntries(E.compute([{name: "amex.csv", text: AMEX}], rules()).transactions.map(t => [t.description, t.id]));
  // sha1("date|description|%.2f amount|account|n")[:16], computed with Python's hashlib
  assert.equal(ids["NETFLIX.COM"], "2b2c2ada05da5730");
  assert.equal(ids["AUTOPAY PAYMENT - THANK YOU"], "e39d4c2790af66eb");
});

test("compute: the same charge twice in one file is kept; overlapping files are deduped", () => {
  const twice = csv(["Date,Description,Amount", "01/20/2026,NETFLIX.COM,19.18", "01/20/2026,NETFLIX.COM,19.18",
                     "01/10/2026,AUTOPAY PAYMENT - THANK YOU,-38.36"]);
  const one = E.compute([{name: "amex.csv", text: twice}], rules());
  assert.deepEqual(one.transactions.filter(t => t.description === "NETFLIX.COM").map(t => t.id), ["2b2c2ada05da5730", "d5afef88d9bfae55"]);
  // a second, overlapping export of the same account (same account name, so same IDs) adds nothing new
  const both = E.compute([{name: "amex.csv", text: twice}, {name: "amex 2.csv", text: AMEX}], rules());
  assert.equal(both.transactions.filter(t => t.account === "amex").length, 3);
});

test("compute: one-off overrides, per-file counts, bad files reported", () => {
  const r = rules({transaction_overrides: {"2b2c2ada05da5730": "Entertainment"}});
  const out = E.compute([{name: "amex.csv", text: AMEX}, {name: "notes.csv", text: "hello\nworld\n"}], r);
  const netflix = out.transactions.find(t => t.id === "2b2c2ada05da5730");
  assert.equal(netflix.category, "Entertainment");
  assert.equal(netflix.overridden, true);
  assert.equal(out.perFile["amex.csv"], 2);
  assert.deepEqual(out.errors.map(e => e.file), ["notes.csv"]);
});

test("compute: a file's saved column mapping is used", () => {
  const text = read("testdata/wells_fargo_checking.csv"), map = E.guessMap(text).map;
  assert.equal(E.compute([{name: "wf.csv", text}], rules()).errors.length, 1);
  assert.equal(E.compute([{name: "wf.csv", text, map}], rules()).perFile["wf.csv"], 140);
});

test("compute: category and file names that are Object.prototype members are plain strings", () => {
  const out = E.compute([{name: "constructor", text: AMEX}], rules({merchant_overrides: {Netflix: "constructor"}}));
  assert.equal(out.transactions.find(t => t.merchant === "Netflix").category, "constructor");
  assert.equal(out.perFile["constructor"], 2);
  assert.equal(out.perFile["toString"], undefined);
});

// ---------------------------------------------------------------- recurring charges

const charge = (merchant, date, amount, category = "Subscriptions") => ({merchant, date, amount: -amount, category});
const months = (merchant, amounts, day = "03", category) =>
  amounts.map((a, i) => charge(merchant, `2026-${String(i + 1).padStart(2, "0")}-${day}`, a, category));

test("findRecurring: steady monthly charges are found, with yearly cost", () => {
  const [r] = E.findRecurring(months("Netflix", [15.49, 15.49, 15.49, 15.49]), []);
  assert.equal(r.merchant, "Netflix");
  assert.equal(r.cadence, "Monthly");
  assert.equal(r.typical, 15.49);
  assert.ok(Math.abs(r.yearly - 15.49 * 12) < 1);
  assert.equal(r.varies, false);
});

test("findRecurring: price increases, varying bills and stopped charges are flagged", () => {
  const out = E.findRecurring([...months("Netflix", [15.49, 15.49, 15.49, 17.99]),
                               ...months("Electric", [60, 95, 72, 81], "06", "Utilities"),
                               ...months("Hulu", [7.99, 7.99, 7.99]),
                               charge("Latest", "2026-04-20", 1, "Shopping")], []);
  const by = Object.fromEntries(out.map(r => [r.merchant, r]));
  assert.equal(by.Netflix.priceUp, 15.49);
  assert.equal(by.Electric.varies, true);
  assert.equal(by.Hulu.ended, false);
  const later = E.findRecurring([...months("Hulu", [7.99, 7.99, 7.99]), charge("Latest", "2026-09-30", 1, "Shopping")], []);
  assert.equal(later[0].ended, true);
});

test("findRecurring: a price increase stays flagged after the first higher charge", () => {
  const [r] = E.findRecurring(months("YouTube", [13.99, 13.99, 13.99, 15.99, 15.99, 15.99]), []);
  assert.equal(r.priceUp, 13.99);
  assert.equal(r.typical, 15.99, "the usual amount is the new price");
  assert.equal(r.varies, false);
  const [down] = E.findRecurring(months("YouTube", [15.99, 15.99, 15.99, 13.99, 13.99]), []);
  assert.equal(down.priceUp, null, "a price drop isn't flagged");
  const [bill] = E.findRecurring(months("Electric", [60, 95, 72, 81, 81], "06", "Utilities"), []);
  assert.equal(bill.priceUp, null, "a varying bill isn't a price increase");
});

test("findRecurring: irregular spending, income and excluded categories are ignored", () => {
  const coffee = [1, 2, 4, 5, 9, 10, 11, 16, 20, 21].map(d => charge("Coffee", `2026-03-${String(d).padStart(2, "0")}`, 4.5, "Dining"));
  const groceries = months("Kroger", [20, 140, 35, 160], "10", "Groceries");  // monthly but amounts all over the place
  const payroll = months("Payroll", [-3100, -3100, -3100], "01", "Income");
  const rent = months("Rent", [2000, 2000, 2000], "01", "Transfers");
  assert.deepEqual(E.findRecurring([...coffee, ...groceries, ...payroll, ...rent], ["Transfers"]), []);
});

// ---------------------------------------------------------------- snapshot of the sample data

// Totals for web/demo/*.csv: catches unintended changes to parsing or the default rules anywhere.
test("sample data: per-file counts and spending per category match the snapshot", () => {
  const files = fs.readdirSync(path.join(ROOT, "web/demo")).filter(n => n.endsWith(".csv")).sort()
    .map(name => ({name, text: read("web/demo/" + name)}));
  const out = E.compute(files, rules());
  const byCategory = {};
  for (const t of out.transactions) byCategory[t.category] = Math.round(((byCategory[t.category] || 0) + t.amount) * 100) / 100;
  const actual = {
    perFile: {...out.perFile}, errors: out.errors,
    byCategory: Object.fromEntries(Object.entries(byCategory).sort()),
    recurring: E.findRecurring(out.transactions, out.exclude).map(r => `${r.merchant} · ${r.cadence} · ${r.typical.toFixed(2)}`),
  };
  const snap = path.join(__dirname, "demo-snapshot.json");
  if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(snap)) fs.writeFileSync(snap, JSON.stringify(actual, null, 2) + "\n");
  assert.deepEqual(actual, JSON.parse(fs.readFileSync(snap, "utf8")));
});
