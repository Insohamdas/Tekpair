// ============================================================
// Tekpair – Provider Dashboard (js/pages/provider-dashboard.js)
// Depends on: window.supabase, requireRole(), showToast(),
//             formatDate(), formatPrice(), uploadImage(),
//             validateImageFile(), getStatusColor(), getStatusLabel()
// ============================================================

// ── State ────────────────────────────────────────────────────
let currentUser     = null;
let providerProfile = null;
let allBookings     = [];        // all bookings for this provider
let currentTab      = 'requests';
let rejectTargetId  = null;
let completeTargetId = null;

// Past-jobs pagination
const PAGE_SIZE   = 10;
let pastPage      = 1;

// Complete-modal staged files
const staged = { before: [], after: [] };

// ── Bootstrap ─────────────────────────────────────────────────
(async () => {
  const profile = await requireRole('provider');
  if (!profile) return;
  currentUser = profile;

  await loadProviderProfile();

  // Approval wall
  if (!providerProfile?.is_approved) {
    document.getElementById('pending-wall').classList.add('show');
    return;  // hide the rest of the dashboard
  }

  // Show dashboard
  show('dash-content');
  setWelcome();

  await loadAllBookings();

  hide('dash-skeleton');
  show('stats-row');
  show('dash-tabs');

  renderStats();
  renderBadges();
  renderCurrentTab();

  // Pre-fill availability toggle
  const toggle = document.getElementById('avail-toggle');
  toggle.checked = providerProfile.is_available ?? false;
  syncAvailUI(toggle.checked);

  subscribeToBookings();
})();

// ── Fetch ──────────────────────────────────────────────────────
async function loadProviderProfile() {
  const { data } = await window.supabase
    .from('provider_profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .maybeSingle();
  providerProfile = data;
}

async function loadAllBookings() {
  const { data, error } = await window.supabase
    .from('bookings')
    .select(`
      id, status, scheduled_at, created_at, updated_at,
      estimated_price, final_price,
      address_city, address_area,
      customer_notes, customer_image_urls,
      provider_notes, before_image_urls, after_image_urls,
      cancel_reason,
      customer_id, provider_id, category_id,
      categories ( id, name, icon ),
      customer:profiles!bookings_customer_id_fkey ( id, name, avatar_url )
    `)
    .eq('provider_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    showToast('Failed to load bookings.', 'error');
    console.error(error);
    return;
  }

  allBookings = data ?? [];

  // Fetch reviews for completed bookings
  const completedIds = allBookings.filter(b => b.status === 'completed').map(b => b.id);
  if (completedIds.length) {
    const { data: reviews } = await window.supabase
      .from('reviews')
      .select('booking_id, rating, comment, created_at')
      .in('booking_id', completedIds);
    const reviewMap = {};
    (reviews ?? []).forEach(r => { reviewMap[r.booking_id] = r; });
    allBookings.forEach(b => { if (reviewMap[b.id]) b._review = reviewMap[b.id]; });
  }
}

// ── Welcome greeting ──────────────────────────────────────────
function setWelcome() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  setText('dash-welcome', `${greet}, ${currentUser.name?.split(' ')[0] ?? 'Provider'}!`);
}

// ── Stats ─────────────────────────────────────────────────────
function renderStats() {
  const todayStr = new Date().toDateString();
  const todayJobs = allBookings.filter(b => {
    const d = b.scheduled_at ? new Date(b.scheduled_at).toDateString() : null;
    return d === todayStr && ['confirmed', 'in_progress'].includes(b.status);
  }).length;

  const pending   = allBookings.filter(b => b.status === 'requested').length;
  const completed = allBookings.filter(b => b.status === 'completed').length;

  setText('stat-today',     todayJobs);
  setText('stat-pending',   pending);
  setText('stat-completed', completed);

  if (providerProfile?.rating_avg) {
    const r = Number(providerProfile.rating_avg).toFixed(1);
    setText('stat-rating',     `${r} ★`);
    setText('stat-rating-sub', `from ${providerProfile.total_reviews ?? 0} reviews`);
  } else {
    setText('stat-rating',     '—');
    setText('stat-rating-sub', 'no reviews yet');
  }
}

