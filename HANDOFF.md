# avail: where the live setup stopped, and what's next

For whoever picks this up (person or coding agent). Plain steps, in order. Full background is in [SETUP.md](SETUP.md) and [TECH-STACK.md](TECH-STACK.md).

**Updated by Codex on 10 November 2026 (Philippine time).** A real Messenger inquiry now receives a booking reply, and the saved day has been independently confirmed through the live owner endpoint. **A later screenshot exposed a promo-inquiry bug; its fix is tested locally and built, but NOT yet imported/published in live n8n. Apply that Messenger update first**, then continue with the GitHub Pages owner app and a receipt-to-owner-confirmation test. Do not recreate the credentials or existing workflows.

**Never put secrets in this file, in git, or in chat.** The Sheet key, Groq key and page token are saved in n8n Credentials; the user also has them. The Sheet URL, page ID, owner key and verify token are in `backend/n8n/config.local.json` (git ignores it). Keep the owner key and verify token private too.

## Owner answers applied: 50% live and verified

The live downpayment setting was changed through the existing authenticated Owner app endpoint to **50%**. A fresh state response verified that percentage, PHP 3,500 for a PHP 7,000 weekday and PHP 5,000 for a PHP 10,000 weekend/holiday. The live Apps Script was not redeployed, and no workflow re-import was needed for the live setting change.

The user then sent `Nov 26 po, 15 kami overnight` to the real test page and pasted its reply: PHP 7,000 overnight, a breakfast promo, PHP 3,500 downpayment, held until 2:56 PM the next day. A second read-only Owner app state check independently confirmed November 26 as `saved`, 15 overnight guests, PHP 7,000 total, PHP 3,500 downpayment, `perk: breakfast`, and expiry `2026-11-11T14:56:17+08:00`. The November 20 / PHP 2,100 record below remains unchanged as history.

Applied the 50% defaults to the engine, Sheet setup seed and demo, updated the unit/end-to-end expectations, and rebuilt all workflow files while keeping the earlier promo-inquiry changes. **42 current local tests pass**. The full local n8n end-to-end suite was not rerun because no local n8n was listening.

The pitch now says **Free during the pilot**, treats a later monthly fee as an unvalidated proposal, and says the owner answers messages alone. Chat/receipt examples, mockups, the flow PNG and its embedded WebP, the embedded calendar screenshot, and TECH-STACK are updated. Headless Edge checks confirmed mobile layout, demo Settings at 50%, Ana's PHP 5,000 and Ben's PHP 3,500 sample downpayments, and no page JavaScript errors. Existing demo users can reset sample data once to load the new defaults.

SETUP and the checklist now require entering/reconciling all upcoming notebook/calendar bookings before the real resort goes live. No booking list was supplied, so no real bookings were invented or imported.

**The user approved committing and pushing these changes on 10 November 2026.** Check the repository's latest commit and GitHub Pages deployment for publication status. The earlier dedicated promo-inquiry fix still needs its live n8n deployment verified; the successful dated November 26 promo reply does not by itself prove the general `kailan date may promo?` regression has been fixed in the deployed workflow.

## Promo-inquiry fix: built locally, live update pending

`image.png` in the parent folder shows `kailan date may promo?` receiving an unrelated November 14 booking confirmation. The parser lacked a dedicated promo intent, and the decision path could treat a parsed or remembered booking date as the date being asked about.

Fixed in `backend/engine/engine.js` and rebuilt all workflow files with `node backend/n8n/build.mjs`:

- Added `ask_promo` and a promo topic to the AI schema, prompt and fallback parser.
- General promo inquiries list upcoming available dates and their current approved perks from the Days calendar. Removed/old promo posts are not treated as active offers.
- A specific-date promo question checks that date's current perk, including the late-checkout restriction. Promo questions do not create holds, release holds or confirm bookings.
- General promo questions ignore unrelated dates copied from chat context by the AI. Only explicit references to the previous date reuse it.
- Explicit booking requests still use the existing reservation flow and include the attached perk.

