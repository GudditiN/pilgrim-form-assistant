'use strict';

/**
 * Pilgrim Form Assistant - on-page fill icon.
 *
 * Loaded after content.js on supported TTD pages only (see manifest.json),
 * and reuses its fill engine (fillFormWithDynamicRetry). Renders a floating
 * Om icon (icons/fill-pin.png, a web-accessible resource) that fills the
 * active profile's details when clicked. It lives inside a closed shadow root so the site's CSS can't
 * restyle it and the fill engine's document queries can't see it.
 *
 * The page is a single-page app, so once a second it re-checks whether the
 * current view has fillable fields and shows/hides the button accordingly.
 * Clicking fills the active profile's details; it never clicks Continue,
 * submits, or pays.
 *
 * A "Copy" panel beside the icon lists every saved value as a chip: click
 * one to copy it, then paste it into the field yourself. This is the
 * fallback for fields a page won't let a script fill (it opens on its own
 * when a fill leaves fields to set manually).
 *
 * Click & Paste: TTD's booking pages wipe any value a script puts into a
 * field. So instead, clicking (or tabbing into) a recognized field copies
 * the value meant for it - the next pilgrim's for each new row - and the
 * user pastes it with Cmd/Ctrl+V. Nothing is typed into the page for them.
 * Once the paste lands, the cursor moves to the next field and its value is
 * copied, so the whole form goes Cmd/Ctrl+V, Cmd/Ctrl+V, ... Dropdowns can't
 * be pasted into, so for those a tip says which option to pick, and it moves
 * on once the user has picked it. Esc stops it.
 */