// ── Tab badge counts ──────────────────────────────────────────
function renderBadges() {
  setText('badge-requests', allBookings.filter(b => b.status === 'requested').length);
  setText('badge-active',   allBookings.filter(b => ['confirmed','in_progress'].includes(b.status)).length);
  setText('badge-past',     allBookings.filter(b => ['completed','cancelled','rejected'].includes(b.status)).length);
}

// ── Tab switching ─────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.dash-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  ['requests', 'active', 'past'].forEach(name => {
    document.getElementById(`panel-${name}`).style.display = name === tab ? '' : 'none';
  });
  if (tab === 'past') { pastPage = 1; renderPastJobs(); }
  else renderCurrentTab();
}

function renderCurrentTab() {
  if (currentTab === 'requests') renderRequests();
  else if (currentTab === 'active') renderActiveJobs();
  else renderPastJobs();
}

// ── NEW REQUESTS tab ──────────────────────────────────────────
function renderRequests() {
  const panel    = document.getElementById('panel-requests');
  const bookings = allBookings.filter(b => b.status === 'requested');
  panel.innerHTML = bookings.length
    ? bookings.map(b => requestCardHTML(b)).join('')
    : emptyState('🎉', 'No new requests', 'New booking requests will appear here.');
}

function requestCardHTML(b) {
  const cust     = b.customer     ?? {};
  const cat      = b.categories   ?? {};
  const images   = safeParseArray(b.customer_image_urls);
  const location = [b.address_area, b.address_city].filter(Boolean).join(', ') || '—';

  return `
  <div class="job-card" id="bk-${b.id}">
    <div class="job-card-header">
      <div class="job-card-customer">
        ${avatarHTML(cust, 42)}
        <div>
          <div class="cust-name">${esc(cust.name ?? 'Customer')}</div>
          <div class="cust-sub">${esc(cat.icon ?? '')} ${esc(cat.name ?? '—')}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:var(--spacing-2);">
        <span class="badge badge-requested">New Request</span>
        <span style="font-size:var(--font-size-xs);color:var(--color-text-muted);">${timeAgo(b.created_at)}</span>
      </div>
    </div>
    <div class="job-card-divider"></div>
    <div class="job-card-body">
      <div class="job-info-grid">
        <div class="job-info-item">
          <div class="job-info-label">Scheduled</div>
          <div class="job-info-value">${b.scheduled_at ? formatDate(b.scheduled_at) : '—'}</div>
        </div>
        <div class="job-info-item">
          <div class="job-info-label">Location</div>
          <div class="job-info-value">📍 ${esc(location)}</div>
        </div>
      </div>
      ${b.customer_notes
        ? `<div class="job-notes-preview">"${esc(truncate(b.customer_notes, 120))}"</div>`
        : ''}
      ${images.length
        ? `<div class="job-thumbs">${images.slice(0, 4).map(url =>
            `<img class="job-thumb" src="${esc(url)}" loading="lazy" />`).join('')}</div>`
        : ''}
    </div>
    <div class="job-card-footer">
      <div class="job-price">
        Estimated: <strong>${b.estimated_price ? formatPrice(b.estimated_price) : 'TBD'}</strong>
      </div>
      <div class="job-actions">
        <button class="btn btn-danger btn-sm"  onclick="openRejectModal('${b.id}')">✕ Reject</button>
        <button class="btn btn-success btn-sm" id="accept-btn-${b.id}" onclick="acceptBooking('${b.id}')">✓ Accept</button>
      </div>
    </div>
    <a href="/booking-detail.html?id=${b.id}" class="btn btn-outline btn-sm"
       style="margin:0 var(--spacing-5) var(--spacing-4);display:inline-block;">View Details →</a>
  </div>`;
}

