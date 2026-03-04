// ============================================================
// Tekpair – Provider Profile Page (js/pages/provider-profile.js)
// Depends on: window.supabase, requireRole(), showToast(),
//             uploadImage(), validateImageFile()
// ============================================================

// ── State ────────────────────────────────────────────────────
let currentUser    = null;
let providerProfile = null;   // row from provider_profiles (may be null on first visit)
let categories     = [];

// Areas served: array of strings
let areasServed    = [];

// Portfolio: mix of existing URL strings + staged File objects
// { type: 'url', value: string } | { type: 'file', file: File, previewUrl: string }
let portfolioItems = [];

const MAX_PORTFOLIO = 6;

// ── Bootstrap ─────────────────────────────────────────────────
(async () => {
  const profile = await requireRole('provider');
  if (!profile) return;
  currentUser = profile;

  // Setup banner if redirected from registration
  if (new URLSearchParams(window.location.search).get('setup') === 'true') {
    document.getElementById('setup-banner').style.display = 'flex';
  }

  await Promise.all([loadProviderProfile(), loadCategories()]);

  prefillForms();
  renderApprovalBanner();
  renderPortfolioGrid();
  updateCompletion();

  hide('form-skeleton');
  show('personal-section');
  show('professional-section');
})();

// ── Data loading ──────────────────────────────────────────────
async function loadProviderProfile() {
  const { data, error } = await window.supabase
    .from('provider_profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (error) {
    console.error('Failed to load provider profile:', error.message);
    showToast('Could not load your profile data.', 'error');
    return;
  }
  providerProfile = data;
}

async function loadCategories() {
  const { data } = await window.supabase
    .from('categories')
    .select('id, name, icon')
    .eq('is_active', true)
    .order('name');
  categories = data ?? [];

  const select = document.getElementById('category-select');
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value       = cat.id;
    opt.textContent = `${cat.icon ?? ''} ${cat.name}`;
    select.appendChild(opt);
  });
}

// ── Prefill forms ─────────────────────────────────────────────
function prefillForms() {
  // Personal (from profiles row = currentUser)
  setInputVal('full-name', currentUser.name ?? '');
  setInputVal('phone',     currentUser.phone ?? '');
  setInputVal('city',      currentUser.city  ?? '');
  renderAvatarPreview(currentUser.avatar_url);

  if (!providerProfile) return;

  // Professional
  setInputVal('bio-input',   providerProfile.bio              ?? '');
  setInputVal('exp-input',   providerProfile.years_experience ?? '');
  updateCharCounter();

  // Category
  if (providerProfile.category_id) {
    document.getElementById('category-select').value = providerProfile.category_id;
  }

  // Areas served
  areasServed = safeParseArray(providerProfile.areas_served);
  renderAreaTags();

  // Portfolio images (existing URLs)
  const urls = safeParseArray(providerProfile.portfolio_images);
  portfolioItems = urls.map(url => ({ type: 'url', value: url }));

  // Availability toggle
  const toggle = document.getElementById('availability-toggle');
  toggle.checked = providerProfile.is_available ?? false;
  syncToggleLabel(toggle.checked);
}

// ── Approval banner ───────────────────────────────────────────
function renderApprovalBanner() {
  if (!providerProfile) return;
  if (providerProfile.is_approved) {
    show('approval-banner-verified');
  } else {
    show('approval-banner-pending');
  }
}

// ── Avatar ────────────────────────────────────────────────────
function renderAvatarPreview(avatarUrl) {
  const container = document.getElementById('avatar-display');
  if (avatarUrl) {
    container.innerHTML =
      `<img class="avatar-preview" src="${esc(avatarUrl)}" id="avatar-img" alt="avatar" />`;
  } else {
    const initials = (currentUser.name ?? 'P').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    container.innerHTML =
      `<div class="avatar-placeholder" id="avatar-placeholder">${initials}</div>`;
  }
}

