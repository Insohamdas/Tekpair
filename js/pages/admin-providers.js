// ============================================================
// Tekpair – Admin Providers (js/pages/admin-providers.js)
// Depends on: window.supabase, requireRole(), showToast(),
//             formatDate(), uploadImage≠, validateImageFile≠
// ============================================================

// ── State ─────────────────────────────────────────────────────
let currentAdmin  = null;
let allProviders  = [];      // full enriched list
let currentTab    = 'pending';
let rejectTarget  = null;    // provider_profiles.id
let suspendTarget = null;

// ── Bootstrap ─────────────────────────────────────────────────
(async () => {
  const profile = await requireRole('admin');
  if (!profile) return;
  currentAdmin = profile;
  updateNavUI(profile);
  await loadProviders();
})();

// ── Data loading ──────────────────────────────────────────────
async function loadProviders() {
  // Fetch provider profiles joined with user profile + categories
  const { data: ppRows, error } = await window.supabase
    .from('provider_profiles')
    .select(`
      id, user_id, is_approved, is_available,
      category_id, bio, years_experience, areas_served,
      city, portfolio_urls, rating_avg, total_reviews,
      reject_reason, created_at, updated_at,
      categories ( id, name, icon ),
      user:profiles!provider_profiles_user_id_fkey ( id, name, email, avatar_url, created_at )
    `)
    .order('created_at', { ascending: false });

  hide('providers-skeleton');
  show('providers-grid');

  if (error) {
    showToast('Failed to load providers: ' + error.message, 'error');
    return;
  }

  // Fetch completed booking counts for approved providers
  const approvedIds = (ppRows ?? []).filter(p => p.is_approved).map(p => p.user_id);
  let completedMap = {};
  if (approvedIds.length) {
    const { data: counts } = await window.supabase
      .from('bookings')
      .select('provider_id')
      .in('provider_id', approvedIds)
      .eq('status', 'completed');
    (counts ?? []).forEach(r => {
      completedMap[r.provider_id] = (completedMap[r.provider_id] ?? 0) + 1;
    });
  }

  allProviders = (ppRows ?? []).map(p => ({
    ...p,
    _completedJobs: completedMap[p.user_id] ?? 0,
  }));

  renderBadgeCounts();
  renderCurrentTab();
}

// ── Tab management ────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderCurrentTab();
}

function renderCurrentTab() {
  const query = document.getElementById('provider-search').value.trim().toLowerCase();
  renderGrid(currentTab, query);
}

// ── Badge counts ──────────────────────────────────────────────
function renderBadgeCounts() {
  const pending  = allProviders.filter(p => !p.is_approved && !p.reject_reason).length;
  const approved = allProviders.filter(p =>  p.is_approved).length;
  const rejected = allProviders.filter(p => !p.is_approved &&  p.reject_reason).length;
  setText('cnt-pending',  pending);
  setText('cnt-approved', approved);
  setText('cnt-rejected', rejected);
}

// ── Search handler ────────────────────────────────────────────
function handleSearch(val) {
  renderGrid(currentTab, val.toLowerCase());
}

