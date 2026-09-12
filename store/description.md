# Chrome Web Store listing draft

## Short description (<=132 chars)

Save pilgrim details locally and one-click fill TTD registration forms. No CAPTCHA, OTP, queue, or payment automation.

(131 characters)

## Full description

**Pilgrim Form Assistant** is a local-only helper for filling out online
registration forms on Tirumala Tirupati Devasthanams (TTD) websites. Save
your contact details and up to 6 pilgrims per profile, then fill matching
form fields in one click instead of retyping the same information every
visit.

**Features**

- Create, duplicate, edit, and delete multiple named profiles
- Store general contact details (email, mobile, city, state, country, PIN)
- Store up to 6 pilgrims per profile (name, age, gender, ID proof type, ID
  number)
- One-click "Fill Only" to populate a supported form
- "Fill & Continue" to fill and then click a clearly-labeled Continue/Next
  button, when present
- Works with dynamically rendered (JavaScript-driven) form fields
- Export/import your profiles as a JSON backup file
- Everything is stored locally in your browser via `chrome.storage.local`

**What this extension will never do**

Pilgrim Form Assistant does not solve or bypass CAPTCHA, does not read or
automate OTP/verification codes, does not interact with queues or slot
selection, and does not fill, submit, or otherwise automate any payment
step. It never submits a form on your behalf - it only fills fields for you
to review before you submit. It makes no network requests: your profile
data is never sent to any server, and no remotely hosted code is ever
loaded or executed.

**Supported sites**

- `*.tirupatibalaji.ap.gov.in`
- `*.ttdevasthanams.ap.gov.in`

## Feature bullets

- Local-only profile storage (chrome.storage.local)
- Up to 6 pilgrims per profile
- One-click Fill Only / Fill & Continue
- Handles dynamically rendered forms
- Export / import JSON backup
- No CAPTCHA, OTP, queue, or payment automation
- No network requests, no remote code

## Permissions justification

- `storage` - to save profiles locally in the browser.
- Host permissions limited to `tirupatibalaji.ap.gov.in` and
  `ttdevasthanams.ap.gov.in` - so the form-filling content script can run
  only on these TTD sites, never elsewhere.