async function handleAvatarChange(event) {
  const file = event.target.files[0];
  if (!file) return;

  try { validateImageFile(file); } catch (e) { showToast(e.message, 'warning'); return; }

  // Optimistic preview
  const previewUrl = URL.createObjectURL(file);
  const container  = document.getElementById('avatar-display');
  container.innerHTML = `<img class="avatar-preview" src="${previewUrl}" alt="avatar" />`;

  // Upload
  const progressWrap = document.getElementById('avatar-upload-progress');
  const bar          = document.getElementById('avatar-progress-bar');
  progressWrap.classList.add('visible');
  bar.style.width = '30%';

  try {
    const path = `avatars/${currentUser.id}/avatar.${file.name.split('.').pop()}`;
    bar.style.width = '60%';
    const publicUrl = await uploadImage(file, 'avatars', path);
    bar.style.width = '100%';

    // Persist to profiles table
    const { error } = await window.supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', currentUser.id);

    if (error) throw new Error(error.message);

    currentUser.avatar_url = publicUrl;
    // Update nav avatar
    document.querySelectorAll('[data-user-avatar]').forEach(img => {
      img.src = publicUrl;
    });

    showToast('Profile photo updated!', 'success');
    updateCompletion();
  } catch (e) {
    showToast('Failed to upload photo: ' + e.message, 'error');
    renderAvatarPreview(currentUser.avatar_url);
  } finally {
    setTimeout(() => {
      progressWrap.classList.remove('visible');
      bar.style.width = '0%';
    }, 800);
  }
}

// ── Save Personal Info ─────────────────────────────────────────
async function savePersonalInfo() {
  const name  = document.getElementById('full-name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const city  = document.getElementById('city').value.trim();

  clearErr('full-name-err');

  if (!name) {
    setErr('full-name-err', 'Full name is required.');
    document.getElementById('full-name').classList.add('error');
    return;
  }
  document.getElementById('full-name').classList.remove('error');

  setBtnLoading('save-personal-btn', true);

  const { error } = await window.supabase
    .from('profiles')
    .update({ name, phone: phone || null, city: city || null, updated_at: new Date().toISOString() })
    .eq('id', currentUser.id);

  setBtnLoading('save-personal-btn', false);

  if (error) { showToast('Failed to save: ' + error.message, 'error'); return; }

  currentUser.name  = name;
  currentUser.phone = phone || null;
  currentUser.city  = city  || null;

  // Update nav name
  document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = name; });

  showToast('Personal info saved!', 'success');
  updateCompletion();
}

// ── Save Professional Info ────────────────────────────────────
async function saveProfessionalInfo() {
  const bio        = document.getElementById('bio-input').value.trim();
  const exp        = document.getElementById('exp-input').value;
  const categoryId = document.getElementById('category-select').value;

  // Validate
  let valid = true;
  clearErr('bio-err');
  clearErr('category-err');

  if (!bio) {
    setErr('bio-err', 'Please add a bio.');
    document.getElementById('bio-input').classList.add('error');
    valid = false;
  } else {
    document.getElementById('bio-input').classList.remove('error');
  }
  if (!categoryId) {
    setErr('category-err', 'Please select a category.');
    document.getElementById('category-select').classList.add('error');
    valid = false;
  } else {
    document.getElementById('category-select').classList.remove('error');
  }
  if (!valid) return;

  setBtnLoading('save-professional-btn', true);

  // Upload staged portfolio files first
  const finalUrls = await uploadStagedPortfolioFiles();

  const payload = {
    user_id:           currentUser.id,
    category_id:       categoryId,
    bio,
    years_experience:  exp ? parseInt(exp, 10) : null,
    areas_served:      areasServed.length ? JSON.stringify(areasServed) : null,
    portfolio_images:  finalUrls.length   ? JSON.stringify(finalUrls)  : null,
    updated_at:        new Date().toISOString(),
  };

  let error;
  if (providerProfile) {
    ({ error } = await window.supabase
      .from('provider_profiles')
      .update(payload)
      .eq('user_id', currentUser.id));
  } else {
    let data;
    ({ data, error } = await window.supabase
      .from('provider_profiles')
      .insert(payload)
      .select('*')
      .single());
    if (!error) providerProfile = data;
  }

  setBtnLoading('save-professional-btn', false);

  if (error) { showToast('Failed to save: ' + error.message, 'error'); return; }

  // Sync local state
  providerProfile = { ...(providerProfile ?? {}), ...payload, portfolio_images: finalUrls.length ? JSON.stringify(finalUrls) : null };
  portfolioItems  = finalUrls.map(url => ({ type: 'url', value: url }));

  renderPortfolioGrid();
  showToast('Professional info saved!', 'success');
  updateCompletion();
}