// ── ACTIVE JOBS tab ───────────────────────────────────────────
function renderActiveJobs() {
  const panel    = document.getElementById('panel-active');
  const bookings = allBookings.filter(b => ['confirmed', 'in_progress'].includes(b.status));
  panel.innerHTML = bookings.length
    ? bookings.map(b => activeCardHTML(b)).join('')
    : emptyState('✅', 'No active jobs', 'Accepted bookings will show up here.');
}

function activeCardHTML(b) {
  const cust     = b.customer   ?? {};
  const cat      = b.categories ?? {};
  const location = [b.address_area, b.address_city].filter(Boolean).join(', ') || '—';

  const actionBtn = b.status === 'confirmed'
    ? `<button class="btn btn-primary btn-sm" id="start-btn-${b.id}" onclick="startJob('${b.id}')">▶ Start Job</button>`
    : `<button class="btn btn-success btn-sm" onclick="openCompleteModal('${b.id}','${b.estimated_price ?? ''}')">✓ Mark Complete</button>`;

  return `
  <div class="job-card" id="bk-${b.id}">
    <div class="job-card-header">
      <div class="job-card-customer">
        ${avatarHTML(cust, 42)}
        <div>
          <div class="cust-name">${esc(cust.name ?? 'Customer')}</div>
          <div class="cust-sub">${esc(cat.icon ?? '')} ${esc(cat.name ?? '—')}</div>
        </div>
      </div>
      <span class="badge ${getStatusColor(b.status)}">${getStatusLabel(b.status)}</span>
    </div>
    <div class="job-card-divider"></div>
    <div class="job-card-body">
      <div class="job-info-grid">
        <div class="job-info-item">
          <div class="job-info-label">Scheduled</div>
          <div class="job-info-value">${b.scheduled_at ? formatDate(b.scheduled_at) : '—'}</div>
        </div>
        <div class="job-info-item">
          <div class="job-info-label">Location</div>
          <div class="job-info-value">📍 ${esc(location)}</div>
        </div>
        ${b.estimated_price ? `
        <div class="job-info-item">
          <div class="job-info-label">Estimated</div>
          <div class="job-info-value">${formatPrice(b.estimated_price)}</div>
        </div>` : ''}
      </div>
      ${b.customer_notes
        ? `<div class="job-notes-preview">"${esc(truncate(b.customer_notes, 100))}"</div>`
        : ''}
    </div>
    <div class="job-card-footer">
      <a href="/booking-detail.html?id=${b.id}" class="btn btn-outline btn-sm">View Details</a>
      <div class="job-actions">${actionBtn}</div>
    </div>
  </div>`;
}

// ── PAST JOBS tab ─────────────────────────────────────────────
function renderPastJobs() {
  const bookings = allBookings.filter(b => ['completed','cancelled','rejected'].includes(b.status));
  const total    = bookings.length;
  const start    = (pastPage - 1) * PAGE_SIZE;
  const slice    = bookings.slice(start, start + PAGE_SIZE);

  const grid = document.getElementById('past-grid');
  grid.innerHTML = slice.length
    ? slice.map(b => pastCardHTML(b)).join('')
    : emptyState('📋', 'No past jobs', 'Your completed and cancelled bookings will appear here.');

  renderPagination(total);
}

