# Test files

Made-up statements in the layouts real banks export, for trying the app by hand. Nothing here is
real data. Add them with **＋ Add statement**; they aren't loaded by "Try it with sample data".

| File | Layout | What it tests |
|---|---|---|
| `wells_fargo_checking.csv` | No header row: `"date","amount","*","","description"` | Can't be detected automatically, so the **"Which column is which?"** form opens, pre-filled with a guess. Import it, then add it again under another name: the layout is remembered and nobody asks. |
| `bank_of_america_checking.csv` | A summary block above the real header; `Running Bal.` column; ACH descriptions with `DES:` | Header found below the summary lines; merchant names cut at `DES:`. |
| `bank_of_america_credit_card.csv` | `Posted Date,Reference Number,Payee,Address,Amount` | Detected automatically; purchases are already negative. |

To try the form on a file that *was* detected, open **Files & backup → Columns…** next to it.
