// ============================================================
// Tekpair – Provider Job Detail Page
// /provider/job-detail.html?id=BOOKING_ID
// ============================================================

// ── State ─────────────────────────────────────────────────
let _booking     = null;
let _profile     = null;
let _bookingId   = null;
const _newFiles  = { before: [], after: [] };
const _existingImages = { before: [], after: [] };
let _realtimeSub = null;

// ── Valid provider status transitions ─────────────────────
const STATUS_TRANSITIONS = {
  requested:   [{ status: 'confirmed',   label: '✓ Confirm Job',    cls: 'btn-success' },
                { status: 'rejected',    label: '✕ Reject',         cls: 'btn-danger', fn: 'openRejectModal' }],
  confirmed:   [{ status: 'in_progress', label: '▶ Start Job',      cls: 'btn-primary' }],
  in_progress: [{ status: 'completed',   label: '✔ Mark Completed', cls: 'btn-success' }],
  completed:   [],
  rejected:    [],
  cancelled:   [],
};

// ── Init ───────────────────────────────────────────────────
(async () => {
  const params = new URLSearchParams(location.search);
  _bookingId = params.get('id');

  if (!_bookingId) return showError('Missing booking ID', 'No job ID was provided in the URL.');

  _profile = await requireRole('provider');
  if (!_profile) return;

  await loadJob();
})();

// ── Load / reload booking ──────────────────────────────────
async function loadJob() {
  const { data, error } = await window.supabase
    .from('bookings')
    .select(`
      *,
      customer:profiles!bookings_customer_id_fkey (id, name, email, phone, avatar_url),
      service_category:service_categories (name),
      provider:profiles!bookings_provider_id_fkey (id, name, avatar_url)
    `)
    .eq('id', _bookingId)
    .single();

  if (error || !data) return showError('Job not found', 'This booking could not be loaded.');
  if (data.provider_id !== _profile.id) return showError('Access Denied', 'This job belongs to a different provider.');

  _booking = data;
  renderAll();
  subscribeRealtime();
}