// ── Availability toggle ───────────────────────────────────────
async function handleAvailabilityToggle() {
  const toggle   = document.getElementById('availability-toggle');
  const newValue = toggle.checked;
  syncToggleLabel(newValue);

  // Need a provider_profile row
  if (!providerProfile) {
    showToast('Please save your professional info first.', 'warning');
    toggle.checked = false;
    syncToggleLabel(false);
    return;
  }

  const { error } = await window.supabase
    .from('provider_profiles')
    .update({ is_available: newValue, updated_at: new Date().toISOString() })
    .eq('user_id', currentUser.id);

  if (error) {
    showToast('Failed to update availability.', 'error');
    toggle.checked = !newValue;
    syncToggleLabel(!newValue);
    return;
  }

  providerProfile.is_available = newValue;
  showToast(newValue ? 'You are now available for bookings.' : 'You are now unavailable.', 'success');
}

function syncToggleLabel(isOn) {
  const label = document.getElementById('avail-status-label');
  label.textContent = isOn ? 'ON' : 'OFF';
  label.className   = `toggle-status ${isOn ? 'on' : 'off'}`;
}

// ── Bio character counter ─────────────────────────────────────
function updateCharCounter() {
  const textarea = document.getElementById('bio-input');
  const counter  = document.getElementById('bio-counter');
  const len = textarea.value.length;
  counter.textContent = `${len} / 500`;
  counter.className   = 'char-counter';
  if (len > 450) counter.classList.add(len >= 500 ? 'over-limit' : 'near-limit');
}

// ── Areas served (tag input) ──────────────────────────────────
function handleAreaKeydown(event) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    const val = event.target.value.trim().replace(/,$/, '');
    addArea(val);
    event.target.value = '';
  } else if (event.key === 'Backspace' && event.target.value === '' && areasServed.length) {
    removeArea(areasServed.length - 1);
  }
}

function addArea(val) {
  if (!val || areasServed.includes(val) || areasServed.length >= 20) return;
  areasServed.push(val);
  renderAreaTags();
  updateCompletion();
}

function removeArea(idx) {
  areasServed.splice(idx, 1);
  renderAreaTags();
  updateCompletion();
}

