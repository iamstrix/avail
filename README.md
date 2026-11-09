# avail

**Fill your empty days.**

avail helps small private pool resorts in the Philippines get bookings on empty days and reply to every guest right away. It works inside the resort's existing Facebook page and Messenger.

- **Empty days:** the owner taps the empty days on a calendar, and avail writes a Facebook post with a promo price the owner is okay with.
- **Fast replies:** when a guest messages, avail reads the message, works out the exact price, and saves the day for that guest until the GCash downpayment comes in. The owner confirms with one tap.

AI reads the messages and writes the posts. Prices are always worked out by code from the owner's own price list.

Built for Build-Off: Business Edition 2026 (Sales and Marketing Solutions).

## What's in here

| File | What it is |
|---|---|
| `promo-days.html` | The empty-days feature: pick days on the calendar, draft a Facebook post, publish it as a promo, then try asking about those days as a guest. |
| `prototype.html` | The full prototype: a guest's phone on one side and the owner's board on the other (inbox, calendar, saved days, approvals, upkeep bar). |

Both are single HTML files. Open them in a browser, or serve the folder locally:

```bash
python -m http.server 8765
```

Then go to `http://localhost:8765/promo-days.html` or `http://localhost:8765/prototype.html`.

When opened inside Claude, the pages use Claude to read guest messages and write posts. Opened anywhere else, they fall back to a simple keyword reader and post templates.

## Sample data

₱7,000 per overnight is the partner resort's real price. Everything else (bookings, lowest promo price, upkeep, house rules, GCash number) is placeholder data until the owner confirms it.