Run `node --test backend/test/engine.test.js backend/test/sheet.test.js backend/test/messenger-promo.test.js` for the business-rule, Sheet and generated Messenger-node regression checks. Browser-control startup failed with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`, so Codex could not edit live n8n in this turn.

**Next:** update the existing `avail · Messenger` workflow (`oD5KQ9Ob35gPZlcn`) with `backend/n8n/my-workflows/avail-messenger.json`, preserve/check its existing credentials, and publish it. This personal file already has the existing local Config values and remains git-ignored. The public `workflows/` copy intentionally contains placeholders. The promo fix requires the Messenger update; it does not require enabling the Timer or changing the Sheet script. Re-test `kailan date may promo?` and `may promo ba Nov 20?` from a team account, checking that no booking status changes.

## Earlier verification: live Messenger inquiry and saved date

The user reported sending an inquiry to the Facebook page and receiving a reply that saved Friday, November 20 for 15 overnight guests, quoted PHP 7,000 and requested a PHP 2,100 downpayment.

Codex then made one read-only `state` request to the live production Owner app endpoint for November 20. The response was `ok: true` and independently confirmed:

- Date: `2026-11-20`.
- Status: `saved`.
- Stay: `overnight`, 15 guests.
- Price and total: PHP 7,000.
- Downpayment: PHP 2,100 (30%).
- Saved until: `2026-11-11T13:11:52+08:00`, consistent with the reported reply.
- The live GCash setting is still the sample number from the demo data. Replace it with the owner's approved payment details before real guest use; label it sample during demonstrations.

This verifies one live inquiry/reply and a persisted saved date. It does not establish whether Groq or the fallback parser handled the message, public access outside app roles, receipt handling, owner confirmation or guest confirmation after payment. Those need separate checks.

Minor wording to improve when next updating the workflow engine: `para sa 15 kayo` should read `para sa 15 guests` or `para sa inyong 15`. No engine or live workflow was changed during this verification.

The earlier setup observations below are retained as history. In particular, the Meta stopping point and the instruction to resume by connecting Messenger predate this successful live test.

## Done

| Piece | State |
|---|---|
| Google Sheet "avail" | Tabs made and seeded. Apps Script (with `@OnlyCurrentDoc`) deployed as a web app: execute as me, access Anyone. The URL is in `config.local.json` → `sheetUrl`. Requests without the key are refused. |
| Groq | A key named "avail" was created. The user has it. |
| Facebook test page | "Avail demo resort". **API page ID `1434560143072955`** (not 61596535135361, the profile URL number). |
| Meta app | "avail", app ID `1019029514558298`, development mode, use cases Messenger and Manage everything on your Page. The test page is connected and a page token generated (the user has it). The user's other pages (Bohan TV, Gachacircles) also got linked; harmless. |
| n8n Cloud | `https://josegiantubera.app.n8n.cloud`. 14-day trial, **1,000 runs total**. To sign in, open it from `app.n8n.cloud` → Dashboard → **Open instance**. |
| Owner key and verify token | Made up and saved in `config.local.json` → `ownerKey`, `verifyToken`. |
| Personal workflow files | `backend/n8n/my-workflows/` (git ignores it): the Sheet URL, page ID, owner key and verify token are already filled into the Config nodes. Rebuild with `node backend/n8n/build.mjs`. |

## Finished by Codex

### Credentials saved

The n8n Credentials list visibly contained all three saved credentials, with the exact names and types below. No credential values were printed in chat or added to git.

| Credential name (exact) | Type | Field name | Value |
|---|---|---|---|
| `avail Sheet key` | Query Auth | `key` | the `API_KEY` from Apps Script → Project Settings → Script Properties |
| `avail Groq` | Header Auth | `Authorization` | `Bearer ` + the Groq key |
| `avail Facebook page` | Query Auth | `access_token` | the page token (`EAA…`) |

The workflows reference these credentials by name. The successful Owner app state check exercised the Sheet credential. **Groq and Facebook API calls have not yet been verified live**; the Messenger message test is still needed.

### Workflows imported and saved

Imported all three files from `backend/n8n/my-workflows/` into the existing Personal project. n8n saved them automatically.

| Workflow | n8n workflow ID | State |
|---|---|---|
| avail · Messenger | `oD5KQ9Ob35gPZlcn` | **Published**, 21 nodes |
| avail · Owner app | `43aH284JGBupOuLN` | **Published**, 28 nodes |
| avail · Timer | `u20jWzBNiW7WROVC` | **Saved, unpublished**, 8 nodes; leave it off |

Production URLs:

- Messenger: `https://josegiantubera.app.n8n.cloud/webhook/avail-messenger`
- Owner app: `https://josegiantubera.app.n8n.cloud/webhook/avail-owner`

### Verification completed

- Messenger verification GET, using the local verify token and challenge `123`: **HTTP 200, exact response `123`**.
- Owner app POST with `action: "state"`, using the local owner key: **HTTP 200, `ok: true`**, with `today`, `from`, `to`, `settings`, `days`, `waiting` and `promos` fields. This confirms n8n can read the live Sheet.
- `node --test backend/test/engine.test.js backend/test/sheet.test.js`: **32 passed, 0 failed**.
- Last observed trial usage: **2/1,000 executions**. The Timer was never published or executed.
- Confirmed Git ignores `backend/n8n/config.local.json` and `backend/n8n/my-workflows/`.
- Scanned tracked and untracked, non-ignored files for common credential patterns and exact local owner-key/verify-token values. Neither local key appeared in those files. A Facebook-token-shaped match in `pitch.html` was inside embedded image data; none remained after excluding image data.
- No application code, Apps Script or workflow source was changed during the live setup. **No commit, push, repository visibility change or Pages setup was performed.** This handoff is now updated separately.

