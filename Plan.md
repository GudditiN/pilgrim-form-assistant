# Claude Code Build Plan — Pilgrim Form Assistant

Paste everything below this line into Claude Code (in an empty local folder) as your first prompt.

---

## Implementation status (as built, 2026-09-12)

The extension has been implemented in this repo. Before coding, a conflict
was found between this plan and the actual build instructions given, and
was resolved as follows — **the build instructions took precedence**:

- **Domains, not `<all_urls>`.** This plan's manifest spec used
  `content_scripts` matches `["<all_urls>"]`. The extension actually built
  is scoped to only two TTD domains, via both `host_permissions` and
  `content_scripts.matches`:
  - `https://*.tirupatibalaji.ap.gov.in/*`
  - `https://*.ttdevasthanams.ap.gov.in/*`
- **No `LAXMI_FILL_FORM` / no ties to the "Laxmi Telugu Tech" prototype.**
  This plan's "Naming migration note" said to keep the internal
  `LAXMI_FILL_FORM` message type unchanged for backward compatibility with
  a prior "Laxmi Telugu Tech - Smart Form Fill" build. The build
  instructions instead required a fully independent implementation with no
  copied identifiers, code, or branding from any existing extension. The
  message type actually used is `PFA_FILL_FORM`, and there is no
  compatibility layer with any other product's data or build.
- **Minimum permissions.** `manifest.json` requests only
  `permissions: ["storage"]` plus the two `host_permissions` above -
  `activeTab` and `scripting` from this plan's spec turned out to be
  unnecessary: content scripts are declared statically (so they're already
  present on supported pages) and `chrome.tabs.sendMessage` needs no extra
  permission beyond the host permission already granted for those domains.

Everything else (data model, popup UI/tabs, profile CRUD, up to 6
pilgrims, Fill Only / Fill & Continue with a safe-continue-button allowlist
and a payment/submit/booking denylist, export/import backup, generic
keyword-based form-fill engine, MV3 service worker) follows this plan and
lives at the repo root as described below.

**Architecture note beyond the original plan:** website-specific field
hints now live in their own file, `site-mappings.js`, loaded before
`content.js` and exposed as `window.PilgrimFormAssistantSiteMap`.
`content.js` itself contains zero TTD-specific selectors or keywords - it
only knows a generic keyword-matching algorithm. This keeps the two
concerns (generic form-filling vs. TTD-specific terminology) in separate
files as required.

**Verification performed:**
- `manifest.json` parses as valid JSON and was checked field-by-field
  against the MV3 schema by hand; `node --check` passed on all `.js` files.
- Loaded via `google-chrome --headless=new --load-extension=<repo>` with
  verbose logging; no manifest/extension-load errors were logged.
- `npm run zip` was run successfully and produces
  `dist/pilgrim-form-assistant.zip` containing only runtime files.
- `content.js`'s `fillForm` and `findSafeContinueButton` were exercised
  against a synthetic jsdom form modeled on typical Indian government
  form markup (table-based labels, `label[for]`, hidden field, an OTP
  field, a "Pay Now" button, and a "Next >>" button): all visible
  general/pilgrim fields filled correctly by position, the OTP and hidden
  fields were correctly left untouched, and only the "Next >>" button was
  identified as safe to click ("Pay Now" was correctly excluded). This
  also caught and fixed a real matching bug: the Aadhaar/Aadhar spelling
  variant now matches on `<select>` fields.
- Grepped the whole extension for `fetch`/`XMLHttpRequest`/`eval`/remote
  `<script src>`/`importScripts` - none exist. The only `console.log` call
  is a static string in `background.js`'s `onInstalled` handler; no
  profile data is ever logged.