function renderAreaTags() {
  const wrap      = document.getElementById('areas-wrap');
  const textInput = document.getElementById('area-text-input');
  // Remove old chips
  wrap.querySelectorAll('.tag-chip').forEach(c => c.remove());
  // Re-insert chips before the text input
  areasServed.forEach((area, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${esc(area)} <button class="tag-chip-remove" onclick="removeArea(${i})" title="Remove">×</button>`;
    wrap.insertBefore(chip, textInput);
  });
}

// ── Portfolio ─────────────────────────────────────────────────
function renderPortfolioGrid() {
  const grid = document.getElementById('portfolio-grid');
  grid.innerHTML = '';

  portfolioItems.forEach((item, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'portfolio-thumb-wrap';
    const src = item.type === 'url' ? item.value : item.previewUrl;
    wrap.innerHTML = `
      <img class="portfolio-thumb" src="${esc(src)}" loading="lazy" alt="Portfolio ${i + 1}" />
      <button class="portfolio-remove" onclick="removePortfolioItem(${i})" title="Remove">×</button>`;
    grid.appendChild(wrap);
  });

  // Upload slot (if under limit)
  if (portfolioItems.length < MAX_PORTFOLIO) {
    const slot  = document.createElement('label');
    slot.className = 'portfolio-upload-slot';
    slot.title     = 'Add image';
    slot.innerHTML = `
      <input type="file" accept="image/*" multiple onchange="handlePortfolioSelect(event)" />
      <span style="font-size:1.4rem;">📷</span>
      <span>Add photo</span>`;
    grid.appendChild(slot);
  }
}

function handlePortfolioSelect(event) {
  const files = Array.from(event.target.files);
  event.target.value = '';
  files.forEach(file => {
    if (portfolioItems.length >= MAX_PORTFOLIO) return;
    try { validateImageFile(file); } catch (e) { showToast(e.message, 'warning'); return; }
    portfolioItems.push({ type: 'file', file, previewUrl: URL.createObjectURL(file) });
  });
  renderPortfolioGrid();
  updateCompletion();
}

function removePortfolioItem(idx) {
  portfolioItems.splice(idx, 1);
  renderPortfolioGrid();
  updateCompletion();
}

async function uploadStagedPortfolioFiles() {
  const staged = portfolioItems.filter(item => item.type === 'file');
  const urls   = portfolioItems.filter(item => item.type === 'url').map(item => item.value);

  if (!staged.length) return urls;

  const progressWrap = document.getElementById('portfolio-upload-progress');
  const bar          = document.getElementById('portfolio-progress-bar');
  progressWrap.classList.add('visible');

  for (let i = 0; i < staged.length; i++) {
    const { file } = staged[i];
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path     = `portfolios/${currentUser.id}/${Date.now()}_${safeName}`;
    try {
      bar.style.width = `${Math.round(((i + 0.5) / staged.length) * 100)}%`;
      const url = await uploadImage(file, 'portfolio-images', path);
      urls.push(url);
      bar.style.width = `${Math.round(((i + 1) / staged.length) * 100)}%`;
    } catch (e) {
      showToast(`Failed to upload ${file.name}: ${e.message}`, 'warning');
    }
  }

  setTimeout(() => {
    progressWrap.classList.remove('visible');
    bar.style.width = '0%';
  }, 800);

  return urls;
}

// ── Profile completion tracker ────────────────────────────────
function updateCompletion() {
  const checks = {
    photo:     !!currentUser.avatar_url,
    bio:       !!(document.getElementById('bio-input').value.trim()),
    category:  !!(document.getElementById('category-select').value),
    areas:     areasServed.length > 0,
    portfolio: portfolioItems.length > 0,
  };

  const done  = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const pct   = Math.round((done / total) * 100);

  document.getElementById('completion-bar').style.width = `${pct}%`;
  document.getElementById('completion-pct').textContent  = `${pct}% complete`;

  // Individual items
  applyCheck('chk-photo',     checks.photo,     'Profile photo');
  applyCheck('chk-bio',       checks.bio,       'Bio / About');
  applyCheck('chk-category',  checks.category,  'Service category');
  applyCheck('chk-areas',     checks.areas,     'Areas served');
  applyCheck('chk-portfolio', checks.portfolio, 'Portfolio images');
}

function applyCheck(itemId, isDone, label) {
  const item = document.getElementById(itemId);
  const icon = document.getElementById(`${itemId}-icon`);
  if (!item || !icon) return;
  item.classList.toggle('done', isDone);
  icon.className   = `check-icon ${isDone ? 'done' : 'pending'}`;
  icon.textContent = isDone ? '✓' : '○';
}

// ── Tiny helpers ──────────────────────────────────────────────
function show(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = '';
}
function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
function setInputVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
function setErr(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}
function clearErr(id) { setErr(id, ''); }

function setBtnLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

function safeParseArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; }
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