// ── Render all ─────────────────────────────────────────────
function renderAll() {
  const b = _booking;

  // Show content
  document.getElementById('page-skeleton').style.display = 'none';
  document.getElementById('page-content').style.display  = '';
  document.getElementById('page-error').style.display    = 'none';

  // Breadcrumb + header
  document.getElementById('bc-booking-id').textContent = `#${b.id.slice(0, 8).toUpperCase()}`;
  document.getElementById('hdr-booking-id').textContent = `Job #${b.id.slice(0, 8).toUpperCase()}`;
  document.getElementById('hdr-status-badge').innerHTML = `<span class="badge ${getStatusColor(b.status)}">${getStatusLabel(b.status)}</span>`;
  document.getElementById('hdr-created-date').textContent = `Booked ${formatDate(b.created_at)}`;

  // Action bar
  document.getElementById('action-bar-title').textContent = `Job #${b.id.slice(0, 8).toUpperCase()}`;
  document.getElementById('action-bar-status').innerHTML  = `<span class="badge ${getStatusColor(b.status)}">${getStatusLabel(b.status)}</span>`;
  renderActionButtons();

  // Customer info
  const cust = b.customer ?? {};
  const initials = encodeURIComponent(cust.name ?? 'C');
  document.getElementById('cust-avatar').src     = cust.avatar_url ?? `https://api.dicebear.com/7.x/initials/svg?seed=${initials}`;
  document.getElementById('cust-name').textContent  = cust.name  ?? '—';
  document.getElementById('cust-phone').textContent = cust.phone ?? 'No phone on file';
  document.getElementById('cust-email').textContent = cust.email ?? '—';
  const callBtn = document.getElementById('cust-call-btn');
  if (cust.phone) {
    callBtn.href = `tel:${cust.phone}`;
    callBtn.style.display = '';
  } else {
    callBtn.style.display = 'none';
  }

  // Service details
  document.getElementById('cust-address').textContent    = b.address ?? '—';
  document.getElementById('svc-scheduled').textContent   = b.scheduled_at ? formatDate(b.scheduled_at) : '—';
  document.getElementById('svc-duration').textContent    = b.duration_hours ? `${b.duration_hours} hour(s)` : '—';
  document.getElementById('svc-category').textContent    = b.service_category?.name ?? '—';
  document.getElementById('svc-booked-on').textContent   = formatDate(b.created_at);

  // Customer notes & images
  document.getElementById('cust-notes').textContent = b.customer_notes ?? 'No notes provided.';
  renderGallery('cust-images', b.customer_images ?? []);

  // Provider notes textarea
  document.getElementById('notes-input').value = b.provider_notes ?? '';

  // Photos card visibility: show for in_progress / completed
  const showPhotos = ['in_progress', 'completed'].includes(b.status);
  document.getElementById('photos-card').style.display = showPhotos ? '' : 'none';
  if (showPhotos) {
    _existingImages.before = b.before_images ?? [];
    _existingImages.after  = b.after_images  ?? [];
    renderExistingThumbs('before', _existingImages.before);
    renderExistingThumbs('after',  _existingImages.after);
  }

  // Pricing
  renderPricing();

  // Set-price row: show when not completed / rejected
  document.getElementById('set-price-row').style.display = ['completed','rejected','cancelled'].includes(b.status) ? 'none' : '';
  if (b.final_price) document.getElementById('final-price-input').value = b.final_price;

  // Status history
  renderHistory();

  // Sidebar summary
  document.getElementById('sidebar-status-badge').innerHTML = `<span class="badge ${getStatusColor(b.status)}">${getStatusLabel(b.status)}</span>`;
  document.getElementById('sidebar-est-price').textContent  = b.estimated_price ? formatPrice(b.estimated_price) : '—';
  document.getElementById('sidebar-final-price').textContent = b.final_price ? formatPrice(b.final_price) : 'Not set yet';
  document.getElementById('sidebar-scheduled').textContent  = b.scheduled_at ? formatDate(b.scheduled_at) : '—';

  // Reject card: only for requested
  document.getElementById('reject-card').style.display = b.status === 'requested' ? '' : 'none';

  // Reschedule banner
  renderRescheduleBanner();

  // Sidebar quick-actions
  renderSidebarActions();
}

// ── Action buttons ─────────────────────────────────────────
function renderActionButtons() {
  const transitions = STATUS_TRANSITIONS[_booking.status] ?? [];
  const bar = document.getElementById('action-bar-btns');
  bar.innerHTML = transitions
    .filter(t => !t.fn) // exclude modal-openers from bar (too destructive)
    .map(t => `<button class="btn ${t.cls} btn-sm" onclick="updateStatus('${t.status}')">${t.label}</button>`)
    .join('');
}

function renderSidebarActions() {
  const transitions = STATUS_TRANSITIONS[_booking.status] ?? [];
  const container = document.getElementById('sidebar-actions');

  if (!transitions.length) {
    container.innerHTML = `<p style="font-size:var(--font-size-sm);color:var(--color-text-muted);">No actions available for this status.</p>`;
    return;
  }

  container.innerHTML = transitions.map(t => {
    const onclick = t.fn ? `${t.fn}()` : `updateStatus('${t.status}')`;
    return `<button class="btn ${t.cls} sidebar-action-btn" onclick="${onclick}">${t.label}</button>`;
  }).join('');
}

