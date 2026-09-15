'use strict';

/**
 * Pilgrim Form Assistant - generic form-filling engine.
 *
 * This file is site-agnostic: it never references a specific TTD domain,
 * selector, or field name. Site-specific keyword hints come from
 * `PilgrimFormAssistantSiteMap` (site-mappings.js), which is loaded first
 * and exposed as a global in this content-script world.
 *
 * Safety rules enforced here:
 *  - Never touches captcha/OTP inputs, file/password uploads, or anything
 *    not visible.
 *  - Never submits the form itself; the optional "continue" click only
 *    fires on a button whose visible text looks like plain pagination
 *    (continue/next/proceed) and never on anything that looks like a
 *    payment, submit, or booking-confirmation action.
 */

const FILL_MESSAGE_TYPE = 'PFA_FILL_FORM';
const MAX_DYNAMIC_RETRIES = 3;
const RETRY_WAIT_MS = 600;

const GENERAL_KEYWORDS = {
  email: ['email', 'e-mail', 'email id', 'mail id'],
  mobile: ['mobile', 'mobile number', 'phone', 'phone number', 'contact number', 'contact no'],
  city: ['city', 'town'],
  state: ['state'],
  country: ['country'],
  pin: ['pin code', 'pincode', 'postal code', 'zip code']
};

const PILGRIM_KEYWORDS = {
  name: ['full name', 'name'],
  age: ['age'],
  gender: ['gender', 'sex'],
  idType: ['id proof type', 'id proof', 'proof type', 'document type', 'id type'],
  idNumber: ['id number', 'id no', 'aadhar number', 'aadhaar number', 'passport number', 'proof number']
};

const UNSAFE_FIELD_PATTERN = /captcha|otp|one[\s-]?time[\s-]?password|verification code/i;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isComputedVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

// Type/visibility eligibility only - deliberately excludes the
// disabled/readonly check, which fillForm applies separately so it can
// tell "wrong kind of field" apart from "disabled for now, might become
// enabled once another field is filled" (see `deferred` in fillForm).
function isTypeEligible(el) {
  const tag = el.tagName.toLowerCase();
  if (!['input', 'select', 'textarea'].includes(tag)) return false;
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    const excludedTypes = ['hidden', 'file', 'password', 'submit', 'button', 'checkbox', 'radio', 'image', 'reset', 'range', 'color'];
    if (excludedTypes.includes(type)) return false;
  }
  return true;
}

function isFieldDisabled(el, comboTrigger) {
  if (comboTrigger) return el.getAttribute('aria-disabled') === 'true' || el.disabled;
  // NOTE: readOnly is deliberately not treated as "disabled for now" here -
  // a readonly input never becomes non-readonly by itself. It's handled
  // separately as a click-to-open picker (see isReadonlyPickerInput).
  return el.disabled;
}

// Some forms use a plain `readonly` text input as a dropdown trigger
// instead of a native <select> or an ARIA combobox: you can't type into
// it, but clicking it opens some kind of picker elsewhere in the page.
function isReadonlyPickerInput(el) {
  const tag = el.tagName.toLowerCase();
  return (tag === 'input' || tag === 'textarea') && el.readOnly === true && !el.disabled;
}

function textFromLabelledBy(el) {
  const attr = el.getAttribute('aria-labelledby');
  if (!attr) return '';
  return attr
    .split(/\s+/)
    .map((id) => {
      const node = document.getElementById(id);
      return node ? node.textContent : '';
    })
    .join(' ');
}

const FIELD_LIKE_SELECTOR = 'input, select, textarea, [aria-haspopup="listbox"], [role="combobox"]';

// Walks up from `el` while each ancestor still contains only this one
// field, collecting sibling/label-like text along the way. This catches
// "floating label" markup where the visible label text sits one or two
// wrapper divs above the input rather than immediately next to it -
// without crossing into a neighboring field's label once an ancestor
// starts containing more than one field.
function textFromNearestFieldContainer(el) {
  const collected = [];
  let node = el.parentElement;
  let hops = 0;

  while (node && hops < 4) {
    const controlsInside = node.querySelectorAll(FIELD_LIKE_SELECTOR);
    if (controlsInside.length > 1) break;

    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        collected.push(child.textContent);
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      if (child === el || child.contains(el)) return;
      const tag = child.tagName.toLowerCase();
      if (['input', 'select', 'textarea', 'script', 'style'].includes(tag)) return;
      collected.push(child.textContent);
    });

    node = node.parentElement;
    hops += 1;
  }

  return collected.join(' ');
}

