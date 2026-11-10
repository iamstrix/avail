# avail tech stack

How avail is put together, in plain terms. The real build lives in `app/` and `backend/`, and [SETUP.md](SETUP.md) explains how to connect it to a real Facebook page. The older prototypes (`promo-days.html`, `prototype.html`) show the same flow inside a single web page.

## The pieces

| Piece | Tool | What it does |
|---|---|---|
| Where guests are | Facebook page + Messenger | Guests message the page or tap Book Now. Replies go back on Messenger, so it looks like the resort answering. |
| Connection to Facebook | Meta developer app (Messenger webhook, Pages API) | Facebook sends every message to our workflow. The same app can publish promo posts to the page. |
| The workflow | n8n (low-code) | Receives each message, passes it through the steps below, and sends the reply. Also runs timers and owner alerts. |
| Reading and writing | Groq, running an open model (gpt-oss-120b) | Reads the guest’s Taglish message: which day, overnight or day tour, how many people, any questions. Writes the promo posts. Free plan to start. If it misreads Taglish, this one step can switch to Claude. |
| Prices and the calendar | Google Sheets, with a small Apps Script | The owner’s price list, every day’s status, and the house rules. The owner can open and fix it directly. The script lets n8n read and write it one change at a time, so two guests can’t save the same day. |
| Price math | Code step inside n8n | Works out the exact price from the sheet. The AI never sets a price. |
| Owner’s screen | A web app on the owner’s phone (hosted free on GitHub Pages) | Shows booked and empty days, lets the owner pick days for promos, confirm bookings, mark walk-ins and change prices. It only talks to n8n. Without a connection it runs a demo with sample bookings. |
| Owner alerts | ntfy (free phone notifications) | Pings the owner when a guest sends a GCash receipt or asks something avail can’t answer. |
| Payments | GCash (owner’s own account) | Guests send a receipt screenshot in Messenger. The owner checks GCash and taps confirm. |

## How one guest message flows

1. A guest messages the Facebook page: “avail pa po Nov 18? 25 kami, overnight.”
2. Facebook passes the message to n8n.
3. The AI (Groq) reads it: Nov 18, overnight, 25 people.
4. The code step checks Google Sheets. If Nov 18 is free, it works out the price: ₱7,000 for up to 20 guests + 5 × ₱500 = ₱9,500. If it’s a promo day, it adds the perk.
5. n8n marks Nov 18 as saved for that guest in the sheet, with a time limit.
6. n8n replies on Messenger with the price and asks for the downpayment.
7. When the receipt comes in, n8n alerts the owner. The owner checks GCash and taps confirm. The day becomes booked and the guest gets a confirmation.
8. If no downpayment comes in before the time limit, n8n frees the day again.

## How a promo post flows

1. The owner opens the calendar and taps the empty days.
2. n8n asks the AI (Groq) to write a Facebook post with the owner’s perk (free breakfast, or late checkout when the next day is empty). Prices come from the sheet, never from the AI.
3. The owner reads it, edits if needed, and publishes. Until Meta approves the app for any page, the owner copies and pastes the post into Facebook.
4. Those days are marked as promo days. Guests who ask about them get the perk automatically.

## What’s in the Google Sheet

| Tab | Columns |
|---|---|
| Settings | Overnight weekday (₱7,000), overnight weekend and holiday (₱10,000), guests included (20), extra guest (₱500), day tour under 10 (₱2,000 flat), day tour per person from 10 (₱300), downpayment (50%), hours to pay (24), GCash number |
| Days | Date, status (empty, promo, saved, receipt, booked, closed), guest name, Messenger ID, type (overnight or day tour), guests, price, perk, saved until, receipt photo |
| Rules | Topic, keywords and answer (videoke free, check-in times, food, pets, and so on). An empty answer means “ask the owner”. |
| Promos, Chats, Log | Every promo post, what each guest last asked about, and every message in and out |
| Holidays | Date and name, charged at the weekend price |

## Rules the system follows (from the owner)

- One group rents the whole resort per day.
- Holidays cost the same as weekends.
- No discounts. Promo days get a perk instead.
- Late checkout is only offered when the next day is empty.
- Day tours are only possible if nobody has booked the overnight that day.
- Videoke is free for everyone, so it’s mentioned in posts and replies, not used as a perk.

## Limits to know

- While the Meta app isn’t approved, Messenger only replies to accounts added to the app as testers. For demos, use team phones.
- Posting straight to a resort’s page needs Meta’s App Review. Until then, the owner copies and pastes the post.
- avail can’t see the owner’s GCash account, so the owner always confirms payments.
- Groq’s free plan has rate limits (about 30 requests a minute and 1,000 a day per model; check the limits page in the Groq account). That’s plenty for building and demos, not for many resorts at once.

## What’s built today

| Part | Status |
|---|---|
| Owner phone app (`app/`) | Built. Rechecked in a phone-sized browser: 50% in Settings, ₱3,500 weekday and ₱5,000 weekend sample downpayments. Previously tested against a local n8n. |
| Prices, perks, replies, owner actions (`backend/engine/engine.js`) | Built. 33 passing tests, including promo-inquiry regressions. |
| Google Sheet data script (`backend/sheet/Code.gs`) | Built. 7 tests in a fake Apps Script. |
| Generated Messenger workflow code | 2 passing regression checks against the Sheet script. Total current local checks: 42. |
| n8n workflows: Messenger, Owner app, Timer | Rebuilt. 16 end-to-end scenarios were previously tested on a real local n8n (2.46.7) with stand-in services; that full suite was not rerun for this update because no local n8n was listening. |
| Live test page and Google Sheet | Connected. The user’s November 26 test received the ₱3,500 downpayment and breakfast perk; a read-only owner-endpoint check confirmed both on the saved day. The Groq-versus-fallback path for that message was not separately checked. |