(function () {
  const CHECK_INTERVAL_MS = 1000;
  // The site briefly empties the page while switching screens. Only hide
  // after this many checks in a row find no fields, so the button stays put
  // instead of blinking out and back in.
  const HIDE_AFTER_MISSES = 3;
  const MAX_PILGRIMS = 6;
  const FILLABLE_SELECTOR =
    'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input:not([type]), select';

  const GENERAL_ORDER = ['email', 'mobile', 'city', 'state', 'country', 'pin'];
  const PILGRIM_ORDER = ['name', 'age', 'gender', 'idType', 'idNumber'];
  const COPIED_FLASH_MS = 1200;
  const TIP_GAP_PX = 6;
  const CLIPBOARD_TIMEOUT_MS = 1500;
  const TIP_HIDE_MS = 6000;
  // How long a dropdown waits for the user to pick before giving up.
  const DROPDOWN_PICK_TIMEOUT_MS = 120000;

  const FIELD_NAMES = {
    email: 'Email ID', mobile: 'Mobile', city: 'City', state: 'State', country: 'Country',
    pin: 'PIN code', name: 'Name', age: 'Age', gender: 'Gender',
    idType: 'Photo ID proof', idNumber: 'Photo ID number'
  };

  let host = null;
  let ui = null;
  let dismissed = false;
  let busy = false;
  let visible = false;
  let misses = 0;
  let labelText = '';

  function pageHasFillableFields() {
    const fields = document.querySelectorAll(FILLABLE_SELECTOR);
    for (const el of fields) {
      if (el.disabled || el.readOnly && el.tagName !== 'SELECT') continue;
      const hint = (el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '');
      if (/captcha|otp/i.test(hint)) continue;
      if (el.getClientRects().length === 0) continue;
      return true;
    }
    return false;
  }

  function readActiveProfile() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['profiles', 'currentProfile'], (data) => {
        const profiles = data.profiles && typeof data.profiles === 'object' ? data.profiles : {};
        const name = data.currentProfile && profiles[data.currentProfile]
          ? data.currentProfile
          : Object.keys(profiles)[0] || null;
        resolve(name ? { name, profile: profiles[name] } : null);
      });
    });
  }

  function buildUi() {
    host = document.createElement('div');
    host.setAttribute('data-pfa-widget', '');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap {
          position: fixed; right: 22px; bottom: 22px; z-index: 2147483646;
          display: flex; align-items: center; gap: 10px;
          font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          opacity: 0; transform: translateY(10px) scale(0.92); pointer-events: none;
          visibility: hidden;
          transition: opacity 0.25s ease, transform 0.25s ease, visibility 0s linear 0.25s;
        }
        .wrap.show {
          opacity: 1; transform: none; pointer-events: auto; visibility: visible;
          transition: opacity 0.25s ease, transform 0.25s ease, visibility 0s;
        }

        /* Bubble to the left of the icon: hover tooltip, or the fill result. */
        .bubble {
          max-width: 260px; padding: 8px 12px; border-radius: 12px;
          background: #fffaf0; color: #2e1a08; border: 1px solid #eedcb4;
          box-shadow: 0 6px 18px rgba(46, 26, 8, 0.14);
          font-weight: 600;
          opacity: 0; transform: translateX(6px); pointer-events: none;
          transition: opacity 0.18s ease, transform 0.18s ease;
        }
        .bubble.on { opacity: 1; transform: none; }
        .bubble.ok { border-color: rgba(31, 138, 80, 0.35); background: #e9f7ee; color: #17703f; }
        .bubble.err { border-color: rgba(194, 59, 43, 0.35); background: #fdecea; color: #c23b2b; }
        .bubble .sub { display: block; font-size: 11px; font-weight: 500; opacity: 0.8; }

        .pin { position: relative; width: 60px; height: 60px; }
        .fill {
          width: 60px; height: 60px; padding: 0; border: none; background: none; cursor: pointer;
          border-radius: 50%;
          filter: drop-shadow(0 6px 10px rgba(194, 86, 10, 0.35)) drop-shadow(0 1px 2px rgba(46, 26, 8, 0.2));
          transition: transform 0.15s ease, filter 0.2s ease;
        }
        .fill img { display: block; width: 100%; height: 100%; pointer-events: none; user-select: none; }
        .fill:hover { transform: translateY(-3px) scale(1.06); }
        .fill:active { transform: scale(0.93); transition-duration: 0s; }
        .fill:focus-visible { outline: 3px solid rgba(201, 151, 28, 0.6); outline-offset: 3px; }
        .fill[disabled] { cursor: progress; }

        /* Spinning ring while filling; a check badge when done. */
        .ring {
          position: absolute; inset: -5px; border-radius: 50%;
          border: 3px solid rgba(232, 112, 10, 0.18); border-top-color: #e8700a;
          opacity: 0; pointer-events: none; transition: opacity 0.15s ease;
        }
        .busy .ring { opacity: 1; animation: spin 0.9s linear infinite; }
        .badge {
          position: absolute; right: -2px; bottom: 2px; width: 20px; height: 20px; border-radius: 50%;
          display: grid; place-items: center; color: #fff; font-size: 12px; font-weight: 800;
          border: 2px solid #fff; box-shadow: 0 2px 6px rgba(46, 26, 8, 0.2);
          opacity: 0; transform: scale(0.5); pointer-events: none;
          transition: opacity 0.2s ease, transform 0.2s ease;
        }
        .badge.ok { background: #1f8a50; opacity: 1; transform: none; }
        .badge.err { background: #c23b2b; opacity: 1; transform: none; }

        .close {
          position: absolute; left: -6px; top: -6px; width: 20px; height: 20px; padding: 0;
          border-radius: 50%; border: 1px solid #eedcb4; background: #fffaf0; color: #6e4f2a;
          cursor: pointer; font: 13px/1 Arial, sans-serif;
          box-shadow: 0 2px 6px rgba(46, 26, 8, 0.15);
          opacity: 0; transition: opacity 0.15s ease;
        }
        .pin:hover .close, .close:focus-visible { opacity: 1; }
        .close:hover { color: #c23b2b; }

        .copy-toggle {
          position: absolute; left: -6px; bottom: -4px; height: 20px; padding: 0 7px;
          border-radius: 10px; border: 1px solid #eedcb4; background: #fffaf0; color: #6e4f2a;
          cursor: pointer; font: 600 11px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          box-shadow: 0 2px 6px rgba(46, 26, 8, 0.15);
        }
        .copy-toggle:hover, .copy-toggle[aria-expanded="true"] { color: #e8700a; border-color: #e8700a; }
        .copy-toggle:focus-visible { outline: 3px solid rgba(201, 151, 28, 0.6); outline-offset: 2px; }

        .panel {
          position: fixed; right: 22px; bottom: 96px; z-index: 2147483646;
          width: 300px; max-width: calc(100vw - 44px); max-height: min(70vh, 520px); overflow-y: auto;
          padding: 12px; border-radius: 14px;
          background: #fffaf0; color: #2e1a08; border: 1px solid #eedcb4;
          box-shadow: 0 10px 28px rgba(46, 26, 8, 0.18);
          font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        }
        .panel[hidden] { display: none; }
        .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
        .panel-title { font-weight: 700; }
        .panel-close { border: none; background: none; color: #6e4f2a; cursor: pointer; font: 16px/1 Arial, sans-serif; padding: 2px 4px; }
        .panel-close:hover { color: #c23b2b; }
        .panel-hint { font-size: 11px; color: #6e4f2a; margin: 0 0 8px; }
        .group { margin-top: 10px; }
        .group-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #8a6a3e; margin-bottom: 4px; }
        .chip {
          display: flex; width: 100%; align-items: baseline; gap: 8px; text-align: left;
          padding: 6px 8px; margin-top: 4px; border-radius: 8px;
          border: 1px solid #eedcb4; background: #fff; color: inherit; cursor: copy; font: inherit;
        }
        .chip:hover { border-color: #e8700a; }
        .chip:focus-visible { outline: 2px solid rgba(201, 151, 28, 0.6); outline-offset: 1px; }
        .chip .k { flex: 0 0 88px; font-size: 11px; color: #8a6a3e; }
        .chip .v { flex: 1; font-weight: 600; overflow-wrap: anywhere; }
        .chip.copied { border-color: #1f8a50; background: #e9f7ee; }
        .chip.copied .v::after { content: "  \\2713 Copied"; color: #17703f; font-weight: 700; }
        .empty { color: #6e4f2a; font-size: 12px; }

        .tip {
          position: fixed; z-index: 2147483647; max-width: min(300px, calc(100vw - 32px));
          padding: 6px 10px; border-radius: 10px; pointer-events: none;
          border: 1px solid #e8700a; background: #fffaf0; color: #2e1a08;
          font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          box-shadow: 0 6px 18px rgba(46, 26, 8, 0.18);
        }
        .tip[hidden] { display: none; }
        .tip .t-v { font-weight: 700; overflow-wrap: anywhere; }
        .tip .t-sub { display: block; font-size: 11px; color: #6e4f2a; }
        .tip.ok { border-color: #1f8a50; background: #e9f7ee; }
        .tip.err { border-color: #d64550; background: #fdecee; }

        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .wrap, .wrap.show, .bubble, .fill, .badge { transition: none; }
          .busy .ring { animation: none; border-color: #e8700a; }
        }
      </style>
      <div class="wrap">
        <div class="bubble" role="status" aria-live="polite"></div>
        <div class="pin">
          <span class="ring" aria-hidden="true"></span>
          <button class="fill" type="button" aria-label="Fill details">
            <img alt="" draggable="false" />
          </button>
          <span class="badge" aria-hidden="true"></span>
          <button class="close" type="button" title="Hide for this page" aria-label="Hide Pilgrim Form Assistant button">&times;</button>
          <button class="copy-toggle" type="button" aria-expanded="false" title="Copy values to paste by hand">Copy</button>
        </div>
      </div>
      <div class="panel" hidden role="dialog" aria-label="Copy saved details">
        <div class="panel-head">
          <span class="panel-title"></span>
          <button class="panel-close" type="button" aria-label="Close copy panel">&times;</button>
        </div>
        <p class="panel-hint">Click a value to copy it, then click the form field and paste (\u2318V / Ctrl+V).</p>
        <div class="panel-body"></div>
      </div>
      <div class="tip" hidden role="status" aria-live="polite"><span class="t-v"></span><span class="t-sub"></span></div>`;
    ui = {
      wrap: root.querySelector('.wrap'),
      pin: root.querySelector('.pin'),
      fill: root.querySelector('.fill'),
      bubble: root.querySelector('.bubble'),
      badge: root.querySelector('.badge'),
      close: root.querySelector('.close'),
      copyToggle: root.querySelector('.copy-toggle'),
      panel: root.querySelector('.panel'),
      panelTitle: root.querySelector('.panel-title'),
      panelBody: root.querySelector('.panel-body'),
      tip: root.querySelector('.tip'),
      tipValue: root.querySelector('.t-v'),
      tipSub: root.querySelector('.t-sub')
    };
    root.querySelector('.fill img').src = chrome.runtime.getURL('icons/fill-pin.png');
    ui.fill.addEventListener('click', handleFill);
    ui.fill.addEventListener('mouseenter', showTooltip);
    ui.fill.addEventListener('focus', showTooltip);
    ui.fill.addEventListener('mouseleave', hideTooltip);
    ui.fill.addEventListener('blur', hideTooltip);
    ui.close.addEventListener('click', () => {
      dismissed = true;
      setVisible(false);
    });
    ui.copyToggle.addEventListener('click', () => setPanelOpen(ui.panel.hidden));
    root.querySelector('.panel-close').addEventListener('click', () => setPanelOpen(false));
    ui.panelBody.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) copyChip(chip);
    });
  }

  function setPanelOpen(open) {
    if (open) renderPanel();
    ui.panel.hidden = !open;
    ui.copyToggle.setAttribute('aria-expanded', String(open));
  }

  function makeChip(key, value) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.value = String(value);
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = FIELD_NAMES[key] || key;
    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = String(value);
    chip.append(k, v);
    chip.setAttribute('aria-label', 'Copy ' + k.textContent + ': ' + v.textContent);
    return chip;
  }

  function makeGroup(title, source, order) {
    const chips = order
      .filter((key) => source[key] !== undefined && source[key] !== null && source[key] !== '')
      .map((key) => makeChip(key, source[key]));
    if (chips.length === 0) return null;
    const group = document.createElement('div');
    group.className = 'group';
    const heading = document.createElement('div');
    heading.className = 'group-title';
    heading.textContent = title;
    group.append(heading, ...chips);
    return group;
  }

  function renderPanel() {
    const active = cachedProfile;
    ui.panelTitle.textContent = active ? active.name : 'Saved details';
    ui.panelBody.replaceChildren();
    if (!active) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No saved profile yet. Open the extension popup to create one.';
      ui.panelBody.appendChild(empty);
      return;
    }
    const general = active.profile.general || {};
    const pilgrims = Array.isArray(active.profile.pilgrims) ? active.profile.pilgrims.slice(0, MAX_PILGRIMS) : [];
    const groups = [makeGroup('Contact', general, GENERAL_ORDER)];
    pilgrims.forEach((p, i) => groups.push(makeGroup('Pilgrim ' + (i + 1), p || {}, PILGRIM_ORDER)));
    groups.filter(Boolean).forEach((g) => ui.panelBody.appendChild(g));
  }

  // navigator.clipboard needs focus and a secure context; the hidden
  // textarea + execCommand path covers pages where it is unavailable. That
  // path moves focus, so callers reacting to a click in a page field pass
  // keepFocus to skip it.
  async function writeClipboard(text, keepFocus) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      if (keepFocus) return false;
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      ui.panel.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  async function copyChip(chip) {
    const ok = await writeClipboard(chip.dataset.value);
    if (!ok) {
      showMessage('Could not copy. Select the value and press \u2318C / Ctrl+C.', 'err');
      return;
    }
    ui.panelBody.querySelectorAll('.chip.copied').forEach((c) => c.classList.remove('copied'));
    chip.classList.add('copied');
    setTimeout(() => chip.classList.remove('copied'), COPIED_FLASH_MS);
  }

  // A result message stays up for a while; the hover tooltip never replaces it.
  let messageTimer = null;
  let showingMessage = false;

  function setBubble(text, sub, kind) {
    ui.bubble.textContent = text;
    if (sub) {
      const el = document.createElement('span');
      el.className = 'sub';
      el.textContent = sub;
      ui.bubble.appendChild(el);
    }
    ui.bubble.className = 'bubble' + (text ? ' on' : '') + (kind ? ' ' + kind : '');
  }

  function showTooltip() {
    if (showingMessage || busy) return;
    setBubble(labelText || 'Fill details', 'Click to fill this form', '');
  }

  function hideTooltip() {
    if (showingMessage || busy) return;
    ui.bubble.classList.remove('on');
  }

  function showMessage(text, kind) {
    clearTimeout(messageTimer);
    ui.badge.className = 'badge' + (text && kind ? ' ' + kind : '');
    ui.badge.textContent = kind === 'ok' ? '\u2713' : kind === 'err' ? '!' : '';
    if (!text) {
      showingMessage = false;
      ui.bubble.classList.remove('on');
      return;
    }
    showingMessage = true;
    setBubble(text, '', kind);
    messageTimer = setTimeout(() => {
      showingMessage = false;
      ui.bubble.classList.remove('on');
      ui.badge.className = 'badge';
    }, 7000);
  }

  // Kept in memory (and refreshed whenever storage changes) so a click can
  // start filling immediately, without a storage round-trip first.
  let cachedProfile = null;

  async function refreshLabel() {
    const active = await readActiveProfile();
    cachedProfile = active;
    labelText = active ? 'Fill details \u00b7 ' + active.name : 'Fill details';
    ui.fill.setAttribute('aria-label', labelText);
    if (!ui.panel.hidden) renderPanel();
  }

  function setVisible(show) {
    if (show === visible) return;
    visible = show;
    // Next frame, so a freshly attached host fades in instead of popping.
    requestAnimationFrame(() => ui.wrap.classList.toggle('show', visible));
    if (!show) {
      showMessage('', '');
      setPanelOpen(false);
      hideTip();
    }
  }

  // --- Click & Paste: focusing a field copies its value -------------------

  let tipFor = null;
  let tipTimer = null;

  function profilePayload(active) {
    return {
      general: active.profile.general || {},
      pilgrims: Array.isArray(active.profile.pilgrims) ? active.profile.pilgrims.slice(0, MAX_PILGRIMS) : []
    };
  }

  function fieldCaption(m) {
    const name = FIELD_NAMES[m.key] || m.key;
    return m.scope === 'pilgrim' ? 'Pilgrim ' + (m.index + 1) + ' · ' + name : name;
  }

  function isDropdown(m) {
    return m.comboTrigger || m.pickerInput || m.el.tagName.toLowerCase() === 'select';
  }

  function fieldText(m) {
    const el = m.el;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return el.selectedIndex >= 0 ? el.options[el.selectedIndex].textContent : '';
    if (tag === 'input' || tag === 'textarea') return el.value;
    return el.textContent || '';
  }

  function alreadyHasValue(m) {
    const current = normalizeForCompare(fieldText(m));
    const wanted = normalizeForCompare(m.value);
    if (!current) return false;
    if (current === wanted) return true;
    // A custom dropdown's text also holds its label/placeholder, so look
    // for the value as a whole word ("Male" must not match "Female").
    return isDropdown(m) && m.el.tagName.toLowerCase() !== 'select' &&
      new RegExp('(^|[^a-z0-9])' + escapeRegExp(wanted) + '($|[^a-z0-9])').test(current);
  }

  function hideTip() {
    clearTimeout(tipTimer);
    tipFor = null;
    if (ui) ui.tip.hidden = true;
  }

  // Above the field when there's room (dropdown menus usually open below it).
  function positionTip() {
    if (!tipFor) return;
    if (!tipFor.el.isConnected) {
      hideTip();
      return;
    }
    const r = tipFor.el.getBoundingClientRect();
    const box = ui.tip.getBoundingClientRect();
    let top = r.top - box.height - TIP_GAP_PX;
    if (top < 4) top = r.bottom + TIP_GAP_PX;
    const left = Math.max(4, Math.min(r.left, window.innerWidth - box.width - 16));
    ui.tip.style.top = top + 'px';
    ui.tip.style.left = left + 'px';
  }

  function showTip(m, value, sub, kind, hideAfterMs) {
    clearTimeout(tipTimer);
    tipFor = m;
    ui.tipValue.textContent = value;
    ui.tipSub.textContent = sub;
    ui.tip.className = 'tip' + (kind ? ' ' + kind : '');
    ui.tip.hidden = false;
    positionTip();
    if (hideAfterMs) tipTimer = setTimeout(() => { if (tipFor === m) hideTip(); }, hideAfterMs);
  }

  async function onFieldFocus(e) {
    if (dismissed || !visible || busy || !cachedProfile) return;
    // Events inside our own widget arrive retargeted to its host.
    if (e.target === host) return;
    const m = matchFieldForElement(e.target, profilePayload(cachedProfile));
    if (!m || m.value === undefined || m.value === null || m.value === '') {
      if (!e.target.closest || !e.target.closest('[role="option"], [role="listbox"]')) hideTip();
      return;
    }
    // focusin and click both fire for one click on a field.
    if (tipFor && tipFor.el === m.el) return;
    const value = String(m.value);

    if (isDropdown(m)) {
      showTip(m, value, fieldCaption(m) + ' — pick this option from the list', '', 0);
      const picked = await waitFor(() => tipFor !== m || alreadyHasValue(m), DROPDOWN_PICK_TIMEOUT_MS);
      if (picked && tipFor === m) advanceFrom(m);
      return;
    }

    showTip(m, value, fieldCaption(m), '', 0);
    // The fallback copy path moves focus, so only the clipboard API is used
    // here; it must not pull the cursor out of the field just clicked.
    const copied = await Promise.race([
      writeClipboard(value, true),
      new Promise((resolve) => setTimeout(() => resolve(false), CLIPBOARD_TIMEOUT_MS))
    ]);
    if (tipFor !== m) return;
    if (copied) {
      showTip(m, value, fieldCaption(m) + ' — copied. Press ⌘V / Ctrl+V', '', 0);
    } else {
      showTip(m, value, fieldCaption(m) + ' — could not copy, type it in', '', TIP_HIDE_MS);
    }
  }

  // The next field after `m` in page order that still needs its value.
  function nextOpenField(m) {
    const order = matchFieldsToProfile(profilePayload(cachedProfile))
      .filter((f) => f.value !== undefined && f.value !== null && f.value !== '');
    const at = order.findIndex((f) => f.el === m.el);
    if (at < 0) return null;
    return order.slice(at + 1).find((f) => !alreadyHasValue(f)) || null;
  }

  // Moves the cursor on; the focusin that causes copies the next value.
  function advanceFrom(m) {
    const next = nextOpenField(m);
    if (!next) {
      showTip(m, 'All done', 'Check the details, then complete the CAPTCHA yourself', 'ok', TIP_HIDE_MS);
      return;
    }
    next.el.scrollIntoView({ block: 'nearest' });
    if (typeof next.el.focus === 'function') next.el.focus();
    // Selected, so the next paste replaces whatever is already there.
    if (typeof next.el.select === 'function') next.el.select();
    // Custom dropdowns may not take focus, so no focusin would fire.
    if (!tipFor || tipFor.el !== next.el) onFieldFocus({ target: next.el });
  }

  document.addEventListener('focusin', onFieldFocus, true);
  // Custom dropdowns often never take focus, so clicks count too.
  document.addEventListener('click', onFieldFocus, true);
  // Once the user's own paste (or typing) matches, move on to the next field.
  document.addEventListener('input', (e) => {
    if (!tipFor || e.target !== tipFor.el || !e.isTrusted || isDropdown(tipFor) || !alreadyHasValue(tipFor)) return;
    const m = tipFor;
    // After the page's own input handlers have seen the paste.
    setTimeout(() => { if (tipFor === m) advanceFrom(m); }, 0);
  }, true);
  // Some fields (Age on TTD) refuse pasted text. If a paste leaves the field
  // without its value, say so and ask the user to type it; the input listener
  // above moves on once what they type matches.
  // Sites may cancel the paste event or the Cmd/Ctrl+V keypress itself, so
  // both are watched; either way the check runs once the page has had its say.
  function checkPasteLanded(e) {
    if (!tipFor || !e.isTrusted || isDropdown(tipFor)) return;
    if (e.target !== tipFor.el && document.activeElement !== tipFor.el) return;
    const m = tipFor;
    setTimeout(() => {
      if (tipFor !== m || alreadyHasValue(m)) return;
      showTip(m, String(m.value), fieldCaption(m) + ' — this field blocks paste, please type it in', 'err', 0);
    }, 300);
  }
  document.addEventListener('paste', checkPasteLanded, true);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') checkPasteLanded(e);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); }, true);
  window.addEventListener('scroll', () => { if (tipFor) positionTip(); }, true);
  window.addEventListener('resize', () => { if (tipFor) positionTip(); });

  async function handleFill() {
    if (busy) return;
    const active = cachedProfile || (await readActiveProfile());
    if (!active) {
      showMessage('No saved profile yet. Open the extension popup to create one.', 'err');
      return;
    }
    busy = true;
    ui.fill.disabled = true;
    ui.pin.classList.add('busy');
    showMessage('', '');
    setBubble('Filling\u2026', '', '');
    try {
      const { filled, failures } = await fillFormWithDynamicRetry(profilePayload(active));
      const missing = Array.from(new Set(failures.map((f) => FIELD_NAMES[f.key] || f.key)));
      const text = 'Filled ' + filled + (filled === 1 ? ' field' : ' fields') + '.' +
        (missing.length ? ' Please set manually: ' + missing.join(', ') + '.' : '');
      showMessage(text, filled > 0 && !missing.length ? 'ok' : 'err');
      if (missing.length || filled === 0) setPanelOpen(true);
    } catch (e) {
      showMessage('Could not fill this page. Try reloading it.', 'err');
    } finally {
      busy = false;
      ui.fill.disabled = false;
      ui.pin.classList.remove('busy');
      refreshLabel();
    }
  }

  async function tick() {
    if (dismissed) return;
    const hasFields = pageHasFillableFields();
    misses = hasFields ? 0 : misses + 1;

    if (hasFields && !host) {
      buildUi();
      // Set the final label before the first paint so it doesn't resize.
      await refreshLabel();
    }
    if (!host) return;
    // The site can re-render <html>'s children; keep our host attached.
    if (!host.isConnected) document.documentElement.appendChild(host);

    if (hasFields) {
      setVisible(true);
    } else if (misses >= HIDE_AFTER_MISSES && !busy) {
      setVisible(false);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && host && (changes.profiles || changes.currentProfile)) {
      refreshLabel();
    }
  });

  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
})();
