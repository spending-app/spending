# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A bank-statement spending analyzer that runs entirely in the browser. It's a static site in `web/`
with no build step, no framework and no dependencies, published to GitHub Pages. Users' statements
never leave their browser. There's no server-side logic and no test suite.

## Commands

```
python3 -m http.server -d web 8765    # serve web/ at http://127.0.0.1:8765
```

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
  - `compute(files, rules)` rebuilds every transaction from the stored CSV texts on each load.
    Nothing derived is stored.
  - Transaction IDs are `sha1("date|description|%.2f amount|account|n")[:16]`, deliberately
    identical to the original Python command-line version (kept in a separate, private repo) so its
    `transaction_overrides` still apply. Don't change the ID recipe or `accountFromName` without
    accepting that users' one-off categories get orphaned.
- **`web/default-rules.js`**: keyword rules, merchant/category aliases, category descriptions
  (tooltips) and `exclude_from_spending`, shipped to every user. Users only store their own
  overrides, so improving these rules reaches everyone.
- **`web/index.html`**: the UI plus storage. IndexedDB holds `files` (`[{name, text}]`) and `user`
  (`{merchant_overrides, transaction_overrides}`); it falls back to memory when storage is blocked.
  Backup/restore is a JSON file, and restore also accepts the old CLI `rules.json`.
- **`web/demo/`**: synthetic sample statements loaded by `?demo`.

Real bank statements and backup files are personal data: keep them out of this repo (the
`.gitignore` covers the usual names) and use `web/demo/` for testing.