### Exact stopping point in Meta

The existing Messenger API Settings page for app `1019029514558298` was inspected. Its **Avail demo resort** row showed page ID `1434560143072955`, **Token generated**, and **No fields subscribed**.

The Messenger production URL was entered into the **Callback URL** field, but **Verify token was left blank and Verify and save was not clicked**. That callback edit was only in the unsaved form; check whether it survived before continuing. No subscriptions were added. The real Messenger message test was not sent.

Computer Use then stopped for that turn because it could not reliably identify the current browser URL on Windows. No further browser actions were taken. Reacquire current browser/tab state before resuming; old browser handles are stale.

### Browser/import gotchas from this session

- The user enabled **Allow access to file URLs** in Chrome → Extensions → ChatGPT → Details. File upload then worked. Changing that setting reconnected the extension, so the browser binding had to be reacquired.
- n8n's import menu was **More actions → Import → From file**. The "Importing this from an AI tool?" dialog was dismissed with **Skip**; no new MCP connector was connected.
- Publishing opened a version-name dialog, then a **Workflow published** confirmation. Both Messenger and Owner app reached that confirmation and passed their production checks.
- The Meta page was cramped in the narrow browser window. Accessibility labels exposed the form and page rows even when the screenshot was clipped.

## Next steps

**Current priority after the successful live inquiry:** finish and test the GitHub Pages owner app (step 3), check that its connected calendar shows the saved date, then test a clearly labeled sample receipt and owner confirmation without making a real payment. Steps 1–2 below describe the earlier connection procedure; the latest successful reply and persisted date supersede the earlier unconnected status. Do not recreate the existing app, credentials or workflows.

1. **Connect Messenger in Meta.** In developers.facebook.com, open app 1019029514558298 → Use cases → Messenger → **Messenger API Settings** → **1. Configure webhooks**:
   - Callback URL: `https://josegiantubera.app.n8n.cloud/webhook/avail-messenger` (may already be entered but unsaved).
   - Verify token: the `verifyToken` from `config.local.json`.
   - Click **Verify and save**.

   Then in **2. Generate access tokens**, subscribe the **Avail demo resort** page to `messages` and `messaging_postbacks`. Sections start collapsed in a narrow window: click **See more**. Facebook permission screens open as pop-ups.
2. **Test.** From the user's own Facebook account (an admin of the app), message the page: `avail pa po Nov 20? 15 kami overnight`. Expected:
   - The exact price comes back within seconds.
   - The **Days** tab shows Nov 20 as `saved`.
   - The **Log** tab shows both messages.

   If not, open n8n → **Executions** and look for a red node.
3. **Owner app on the phone.**
   - Push the code to GitHub (`iamstrix/avail`, branch `main`). **Ask the user first.** Nothing since commit `1884784` is pushed: `app/`, `backend/`, `SETUP.md`, `checklist.html`, `pitch.html`, this file and edits are all uncommitted. Never commit `config.local.json` or `my-workflows/`.
   - The repo must be **public** for free GitHub Pages. Ask the user first.
   - Turn on Pages (main, root). The app will be at `https://iamstrix.github.io/avail/app/`.
   - On the phone: open it → Settings → turn off sample data → paste the Owner app URL and `ownerKey` → **Save and connect** → Add to Home screen.
   - Optional: put that app address in `config.local.json` as `ownerAppUrl`, rebuild, and re-import the Messenger workflow. It's only used as the link in owner alerts.
4. **Keep the Timer off for now.** Its hourly trigger alone uses about 24 runs a day. An unpublished workflow's production "Run now" webhook is not active either; use n8n's manual/test execution if a one-off cleanup is needed. Publish the Timer, or switch it to every 6 hours, closer to the demo.
5. **Optional:**
   - Teammates as **Testers** (Meta app → App roles), so their accounts get replies.
   - Phone alerts with ntfy (`ntfyTopic` in `config.local.json`, then rebuild and re-import Messenger).
   - The real GCash number and house rule answers in the Sheet's Settings and Rules tabs.

## Good to know

- Tests: `node --test backend/test/engine.test.js backend/test/sheet.test.js` (32 pass, rerun by Codex). The prior handoff reported 16 passing end-to-end scenarios in `backend/test/e2e.js`; Codex did not rerun that suite. It needs a local n8n; its header explains how.
- If `backend/sheet/Code.gs` changes, update the Apps Script and use **Deploy → Manage deployments → Edit → New version**, so the URL stays the same.
- Messenger can only message a guest within 24 hours of their last message (saved days last 24 hours by default).
- Groq free plan: about 30 requests a minute and 1,000 a day.
- Demo backup: the owner app works with no setup in demo mode (Settings → Use sample data).
