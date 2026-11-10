# Changes from the owner's answers (10 Nov 2026)

For Codex (or anyone) to apply. Plain list, in order. Build on the **current working tree**: there are uncommitted changes in `backend/engine/engine.js`, the three workflow JSONs, `backend/test/engine.test.js` and a new `backend/test/messenger-promo.test.js`. Keep those, don't revert them.

**Never put secrets in files, git or chat.** The Sheet key, Groq key and page token live in n8n Credentials. The owner key and verify token live in `backend/n8n/config.local.json` (git-ignored).

## Application status (Codex, 10 Nov 2026)

- Live downpayment set to **50%** and verified through the owner endpoint.
- The user’s new **November 26** Messenger reply requests **PHP 3,500** and includes breakfast. A separate read-only state check confirms the saved day, 15 guests, PHP 7,000 total and PHP 3,500 downpayment.
- Defaults, expectations, generated workflows, pitch text, mockups, flow PNG/embedded WebP, embedded calendar image and notebook setup instructions updated. Earlier uncommitted promo fixes preserved.
- **42 local tests pass**. Phone-size and desktop browser checks pass. The full local n8n suite was not rerun because no local n8n was available.
- The 50% live change required neither Apps Script redeployment nor workflow re-import. The earlier general-promo fix's live deployment remains unverified.
- The user approved committing and pushing the prepared changes on 10 November 2026. Check the repository's latest commit and GitHub Pages deployment for publication status. The original instructions and owner answers below are retained.

## What the owner said

| # | Question | Answer | What it means |
|---|---|---|---|
| 1 | Tried Facebook's auto-reply or AI? | No (no reason given) | Nothing to replace. Don't claim they rejected Meta's AI. |
| 2 | Downpayment and how it's paid | **Half**, through GCash | **Change 30% → 50%.** |
| 3 | How long a day is held | At most 1 day | Matches `hold_hours = 24`. No change. |
| 4 | How bookings are tracked | Notebook and calendar | At setup, upcoming notebook bookings must go into avail. |
| 5 | Who answers messages | The owner, alone | Strengthens the "late replies" problem in the pitch. |
| 6–8 | Would they pay, and how much | Can't answer / no answer | Price is unproven. Pitch "free during the pilot", no number. |

## 1. Live setting (do this first, no code needed)

Set the downpayment to 50% in the live system, either way:

- **Owner app:** Settings → Prices → **Downpayment (%)** = `50` → **Save prices**, or
- **Google Sheet:** Settings tab → row `downpayment_percent` → value `50`.

From then on every reply and the owner app say **₱3,500** for a ₱7,000 weekday and **₱5,000** for a ₱10,000 weekend or holiday.

Guests whose days are already saved were quoted 30% in their reply (₱2,100). The app will now show 50% for them. That only affects test data, so release those test saves or ignore them.

**Check:** POST to the Owner app webhook with `action: "state"` (using the owner key from `config.local.json`). The `waiting` entries should show `down: 3500` for a ₱7,000 day. Or just open the owner app.

## 2. Code defaults (so new setups, the demo and the tests match)

| File | Line (approx.) | Change |
|---|---|---|
| `backend/engine/engine.js` | ~107 | `downPct: num(s.downpayment_percent, 30)` → `50` |
| `backend/sheet/Code.gs` | ~248 | seed row `['downpayment_percent', '30', …]` → `'50'` |
| `app/demo.js` | ~17 | `downpayment_percent: '30'` → `'50'` |

`Code.gs` only seeds an empty Sheet, so the live Apps Script **doesn't need redeploying** for this. Keep the repo copy in sync anyway.

The demo's sample "Ana Reyes" Sunday booking (₱10,000) will then show a **₱5,000** downpayment, and Ben Cruz's weekday ₱3,500. That's computed, so no extra edit is needed.

## 3. Tests