// ── Status update ──────────────────────────────────────────
async function updateStatus(newStatus) {
  const updates = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  if (newStatus === 'in_progress') {
    updates.started_at  = new Date().toISOString();
  }
  if (newStatus === 'completed') {
    updates.completed_at = new Date().toISOString();
    // Apply final price if entered
    const fp = parseFloat(document.getElementById('final-price-input').value);
    if (!isNaN(fp) && fp > 0) updates.final_price = fp;
  }
  if (newStatus === 'confirmed') {
    updates.confirmed_at = new Date().toISOString();
  }

  const { error } = await window.supabase
    .from('bookings')
    .update(updates)
    .eq('id', _bookingId);

  if (error) { showToast(error.message, 'error'); return; }

  _booking = { ..._booking, ...updates };
  logHistoryLocal(newStatus);
  renderAll();
  showToast(`Status updated to "${getStatusLabel(newStatus)}"`, 'success');
}

// ── Save notes ─────────────────────────────────────────────
async function saveNotes() {
  const btn   = document.getElementById('notes-save-btn');
  const notes = document.getElementById('notes-input').value.trim();
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const { error } = await window.supabase
    .from('bookings')
    .update({ provider_notes: notes, updated_at: new Date().toISOString() })
    .eq('id', _bookingId);

  btn.disabled = false;
  btn.textContent = 'Save Notes';

  if (error) { showToast(error.message, 'error'); return; }
  _booking.provider_notes = notes;

  const hint = document.getElementById('notes-saved-hint');
  hint.style.display = '';
  setTimeout(() => { hint.style.display = 'none'; }, 2500);
  showToast('Notes saved.', 'success');
}

// ── Save final price ───────────────────────────────────────
async function saveFinalPrice() {
  const raw = parseFloat(document.getElementById('final-price-input').value);
  if (isNaN(raw) || raw < 0) { showToast('Enter a valid price.', 'warning'); return; }

  const { error } = await window.supabase
    .from('bookings')
    .update({ final_price: raw, updated_at: new Date().toISOString() })
    .eq('id', _bookingId);

  if (error) { showToast(error.message, 'error'); return; }
  _booking.final_price = raw;
  document.getElementById('sidebar-final-price').textContent = formatPrice(raw);
  renderPricing();
  showToast('Final price updated.', 'success');
}

// ── Photo upload ───────────────────────────────────────────
function handleDragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.add('dragover');
}
function handleDragLeave(e, zoneId) {
  document.getElementById(zoneId).classList.remove('dragover');
}
function handleDrop(e, type) {
  e.preventDefault();
  document.getElementById(`${type}-drop`).classList.remove('dragover');
  addFiles(type, Array.from(e.dataTransfer.files));
}
function handleFileSelect(e, type) {
  addFiles(type, Array.from(e.target.files));
}

function addFiles(type, files) {
  const MAX = 3;
  const existing = _existingImages[type].length;
  const pending  = _newFiles[type].length;
  const slots = MAX - existing - pending;

  if (slots <= 0) { showToast(`Max ${MAX} ${type} images.`, 'warning'); return; }

  const valid = files.filter(f => {
    try { validateImageFile(f); return true; }
    catch(e) { showToast(e.message, 'error'); return false; }
  }).slice(0, slots);

  _newFiles[type].push(...valid);
  renderNewThumbs(type);
}

function renderExistingThumbs(type, urls) {
  const container = document.getElementById(`${type}-thumbs`);
  container.innerHTML = '';
  urls.forEach((url, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb-wrap';
    wrap.innerHTML = `
      <img class="photo-thumb" src="${url}" alt="${type} ${i+1}" onclick="openLightbox('${url}')" />
      <button class="photo-thumb-remove" title="Remove" onclick="removeExisting('${type}', ${i})">×</button>`;
    container.appendChild(wrap);
  });
}

function renderNewThumbs(type) {
  setTimeout(() => {
    const container = document.getElementById(`${type}-thumbs`);
    // Keep existing thumbs & append new
    const existingCount = _existingImages[type].length;
    // Remove only new-file thumbs (beyond existing)
    const all = container.querySelectorAll('.photo-thumb-wrap');
    all.forEach((el, i) => { if (i >= existingCount) el.remove(); });

    _newFiles[type].forEach((file, i) => {
      const url  = URL.createObjectURL(file);
      const wrap = document.createElement('div');
      wrap.className = 'photo-thumb-wrap new-thumb';
      wrap.innerHTML = `
        <img class="photo-thumb" src="${url}" alt="new ${i}" onclick="openLightbox('${url}')" />
        <button class="photo-thumb-remove" title="Remove" onclick="removeNew('${type}', ${i})">×</button>`;
      container.appendChild(wrap);
    });
  }, 0);
}

