# avail: the next four hours

Prepared 10 November 2026. Assumes the current avail resort project.

**Decision: use the existing mobile web app and demonstrate one complete workflow.** Spend the remaining time proving that workflow and preparing the pitch.

## What exists

- `app/`: owner calendar, promo drafts, booking confirmations and settings, with sample-data mode.
- `backend/`: pricing and availability rules, Google Sheets script and three n8n workflows.
- Rechecked after the owner's answers: **42 local tests passed, zero failures**. These cover business rules, a simulated Sheet environment and generated Messenger code.
- The live downpayment is now **50%**. The user’s new November 26 inquiry received a PHP 3,500 downpayment on a PHP 7,000 overnight stay and the breakfast promo. A read-only owner-endpoint check independently confirmed the saved day, 15 guests, the same total/downpayment/perk and expiry at 2:56 PM Philippine time on November 11.
- Live inquiry-to-reply and saved-date persistence are verified for this test. The local demo UI was also checked at phone size. Receipt handling, owner confirmation and deployment of the updated site still need checks. A successful reply alone does not establish whether Groq or the fallback parser handled it.
- The live payment number is still the sample GCash number; use clearly labeled sample payment details for the demo and obtain approved owner details before real guest use.

## Target platforms: Android, iOS and desktop web

**User clarification: “platforms” means device and operating-system platforms.** The recommendation for this pitch is one responsive web app, with a Progressive Web App (PWA) home-screen experience where supported.

| Platform | Delivery for this pitch |
|---|---|
| Android | Open the hosted app in Chrome; use the browser's web-app installation option where available. Verify on the actual demo phone. |
| iOS / iPadOS | Open the hosted app in Safari; use Add to Home Screen to open it as a web app. Verify on the actual demo device. |
| Windows / macOS | Open the same app URL in a desktop browser. Use this as the presentation fallback. |
| Native Android / iOS packages | Defer APK, AAB and IPA packaging and store distribution until an owner pilot establishes a need for native capabilities. |

The current source already includes a web manifest, 192px and 512px icons, standalone display settings, Apple home-screen metadata and a service worker. These are implementation assets, not evidence of testing on real Android and iOS devices. Remote service-worker use needs HTTPS hosting. Live bookings and AI requests still need an internet connection.

Owner features are the calendar, offers and booking confirmation. Guests continue to use Messenger, so they do not need to install the owner app.

Pitch wording: **“avail is a mobile web app for resort owners, targeting Android and iPhone browsers, with desktop access. Guests use the resort's existing Messenger.”** Say that it works on a specific device only after testing it there; describe home-screen installation as verified only after trying it on that device.

Platform references: [Apple: turn a website into an app](https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iphea86e5236/ios), [Google Chrome: use web apps on Android](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en).

## Services used by the current build

| Role | Decision for this pitch |
|---|---|
| Owner interface | Existing mobile web app in `app/`; use a browser on laptop or phone. |
| Guest channel | Facebook Messenger; one real inquiry/reply and its saved date are now verified. |
| Backend | Existing n8n workflows and Google Sheets script. |
| AI | Existing Groq integration; live calls still need verification per the handoff. |
| Demo backup | Sample-data owner app and `promo-days.html` guest simulation. Label simulations clearly: template replies do not demonstrate live AI. |
| Payment | Owner manually checks GCash and confirms. A receipt image is not payment verification. |

## Additional research: competitors and alternatives

Checked official product pages today. These are advertised capabilities, not hands-on evaluations.

| Platform | Relevant overlap | Pitch implication |
|---|---|---|
| [DaliBook](https://www.dalibook.io/) | Philippine resort booking pages, whole-property inventory, calendars, pricing rules and GCash/Maya payments. | Being local, supporting whole resorts or using GCash is not sufficient differentiation. |
| [Skyhost](https://tryskyhost.com/) | Advertises a Messenger-focused early-access pilot with availability checks, saved-rate quotes, reservations and host control over manual payment confirmation. | Close direct overlap. A Messenger booking assistant alone is not a unique claim. The page describes a pilot; do not imply independently verified maturity. |
| [Manychat](https://manychat.com/product/messenger-marketing) | Facebook Messenger marketing automation. | Judges may ask why an owner cannot configure an existing automation tool. Explain the resort-specific workflow and setup you provide. |
| [HiJiffy](https://www.hijiffy.com/booking-assistant) | Hospitality AI booking assistance, Messenger support and booking-engine availability integration. | Instant hotel replies and AI booking assistance already exist. |
| [Little Hotelier](https://www.littlehotelier.com/) | Property management, direct bookings and booking-channel connections for small properties. | Small-property software already exists. Explain why this particular owner's sales process needs your approach. |

**Working positioning, still to validate:** avail helps a small private-pool owner turn selected empty weekdays into perk-based offers, then handles resulting inquiries using the same calendar and approved rates. This is a proposed focus, not evidence that competitors cannot do it.

Suggested competition answer:

> Existing products already handle bookings and automated replies. Our starting point is the private-pool owner's empty-day sales workflow: choose vacant dates, approve a perk-based offer, and handle the inquiries against the same calendar and price list. We still need to test whether owners prefer this workflow enough to pay for it.

## Four-hour schedule

Times are relative to the start of the remaining four-hour window.

| Time | Concrete output |
|---|---|
| 0:00–0:45 | Run the existing demo. Check selecting empty days, drafting an offer, showing its price and confirming a sample booking. Reset sample data and repeat. |
| 0:45–1:15 | The live Messenger inquiry and saved date now pass. Use this slot to connect the GitHub Pages owner app to n8n and verify the saved date, then test a sample receipt and owner confirmation. Keep the labeled simulation as backup. |
| 1:15–2:00 | Finish the pitch: owner problem and evidence, focused workflow, competition, proposed business model, current limitations and next pilot. |
| 2:00–2:30 | Record a short backup walkthrough. Keep a resettable demo and screenshots ready. Freeze features. |
| 2:30–4:00 | Rehearse to the actual pitch time limit. Practice competitor, pricing, payment and pilot questions. Use the final minutes for device and presentation checks. |

## Demo story

1. The owner selects two empty weekdays and an approved perk.
2. avail drafts a post with the owner's rate. The owner reviews it.
3. A guest asks for one date and a group size. Show the price calculation and calendar status.
4. Show a sample pending downpayment, then owner confirmation. State which parts are simulated if the live integration is unfinished.

Use one exact pricing example: **25 overnight guests on a weekday = PHP 7,000 + 5 × PHP 500 = PHP 9,500**, using the current sample rules. Check the chosen date is a weekday, not a configured holiday.

## Claims to keep accurate

- The existing pitch attributes historical booking figures to one owner's interview. Present them as owner-reported figures, not measured app results.
- The pitch says Miranda's is renovating and reopens after summer 2027. Describe it as an interviewed owner/design partner unless a live pilot has actually happened. A nearer-term pilot requires an operating resort.
- A difference between peak and off-season revenue is not evidence that avail can recover that difference. Revenue is not profit.
- The pilot is free. A later monthly fee is a proposal until willingness to pay and running costs are tested; the owner did not agree to a price.
- Code tests, a simulated demonstration and a live customer pilot are different evidence. Name the evidence actually obtained.
- Use “drafts a post for owner approval” unless live publishing has been demonstrated.

## What the next pilot should resolve

At an operating resort, record response time, incorrect quotes, inquiry-to-deposit conversion, bookings on promoted dates, perk cost, owner effort and willingness to pay. Compare with the owner's baseline and account for demand and seasonality before attributing additional bookings to avail.
