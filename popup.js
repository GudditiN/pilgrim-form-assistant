'use strict';

/**
 * Pilgrim Form Assistant - popup logic
 * All data lives in chrome.storage.local under keys: profiles, currentProfile.
 * Nothing here ever makes a network request.
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
  els.btnSaveProfile = qs('btnSaveProfile');
  els.btnDeleteProfile = qs('btnDeleteProfile');
  els.btnFillContinue = qs('btnFillContinue');
  els.btnFillOnly = qs('btnFillOnly');
  els.tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  els.tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
  els.genEmail = qs('genEmail');
  els.genMobile = qs('genMobile');
  els.genCity = qs('genCity');
  els.genState = qs('genState');
  els.genCountry = qs('genCountry');
  els.genPin = qs('genPin');
  els.pilgrimsList = qs('pilgrimsList');
  els.pilgrimsCountLabel = qs('pilgrimsCountLabel');
  els.btnAddPilgrim = qs('btnAddPilgrim');
  els.btnExport = qs('btnExport');
  els.importFile = qs('importFile');
  els.statusLine = qs('statusLine');
  els.statusIcon = qs('statusIcon');
  els.statusText = qs('statusText');
  els.pilgrimCardTemplate = qs('pilgrimCardTemplate');
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

function renderGeneral(profile) {
  const g = profile.general;
  els.genEmail.value = g.email || '';
  els.genMobile.value = g.mobile || '';
  els.genCity.value = g.city || '';
  els.genState.value = g.state || '';
  els.genCountry.value = g.country || 'India';
  els.genPin.value = g.pin || '';
}

function pilgrimCardFromData(pilgrim, index) {
  const frag = els.pilgrimCardTemplate.content.cloneNode(true);
  const card = frag.querySelector('.pilgrim-card');
  card.querySelector('.pilgrim-badge').textContent = String(index + 1);
  card.querySelector('.pilgrim-index').textContent = 'Pilgrim';
  card.querySelector('.pilgrim-name').value = pilgrim.name || '';
  card.querySelector('.pilgrim-age').value = pilgrim.age || '';
  card.querySelector('.pilgrim-gender').value = pilgrim.gender || '';
  card.querySelector('.pilgrim-idtype').value = pilgrim.idType || '';
  card.querySelector('.pilgrim-idnumber').value = pilgrim.idNumber || '';
  card.querySelector('.btn-remove-pilgrim').addEventListener('click', () => {
    card.remove();
    renumberPilgrimCards();
  });
  return card;
}

function renumberPilgrimCards() {
  const cards = els.pilgrimsList.querySelectorAll('.pilgrim-card');
  cards.forEach((card, i) => {
    card.querySelector('.pilgrim-badge').textContent = String(i + 1);
  });
  els.pilgrimsCountLabel.textContent = 'PILGRIMS (' + cards.length + ' OF ' + MAX_PILGRIMS + ')';
  els.btnAddPilgrim.disabled = cards.length >= MAX_PILGRIMS;
}

function renderPilgrims(profile) {
  els.pilgrimsList.innerHTML = '';
  const pilgrims = Array.isArray(profile.pilgrims) ? profile.pilgrims.slice(0, MAX_PILGRIMS) : [];
  pilgrims.forEach((p, i) => {
    els.pilgrimsList.appendChild(pilgrimCardFromData(p, i));
  });
  renumberPilgrimCards();
}

function renderProfileIntoForm(name) {
  const profile = state.profiles[name] || emptyProfile();
  renderGeneral(profile);
  renderPilgrims(profile);
}

function collectGeneralFromForm() {
  return {
    email: els.genEmail.value.trim(),
    mobile: els.genMobile.value.trim(),
    city: els.genCity.value.trim(),
    state: els.genState.value.trim(),
    country: els.genCountry.value.trim() || 'India',
    pin: els.genPin.value.trim()
  };
}

function collectPilgrimsFromForm() {
  const cards = els.pilgrimsList.querySelectorAll('.pilgrim-card');
  const pilgrims = [];
  cards.forEach((card) => {
    pilgrims.push({
      name: card.querySelector('.pilgrim-name').value.trim(),
      age: card.querySelector('.pilgrim-age').value.trim(),
      gender: card.querySelector('.pilgrim-gender').value,
      idType: card.querySelector('.pilgrim-idtype').value,
      idNumber: card.querySelector('.pilgrim-idnumber').value.trim()
    });
  });
  return pilgrims;
}

function validateGeneral(general) {
  const errors = [];
  if (general.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(general.email)) {
    errors.push('Email ID looks invalid.');
  }
  if (general.mobile && !/^\d{10}$/.test(general.mobile.replace(/\D/g, ''))) {
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

function switchTab(tabName) {
  els.tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  els.tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === 'tab-' + tabName);
  });
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
  renderProfileIntoForm(name);
  els.profileNameInput.value = '';
  setStatus('Created profile "' + name + '".', 'ready');
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
  renderProfileIntoForm(name);
  els.profileNameInput.value = '';
  setStatus('Duplicated as "' + name + '".', 'ready');
}

async function handleSaveProfile() {
  if (!state.currentProfile) {
    setStatus('Create a profile first.', 'error');
    return;
  }
  const general = collectGeneralFromForm();
  const pilgrims = collectPilgrimsFromForm();
  const errors = [...validateGeneral(general), ...validatePilgrims(pilgrims)];
  if (errors.length > 0) {
    setStatus(errors[0], 'error');
    return;
  }
  state.profiles[state.currentProfile] = { general, pilgrims };
  await persistState();
  setStatus('Saved "' + state.currentProfile + '".', 'ready');
}

async function handleDeleteProfile() {
  if (!state.currentProfile) return;
  const name = state.currentProfile;
  delete state.profiles[name];
  const remaining = Object.keys(state.profiles);
  state.currentProfile = remaining.length > 0 ? remaining[0] : null;
  await persistState();
  renderProfileSelect();
  renderProfileIntoForm(state.currentProfile || '');
  setStatus('Deleted "' + name + '".', 'ready');
}

async function handleProfileSelectChange() {
  state.currentProfile = els.profileSelect.value || null;
  await persistState();
  renderProfileIntoForm(state.currentProfile || '');
  setStatus('Switched to "' + state.currentProfile + '".', 'ready');
}

function handleAddPilgrim() {
  const cards = els.pilgrimsList.querySelectorAll('.pilgrim-card');
  if (cards.length >= MAX_PILGRIMS) return;
  const card = pilgrimCardFromData({}, cards.length);
  els.pilgrimsList.appendChild(card);
  renumberPilgrimCards();
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
  const general = collectGeneralFromForm();
  const pilgrims = collectPilgrimsFromForm();
  const errors = [...validateGeneral(general), ...validatePilgrims(pilgrims)];
  if (errors.length > 0) {
    setStatus(errors[0], 'error');
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
    if (continueAfter) {
      setStatus(
        'Filled ' + filledText + '. ' + (response.continued ? 'Clicked Continue.' : 'No safe Continue button found.'),
        'ready'
      );
    } else {
      setStatus('Filled ' + filledText + '.', 'ready');
    }
  } catch (err) {
    setStatus('Could not reach this page. Reload the tab and try again.', 'error');
  }
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleExport() {
  const payload = {
    profiles: state.profiles,
    currentProfile: state.currentProfile,
    exportedAt: new Date().toISOString(),
    format: 'pilgrim-form-assistant-backup-v1'
  };
  download('pilgrim-form-assistant-backup.json', JSON.stringify(payload, null, 2));
  setStatus('Exported backup.', 'ready');
}

const GENERAL_FIELD_ALIASES = {
  email: ['email'],
  mobile: ['mobile', 'phone'],
  city: ['city'],
  state: ['state'],
  country: ['country'],
  pin: ['pin', 'pincode', 'zip']
};

const PILGRIM_FIELD_ALIASES = {
  name: ['name', 'fullName', 'fullname'],
  age: ['age'],
  gender: ['gender'],
  idType: ['idType', 'idProof', 'idproof'],
  idNumber: ['idNumber', 'idNo', 'idnumber']
};

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return '';
}

function normalizeGeneral(rawGeneral) {
  const src = rawGeneral && typeof rawGeneral === 'object' ? rawGeneral : {};
  const general = {};
  for (const key of Object.keys(GENERAL_FIELD_ALIASES)) {
    general[key] = String(firstDefined(src, GENERAL_FIELD_ALIASES[key]) || '');
  }
  general.country = general.country || 'India';
  return general;
}

function normalizePilgrims(rawPilgrims) {
  if (!Array.isArray(rawPilgrims)) return [];
  return rawPilgrims.slice(0, MAX_PILGRIMS).map((rawPilgrim) => {
    const src = rawPilgrim && typeof rawPilgrim === 'object' ? rawPilgrim : {};
    const pilgrim = {};
    for (const key of Object.keys(PILGRIM_FIELD_ALIASES)) {
      pilgrim[key] = String(firstDefined(src, PILGRIM_FIELD_ALIASES[key]) || '');
    }
    return pilgrim;
  });
}

/**
 * Accepts our own export shape (profiles keyed by profile name, each with
 * {general, pilgrims}) as well as other reasonably-shaped pilgrim-profile
 * backups (profiles keyed by an id with the display name inside the
 * profile, or pilgrim fields named fullName/idProof instead of
 * name/idType). Returns null if the file isn't a recognizable backup at
 * all.
 */
