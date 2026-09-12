'use strict';

/**
 * Website-specific field mapping hints for Pilgrim Form Assistant.
 *
 * This file is intentionally the ONLY place that knows about individual
 * TTD sites. content.js contains only generic, site-agnostic form-filling
 * logic and reads hints from here through `PilgrimFormAssistantSiteMap`.
 *
 * Each site entry can extend the generic keyword lists used to recognize
 * a field (labels/placeholders/names on TTD forms often use local
 * terminology such as "devotee", "yatri", "aadhar", "seva", etc.) and can
 * optionally list exact CSS selectors once a specific form has been
 * inspected. No selectors are hard-coded yet: the generic keyword matcher
 * in content.js is the primary mechanism, and this file is the extension
 * point for tightening accuracy on a specific TTD page without touching
 * the generic engine.
 */

const PILGRIM_FORM_SITE_MAP = {
  'tirupatibalaji.ap.gov.in': {
    label: 'Tirupati Tirumala Devasthanams (tirupatibalaji.ap.gov.in)',
    extraKeywords: {
      general: {
        email: ['email id', 'e-mail'],
        mobile: ['mobile no', 'contact number', 'phone number', 'mobile number'],
        pin: ['pincode', 'pin code', 'postal code']
      },
      pilgrim: {
        name: ['devotee name', 'yatri name', 'pilgrim name', 'passenger name'],
        age: ['age (yrs)', 'age in years'],
        gender: ['sex'],
        idType: ['id proof type', 'proof of identity', 'document type'],
        idNumber: ['aadhar number', 'aadhaar number', 'id proof number', 'document number']
      }
    },
    // Exact selectors can be added here once a live form has been inspected,
    // e.g. { general: { email: '#txtEmail' }, pilgrim: { name: '.yatriName' } }
    selectors: {}
  },
  'ttdevasthanams.ap.gov.in': {
    label: 'Tirumala Tirupati Devasthanams (ttdevasthanams.ap.gov.in)',
    extraKeywords: {
      general: {
        email: ['email id', 'e-mail'],
        mobile: ['mobile no', 'contact number', 'phone number', 'mobile number'],
        pin: ['pincode', 'pin code', 'postal code']
      },
      pilgrim: {
        name: ['devotee name', 'yatri name', 'pilgrim name', 'passenger name'],
        age: ['age (yrs)', 'age in years'],
        gender: ['sex'],
        idType: ['id proof type', 'proof of identity', 'document type'],
        idNumber: ['aadhar number', 'aadhaar number', 'id proof number', 'document number']
      }
    },
    selectors: {}
  }
};

function pfaGetSiteConfig(hostname) {
  const key = Object.keys(PILGRIM_FORM_SITE_MAP).find((k) => hostname === k || hostname.endsWith('.' + k));
  if (key) return PILGRIM_FORM_SITE_MAP[key];
  return { label: 'Unknown site', extraKeywords: {}, selectors: {} };
}

// Exposed to content.js (loaded as a sibling content script in the same
// isolated world, so a plain global is sufficient - no bundler needed).
window.PilgrimFormAssistantSiteMap = {
  getSiteConfig: pfaGetSiteConfig
};