function pastCardHTML(b) {
  const cust     = b.customer   ?? {};
  const cat      = b.categories ?? {};
  const location = [b.address_area, b.address_city].filter(Boolean).join(', ') || '—';
  const review   = b._review ?? null;

  return `
  <div class="job-card">
    <div class="job-card-header">
      <div class="job-card-customer">
        ${avatarHTML(cust, 42)}
        <div>
          <div class="cust-name">${esc(cust.name ?? 'Customer')}</div>
          <div class="cust-sub">${esc(cat.icon ?? '')} ${esc(cat.name ?? '—')}</div>
        </div>
      </div>
      <span class="badge ${getStatusColor(b.status)}">${getStatusLabel(b.status)}</span>
    </div>
    <div class="job-card-divider"></div>
    <div class="job-card-body">
      <div class="job-info-grid">
        <div class="job-info-item">
          <div class="job-info-label">Scheduled</div>
          <div class="job-info-value">${b.scheduled_at ? formatDate(b.scheduled_at) : '—'}</div>
        </div>
        <div class="job-info-item">
          <div class="job-info-label">Location</div>
          <div class="job-info-value">📍 ${esc(location)}</div>
        </div>
        ${(b.final_price || b.estimated_price) ? `
        <div class="job-info-item">
          <div class="job-info-label">${b.final_price ? 'Final Price' : 'Estimated'}</div>
          <div class="job-info-value">${formatPrice(b.final_price ?? b.estimated_price)}</div>
        </div>` : ''}
      </div>
      ${b.cancel_reason
        ? `<div class="job-notes-preview" style="border-left-color:var(--color-danger);">
             Reason: ${esc(b.cancel_reason)}</div>`
        : ''}
      ${review ? `
        <div style="margin-top:var(--spacing-1);">
          <div class="review-stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
          ${review.comment ? `<div class="review-comment">"${esc(review.comment)}"</div>` : ''}
        </div>` : ''}
    </div>
    <div style="padding:0 var(--spacing-5) var(--spacing-4);">
      <a href="/booking-detail.html?id=${b.id}" class="btn btn-outline btn-sm">View Details</a>
    </div>
  </div>`;
}

function renderPagination(total) {
  const pages    = Math.ceil(total / PAGE_SIZE);
  const pagEl    = document.getElementById('pagination');
  if (pages <= 1) { pagEl.innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="goPage(${pastPage - 1})" ${pastPage === 1 ? 'disabled' : ''}>‹</button>`;
  for (let p = 1; p <= pages; p++) {
    html += `<button class="page-btn ${p === pastPage ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
  }
  html += `<button class="page-btn" onclick="goPage(${pastPage + 1})" ${pastPage === pages ? 'disabled' : ''}>›</button>`;
  pagEl.innerHTML = html;
}

function goPage(p) {
  pastPage = p;
  renderPastJobs();
  document.getElementById('panel-past').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── ACTIONS ───────────────────────────────────────────────────

// Accept booking
async function acceptBooking(id) {
  const btn = document.getElementById(`accept-btn-${id}`);
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }

  const ok = await updateStatus(id, 'confirmed');
  if (!ok) {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    return;
  }
  showToast('Booking accepted!', 'success');
  refreshBooking(id);
}

// Start job
async function startJob(id) {
  const btn = document.getElementById(`start-btn-${id}`);
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }

  const ok = await updateStatus(id, 'in_progress');
  if (!ok) {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    return;
  }
  showToast('Job started!', 'success');
  refreshBooking(id);
}

// Reject flow
function openRejectModal(id) {
  rejectTargetId = id;
  document.getElementById('reject-reason').value = '';
  document.getElementById('reject-modal').classList.add('open');
}
function closeRejectModal() {
  document.getElementById('reject-modal').classList.remove('open');
  rejectTargetId = null;
}
async function confirmReject() {
  const reason = document.getElementById('reject-reason').value.trim();
  setBtnLoading('reject-confirm-btn', true);
  const ok = await updateStatus(rejectTargetId, 'rejected', reason || null);
  setBtnLoading('reject-confirm-btn', false);
  if (!ok) return;
  closeRejectModal();
  showToast('Booking rejected.', 'info');
  refreshBooking(rejectTargetId);
}

// Complete job flow
function openCompleteModal(id, estimatedPrice) {
  completeTargetId = id;
  staged.before    = [];
  staged.after     = [];
  document.getElementById('before-thumbs').innerHTML = '';
  document.getElementById('after-thumbs').innerHTML  = '';
  document.getElementById('complete-notes').value = '';
  document.getElementById('complete-price').value = estimatedPrice ?? '';
  document.getElementById('complete-progress-wrap').classList.remove('show');
  document.getElementById('complete-progress-bar').style.width = '0%';
  document.getElementById('complete-modal').classList.add('open');
}
function closeCompleteModal() {
  document.getElementById('complete-modal').classList.remove('open');
  completeTargetId = null;
}

