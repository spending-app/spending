# Spending: see where your money goes

A spending dashboard that runs entirely in your web browser. There's nothing to install and no
account to create, and your bank statements are never uploaded: everything stays on your computer.
It's free and open source.

It looks back at where your money went: by month, category and merchant, plus the subscriptions and
bills that repeat. It's an analyzer, not a budgeting app: there are no budgets, goals or envelopes.

**Open it: https://spending-app.github.io/spending/**

![The dashboard with sample data: monthly spending, spending by category, and the transaction list](docs/screenshot.png)

## Use it
1. Open **https://spending-app.github.io/spending/**.
2. On your bank's or card's website, download your account activity as a **CSV** file.
3. Drop the files onto the page (or click **Add statement**). Add as many accounts as you like.

Not ready to use your own data? Click **Try it with sample data**.

- Click a category to see its merchants, then a merchant to see its transactions. Click a month bar to focus that month.
- Wrong category? Change it in the table. With "applies to all from that merchant" checked, it also
  remembers that choice for that merchant's future statements. In a category's merchant list, each
  merchant has its own category picker.
- Hover over a category to see what belongs in it.
- English and Chinese (中文): picked from your browser's language, or switch with the 中文 / EN button.
- **Recurring charges** lists subscriptions and bills found from charges that repeat on a steady
  schedule (weekly to yearly), with what each costs per year. It flags price increases and charges
  that seem to have stopped.
- Bank not recognized? You'll be asked once which column is the date, description and amount, and
  files with the same layout are read automatically after that. If a file comes out wrong (amounts
  with the wrong sign, say), **Files & backup → Columns…** lets you fix it.

## Your data
- Statements and your category choices are saved **in this browser only**. They don't sync to other
  computers or browsers.
- Clearing your browser's site data erases them, so use **Files & backup → Download backup** now and
  then. **Restore backup** brings everything back, on any computer.

## Not supported (yet)
- **PDF statements.** Download CSV from your bank instead.
- **OFX / QFX files** (the Quicken and Money format many banks offer).
- **Syncing between devices, or backup to your own cloud** (Dropbox, iCloud, Google Drive). Use
  Download backup / Restore backup to move your data.
- **Budgets and goals**, by design (see above).

Want one of these? [Open an issue](https://github.com/spending-app/spending/issues); requests
decide what gets built next.

### Check it yourself
You don't have to take our word that nothing is uploaded:
- **Go offline.** Load the page, turn off Wi-Fi, then add statements. Everything keeps working.
- **Watch the network.** Open your browser's developer tools (F12, or ⌥⌘I on a Mac), go to the
  **Network** tab and add a statement. The only requests are the page loading its own files.
- **Read the code.** It's all in `web/`, with no trackers or analytics, and the page's
  Content-Security-Policy (`connect-src 'self'`) tells the browser to block connections to any
  other site.

## Run it yourself
Any static file server works, since the app is just the files in `web/`:
```
python3 -m http.server -d web 8765    # then open http://127.0.0.1:8765
```
Tests: `node --test` (Node 18 or newer, nothing to install).

Pushing to `main` publishes `web/` to GitHub Pages (see `.github/workflows/pages.yml`). Tests run first, and
a failing test stops the deploy.