function removeExisting(type, idx) {
  _existingImages[type].splice(idx, 1);
  renderExistingThumbs(type, _existingImages[type]);
}
function removeNew(type, idx) {
  _newFiles[type].splice(idx, 1);
  renderNewThumbs(type);
}

async function savePhotos() {
  const btn = document.getElementById('photos-save-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Uploading…';

  const bar = document.getElementById('photo-upload-progress');
  const progress = document.getElementById('photo-progress-bar');
  bar.style.display = '';

  const types  = ['before', 'after'];
  const allNew = types.flatMap(t => _newFiles[t].map(f => ({ type: t, file: f })));
  let done = 0;

  const uploadedUrls = { before: [..._existingImages.before], after: [..._existingImages.after] };

  for (const { type, file } of allNew) {
    try {
      const path = makeStoragePath(`bookings/${_bookingId}/${type}`, file.name);
      const url  = await uploadImage(file, 'work-images', path);
      uploadedUrls[type].push(url);
    } catch(e) {
      showToast(`Upload failed: ${e.message}`, 'error');
    }
    done++;
    progress.style.width = `${Math.round((done / Math.max(allNew.length, 1)) * 100)}%`;
  }

  const updates = {
    before_images: uploadedUrls.before,
    after_images:  uploadedUrls.after,
    updated_at: new Date().toISOString(),
  };

  const { error } = await window.supabase
    .from('bookings')
    .update(updates)
    .eq('id', _bookingId);

  bar.style.display = 'none';
  progress.style.width = '0%';
  btn.disabled = false;
  btn.textContent = '💾 Save Photos';

  if (error) { showToast(error.message, 'error'); return; }

  _booking.before_images = uploadedUrls.before;
  _booking.after_images  = uploadedUrls.after;
  _existingImages.before = [...uploadedUrls.before];
  _existingImages.after  = [...uploadedUrls.after];
  _newFiles.before = [];
  _newFiles.after  = [];

  renderExistingThumbs('before', _existingImages.before);
  renderExistingThumbs('after',  _existingImages.after);
  showToast('Photos saved.', 'success');
}

// ── Reject ─────────────────────────────────────────────────
function openRejectModal()  { document.getElementById('reject-modal').classList.add('open'); }
function closeRejectModal() { document.getElementById('reject-modal').classList.remove('open'); }

async function confirmReject() {
  const reason = document.getElementById('reject-reason').value.trim();
  const btn    = document.getElementById('reject-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Rejecting…';

  const updates = {
    status: 'rejected',
    rejection_reason: reason || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await window.supabase
    .from('bookings')
    .update(updates)
    .eq('id', _bookingId);

  btn.disabled = false;
  btn.textContent = 'Reject Booking';

  if (error) { showToast(error.message, 'error'); return; }
  closeRejectModal();
  _booking = { ..._booking, ...updates };
  renderAll();
  showToast('Booking rejected.', 'success');
}

// ── Reschedule response ─────────────────────────────────────
async function respondReschedule(decision) {
  const updates = {
    reschedule_status: decision,
    updated_at: new Date().toISOString(),
  };
  if (decision === 'accepted' && _booking.reschedule_requested_at) {
    updates.scheduled_at = _booking.reschedule_proposed_time;
  }

  const { error } = await window.supabase
    .from('bookings')
    .update(updates)
    .eq('id', _bookingId);

  if (error) { showToast(error.message, 'error'); return; }
  _booking = { ..._booking, ...updates };
  renderAll();
  showToast(`Reschedule ${decision}.`, decision === 'accepted' ? 'success' : 'info');
}

// ── Pricing render ─────────────────────────────────────────
function renderPricing() {
  const b = _booking;
  const rows = [];
  if (b.estimated_price) rows.push({ label: 'Estimated Price', value: formatPrice(b.estimated_price) });
  if (b.final_price)     rows.push({ label: 'Final Price',     value: formatPrice(b.final_price),    total: true });
  if (!rows.length) rows.push({ label: 'Price', value: 'TBD' });

  document.getElementById('pricing-rows').innerHTML = rows.map(r => `
    <div class="price-row ${r.total ? 'total' : ''}">
      <span class="price-row-label">${r.label}</span>
      <span class="price-row-value">${r.value}</span>
    </div>`).join('');
}

// ── Existing photos gallery ────────────────────────────────
function renderGallery(containerId, urls) {
  const c = document.getElementById(containerId);
  if (!urls || !urls.length) { c.innerHTML = `<span style="font-size:var(--font-size-sm);color:var(--color-text-muted);">No images.</span>`; return; }
  c.innerHTML = urls.map(url => `<img class="gallery-img" src="${url}" alt="" onclick="openLightbox('${url}')" loading="lazy" />`).join('');
}

// ── History ────────────────────────────────────────────────
function renderHistory() {
  const b = _booking;
  const entries = [];
  const push = (label, ts) => { if (ts) entries.push({ label, ts }); };

  push('Booking requested',    b.created_at);
  push('Booking confirmed',    b.confirmed_at);
  push('Job started',          b.started_at);
  push('Job completed',        b.completed_at);
  push('Booking rejected',     b.status === 'rejected' ? b.updated_at : null);
  push('Booking cancelled',    b.status === 'cancelled' ? b.updated_at : null);

  entries.sort((a, b) => new Date(a.ts) - new Date(b.ts));

  const container = document.getElementById('history-log');
  if (!entries.length) {
    container.innerHTML = `<span style="font-size:var(--font-size-sm);color:var(--color-text-muted);">No history yet.</span>`;
    return;
  }
  container.innerHTML = entries.map(e => `
    <div class="history-entry">
      <div class="history-dot"></div>
      <div>
        <div class="history-text">${e.label}</div>
        <div class="history-time">${formatDate(e.ts)}</div>
      </div>
    </div>`).join('');
}

function logHistoryLocal(status) {
  const now = new Date().toISOString();
  if (status === 'confirmed')    _booking.confirmed_at  = now;
  if (status === 'in_progress')  _booking.started_at    = now;
  if (status === 'completed')    _booking.completed_at  = now;
}

// ── Reschedule banner ──────────────────────────────────────
function renderRescheduleBanner() {
  const b = _booking;
  const banner = document.getElementById('reschedule-banner');
  if (b.reschedule_status === 'pending' && b.reschedule_proposed_time) {
    document.getElementById('reschedule-proposed-time').textContent = formatDate(b.reschedule_proposed_time);
    banner.style.display = '';
  } else {
    banner.style.display = 'none';
  }
}

// ── Lightbox ───────────────────────────────────────────────
function openLightbox(url) {
  document.getElementById('lightbox-img').src = url;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

// ── Error state ────────────────────────────────────────────
function showError(title, desc) {
  document.getElementById('page-skeleton').style.display = 'none';
  document.getElementById('page-content').style.display  = 'none';
  document.getElementById('page-error').style.display    = '';
  document.getElementById('err-title').textContent = title;
  document.getElementById('err-desc').textContent  = desc;
}

// ── Realtime subscription ──────────────────────────────────
function subscribeRealtime() {
  if (_realtimeSub) _realtimeSub.unsubscribe();
  _realtimeSub = window.supabase
    .channel(`job-detail-${_bookingId}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'bookings',
      filter: `id=eq.${_bookingId}`,
    }, payload => {
      _booking = { ..._booking, ...payload.new };
      renderAll();
    })
    .subscribe();
}
