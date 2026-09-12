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
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

function isEligibleField(el) {
  const tag = el.tagName.toLowerCase();
  if (!['input', 'select', 'textarea'].includes(tag)) return false;
  if (el.disabled || el.readOnly) return false;
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    const excludedTypes = ['hidden', 'file', 'password', 'submit', 'button', 'checkbox', 'radio', 'image', 'reset', 'range', 'color'];
    if (excludedTypes.includes(type)) return false;
  }
  if (!isComputedVisible(el)) return false;
  return true;
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

function fillForm(payload) {
  const general = (payload && payload.general) || {};
  const pilgrims = (payload && payload.pilgrims) || [];

  const siteConfig =
    window.PilgrimFormAssistantSiteMap && typeof window.PilgrimFormAssistantSiteMap.getSiteConfig === 'function'
      ? window.PilgrimFormAssistantSiteMap.getSiteConfig(location.hostname)
      : { extraKeywords: {} };

  const generalKeywords = mergeKeywordMaps(GENERAL_KEYWORDS, siteConfig.extraKeywords && siteConfig.extraKeywords.general);
  const pilgrimKeywords = mergeKeywordMaps(PILGRIM_KEYWORDS, siteConfig.extraKeywords && siteConfig.extraKeywords.pilgrim);

  const fields = Array.from(document.querySelectorAll('input, select, textarea'));
  const pilgrimCounters = { name: 0, age: 0, gender: 0, idType: 0, idNumber: 0 };
  let filledCount = 0;

  for (const el of fields) {
    if (!isEligibleField(el)) continue;

    const contextText = buildFieldContextText(el);
    if (UNSAFE_FIELD_PATTERN.test(contextText)) continue;

    const match = classifyField(contextText, generalKeywords, pilgrimKeywords);
    if (!match) continue;

    if (match.scope === 'general') {
      const value = general[match.key];
      if (fillOneField(el, value)) filledCount += 1;
    } else {
      const index = pilgrimCounters[match.key]++;
      if (index < pilgrims.length) {
        const value = pilgrims[index][match.key];
        if (fillOneField(el, value)) filledCount += 1;
      }
    }
  }

  return filledCount;
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
  let filled = fillForm(payload);
  let attempt = 0;
  while (filled === 0 && attempt < MAX_DYNAMIC_RETRIES) {
    await waitBeforeRetry(RETRY_WAIT_MS);
    filled = fillForm(payload);
    attempt += 1;
  }
  return filled;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== FILL_MESSAGE_TYPE) return false;

  const payload = message.payload || { general: {}, pilgrims: [] };

  fillFormWithDynamicRetry(payload).then((filled) => {
    let continued = false;
    if (message.continueAfter) {
      const btn = findSafeContinueButton();
      if (btn) {
        btn.click();
        continued = true;
      }
    }
    sendResponse({ filled, continued });
  });

  return true;
});
