'use strict';

/**
 * Pilgrim Form Assistant - popup logic
 * All data lives in chrome.storage.local under keys: profiles, currentProfile.
 * Nothing here ever makes a network request.
 *
 * The popup itself is just a profile picker + fill trigger. Editing a
 * profile's General/Pilgrims/Settings details happens in fullpage.html,
 * opened as a normal browser tab (see openFullPage below) - see
 * fullpage.js for that editor. Both read/write the same chrome.storage
 * keys, so a save there is picked up here the next time the popup opens.
 */

const MAX_PILGRIMS = 6;
const FILL_MESSAGE_TYPE = 'PFA_FILL_FORM';

const SUPPORTED_HOST_SUFFIXES = ['.tirupatibalaji.ap.gov.in', '.ttdevasthanams.ap.gov.in'];

let state = {
  profiles: {},
  currentProfile: null
};

const els = {};

function qs(id) {
  return document.getElementById(id);
}

function cacheEls() {
  els.profileSelect = qs('profileSelect');
  els.profileNameInput = qs('profileNameInput');
  els.btnNewProfile = qs('btnNewProfile');
  els.btnDuplicateProfile = qs('btnDuplicateProfile');
  els.btnRenameProfile = qs('btnRenameProfile');
  els.btnDeleteProfile = qs('btnDeleteProfile');
  els.btnFillContinue = qs('btnFillContinue');
  els.btnFillOnly = qs('btnFillOnly');
  els.editTabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  els.statusLine = qs('statusLine');
  els.statusIcon = qs('statusIcon');
  els.statusText = qs('statusText');
}

const FIELD_DISPLAY_NAMES = {
  email: 'Email ID',
  mobile: 'Mobile',
  city: 'City',
  state: 'State',
  country: 'Country',
  pin: 'PIN code',
  name: 'Name',
  age: 'Age',
  gender: 'Gender',
  idType: 'Photo ID proof',
  idNumber: 'Photo ID number'
};

// Some form fields on some sites can't be auto-filled (an unrecognized
// dropdown widget, an option list that doesn't match the saved value,
// etc.) - this surfaces which ones, in plain language, instead of
// silently under-reporting the fill count.
function unmatchedFieldsNote(unmatchedKeys) {
  if (!unmatchedKeys || unmatchedKeys.length === 0) return '';
  const names = Array.from(new Set(unmatchedKeys.map((k) => FIELD_DISPLAY_NAMES[k] || k)));
  return ' Please set manually: ' + names.join(', ') + '.';
}

const STATUS_ICON_PATHS = {
  ready: '<path d="M5 10.5l3 3 7-7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  busy: '<circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="7 4"/>',
  error: '<path d="M10 3 2.5 16h15L10 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8.5v3.2M10 14.2v.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
};

function setStatus(message, kind) {
  const safeKind = kind || 'ready';
  els.statusText.textContent = message;
  els.statusLine.className = 'status status-' + safeKind;
  els.statusIcon.innerHTML = STATUS_ICON_PATHS[safeKind] || STATUS_ICON_PATHS.ready;
  if (safeKind === 'busy') {
    els.statusIcon.classList.add('spin');
  } else {
    els.statusIcon.classList.remove('spin');
  }
}

function emptyProfile() {
  return {
    general: { email: '', mobile: '', city: '', state: '', country: 'India', pin: '' },
    pilgrims: []
  };
}

function loadState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['profiles', 'currentProfile'], (data) => {
      state.profiles = data.profiles && typeof data.profiles === 'object' ? data.profiles : {};
      const names = Object.keys(state.profiles);
      if (data.currentProfile && state.profiles[data.currentProfile]) {
        state.currentProfile = data.currentProfile;
      } else if (names.length > 0) {
        state.currentProfile = names[0];
      } else {
        state.currentProfile = null;
      }
      resolve();
    });
  });
}

function persistState() {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { profiles: state.profiles, currentProfile: state.currentProfile },
      resolve
    );
  });
}

function renderProfileSelect() {
  const names = Object.keys(state.profiles).sort((a, b) => a.localeCompare(b));
  els.profileSelect.innerHTML = '';
  if (names.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No profiles yet';
    els.profileSelect.appendChild(opt);
    els.profileSelect.disabled = true;
  } else {
    els.profileSelect.disabled = false;
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === state.currentProfile) opt.selected = true;
      els.profileSelect.appendChild(opt);
    }
  }
}

function validateGeneral(general) {
  const errors = [];
  if (general.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(general.email)) {
    errors.push('Email ID looks invalid.');
  }
  if (general.mobile && !/^\d{10}$/.test(general.mobile)) {
    errors.push('Mobile should be a 10-digit number.');
  }
  if (general.pin && !/^\d{6}$/.test(general.pin)) {
    errors.push('PIN code should be 6 digits.');
  }
  return errors;
}

function validatePilgrims(pilgrims) {
  const errors = [];
  pilgrims.forEach((p, i) => {
    const hasAnyField = p.name || p.age || p.gender || p.idType || p.idNumber;
    if (!hasAnyField) return;
    if (!p.name) errors.push('Pilgrim ' + (i + 1) + ': name is required.');
    if (p.age && (!/^\d+$/.test(p.age) || Number(p.age) < 0 || Number(p.age) > 120)) {
      errors.push('Pilgrim ' + (i + 1) + ': age must be between 0 and 120.');
    }
  });
  return errors;
}

function generateUniqueName(baseName, pool) {
  const existing = pool || state.profiles;
  let candidate = baseName;
  let suffix = 2;
  while (existing[candidate]) {
    candidate = baseName + ' (' + suffix + ')';
    suffix += 1;
  }
  return candidate;
}

