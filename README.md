# Pilgrim Form Assistant

A local-only Chrome extension that stores your pilgrim/traveler profiles in
your browser and helps fill in supported TTD (Tirumala Tirupati
Devasthanams) online registration forms in one click.

## What it does

- Saves one or more profiles (your contact details + up to 6 pilgrims per
  profile) entirely in `chrome.storage.local` on your own machine.
- On a supported page, fills matching text/select fields from your saved
  profile using label/placeholder/name-based matching.
- Optionally clicks a clearly-labeled "Continue" / "Next" / "Proceed"
  button after filling, so you can move to the next step of a multi-page
  form without re-typing your details.

## What it deliberately does NOT do

- It does **not** solve or bypass CAPTCHA.
- It does **not** read, fill, or bypass OTP/verification-code fields.
- It does **not** join, skip, or manipulate queues or slot-selection flows.
- It does **not** fill or interact with payment fields, and it never clicks
  a button whose label suggests "Pay", "Submit", "Confirm booking", "Book
  now", or "Order".
- It never submits a form on your behalf - filling only sets field values;
  you always review and submit the form yourself.
- It does **not** send your profile data anywhere. There are no network
  requests in this extension, and no remotely hosted code is loaded or
  executed.

## Supported sites

The extension only runs on:

- `https://*.tirupatibalaji.ap.gov.in/*`
- `https://*.ttdevasthanams.ap.gov.in/*`

It requests no other host permissions and does not use `<all_urls>`.

## Installing in Chrome (Load unpacked)

This extension is not (yet) on the Chrome Web Store, so it's installed as
an unpacked/"developer mode" extension. This is completely safe and is the
normal way to run an extension you (or your team) built yourselves - it
just means Chrome shows a one-time reminder that developer-mode extensions
are installed.

1. **Get the code onto your machine**, if it isn't already - e.g.
   `git clone <this-repo-url>` or download/unzip it - and remember the
   folder path (the one containing `manifest.json`).
2. **Open the extensions page.** In Chrome, go to `chrome://extensions`
   (type it directly into the address bar), or click the puzzle-piece icon
   in the toolbar → **Manage extensions**.
3. **Turn on Developer mode.** There's a toggle labeled **Developer mode**
   in the top-right corner of that page. Switch it on - three new buttons
   ("Load unpacked", "Pack extension", "Update") will appear.
4. **Click "Load unpacked".** A file picker opens.
5. **Select the project folder** - the one that directly contains
   `manifest.json` (i.e. this repository's root folder, `pilgrim-form-
   assistant/`). Click **Select** / **Open**.
6. **Confirm it loaded.** "Pilgrim Form Assistant" should now appear as a
   card on the extensions page, with its temple icon, version `1.0.0`, and
   no red "Errors" button. If you do see an "Errors" button, click it to
   see what Chrome reported and re-check step 5 (you may have selected a
   sub-folder like `icons/` instead of the project root).
7. **Pin it to the toolbar** so it's one click away: click the
   puzzle-piece icon in Chrome's toolbar, find "Pilgrim Form Assistant" in
   the list, and click the pin icon next to it. Its icon will then sit
   directly in the toolbar.
8. **Open it.** Click the pinned icon (or the puzzle-piece → the
   extension's name) to open the popup and start creating a profile.

**Updating after you change the code:** go back to `chrome://extensions`
and click the circular reload icon on the "Pilgrim Form Assistant" card
(or toggle it off/on). If a supported TTD tab was already open, refresh
that tab too so it picks up the updated content script.

**Removing it:** on `chrome://extensions`, click **Remove** on the
"Pilgrim Form Assistant" card, or right-click its toolbar icon and choose
**Remove from Chrome**. This deletes its `chrome.storage.local` data
(your saved profiles) as well - export a backup first from **Settings →
Export backup** if you want to keep them.

## Using it

1. Open the extension popup and create a profile (**New**) under the
   profile bar, or select an existing one.
2. Fill in **General Details** (email, mobile, city, state, country, PIN)
   and add up to 6 people under **Pilgrims**.
3. Click **Save** to persist the profile.
4. Navigate to a supported TTD registration form.
5. Click **Fill Only** to fill the visible fields, or **Fill & Continue**
   to fill and then click a safe "Continue"/"Next"/"Proceed" button if one
   is present. CAPTCHA, OTP, queue, slot-selection, and payment steps are
   always left for you to complete manually.

## Data & privacy

All profile data is stored using `chrome.storage.local`, scoped to your
browser profile on your own device. Nothing is transmitted to any server -
this extension makes no network requests at all. Use **Settings → Export
backup** to download a JSON copy of your profiles, and **Import backup** to
restore it (e.g. after reinstalling the extension or moving to another
computer). Imported files are validated for shape before being loaded.

## Project layout

```
pilgrim-form-assistant/
├── manifest.json       # MV3 manifest, minimal permissions
├── popup.html/.css/.js # Profile management + fill-trigger UI
├── content.js          # Generic, site-agnostic form-filling engine
├── site-mappings.js    # TTD-site-specific keyword hints (kept separate
│                        # from the generic engine in content.js)
├── background.js       # No-op service worker (required by MV3), no network
├── icons/               # Extension icons (original artwork)
├── scripts/build-zip.js # Dev-only packaging script
└── store/               # Chrome Web Store listing draft
```

Website-specific knowledge (TTD form terminology such as "devotee name",
"aadhar number", etc.) lives only in `site-mappings.js`. `content.js`
contains no site-specific selectors or logic, so new TTD form variants can
be supported by extending `site-mappings.js` alone.

## Building a Web Store package

```bash
npm run zip
```

This shells out to the system `zip` command and produces
`dist/pilgrim-form-assistant.zip` containing only the extension runtime
files (manifest, scripts, popup, icons, README, LICENSE) - `store/`,
`.git`, `node_modules`, and `Plan.md` are excluded.

## Screenshots

Add real screenshots to `store/screenshots/` before publishing to the
Chrome Web Store.

## License

MIT - see [LICENSE](LICENSE).