**Known limitations / what's not yet verified:**
- The generic keyword-matching engine has **not** been tested against a
  real, live tirupatibalaji.ap.gov.in or ttdevasthanams.ap.gov.in
  registration form (this environment has no way to browse and inspect
  the live authenticated forms). `site-mappings.js` currently ships with
  TTD-terminology keyword synonyms (e.g. "devotee name", "yatri name",
  "aadhar/aadhaar number") but no hard-coded selectors. Before relying on
  this for a real booking, test it against the actual live form and, if
  matching misses a field, add that field's exact selector or wording to
  `site-mappings.js` (see the `selectors` extension point already present
  in that file) - `content.js` should not need to change.
- Store screenshots are still placeholders (`store/screenshots/.gitkeep`);
  add real screenshots before submitting to the Chrome Web Store.
- No automated Chrome-extension test harness (e.g. Puppeteer end-to-end
  test against a real page) is included - verification above used a
  synthetic jsdom form and a headless manifest-load smoke test instead.

**Build & test commands:**
```bash
# Validate JSON/JS syntax
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
node --check popup.js && node --check content.js && node --check background.js && node --check site-mappings.js

# Package for the Chrome Web Store
npm run zip   # -> dist/pilgrim-form-assistant.zip

# Load unpacked for manual testing
# chrome://extensions -> Developer mode -> Load unpacked -> select this folder
```

---

Build a Chrome Extension (Manifest V3) called **Pilgrim Form Assistant**.
GitHub repo name: `pilgrim-form-assistant`. Chrome Web Store listing name: "Pilgrim Form Assistant".

## What it does
A local-only helper that stores user profiles (general details + multiple pilgrim
details) in the browser and one-click fills supported online pilgrimage/temple
registration forms. It does NOT bypass CAPTCHA, OTP, queues, slot selection, or
payment — it only fills text/select fields and optionally clicks a clearly-labeled
"Continue"/"Next" button.

## Repo layout
```
pilgrim-form-assistant/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── content.js
├── background.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── README.md
├── LICENSE (MIT)
├── package.json          # dev-only: zip script, no runtime deps
├── .gitignore
└── store/
    ├── description.md    # Chrome Web Store listing copy
    └── screenshots/       # placeholder folder, add real screenshots before publishing
```

## manifest.json requirements
- manifest_version: 3
- name: "Pilgrim Form Assistant"
- short_name: "Pilgrim Form Assistant"
- version: "1.0.0"
- description: "Save pilgrim & traveler profiles locally and fill supported registration forms in one click. No CAPTCHA/OTP/payment bypass."
- permissions: ["storage", "activeTab", "scripting"]
- action.default_popup: popup.html
- background.service_worker: background.js
- content_scripts: matches ["<all_urls>"], js: ["content.js"], run_at: document_idle
- icons: 16/48/128 from icons/

## popup.html / popup.css / popup.js — UI spec
Header: logo + title "Pilgrim Form Assistant" + subtitle "Smart Form Fill • Fast • Simple • Accurate".

Profile bar:
- `<select id="profileSelect">` listing saved profiles
- Buttons: New, Duplicate, Delete, Save
- Text input for naming a new/duplicated profile

Two primary action buttons:
- "⚡ Fill & Continue" (green) — fills the form, then clicks a button whose visible
  text matches /^(continue|next|proceed)/i, but never one matching /pay|payment|submit|confirm booking|book now|order/i
- "🖊 Fill Only" (light blue) — fills the form, does not click anything

Tabs: General Details / Pilgrims / Settings

**General Details** fields: Email ID, Mobile, City, State, Country (default "India"), PIN code.

**Pilgrims** tab: up to 6 pilgrim cards, each with Full name, Age, Gender
(—/Male/Female/Transgender), Photo ID proof (Aadhaar Card/Passport), Photo ID
number. "+ Add pilgrim" button disabled at 6. Each card has a "Remove" button.
Header shows "PILGRIMS (X OF 6)".

**Settings** tab: hint text "Local-only helper. Data is stored in this browser
only — nothing is sent to any server." Export backup (downloads JSON of all
profiles) and Import backup (file picker, validates JSON shape before loading).

Status line at the bottom reflecting last action (ready/busy/error states).
Footer: "v1.0.0 — local profiles + one-click form filling. CAPTCHA, OTP, queue,
slot selection and payment are not automated."