async function confirmComplete() {
  const notes      = document.getElementById('complete-notes').value.trim();
  const priceRaw   = document.getElementById('complete-price').value;
  const finalPrice = priceRaw ? parseFloat(priceRaw) : null;

  setBtnLoading('complete-confirm-btn', true);
  document.getElementById('complete-progress-wrap').classList.add('show');

  const beforeUrls = await uploadBatch(staged.before, 'before', 0, 0.5);
  const afterUrls  = await uploadBatch(staged.after,  'after',  0.5, 1.0);

  const extra = {};
  if (notes)           extra.provider_notes    = notes;
  if (finalPrice)      extra.final_price        = finalPrice;
  if (beforeUrls.length) extra.before_image_urls = JSON.stringify(beforeUrls);
  if (afterUrls.length)  extra.after_image_urls  = JSON.stringify(afterUrls);

  const ok = await updateStatus(completeTargetId, 'completed', null, extra);
  setBtnLoading('complete-confirm-btn', false);
  document.getElementById('complete-progress-wrap').classList.remove('show');

  if (!ok) return;
  closeCompleteModal();
  showToast('Job marked as completed!', 'success');
  refreshBooking(completeTargetId);
  renderStats(); // refresh completed count
}

// Drop-zone helpers
function dzDragOver(e, zoneId)  { e.preventDefault(); document.getElementById(zoneId).classList.add('dragover'); }
function dzDragLeave(e, zoneId) { document.getElementById(zoneId).classList.remove('dragover'); }
function dzDrop(e, bucket)      { e.preventDefault(); document.getElementById(`${bucket}-zone`).classList.remove('dragover'); addFiles(Array.from(e.dataTransfer.files), bucket); }
function dzSelect(e, bucket)    { addFiles(Array.from(e.target.files), bucket); e.target.value = ''; }

function addFiles(files, bucket) {
  const thumbsEl = document.getElementById(`${bucket}-thumbs`);
  files.forEach(file => {
    if (staged[bucket].length >= 3) return;
    try { validateImageFile(file); } catch (err) { showToast(err.message, 'warning'); return; }
    staged[bucket].push(file);
    const img = document.createElement('img');
    img.src   = URL.createObjectURL(file);
    img.className = 'mini-thumb';
    thumbsEl.appendChild(img);
  });
}

async function uploadBatch(files, folder, fromFrac, toFrac) {
  const urls = [];
  const bar  = document.getElementById('complete-progress-bar');
  for (let i = 0; i < files.length; i++) {
    const f    = files[i];
    const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `bookings/${completeTargetId}/${folder}/${Date.now()}_${safe}`;
    try {
      if (bar) bar.style.width = `${Math.round((fromFrac + (toFrac - fromFrac) * ((i + 0.5) / files.length)) * 100)}%`;
      const url = await uploadImage(f, 'booking-images', path);
      urls.push(url);
    } catch (err) { showToast(`Upload failed: ${err.message}`, 'warning'); }
  }
  if (bar) bar.style.width = `${Math.round(toFrac * 100)}%`;
  return urls;
}

// Generic status update
async function updateStatus(bookingId, newStatus, note = null, extra = {}) {
  const { error } = await window.supabase
    .from('bookings')
    .update({ status: newStatus, updated_at: new Date().toISOString(), ...extra })
    .eq('id', bookingId);

  if (error) { showToast('Failed: ' + error.message, 'error'); return false; }

  await window.supabase.from('booking_status_history').insert({
    booking_id: bookingId,
    status:     newStatus,
    changed_by: currentUser.id,
    note:       note ?? null,
  });

  // Patch local state
  const idx = allBookings.findIndex(b => b.id === bookingId);
  if (idx !== -1) allBookings[idx] = { ...allBookings[idx], status: newStatus, ...extra };
  return true;
}

