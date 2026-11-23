# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A bank-statement spending analyzer that runs entirely in the browser. It's a static site in `web/`
with no build step, no framework and no dependencies, published to GitHub Pages. Users' statements
never leave their browser. There's no server-side logic.

## Commands

```
python3 -m http.server -d web 8765    # serve web/ at http://127.0.0.1:8765
node --test                           # run tests/ (Node 18+, no dependencies)
UPDATE_SNAPSHOTS=1 node --test        # after an intended change to sample data or default rules
```

Tests cover `engine.js` (parsing, sign detection, column mappings, merchants, categories, transaction
IDs, recurring charges). `tests/demo-snapshot.json` pins per-file counts, per-category totals and
recurring charges for `web/demo/`, so any rule or parser change that moves those numbers shows up;
review the diff before refreshing it. CI runs the tests on every push, and a failure stops the Pages
deploy. The UI in `index.html` has no automated tests: check it in a browser.

Edits to `web/` show up on a page refresh. Open `http://127.0.0.1:8765/?demo` for the sample data.
`?demo` uses a separate browser database (`spending-demo`), so it never touches your own
(`spending-main`). `engine.js` and `default-rules.js` also load under Node
(`require("./web/engine.js")`), which is the way to test parsing/categorizing without a browser.

## Architecture

- **`web/engine.js`**: all parsing and categorizing, as pure functions.
  - `readCSV` finds the header row and handles single signed Amount vs. separate Debit/Credit columns,
    plus sign conventions: a Type column (Purchase/Payment) wins, otherwise a majority-positive file
    gets flipped.
  - `merchantFor` / `categoryFor` derive the merchant and the category. Category precedence, highest
    first: `transaction_overrides` > `merchant_overrides` > keyword `rules` (first match in list
    order) > the bank's own category > default (`Income` if positive, else `Uncategorized`).
    `category_aliases` is then applied to the result, folding bank labels like "Automotive" into our
    categories.
  - `readCSV(text, map)`: with a `map` (`{header, date, desc, amount, debit, credit, category}` as
    row/column indexes, -1 for none, plus `sign`), detection is skipped and those columns are used.
    `guessMap` pre-fills the "which column is which" dialog shown when detection fails; `layoutKey`
    fingerprints a layout so the user's mapping is reused for later files from the same bank.
  - `findRecurring(transactions, exclude)` finds subscriptions/bills: merchants charged on a steady
    cadence (most gaps within a weekly to yearly band) for a similar amount. It runs over all history,
    not the selected range.
  - `compute(files, rules)` rebuilds every transaction from the stored CSV texts on each load.
    Nothing derived is stored.
  - Transaction IDs are `sha1("date|description|%.2f amount|account|n")[:16]`, deliberately
    identical to the original Python command-line version (kept in a separate, private repo) so its
    `transaction_overrides` still apply. Don't change the ID recipe or `accountFromName` without
    accepting that users' one-off categories get orphaned.
- **`web/default-rules.js`**: keyword rules, merchant/category aliases, category descriptions
  (tooltips) and `exclude_from_spending`, shipped to every user. Users only store their own
  overrides, so improving these rules reaches everyone.
- **`web/index.html`**: the UI plus storage. IndexedDB holds `files` (`[{name, text, map?}]`) and `user`
  (`{merchant_overrides, transaction_overrides, formats}`, where `formats` maps a layout key to a
  column mapping); it falls back to memory when storage is blocked. Anything read from storage or a
  backup goes through `strMap` / `cleanMap` / `cleanFormats` before use.
  Backup/restore is a JSON file, and restore also accepts the old CLI `rules.json`.
- **`web/demo/`**: synthetic sample statements loaded by `?demo`.
- **`testdata/`**: synthetic files in real banks' layouts (Wells Fargo has no header row, so it exercises
  the column-mapping form) for manual testing. Not deployed and not auto-loaded.

Real bank statements and backup files are personal data: keep them out of this repo (the
`.gitignore` covers the usual names) and use `web/demo/` for testing.
