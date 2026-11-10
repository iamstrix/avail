# Setting up avail for real

This is the step-by-step for running avail on a real Facebook page. Do the parts in order. Everything here has a free option.

| Part | What you get | Where |
|---|---|---|
| 1. Google Sheet | The database: prices, calendar, house rules | Google account |
| 2. Groq key | The AI that reads messages and writes posts | console.groq.com |
| 3. Facebook | A test page, a Meta app, a page token | developers.facebook.com |
| 4. n8n | The three workflows that connect everything | n8n Cloud or your own n8n |
| 5. Messenger webhook | Facebook sends guest messages to n8n | Meta app |
| 6. Owner app | The calendar on the owner's phone | GitHub Pages |
| 7. Phone alerts (optional) | A ping when a guest sends a receipt | ntfy app |

Keep a notes file open. You'll copy about eight values from one place to another, and the steps say which ones.

---

## 1. Google Sheet and its data script

1. Make a new Google Sheet. Name it `avail`.
2. Click **Extensions → Apps Script**. Delete what's there and paste everything from [`backend/sheet/Code.gs`](backend/sheet/Code.gs). Click **Save**.
3. Pick `setup` in the function list at the top and click **Run**. Google asks for permission the first time: click through (if it says "Google hasn't verified this app", click **Advanced → Go to avail**. It's your own script.)
4. A box shows the **API key**. Copy it to your notes as **Sheet key**. (You can see it again any time under Project Settings → Script Properties.)
5. Back in the Sheet you now have the tabs Settings, Days, Promos, Holidays, Rules, Chats and Log. Check the prices in **Settings** and fill in `gcash_number` and `gcash_name`.
6. In **Rules**, fill in the answers the owner gave (check-in time, pets, food...). Rows with an empty answer are sent to the owner instead of guessed.
7. In Apps Script, click **Deploy → New deployment**. Type: **Web app**. Execute as: **Me**. Who has access: **Anyone**. Click **Deploy**.
8. Copy the **Web app URL** (it ends in `/exec`) to your notes as **Sheet URL**.

> If you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version**, so the URL stays the same.

## 2. Groq key

1. Sign up at [console.groq.com](https://console.groq.com) (free plan).
2. **API Keys → Create API Key**. Copy it to your notes as **Groq key** (starts with `gsk_`).

## 3. Facebook

You need a Facebook account, and a **page you manage** for testing. Don't use the resort's real page until the owner adds you to it.

1. Make a test page (for example "avail demo resort").
2. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App**. Pick the option for Messenger / engaging with customers (if asked for an app type, pick **Business**).
3. In the app, add the **Messenger** product. In **Messenger API Settings**, connect your test page.
4. Get a **page access token** with these permissions: `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_posts`.
   - The easiest way: open the **Graph API Explorer** (Tools menu), choose your app, click **Get Page Access Token**, tick those four permissions, pick your page, then copy the token shown.
   - Tokens from the Explorer expire in about an hour. For a lasting one, use the **Access Token Debugger** → **Extend Access Token** on the user token first, then get the page token again with `GET /me/accounts`. Page tokens made from a long-lived user token don't expire.
5. Copy the token to your notes as **Page token**.
6. Find your **Page ID** (page → About → Page transparency, or the `id` in `GET /me/accounts`). Copy it as **Page ID**.
7. Under **App roles**, add your teammates as **Testers**. While the app is in development mode, Messenger only replies to people with a role on the app.

## 4. n8n

Use **n8n Cloud** (free trial, already reachable from the internet) or your own n8n. If you run n8n on a laptop, Facebook can't reach it without a tunnel such as ngrok.

**Credentials first** (left menu → Credentials → Create). The names must match exactly, because the workflows find them by name:

| Name | Type | Field name | Value |
|---|---|---|---|
| `avail Sheet key` | Query Auth | `key` | your **Sheet key** |
| `avail Groq` | Header Auth | `Authorization` | `Bearer ` + your **Groq key** (with the space) |
| `avail Facebook page` | Query Auth | `access_token` | your **Page token** |

**Then import the three workflows** from [`backend/n8n/workflows/`](backend/n8n/workflows/): Workflows → Create → **⋯ → Import from File**, once for each file. Save each one.

**In each workflow, open the `Config` node** and fill in:

| Setting | Messenger | Owner app | Timer |
|---|---|---|---|
| `sheetUrl` (your **Sheet URL**) | ✓ | ✓ | ✓ |
| `pageId` | | ✓ | |
| `ownerKey`: make up a long random word. The owner app needs it. | | ✓ | |
| `ntfyTopic` (part 7, or leave empty) | ✓ | | |
| `ownerAppUrl` (part 6) | ✓ | | |

The Messenger workflow also has a **verify token** inside the node **Check the verify token**. Change `CHANGE-ME-TOO` to any word and note it as **Verify token**.

Open any HTTP node with a warning triangle and pick the matching credential if n8n didn't pick it already. Then **Publish** each workflow.

Copy two production URLs to your notes (open the webhook node, choose **Production URL**):
- **Messenger URL**: from `Guest message comes in` (ends in `/webhook/avail-messenger`)
- **Owner app URL**: from `Owner app request` (ends in `/webhook/avail-owner`)

## 5. Connect Messenger to n8n

1. In the Meta app: **Messenger → Messenger API Settings → Configure webhooks**.
2. Callback URL: your **Messenger URL**. Verify token: your **Verify token**. Click **Verify and save**. (The Messenger workflow must be published, or this fails.)
3. Subscribe the page to the webhook fields `messages` and `messaging_postbacks`.
4. From a tester's Facebook account, message the test page: `avail pa po Nov 20? 15 kami overnight`. You should get the exact price within a few seconds, and see Nov 20 as `saved` in the **Days** tab.

## 6. The owner app

The app is in [`app/`](app/). It's a plain web page, so any static host works.

**GitHub Pages:** repository **Settings → Pages → Deploy from a branch**, branch `main`, folder `/ (root)`. The app is then at `https://<your-github-name>.github.io/avail/app/`. (On a free GitHub plan the repository has to be public for Pages.) Put this address into the Messenger workflow's `ownerAppUrl`.

On the owner's phone:
1. Open the app address in Chrome (Android) or Safari (iPhone).
2. **Settings**: turn off "Use sample data", paste the **Owner app URL** and the **ownerKey**, tap **Save and connect**.
3. Add it to the home screen (Chrome: ⋮ → Add to Home screen. Safari: Share → Add to Home Screen).

Without a connection, the app runs in **demo mode** with sample bookings. That's handy for the pitch if the venue Wi-Fi is bad.

## 7. Phone alerts (optional)

1. Install the free **ntfy** app (Android or iPhone).
2. Subscribe to a topic with a long, hard-to-guess name, like `avail-miranda-7k2x9q`. Anyone who knows the name can read it, so don't use something guessable.
3. Put the same name in the Messenger workflow's Config as `ntfyTopic`.

The owner gets a notification when a guest sends a GCash receipt, or asks something avail can't answer.

---

## Checklist before the demo

- [ ] Message the page as a tester → the price reply arrives, and the day shows **Saved** in the app.
- [ ] Send a photo → the day shows **GCash** and the owner app shows the downpayment card.
- [ ] Tap **Confirm booking** → the guest gets "Confirmed na po" on Messenger.
- [ ] Pick two empty days → **Draft post** → **Publish to Facebook** → the post is on the page.
- [ ] Ask about a promo day → the reply mentions the perk.
- [ ] Ask "pwede po ba aso?" with an empty pets rule → "itatanong ko po muna sa owner", and an alert if ntfy is on.

## When something doesn't work

| What you see | What to check |
|---|---|
| Facebook says the callback URL couldn't be verified | The Messenger workflow isn't published, or the verify token doesn't match. |
| No reply on Messenger | The person isn't a tester on the Meta app; the page isn't subscribed to `messages`; or look at **Executions** in n8n for a red node. |
| Replies say "may konting problema sa system" | n8n couldn't reach the Sheet: check `sheetUrl` and the `avail Sheet key` credential. |
| App says "Wrong owner key" | The key in the app and `ownerKey` in the Owner app Config differ. |
| "Couldn't post to Facebook" | The page token is missing `pages_manage_posts`, or `pageId` is wrong. The days are still marked as promo and the post is copied, so it can be pasted by hand. |
| Posts always say "written from the template" | Groq didn't answer or its draft failed the checks (wrong price, a discount, a missing perk). The reason is shown under the post. |

## Limits to know

- **Development mode:** until Meta approves the app (App Review), only testers get Messenger replies, and only pages managed by app roles can be used.
- **24-hour rule:** pages can message a guest freely within 24 hours of the guest's last message. Saved days last 24 hours by default, so release and confirmation messages usually fall inside it. If the owner confirms much later, the Messenger message may be refused (the booking itself is still saved).
- **Groq free plan:** about 30 requests a minute and 1,000 a day per model. Fine for testing and one resort.
- **Apps Script:** each Sheet call takes about one to two seconds. That's the slowest part of a reply.

## Changing the code

- All prices, rules and reply wording live in [`backend/engine/engine.js`](backend/engine/engine.js).
- The workflows are generated from it. After changing it, run `node backend/n8n/build.mjs` and re-import the three files.
- To skip retyping the Config values after each rebuild, put them in `backend/n8n/config.local.json` (git ignores it), for example `{ "sheetUrl": "https://script.google.com/macros/s/…/exec", "pageId": "1234", "ownerKey": "…", "verifyToken": "…", "ntfyTopic": "…", "ownerAppUrl": "…" }`. The build then also writes `backend/n8n/my-workflows/` (git ignores it too) with your values already filled in, so import those files instead. `workflows/` always keeps the blanks, so nothing personal ends up on GitHub.
- Tests: `node --test backend/test/engine.test.js backend/test/sheet.test.js`. The full test (`backend/test/e2e.js`) runs the real workflows in a local n8n against fake Facebook, Groq and Sheet services; its header explains how.
