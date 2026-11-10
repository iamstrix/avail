# avail: where the live setup stopped, and what's next

For whoever picks this up (person or coding agent). Plain steps, in order. Full background is in [SETUP.md](SETUP.md) and [TECH-STACK.md](TECH-STACK.md).

**Updated by Codex on 10 November 2026 (Philippine time), for handoff back to the first agent.** Resume at **Next steps → 1. Connect Messenger in Meta**. The credentials and workflow imports are finished; do not recreate them.

**Never put secrets in this file, in git, or in chat.** The Sheet key, Groq key and page token are saved in n8n Credentials; the user also has them. The Sheet URL, page ID, owner key and verify token are in `backend/n8n/config.local.json` (git ignores it). Keep the owner key and verify token private too.

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