Data model in `chrome.storage.local`:
```js
{
  profiles: {
    "<profileName>": {
      general: { email, mobile, city, state, country, pin },
      pilgrims: [ { name, age, gender, idType, idNumber }, ... up to 6 ]
    }
  },
  currentProfile: "<profileName>"
}
```

## content.js — form-fill logic
- Build a descriptor for every fillable `input`/`select`/`textarea` on the page
  using: `label[for=id]`, wrapping `<label>`, `aria-label`, `placeholder`,
  `name`, `id`, and nearby sibling/parent text — lowercased and concatenated.
- Skip disabled/readonly/hidden/file/password/submit/button/checkbox/radio
  inputs and anything not visible (`display:none`/`visibility:hidden`).
- Keyword-match each descriptor against two keyword maps:
  - General (single-instance): email, mobile, city, state, country, pin
  - Pilgrim (repeatable, matched in DOM order and assigned to pilgrim[0],
    pilgrim[1], … by position): name, age, gender, idType, idNumber
- For `<select>` elements, match option text case-insensitively (exact match
  first, then substring match either direction).
- For text/number inputs, set the value via the native property setter (so
  React/Vue-controlled inputs pick it up) and dispatch `input` and `change`
  events.
- Never touch CAPTCHA widgets, OTP inputs, file uploads, or payment iframes.
- Listen for a `chrome.runtime.onMessage` of type `LAXMI_FILL_FORM` (keep this
  exact message type for compatibility) with `{ payload: { general, pilgrims },
  continueAfter }`, fill accordingly, optionally click a safe "Continue" button
  as described above, and respond with `{ filled: <count>, continued: <bool> }`.

## background.js
Minimal service worker, no network calls, just an `onInstalled` log line.

## README.md must include
- What the extension does and does NOT do (no CAPTCHA/OTP/payment bypass)
- Local installation instructions (chrome://extensions → Developer mode →
  Load unpacked)
- Data-privacy note: all data stays in `chrome.storage.local`, nothing is
  transmitted anywhere
- Screenshot placeholder section
- License (MIT)

## package.json
Dev-only tooling, no runtime dependencies:
```json
{
  "name": "pilgrim-form-assistant",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "zip": "node scripts/build-zip.js"
  }
}
```
Add a small `scripts/build-zip.js` (Node, no external deps — use the built-in
`zlib`/`archiver` if available, otherwise shell out to `zip`) that packages the
extension folder into `dist/pilgrim-form-assistant.zip` for Chrome Web Store
upload, excluding `store/`, `.git`, `node_modules`.

## store/description.md
Draft Chrome Web Store listing copy (short description ≤132 chars, full
description, feature bullets, and a clear line stating it does not bypass
CAPTCHA/OTP/queues/payment) based on the app's actual functionality.

## Acceptance checklist (Claude Code should self-verify before finishing)
- [ ] `manifest.json` is valid JSON and loads with no console errors when
      loaded unpacked in Chrome
- [ ] Creating, duplicating, deleting, and saving profiles persists correctly
      across popup close/reopen (chrome.storage.local)
- [ ] Up to 6 pilgrims can be added/removed; 7th is blocked
- [ ] Export produces a valid JSON file; Import round-trips it correctly
- [ ] Fill & Continue / Fill Only send a message to the active tab's content
      script and report a filled-field count back to the popup
- [ ] No permissions beyond storage/activeTab/scripting are requested
- [ ] Git repo initialized with an initial commit, `.gitignore` excludes
      `dist/` and `node_modules/`

## Naming migration note
This project starts from an existing "Laxmi Telugu Tech - Smart Form Fill"
prototype. Rename everywhere to "Pilgrim Form Assistant" (manifest name,
popup title, footer text, README, package.json, store copy). Keep the internal
`chrome.storage.local` key and the `LAXMI_FILL_FORM` message type unchanged so
existing user data/backups from the old build still import cleanly — do not
rename these two identifiers even though the product name changes.