function normalizeBackup(data) {
  if (!data || typeof data !== 'object') return null;
  if (!data.profiles || typeof data.profiles !== 'object') return null;

  const profiles = {};
  const keyToName = {};

  for (const key of Object.keys(data.profiles)) {
    const rawProfile = data.profiles[key];
    if (!rawProfile || typeof rawProfile !== 'object') continue;

    const displayName =
      (typeof rawProfile.name === 'string' && rawProfile.name.trim()) || key;
    const uniqueName = generateUniqueName(displayName, profiles);

    profiles[uniqueName] = {
      general: normalizeGeneral(rawProfile.general),
      pilgrims: normalizePilgrims(rawProfile.pilgrims)
    };
    keyToName[key] = uniqueName;
  }

  if (Object.keys(profiles).length === 0) return null;

  const activeKeyCandidate = data.currentProfile || data.activeProfileId;
  let currentProfile = null;
  if (activeKeyCandidate && keyToName[activeKeyCandidate]) {
    currentProfile = keyToName[activeKeyCandidate];
  } else if (activeKeyCandidate && profiles[activeKeyCandidate]) {
    currentProfile = activeKeyCandidate;
  } else {
    currentProfile = Object.keys(profiles)[0];
  }

  return { profiles, currentProfile };
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(String(reader.result));
      const normalized = normalizeBackup(data);
      if (!normalized) {
        setStatus('Import failed: file is not a recognizable backup.', 'error');
        return;
      }
      state.profiles = normalized.profiles;
      state.currentProfile = normalized.currentProfile;
      await persistState();
      renderProfileSelect();
      renderProfileIntoForm(state.currentProfile || '');
      setStatus('Import successful.', 'ready');
    } catch (e) {
      setStatus('Import failed: invalid JSON file.', 'error');
    }
  };
  reader.onerror = () => setStatus('Import failed: could not read file.', 'error');
  reader.readAsText(file);
}

function bindEvents() {
  els.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  els.profileSelect.addEventListener('change', handleProfileSelectChange);
  els.btnNewProfile.addEventListener('click', handleNewProfile);
  els.btnDuplicateProfile.addEventListener('click', handleDuplicateProfile);
  els.btnSaveProfile.addEventListener('click', handleSaveProfile);
  els.btnDeleteProfile.addEventListener('click', handleDeleteProfile);

  els.btnFillContinue.addEventListener('click', () => handleFill(true));
  els.btnFillOnly.addEventListener('click', () => handleFill(false));

  els.btnAddPilgrim.addEventListener('click', handleAddPilgrim);

  els.btnExport.addEventListener('click', handleExport);
  els.importFile.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleImportFile(file);
    e.target.value = '';
  });
}

async function init() {
  cacheEls();
  bindEvents();
  await loadState();
  renderProfileSelect();
  renderProfileIntoForm(state.currentProfile || '');
  setStatus('Ready.', 'ready');
}

document.addEventListener('DOMContentLoaded', init);