async function handleNewProfile() {
  const typed = els.profileNameInput.value.trim();
  const baseName = typed || 'New Profile';
  const name = generateUniqueName(baseName);
  state.profiles[name] = emptyProfile();
  state.currentProfile = name;
  await persistState();
  renderProfileSelect();
  els.profileNameInput.value = '';
  setStatus('Created profile "' + name + '". Click General/Pilgrims to fill in details.', 'ready');
}

async function handleDuplicateProfile() {
  if (!state.currentProfile) {
    setStatus('No profile selected to duplicate.', 'error');
    return;
  }
  const typed = els.profileNameInput.value.trim();
  const baseName = typed || state.currentProfile + ' copy';
  const name = generateUniqueName(baseName);
  state.profiles[name] = JSON.parse(JSON.stringify(state.profiles[state.currentProfile]));
  state.currentProfile = name;
  await persistState();
  renderProfileSelect();
  els.profileNameInput.value = '';
  setStatus('Duplicated as "' + name + '".', 'ready');
}

async function handleRenameProfile() {
  if (!state.currentProfile) {
    setStatus('No profile selected to rename.', 'error');
    return;
  }
  const newName = els.profileNameInput.value.trim();
  if (!newName) {
    setStatus('Type the new name in the box above, then click Rename.', 'error');
    return;
  }
  if (newName === state.currentProfile) {
    setStatus('That is already the profile’s name.', 'error');
    return;
  }
  if (state.profiles[newName]) {
    setStatus('A profile named "' + newName + '" already exists.', 'error');
    return;
  }
  const oldName = state.currentProfile;
  state.profiles[newName] = state.profiles[oldName];
  delete state.profiles[oldName];
  state.currentProfile = newName;
  await persistState();
  renderProfileSelect();
  els.profileNameInput.value = '';
  setStatus('Renamed "' + oldName + '" to "' + newName + '".', 'ready');
}

async function handleDeleteProfile() {
  if (!state.currentProfile) return;
  const name = state.currentProfile;
  delete state.profiles[name];
  const remaining = Object.keys(state.profiles);
  state.currentProfile = remaining.length > 0 ? remaining[0] : null;
  await persistState();
  renderProfileSelect();
  setStatus('Deleted "' + name + '".', 'ready');
}

async function handleProfileSelectChange() {
  state.currentProfile = els.profileSelect.value || null;
  await persistState();
  setStatus('Switched to "' + state.currentProfile + '".', 'ready');
}

function isSupportedUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'https:') return false;
    return SUPPORTED_HOST_SUFFIXES.some(
      (suffix) => url.hostname === suffix.slice(1) || url.hostname.endsWith(suffix)
    );
  } catch (e) {
    return false;
  }
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function sendFillMessage(tabId, payload, continueAfter) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: FILL_MESSAGE_TYPE, payload, continueAfter },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      }
    );
  });
}

async function handleFill(continueAfter) {
  if (!state.currentProfile || !state.profiles[state.currentProfile]) {
    setStatus('No profile selected. Pick or create one above first.', 'error');
    return;
  }

  const profile = state.profiles[state.currentProfile];
  const general = profile.general || emptyProfile().general;
  const pilgrims = Array.isArray(profile.pilgrims) ? profile.pilgrims.slice(0, MAX_PILGRIMS) : [];
  const errors = [...validateGeneral(general), ...validatePilgrims(pilgrims)];
  if (errors.length > 0) {
    setStatus(errors[0] + ' Click General/Pilgrims to fix it.', 'error');
    return;
  }

  setStatus('Filling form...', 'busy');

  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    setStatus('Could not access the current tab.', 'error');
    return;
  }
  if (!isSupportedUrl(tab.url)) {
    setStatus('This page is not a supported TTD form site.', 'error');
    return;
  }

  try {
    const response = await sendFillMessage(tab.id, { general, pilgrims }, continueAfter);
    if (!response) {
      setStatus('No response from the page. Try reloading the tab.', 'error');
      return;
    }
    const filledText = response.filled === 1 ? '1 field' : response.filled + ' fields';
    const note = unmatchedFieldsNote(response.unmatchedKeys);
    const statusKind = note ? 'busy' : 'ready';
    if (continueAfter) {
      setStatus(
        'Filled ' + filledText + '. ' + (response.continued ? 'Clicked Continue.' : 'No safe Continue button found.') + note,
        statusKind
      );
    } else {
      setStatus('Filled ' + filledText + '.' + note, statusKind);
    }
  } catch (err) {
    setStatus('Could not reach this page. Reload the tab and try again.', 'error');
  }
}

function openFullPage(tabName) {
  const url = chrome.runtime.getURL('fullpage.html') + '?tab=' + encodeURIComponent(tabName);
  chrome.tabs.create({ url });
  window.close();
}

function bindEvents() {
  els.editTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => openFullPage(btn.dataset.tab));
  });

  els.profileSelect.addEventListener('change', handleProfileSelectChange);
  els.btnNewProfile.addEventListener('click', handleNewProfile);
  els.btnDuplicateProfile.addEventListener('click', handleDuplicateProfile);
  els.btnRenameProfile.addEventListener('click', handleRenameProfile);
  els.btnDeleteProfile.addEventListener('click', handleDeleteProfile);

  els.btnFillContinue.addEventListener('click', () => handleFill(true));
  els.btnFillOnly.addEventListener('click', () => handleFill(false));
}

async function init() {
  cacheEls();
  bindEvents();
  await loadState();
  renderProfileSelect();
  setStatus('Ready.', 'ready');
}

document.addEventListener('DOMContentLoaded', init);