function buildFieldContextText(el) {
  const parts = [];

  if (el.id && window.CSS && typeof CSS.escape === 'function') {
    const labelFor = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (labelFor) parts.push(labelFor.textContent);
  }

  const wrappingLabel = el.closest('label');
  if (wrappingLabel) parts.push(wrappingLabel.textContent);

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) parts.push(ariaLabel);

  parts.push(textFromLabelledBy(el));

  // Some component libraries pass a "label" prop straight through as a
  // plain (non-standard) HTML attribute on the field itself, e.g.
  // <input label="Name" ...>, without any visually/programmatically
  // linked <label> element at all.
  const labelAttr = el.getAttribute('label');
  if (labelAttr) parts.push(labelAttr);

  if (el.getAttribute('placeholder')) parts.push(el.getAttribute('placeholder'));
  if (el.getAttribute('name')) parts.push(el.getAttribute('name'));
  if (el.id) parts.push(el.id);

  const prevSibling = el.previousElementSibling;
  if (prevSibling && !['input', 'select', 'textarea', 'button'].includes(prevSibling.tagName.toLowerCase())) {
    parts.push(prevSibling.textContent);
  }

  const parent = el.parentElement;
  if (parent) {
    const directText = Array.from(parent.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join(' ');
    parts.push(directText);

    const cell = el.closest('td, th');
    if (cell) {
      const prevCell = cell.previousElementSibling;
      if (prevCell) parts.push(prevCell.textContent);
    }
  }

  parts.push(textFromNearestFieldContainer(el));

  return parts.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function mergeKeywordMaps(base, extra) {
  const merged = {};
  for (const key of Object.keys(base)) {
    merged[key] = base[key].slice();
  }
  if (extra) {
    for (const key of Object.keys(extra)) {
      merged[key] = (merged[key] || []).concat(extra[key]);
    }
  }
  return merged;
}

function bestKeywordMatchLength(text, keywordList) {
  let best = 0;
  for (const keyword of keywordList) {
    const re = new RegExp('\\b' + escapeRegExp(keyword.toLowerCase()) + '\\b', 'i');
    if (re.test(text) && keyword.length > best) {
      best = keyword.length;
    }
  }
  return best;
}

function classifyField(text, generalKeywords, pilgrimKeywords) {
  let bestScope = null;
  let bestKey = null;
  let bestLen = 0;
  let tie = false;

  for (const key of Object.keys(generalKeywords)) {
    const len = bestKeywordMatchLength(text, generalKeywords[key]);
    if (len > bestLen) {
      bestLen = len;
      bestScope = 'general';
      bestKey = key;
      tie = false;
    } else if (len > 0 && len === bestLen) {
      tie = true;
    }
  }

  for (const key of Object.keys(pilgrimKeywords)) {
    const len = bestKeywordMatchLength(text, pilgrimKeywords[key]);
    if (len > bestLen) {
      bestLen = len;
      bestScope = 'pilgrim';
      bestKey = key;
      tie = false;
    } else if (len > 0 && len === bestLen) {
      tie = true;
    }
  }

  if (bestLen === 0 || tie) return null;
  return { scope: bestScope, key: bestKey };
}

function setNativeValue(el, value) {
  const tag = el.tagName.toLowerCase();
  const proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && descriptor.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function normalizeForCompare(s) {
  return String(s).trim().toLowerCase();
}

// "Aadhaar" is very commonly misspelled "Aadhar" on Indian government
// forms; treat both spellings as equivalent when matching option text.
function spellingVariants(text) {
  const variants = new Set([text]);
  variants.add(text.replace(/aadhaar/g, 'aadhar'));
  variants.add(text.replace(/aadhar/g, 'aadhaar'));
  return Array.from(variants);
}

function setSelectValue(el, desiredText) {
  if (!desiredText) return false;
  const targets = spellingVariants(normalizeForCompare(desiredText));
  const options = Array.from(el.options);

  let match = options.find((o) => {
    const optText = normalizeForCompare(o.textContent);
    return targets.includes(optText);
  });
  if (!match) {
    match = options.find((o) => {
      const optText = normalizeForCompare(o.textContent);
      if (!optText) return false;
      return targets.some((t) => optText.includes(t) || t.includes(optText));
    });
  }
  if (!match) return false;

  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
  if (descriptor && descriptor.set) {
    descriptor.set.call(el, match.value);
  } else {
    el.value = match.value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function fillOneField(el, value) {
  if (value === undefined || value === null || value === '') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') {
    return setSelectValue(el, value);
  }
  setNativeValue(el, String(value));
  return true;
}

function isAriaComboTrigger(el) {
  const tag = el.tagName.toLowerCase();
  if (['input', 'select', 'textarea'].includes(tag)) return false;
  return el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('role') === 'combobox';
}

function findVisibleOptionElements() {
  return Array.from(document.querySelectorAll('[role="option"]')).filter(isComputedVisible);
}

function matchOptionElement(options, desiredText) {
  const targets = spellingVariants(normalizeForCompare(desiredText));
  let match = options.find((o) => targets.includes(normalizeForCompare(o.textContent)));
  if (!match) {
    match = options.find((o) => {
      const t = normalizeForCompare(o.textContent);
      return t && targets.some((x) => t.includes(x) || x.includes(t));
    });
  }
  return match || null;
}

// Many modern government/enterprise forms build "select" dropdowns as a
// clickable trigger (following the ARIA combobox/listbox pattern) plus a
// popup list of role="option" items, rather than a native <select>. This
// opens the trigger, waits briefly for the (often portaled/animated)
// option list to appear, and clicks the matching option - or closes the
// menu again if nothing matches, so we never leave a stray menu open or
// click something unrelated.
async function fillAriaCombobox(triggerEl, desiredText) {
  if (!desiredText) return false;

  triggerEl.click();
  await waitBeforeRetry(150);
  let options = findVisibleOptionElements();
  if (options.length === 0) {
    await waitBeforeRetry(250);
    options = findVisibleOptionElements();
  }

  const match = matchOptionElement(options, desiredText);
  if (match) {
    match.click();
    return true;
  }

  triggerEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return false;
}

// Small, visible, childless elements are good candidates for "one option
// row in a picker" regardless of what markup/classes a site happens to
// use for it - no role="option" or particular tag name required.
function collectVisibleLeafTextElements() {
  return Array.from(document.querySelectorAll('li, div, span, button, p, a')).filter((e) => {
    if (e.children.length > 0) return false;
    const text = (e.textContent || '').trim();
    if (!text || text.length > 60) return false;
    return isComputedVisible(e);
  });
}

// Handles a `readonly` text input used as a picker trigger (see
// isReadonlyPickerInput): clicks it, waits for whatever picker UI shows
// up, and clicks the option whose text matches - preferring elements that
// newly appeared after the click over ones that were already on the page,
// so we don't accidentally click unrelated existing text. Closes the
// picker (a body click) if nothing matches, rather than leaving it open
// or clicking something unintended.
async function fillReadonlyPickerField(triggerEl, desiredText) {
  if (!desiredText) return false;

  const before = new Set(collectVisibleLeafTextElements());
  triggerEl.click();
  await waitBeforeRetry(200);
  let after = collectVisibleLeafTextElements();
  let newlyVisible = after.filter((e) => !before.has(e));
  if (newlyVisible.length === 0) {
    await waitBeforeRetry(300);
    after = collectVisibleLeafTextElements();
    newlyVisible = after.filter((e) => !before.has(e));
  }

  const pool = newlyVisible.length > 0 ? newlyVisible : after;
  const match = matchOptionElement(pool, desiredText);
  if (match) {
    match.click();
    return true;
  }

  document.body.click();
  return false;
}

async function attemptFill(el, comboTrigger, pickerInput, value) {
  if (comboTrigger) return fillAriaCombobox(el, value);
  if (pickerInput) return fillReadonlyPickerField(el, value);
  return fillOneField(el, value);
}

async function fillForm(payload) {
  const general = (payload && payload.general) || {};
  const pilgrims = (payload && payload.pilgrims) || [];

  const siteConfig =
    window.PilgrimFormAssistantSiteMap && typeof window.PilgrimFormAssistantSiteMap.getSiteConfig === 'function'
      ? window.PilgrimFormAssistantSiteMap.getSiteConfig(location.hostname)
      : { extraKeywords: {} };

  const generalKeywords = mergeKeywordMaps(GENERAL_KEYWORDS, siteConfig.extraKeywords && siteConfig.extraKeywords.general);
  const pilgrimKeywords = mergeKeywordMaps(PILGRIM_KEYWORDS, siteConfig.extraKeywords && siteConfig.extraKeywords.pilgrim);

  const fields = Array.from(document.querySelectorAll(FIELD_LIKE_SELECTOR));
  const pilgrimCounters = { name: 0, age: 0, gender: 0, idType: 0, idNumber: 0 };
  let filledCount = 0;
  // Fields that matched and have a value, but are disabled right now.
  // Some forms only enable a field (e.g. Gender, ID Proof) once an
  // earlier field has been filled in - we retry these once, after a
  // short pause, instead of giving up on the first pass.
  const deferred = [];
  // Matched fields (had a category + a value to put in them) that still
  // did not end up filled - surfaced back to the popup as a short "these
  // need manual entry" note.
  const failures = [];

  function describeFailure(key) {
    failures.push({ key });
  }

  for (const el of fields) {
    const comboTrigger = isAriaComboTrigger(el);
    const pickerInput = !comboTrigger && isReadonlyPickerInput(el);

    if (!comboTrigger && !isTypeEligible(el)) continue;
    if (!isComputedVisible(el)) continue;

    const contextText = buildFieldContextText(el);
    if (UNSAFE_FIELD_PATTERN.test(contextText)) continue;

    const match = classifyField(contextText, generalKeywords, pilgrimKeywords);
    if (!match) continue;

    let value;
    if (match.scope === 'general') {
      value = general[match.key];
    } else {
      const index = pilgrimCounters[match.key]++;
      value = index < pilgrims.length ? pilgrims[index][match.key] : undefined;
    }
    if (value === undefined || value === null || value === '') continue;

    if (!pickerInput && isFieldDisabled(el, comboTrigger)) {
      deferred.push({ el, comboTrigger, pickerInput, value, key: match.key });
      continue;
    }

    if (await attemptFill(el, comboTrigger, pickerInput, value)) {
      filledCount += 1;
    } else {
      describeFailure(match.key);
    }
  }

  let remainingDeferred = deferred;
  for (let attempt = 0; attempt < 3 && remainingDeferred.length > 0; attempt++) {
    await waitBeforeRetry(400);
    const stillDisabled = [];
    for (const item of remainingDeferred) {
      if (isFieldDisabled(item.el, item.comboTrigger)) {
        stillDisabled.push(item);
        continue;
      }
      if (!isComputedVisible(item.el)) continue;
      if (await attemptFill(item.el, item.comboTrigger, item.pickerInput, item.value)) {
        filledCount += 1;
      } else {
        describeFailure(item.key);
      }
    }
    remainingDeferred = stillDisabled;
  }

  remainingDeferred.forEach((item) => describeFailure(item.key));

  return { filled: filledCount, failures };
}

function findSafeContinueButton() {
  const includeRe = /^(continue|next|proceed)\b/i;
  const excludeRe = /pay|payment|submit|confirm booking|book now|order/i;
  const candidates = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a'));

  for (const el of candidates) {
    if (el.disabled) continue;
    if (!isComputedVisible(el)) continue;
    const text = (el.tagName.toLowerCase() === 'input' ? el.value || '' : el.textContent || '').trim();
    if (!text) continue;
    if (excludeRe.test(text)) continue;
    if (includeRe.test(text)) return el;
  }
  return null;
}

function waitBeforeRetry(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fillFormWithDynamicRetry(payload) {
  let result = await fillForm(payload);
  let attempt = 0;
  while (result.filled === 0 && attempt < MAX_DYNAMIC_RETRIES) {
    await waitBeforeRetry(RETRY_WAIT_MS);
    result = await fillForm(payload);
    attempt += 1;
  }
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== FILL_MESSAGE_TYPE) return false;

  const payload = message.payload || { general: {}, pilgrims: [] };

  fillFormWithDynamicRetry(payload).then(({ filled, failures }) => {
    let continued = false;
    if (message.continueAfter) {
      const btn = findSafeContinueButton();
      if (btn) {
        btn.click();
        continued = true;
      }
    }
    const unmatchedKeys = failures.map((f) => f.key);
    sendResponse({ filled, continued, unmatchedKeys });
  });

  return true;
});