- `backend/test/engine.test.js`:
  - the `SETTINGS` object: `downpayment_percent: '30'` → `'50'`
  - expected values: every `2100` / `₱2,100` that comes from a ₱7,000 quote → `3500` / `₱3,500` (about lines 38, 145, 332, 404)
  - check for any ₱3,000 / ₱10,000-based expectations: ₱10,000 at 50% = ₱5,000
- `backend/test/messenger-promo.test.js`: check it for downpayment amounts (none found at time of writing).
- `backend/test/e2e.js`: lines ~82 and ~127, `₱2,100` / `2100` → `₱3,500` / `3500`. The fake Sheet uses the `Code.gs` seed, so it follows the change in step 2.

Run:
```bash
node --test backend/test/engine.test.js backend/test/sheet.test.js backend/test/messenger-promo.test.js
```
Everything should pass. If you can run the local n8n end-to-end test (see the `e2e.js` header), it should pass too.

## 4. Rebuild the workflows (only if engine code changed)

```bash
node backend/n8n/build.mjs
```
This writes the blank `workflows/` and the personal `my-workflows/`. The 50% itself comes from the live Sheet setting, so **re-importing isn't needed just for this change**. Re-import only if the engine code changed in ways that matter live (Codex's own uncommitted engine edits may need it). When re-importing a published workflow in n8n, replace the existing one rather than creating a duplicate, then publish it again.

## 5. Pitch page and visuals

- `pitch.html`:
  - The chat example (~line 234): `₱2,100 downpayment` → `₱3,500 downpayment`.
  - The receipt bubble (~line 235): `₱2,100.00` → `₱3,500.00`.
  - The "A flat monthly fee" card (~line 272): the owner hasn't agreed to any price. Change it to **"Free during the pilot"**, with text like "Then a flat monthly fee, no cut of bookings." Remove "priced well under what one weekday booking brings in".
  - Optional, in the problem section, on the "Business hours" stat (~line 174): add that **the owner answers every message alone**.
- `mockups.html`:
  - ~line 117: Ana's Sunday `₱3,000 downpayment` → `₱5,000 downpayment`.
  - ~line 241: Settings → Downpayment `[₱__]` → `50%`.
- `tech-flow.html` (~lines 216, 318, 321, 329): `₱2,100` → `₱3,500` in the receipt card, the code step, the reply bubble and the owner notification. Then re-render `tech-flow.png` with headless Edge, as before:
  - find the height with `--dump-dom` (it's in `body[data-h]`)
  - then `--force-device-scale-factor=2 --window-size=1600,<height> --virtual-time-budget=8000 --screenshot=tech-flow.png`

  `pitch.html` embeds a copy of this diagram as a base64 image. Re-embedding means converting the new PNG to WebP (≈1400px wide) and swapping it in for that `data:` URI. Optional: the diagram's text is small.
- `TECH-STACK.md` (~line 41): "downpayment (30%)" → "downpayment (50%)".
- Leave `HANDOFF.md`'s record of the 20 November test as is. It's history: that reply really did say ₱2,100.

## 6. Setup: the owner's notebook bookings

The owner tracks bookings in a notebook and calendar. If those aren't in avail, avail could offer a day that's already taken.

- `SETUP.md`: in **6. The owner app**, after connecting, add a step: "Enter every upcoming booking from the owner's notebook: tap the day → **Mark as booked** (guest name, guests, price). After this, avail's calendar is the one to trust. New walk-ins and phone bookings go in the same way."
- `checklist.html`: in **Later** (`#later`), add one line about entering notebook bookings before going live with the real resort.

## 7. Commit and push

Ask the user before committing and pushing. Then:
```bash
git add -A
git status
```
Confirm `config.local.json` and `my-workflows/` are not staged. Commit with a message like "Downpayment 50% (owner's rule); pitch: free pilot pricing; notebook import step", and push to `main`. GitHub Pages redeploys on its own.

## Done means

- A new test message (e.g. "Nov 26 po, 15 kami overnight") gets a reply with **₱3,500 downpayment**.
- The owner app shows ₱3,500 for that saved day.
- All unit tests pass.
- The pitch page no longer implies a price the owner agreed to.