// Refresh single booking in current list
function refreshBooking(id) {
  renderBadges();
  renderStats();
  renderCurrentTab();
}

// ── Availability toggle ───────────────────────────────────────
async function handleAvailToggle() {
  const toggle   = document.getElementById('avail-toggle');
  const newValue = toggle.checked;
  syncAvailUI(newValue);

  if (!providerProfile) {
    showToast('Profile not set up yet.', 'warning');
    toggle.checked = !newValue;
    syncAvailUI(!newValue);
    return;
  }

  const { error } = await window.supabase
    .from('provider_profiles')
    .update({ is_available: newValue, updated_at: new Date().toISOString() })
    .eq('user_id', currentUser.id);

  if (error) {
    showToast('Failed to update availability.', 'error');
    toggle.checked = !newValue;
    syncAvailUI(!newValue);
    return;
  }

  providerProfile.is_available = newValue;
  showToast(newValue ? 'You are now available for bookings.' : 'You are now unavailable.', 'success');
}

function syncAvailUI(isOn) {
  const row  = document.getElementById('avail-row');
  row.classList.toggle('available', isOn);
  setText('avail-text', isOn ? 'AVAILABLE' : 'UNAVAILABLE');
}

// ── Realtime subscription ─────────────────────────────────────
function subscribeToBookings() {
  window.supabase
    .channel(`provider-bookings:${currentUser.id}`)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'bookings',
      filter: `provider_id=eq.${currentUser.id}`,
    }, async (payload) => {
      // Fetch full booking with joins
      const { data } = await window.supabase
        .from('bookings')
        .select(`
          id, status, scheduled_at, created_at, updated_at,
          estimated_price, final_price,
          address_city, address_area,
          customer_notes, customer_image_urls,
          provider_notes, before_image_urls, after_image_urls,
          cancel_reason, customer_id, provider_id, category_id,
          categories ( id, name, icon ),
          customer:profiles!bookings_customer_id_fkey ( id, name, avatar_url )
        `)
        .eq('id', payload.new.id)
        .single();

      if (data) {
        allBookings.unshift(data);
        showToast(`🔔 New booking request from ${data.customer?.name ?? 'a customer'}!`, 'info');
        renderStats();
        renderBadges();
        if (currentTab === 'requests') renderRequests();
      }
    })
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'bookings',
      filter: `provider_id=eq.${currentUser.id}`,
    }, (payload) => {
      const idx = allBookings.findIndex(b => b.id === payload.new.id);
      if (idx !== -1) {
        const prev  = allBookings[idx].status;
        allBookings[idx] = { ...allBookings[idx], ...payload.new };
        if (prev !== payload.new.status) {
          showToast(`Booking status updated → ${getStatusLabel(payload.new.status)}`, 'info');
        }
        renderStats();
        renderBadges();
        renderCurrentTab();
      }
    })
    .subscribe();
}

// ── Empty state ───────────────────────────────────────────────
function emptyState(icon, title, desc) {
  return `<div class="empty-state" style="padding:var(--spacing-12) var(--spacing-4);">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${title}</div>
    <p class="empty-state-desc">${desc}</p>
  </div>`;
}

// ── Helpers ────────────────────────────────────────────────────
function avatarHTML(person, size = 42) {
  if (person.avatar_url) {
    return `<img class="cust-avatar" style="width:${size}px;height:${size}px;" src="${esc(person.avatar_url)}" alt="avatar" />`;
  }
  const initials = (person.name ?? 'C').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return `<div class="cust-initials" style="width:${size}px;height:${size}px;">${initials}</div>`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function show(id)             { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hide(id)             { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function setText(id, val)     { const el = document.getElementById(id); if (el) el.textContent = val; }
function setBtnLoading(id, v) { const el = document.getElementById(id); if (!el) return; el.disabled = v; el.classList.toggle('loading', v); }

function safeParseArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; }
}

function truncate(str, max = 80) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