// ── Render grid ───────────────────────────────────────────────
function renderGrid(tab, query = '') {
  let providers = [];
  if (tab === 'pending')  providers = allProviders.filter(p => !p.is_approved && !p.reject_reason);
  if (tab === 'approved') providers = allProviders.filter(p =>  p.is_approved);
  if (tab === 'rejected') providers = allProviders.filter(p => !p.is_approved &&  p.reject_reason);

  if (query) {
    providers = providers.filter(p => {
      const name = (p.user?.name ?? '').toLowerCase();
      const city = (p.city ?? '').toLowerCase();
      return name.includes(query) || city.includes(query);
    });
  }

  const grid = document.getElementById('providers-grid');
  if (!providers.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">${tab === 'pending' ? '⏳' : tab === 'approved' ? '✅' : '❌'}</div>
      <div class="empty-state-title">No ${tab} providers${query ? ' matching your search' : ''}</div>
      <p class="empty-state-desc">${
        tab === 'pending'
          ? 'New provider sign-ups awaiting your review will appear here.'
          : tab === 'approved'
            ? 'Approved providers will appear here once you review applications.'
            : 'Rejected providers will be listed here.'
      }</p>
    </div>`;
    return;
  }

  grid.innerHTML = providers.map(p => providerCardHTML(p, tab)).join('');
}

// ── Card HTML ─────────────────────────────────────────────────
function providerCardHTML(p, tab) {
  const user     = p.user     ?? {};
  const cat      = p.categories ?? {};
  const portfolio = safeParseArray(p.portfolio_urls);
  const areas     = safeParseArray(p.areas_served);

  const statusBadge = tab === 'pending'
    ? `<span class="badge badge-warning">Pending</span>`
    : tab === 'approved'
      ? `<span class="badge badge-success">Approved</span>`
      : `<span class="badge badge-danger">Rejected</span>`;

  // Avatar
  const avatarHTML = user.avatar_url
    ? `<img class="pc-avatar" src="${esc(user.avatar_url)}" alt="${esc(user.name)}" />`
    : `<div class="pc-initials">${initials(user.name)}</div>`;

  // Meta pills
  const pills = [
    cat.name ? `${esc(cat.icon ?? '')} ${esc(cat.name)}` : null,
    p.years_experience ? `${p.years_experience}yr${p.years_experience > 1 ? 's' : ''} exp` : null,
    p.city ? `📍 ${esc(p.city)}` : null,
  ].filter(Boolean).map(txt => `<span class="pc-pill">${txt}</span>`).join('');

  // Portfolio thumbs
  const thumbsHTML = portfolio.length
    ? `<div class="pc-portfolio">
        ${portfolio.slice(0, 6).map(url =>
          `<img class="pc-portfolio-thumb" src="${esc(url)}" loading="lazy"
               onclick="openLightbox('${esc(url)}')" title="View portfolio image" />`
        ).join('')}
      </div>`
    : '';

  // Approved stats
  const statsHTML = tab === 'approved'
    ? `<div class="pc-stats">
        <div class="pc-stat">
          <div class="pc-stat-val">${p.rating_avg ? Number(p.rating_avg).toFixed(1) + ' ★' : '—'}</div>
          <div class="pc-stat-lbl">Rating</div>
        </div>
        <div class="pc-stat">
          <div class="pc-stat-val">${p.total_reviews ?? 0}</div>
          <div class="pc-stat-lbl">Reviews</div>
        </div>
        <div class="pc-stat">
          <div class="pc-stat-val">${p._completedJobs}</div>
          <div class="pc-stat-lbl">Completed</div>
        </div>
      </div>`
    : '';

  // Reject reason (rejected tab)
  const rejectReasonHTML = (tab === 'rejected' && p.reject_reason)
    ? `<div style="margin:0 var(--spacing-5) var(--spacing-3);font-size:var(--font-size-xs);color:var(--color-danger);background:#FEF2F2;padding:var(--spacing-2) var(--spacing-3);border-radius:var(--radius-md);">
         Reason: ${esc(p.reject_reason)}</div>`
    : '';

  // Footer actions
  let actionsHTML = '';
  if (tab === 'pending') {
    actionsHTML = `
      <button class="btn btn-outline btn-sm" onclick="openRejectModal('${p.id}')">❌ Reject</button>
      <button class="btn btn-success btn-sm" id="approve-btn-${p.id}" onclick="approveProvider('${p.id}')">✅ Approve</button>`;
  } else if (tab === 'approved') {
    actionsHTML = `
      <button class="btn btn-warning btn-sm" onclick="openSuspendModal('${p.id}')">⏸ Suspend</button>`;
  } else {
    actionsHTML = `
      <button class="btn btn-success btn-sm" id="approve-btn-${p.id}" onclick="approveProvider('${p.id}')">✅ Re-Approve</button>`;
  }

  return `
  <div class="provider-card ${tab}" id="pc-${p.id}">
    <div class="pc-head">
      ${avatarHTML}
      <div class="pc-info">
        <div class="pc-name">${esc(user.name ?? 'Unknown')}</div>
        <div class="pc-email">${esc(user.email ?? '—')}</div>
        ${p.city ? `<div class="pc-city">📍 ${esc(p.city)}</div>` : ''}
      </div>
      <div class="pc-status-badge">${statusBadge}</div>
    </div>
    ${pills ? `<div class="pc-meta">${pills}</div>` : ''}
    ${statsHTML}
    ${p.bio
      ? `<div class="pc-bio">${esc(truncate(p.bio, 160))}</div>`
      : ''}
    ${rejectReasonHTML}
    ${thumbsHTML}
    <div class="pc-joined">Joined ${user.created_at ? formatDateShort(user.created_at) : '—'}</div>
    <div class="pc-footer">${actionsHTML}</div>
  </div>`;
}

// ── Approve ───────────────────────────────────────────────────
async function approveProvider(ppId) {
  const btn = document.getElementById(`approve-btn-${ppId}`);
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }

  const { error } = await window.supabase
    .from('provider_profiles')
    .update({ is_approved: true, reject_reason: null, updated_at: new Date().toISOString() })
    .eq('id', ppId);

  if (error) {
    showToast('Failed: ' + error.message, 'error');
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    return;
  }

  const idx = allProviders.findIndex(p => p.id === ppId);
  if (idx !== -1) {
    allProviders[idx].is_approved = true;
    allProviders[idx].reject_reason = null;
  }

  showToast('Provider approved!', 'success');
  renderBadgeCounts();
  renderCurrentTab();
}

// ── Reject flow ───────────────────────────────────────────────
function openRejectModal(ppId) {
  rejectTarget = ppId;
  document.getElementById('reject-reason').value = '';
  document.getElementById('reject-modal').classList.add('open');
}
function closeRejectModal() {
  document.getElementById('reject-modal').classList.remove('open');
  rejectTarget = null;
}
async function confirmReject() {
  const reason = document.getElementById('reject-reason').value.trim() || null;
  setBtnLoading('reject-confirm-btn', true);

  const { error } = await window.supabase
    .from('provider_profiles')
    .update({ is_approved: false, reject_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', rejectTarget);

  setBtnLoading('reject-confirm-btn', false);
  if (error) { showToast('Failed: ' + error.message, 'error'); return; }

  const idx = allProviders.findIndex(p => p.id === rejectTarget);
  if (idx !== -1) {
    allProviders[idx].is_approved  = false;
    allProviders[idx].reject_reason = reason;
  }

  closeRejectModal();
  showToast('Provider rejected.', 'info');
  renderBadgeCounts();
  renderCurrentTab();
}

// ── Suspend flow ──────────────────────────────────────────────
function openSuspendModal(ppId) {
  suspendTarget = ppId;
  document.getElementById('suspend-reason').value = '';
  document.getElementById('suspend-modal').classList.add('open');
}
function closeSuspendModal() {
  document.getElementById('suspend-modal').classList.remove('open');
  suspendTarget = null;
}
async function confirmSuspend() {
  const reason = document.getElementById('suspend-reason').value.trim() || null;
  setBtnLoading('suspend-confirm-btn', true);

  const { error } = await window.supabase
    .from('provider_profiles')
    .update({ is_approved: false, reject_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', suspendTarget);

  setBtnLoading('suspend-confirm-btn', false);
  if (error) { showToast('Failed: ' + error.message, 'error'); return; }

  const idx = allProviders.findIndex(p => p.id === suspendTarget);
  if (idx !== -1) {
    allProviders[idx].is_approved   = false;
    allProviders[idx].reject_reason = reason;
  }

  closeSuspendModal();
  showToast('Provider suspended.', 'info');
  renderBadgeCounts();
  renderCurrentTab();
}

// ── Portfolio lightbox ────────────────────────────────────────
function openLightbox(url) {
  document.getElementById('lightbox-img').src = url;
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLightbox(e) {
  if (e && e.target !== document.getElementById('lightbox') &&
      e.target !== document.getElementById('lightbox-close')) return;
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightbox-img').src = '';
  document.body.style.overflow = '';
}

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeLightbox();
    closeRejectModal();
    closeSuspendModal();
  }
});

// ── Helpers ────────────────────────────────────────────────────
function formatDateShort(str) {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function truncate(str, max = 80) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function safeParseArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; }
}

function show(id)     { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hide(id)     { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = String(val); }
function setBtnLoading(id, v) { const el = document.getElementById(id); if (!el) return; el.disabled = v; el.classList.toggle('loading', v); }

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
