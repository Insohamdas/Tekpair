// ============================================================
// Tekpair – Booking Detail Page  (js/pages/booking-detail.js)
// Depends on: window.supabase, requireAuth(), showToast(),
//             formatDate(), formatPrice(), uploadImage(),
//             validateImageFile(), getStatusColor(), getStatusLabel()
// ============================================================

// ── State ────────────────────────────────────────────────────
let booking       = null;
let currentUser   = null;
let viewerRole    = null;   // 'customer' | 'provider' | 'admin'
let existingReview = null;

// Complete-job file staging
const staged = { before: [], after: [] };

// Lightbox
let lightboxImages = [];
let lightboxIndex  = 0;

// ── Timeline step definitions ─────────────────────────────────
const STEPS = [
  { key: 'requested',   label: 'Requested'   },
  { key: 'confirmed',   label: 'Confirmed'   },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed',   label: 'Completed'   },
];
const STATUS_ORDER = ['requested', 'confirmed', 'in_progress', 'completed'];

// ── Bootstrap ─────────────────────────────────────────────────
(async () => {
  const sessionUser = await requireAuth();
  if (!sessionUser) return;

  // Get full profile (with role) — auth.js exposes getUserProfile()
  const profile = await getUserProfile(sessionUser.id);
  if (!profile) { showAccessDenied('Could not load your profile.'); return; }
  currentUser = profile;

  const params    = new URLSearchParams(window.location.search);
  const bookingId = params.get('id');

  if (!bookingId) { showAccessDenied('No booking ID provided.'); return; }

  await loadBooking(bookingId);
})();

// ── Fetch ──────────────────────────────────────────────────────
async function loadBooking(bookingId) {
  const [bookingRes, historyRes] = await Promise.all([
    window.supabase
      .from('bookings')
      .select(`
        *,
        categories ( id, name, icon ),
        provider:profiles!bookings_provider_id_fkey ( id, name, avatar_url, phone ),
        customer:profiles!bookings_customer_id_fkey ( id, name, avatar_url ),
        provider_profile:provider_profiles!provider_profiles_user_id_fkey (
          rating_avg, total_reviews, is_verified, years_experience
        )
      `)
      .eq('id', bookingId)
      .single(),
    window.supabase
      .from('booking_status_history')
      .select(`
        id, status, note, created_at,
        changer:profiles!booking_status_history_changed_by_fkey ( id, name, role )
      `)
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true }),
  ]);

  if (bookingRes.error || !bookingRes.data) {
    showAccessDenied('Booking not found.');
    return;
  }

  booking = bookingRes.data;

  // ── Access control ──────────────────────────────────────────
  if (currentUser.role === 'customer' && booking.customer_id !== currentUser.id) {
    showAccessDenied(); return;
  }
  if (currentUser.role === 'provider' && booking.provider_id !== currentUser.id) {
    showAccessDenied(); return;
  }
  viewerRole = currentUser.role;

  // ── Check for existing review ────────────────────────────────
  if (booking.status === 'completed') {
    const { data: rev } = await window.supabase
      .from('reviews')
      .select('*')
      .eq('booking_id', bookingId)
      .maybeSingle();
    existingReview = rev;
  }

  // ── Render all sections ──────────────────────────────────────
  renderPage(historyRes.data ?? []);
  subscribeToChanges(bookingId);
}

// ── Main render ───────────────────────────────────────────────
function renderPage(history) {
  hide('page-skeleton');
  show('page-content');

  renderHeader();
  renderTimeline();
  renderHistory(history);
  renderServiceDetails();
  renderCustomerContent();
  renderProviderContent();
  renderPricing();
  renderReschedule();
  renderProviderSidebar();
  renderReviewSection();
  renderActionPanel();
  updateBreadcrumb();
}

// ── Header ────────────────────────────────────────────────────
function renderHeader() {
  const shortId = booking.id.slice(0, 8).toUpperCase();
  setText('hdr-booking-id', `Booking #${shortId}`);
  document.getElementById('bc-booking-id').textContent = `#${shortId}`;
  document.getElementById('hdr-status-badge').outerHTML =
    `<span id="hdr-status-badge" class="badge ${getStatusColor(booking.status)}">${getStatusLabel(booking.status)}</span>`;
  setText('hdr-created-date', `Created ${formatDate(booking.created_at)}`);
  setText('hdr-role-tag', capitalize(viewerRole));
}

// ── Timeline ──────────────────────────────────────────────────
function renderTimeline() {
  const el = document.getElementById('status-timeline');
  const isCancelled = ['cancelled', 'rejected'].includes(booking.status);
  const currentIdx  = STATUS_ORDER.indexOf(booking.status);

  const stepsHtml = STEPS.map((step, i) => {
    let cls = '';
    if (isCancelled) {
      cls = i === 0 ? 'done' : '';
    } else {
      if (i < currentIdx) cls = 'done';
      else if (i === currentIdx) cls = 'active';
    }
    return `
    <div class="dt-step ${cls}">
      <div class="dt-dot">${cls === 'done' ? '✓' : i + 1}</div>
      <div class="dt-label">${step.label}</div>
    </div>`;
  }).join('');

  const cancelStep = isCancelled
    ? `<div class="dt-step ${booking.status}" style="flex:0 0 80px;min-width:72px;">
         <div class="dt-dot">✕</div>
         <div class="dt-label" style="color:var(--color-danger);">${booking.status === 'rejected' ? 'Rejected' : 'Cancelled'}</div>
       </div>`
    : '';

  el.innerHTML = stepsHtml + cancelStep;
}

// ── History log ───────────────────────────────────────────────
function renderHistory(history) {
  const el = document.getElementById('history-log');
  if (!history.length) {
    el.innerHTML = `<p class="text-secondary text-sm">No history recorded yet.</p>`;
    return;
  }

  const HISTORY_COLORS = {
    requested:   '#3B82F6', confirmed: '#16A34A', in_progress: '#F59E0B',
    completed:   '#16A34A', cancelled: '#DC2626',  rejected:    '#DC2626',
  };

  el.innerHTML = history.map((entry, idx) => {
    const color   = HISTORY_COLORS[entry.status] ?? 'var(--color-border-dark)';
    const who     = entry.changer?.name ?? 'System';
    const isLast  = idx === history.length - 1;
    return `
    <div class="history-entry">
      <div class="history-icon-col">
        <div class="history-dot" style="background:${color};border-color:${color};color:#fff;">✓</div>
        ${!isLast ? `<div class="history-line"></div>` : ''}
      </div>
      <div class="history-content">
        <div class="history-content-top">
          <span class="badge ${getStatusColor(entry.status)}" style="font-size:0.6rem;">${getStatusLabel(entry.status)}</span>
          <span class="history-who">by ${esc(who)}</span>
        </div>
        <div class="history-time">${formatDate(entry.created_at)}</div>
        ${entry.note ? `<div class="history-note">${esc(entry.note)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Service details ───────────────────────────────────────────
function renderServiceDetails() {
  const cat      = booking.categories ?? {};
  const provider = booking.provider    ?? {};

  setText('svc-category',  `${cat.icon ?? ''} ${cat.name ?? '—'}`);

  const link = document.getElementById('svc-provider-link');
  link.textContent = provider.name ?? '—';
  link.href = `/provider/profile.html?id=${provider.id ?? ''}`;

  setText('svc-scheduled', booking.scheduled_at ? formatDate(booking.scheduled_at) : '—');
  setText('svc-duration',  booking.estimated_duration_hours
    ? `${booking.estimated_duration_hours} hr${booking.estimated_duration_hours !== 1 ? 's' : ''}`
    : '—');

  const addrParts = [
    booking.address_line1,
    booking.address_line2,
    booking.address_area,
    booking.address_city,
    booking.address_state,
    booking.address_pincode,
  ].filter(Boolean);
  setText('svc-address', addrParts.length ? addrParts.join(', ') : '—');
}

// ── Customer notes + images ───────────────────────────────────
function renderCustomerContent() {
  const notes  = booking.customer_notes;
  const images = safeParseArray(booking.customer_image_urls);

  setText('cust-notes', notes || 'No notes provided.');

  const galleryEl = document.getElementById('cust-images');
  if (images.length) {
    galleryEl.innerHTML = images.map((url, i) =>
      `<img class="gallery-thumb" src="${esc(url)}" loading="lazy"
           onclick="openLightbox(${JSON.stringify(images)}, ${i})" />`
    ).join('');
  } else {
    galleryEl.innerHTML = `<p class="text-secondary text-sm">No images uploaded.</p>`;
  }
}

// ── Provider notes + before/after images ─────────────────────
function renderProviderContent() {
  const notes  = booking.provider_notes;
  const before = safeParseArray(booking.before_image_urls);
  const after  = safeParseArray(booking.after_image_urls);

  if (!notes && !before.length && !after.length) {
    hide('provider-content-card');
    return;
  }

  show('provider-content-card');
  setText('prov-notes', notes || '');

  if (before.length) {
    show('before-img-section');
    document.getElementById('before-images').innerHTML = before.map((url, i) =>
      `<img class="gallery-thumb" src="${esc(url)}" loading="lazy"
           onclick="openLightbox(${JSON.stringify(before)}, ${i})" />`
    ).join('');
  }
  if (after.length) {
    show('after-img-section');
    document.getElementById('after-images').innerHTML = after.map((url, i) =>
      `<img class="gallery-thumb" src="${esc(url)}" loading="lazy"
           onclick="openLightbox(${JSON.stringify(after)}, ${i})" />`
    ).join('');
  }
}

// ── Pricing ───────────────────────────────────────────────────
function renderPricing() {
  const est    = booking.estimated_price;
  const final  = booking.final_price;
  let html     = '';

  if (est) {
    html += priceRow('Estimated Price', formatPrice(est), false);
  }
  if (final) {
    html += priceRow('Final Price', formatPrice(final), true);
  }
  if (!est && !final) {
    html = `<p class="text-secondary text-sm">Pricing to be confirmed by provider.</p>`;
  }

  document.getElementById('pricing-rows').innerHTML = html;
}
function priceRow(label, value, isFinal) {
  return `<div class="price-row">
    <span class="price-row-label">${label}</span>
    <span class="price-row-value ${isFinal ? 'final' : ''}">${value}</span>
  </div>`;
}

// ── Reschedule banner ─────────────────────────────────────────
function renderReschedule() {
  if (booking.reschedule_status !== 'pending') return;

  show('reschedule-banner');
  const proposed = booking.reschedule_proposed_time;
  setText('reschedule-proposed-time', proposed ? formatDate(proposed) : '—');

  if (viewerRole === 'provider') {
    show('reschedule-review-actions');
  } else {
    show('reschedule-awaiting-msg');
  }
}

// ── Provider sidebar mini-card ────────────────────────────────
function renderProviderSidebar() {
  const provider = booking.provider        ?? {};
  const pp       = booking.provider_profile ?? {};

  // Avatar
  const container = document.getElementById('provider-avatar-container');
  if (provider.avatar_url) {
    container.innerHTML = `<img src="${esc(provider.avatar_url)}" class="provider-mini-avatar" alt="avatar" />`;
  } else {
    const initials = (provider.name ?? 'P').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    container.innerHTML = `<div class="provider-mini-initials">${initials}</div>`;
  }

  setText('sidebar-provider-name', provider.name ?? '—');

  if (pp.rating_avg) {
    const stars = '★'.repeat(Math.round(pp.rating_avg)) + '☆'.repeat(5 - Math.round(pp.rating_avg));
    document.getElementById('sidebar-provider-rating').innerHTML =
      `<span style="color:#F59E0B;">${stars}</span> <span>${Number(pp.rating_avg).toFixed(1)}</span> (${pp.total_reviews ?? 0} reviews)`;
  }

  if (pp.is_verified) {
    show('verified-tag');
  }

  // Show phone after booking confirmed
  const statusShowPhone = ['confirmed', 'in_progress', 'completed'];
  if (provider.phone && statusShowPhone.includes(booking.status)) {
    show('phone-section');
    setText('contact-phone-number', provider.phone);
    document.getElementById('contact-tel-link').href = `tel:${provider.phone}`;
  }
}

// ── Review section ────────────────────────────────────────────
function renderReviewSection() {
  if (booking.status !== 'completed') return;

  show('review-section');

  if (existingReview) {
    renderReviewDisplay(existingReview);
  } else if (viewerRole === 'customer') {
    show('review-form');
  } else {
    document.getElementById('review-section').querySelector('.detail-card-title').insertAdjacentHTML(
      'afterend',
      `<p class="text-secondary text-sm">No review submitted yet.</p>`
    );
  }
}

function renderReviewDisplay(review) {
  const starsOn  = '★'.repeat(review.rating);
  const starsOff = '☆'.repeat(5 - review.rating);
  document.getElementById('review-display').innerHTML = `
    <div class="review-stars">${starsOn}<span style="color:var(--color-border-dark);">${starsOff}</span></div>
    ${review.comment ? `<div class="review-comment">"${esc(review.comment)}"</div>` : ''}
    <div class="review-meta">Reviewed ${formatDate(review.created_at)}</div>`;
  show('review-display');
}

// ── Action panel ──────────────────────────────────────────────
function renderActionPanel() {
  const panel   = document.getElementById('action-panel');
  const buttons = actionButtonsHTML();
  if (!buttons) return;
  show('action-panel');
  document.getElementById('action-buttons').innerHTML = buttons;
}

function actionButtonsHTML() {
  const s = booking.status;

  if (viewerRole === 'customer') {
    const cancellable = ['requested', 'confirmed'].includes(s);
    if (!cancellable) return '';
    return `
      <button class="btn btn-danger"     style="width:100%;" onclick="openCancelModal()">✕ Cancel Booking</button>`;
  }

  if (viewerRole === 'provider') {
    switch (s) {
      case 'requested':
        return `
          <button class="btn btn-success" style="width:100%;" onclick="changeStatus('confirmed')">✓ Accept Booking</button>
          <button class="btn btn-danger"  style="width:100%;" onclick="openRejectModal()">✕ Reject</button>`;
      case 'confirmed':
        return `
          <button class="btn btn-primary" style="width:100%;" onclick="changeStatus('in_progress')">▶ Start Job</button>
          <button class="btn btn-outline" style="width:100%;" onclick="openNotesModal()">📝 Add Notes</button>`;
      case 'in_progress':
        return `
          <button class="btn btn-success" style="width:100%;" onclick="openCompleteModal()">✓ Complete Job</button>
          <button class="btn btn-outline" style="width:100%;" onclick="openNotesModal()">📝 Add Notes</button>`;
      default:
        return '';
    }
  }

  if (viewerRole === 'admin') {
    const s2 = booking.status;
    return `
      <select class="form-select" id="admin-status-select" style="margin-bottom:var(--spacing-2);">
        ${['requested','confirmed','in_progress','completed','cancelled','rejected'].map(st =>
          `<option value="${st}" ${st === s2 ? 'selected' : ''}>${getStatusLabel(st)}</option>`
        ).join('')}
      </select>
      <button class="btn btn-primary" style="width:100%;" onclick="adminUpdateStatus()">Update Status</button>`;
  }

  return '';
}

// ── Breadcrumb ────────────────────────────────────────────────
function updateBreadcrumb() {
  const backLink = document.getElementById('back-link');
  if (viewerRole === 'provider') {
    backLink.textContent = 'Dashboard';
    backLink.href = '/provider/dashboard.html';
  } else if (viewerRole === 'admin') {
    backLink.textContent = 'Admin';
    backLink.href = '/admin/dashboard.html';
  }
}

// ─────────────────────────────────────────────────────────────
// ── ACTIONS ──────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────

// ── Generic status change ─────────────────────────────────────
async function changeStatus(newStatus, note, extra = {}) {
  const { error } = await window.supabase
    .from('bookings')
    .update({ status: newStatus, updated_at: new Date().toISOString(), ...extra })
    .eq('id', booking.id);

  if (error) { showToast('Failed: ' + error.message, 'error'); return false; }

  await window.supabase.from('booking_status_history').insert({
    booking_id: booking.id,
    status:     newStatus,
    changed_by: currentUser.id,
    note:       note ?? null,
  });

  showToast(`Booking ${getStatusLabel(newStatus)}.`, 'success');
  booking.status = newStatus;
  Object.assign(booking, extra);
  return true;
}

// ── Cancel (customer) ─────────────────────────────────────────
function openCancelModal() {
  document.getElementById('cancel-reason').value = '';
  setText('cancel-reason-err', '');
  document.getElementById('cancel-reason').classList.remove('error');
  document.getElementById('cancel-modal').classList.add('open');
}
function closeCancelModal() {
  document.getElementById('cancel-modal').classList.remove('open');
}
async function confirmCancel() {
  const reason = document.getElementById('cancel-reason').value.trim();
  if (!reason) {
    setText('cancel-reason-err', 'Please provide a reason.');
    document.getElementById('cancel-reason').classList.add('error');
    return;
  }
  setLoading('cancel-confirm-btn', true);
  const ok = await changeStatus('cancelled', reason, { cancel_reason: reason });
  setLoading('cancel-confirm-btn', false);
  if (!ok) return;
  closeCancelModal();
  refreshPage();
}

// ── Reject (provider) ─────────────────────────────────────────
function openRejectModal() {
  document.getElementById('reject-reason').value = '';
  document.getElementById('reject-modal').classList.add('open');
}
function closeRejectModal() {
  document.getElementById('reject-modal').classList.remove('open');
}
async function confirmReject() {
  const reason = document.getElementById('reject-reason').value.trim();
  setLoading('reject-confirm-btn', true);
  const ok = await changeStatus('rejected', reason || null);
  setLoading('reject-confirm-btn', false);
  if (!ok) return;
  closeRejectModal();
  refreshPage();
}

// ── Add Notes (provider) ─────────────────────────────────────
function openNotesModal() {
  document.getElementById('provider-notes-input').value = booking.provider_notes ?? '';
  document.getElementById('notes-modal').classList.add('open');
}
function closeNotesModal() {
  document.getElementById('notes-modal').classList.remove('open');
}
async function saveNotes() {
  const notes = document.getElementById('provider-notes-input').value.trim();
  setLoading('notes-save-btn', true);

  const { error } = await window.supabase
    .from('bookings')
    .update({ provider_notes: notes, updated_at: new Date().toISOString() })
    .eq('id', booking.id);

  setLoading('notes-save-btn', false);
  if (error) { showToast('Failed to save notes.', 'error'); return; }

  booking.provider_notes = notes;
  closeNotesModal();
  showToast('Notes saved.', 'success');
  renderProviderContent();
}

// ── Complete Job (provider) ───────────────────────────────────
function openCompleteModal() {
  staged.before = [];
  staged.after  = [];
  document.getElementById('before-thumbs').innerHTML = '';
  document.getElementById('after-thumbs').innerHTML  = '';
  document.getElementById('final-price-input').value = booking.estimated_price ?? '';
  hide('complete-upload-progress');
  document.getElementById('complete-modal').classList.add('open');
}
function closeCompleteModal() {
  document.getElementById('complete-modal').classList.remove('open');
}

function handleDragOver(event, dropId) {
  event.preventDefault();
  document.getElementById(dropId).classList.add('dragover');
}
function handleDragLeave(event, dropId) {
  document.getElementById(dropId).classList.remove('dragover');
}
function handleDrop(event, bucket) {
  event.preventDefault();
  document.getElementById(`${bucket}-drop`).classList.remove('dragover');
  const files = Array.from(event.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  addStagedFiles(files, bucket);
}
function handleFileSelect(event, bucket) {
  addStagedFiles(Array.from(event.target.files), bucket);
  event.target.value = '';
}

function addStagedFiles(files, bucket) {
  const thumbsEl = document.getElementById(`${bucket}-thumbs`);
  files.forEach(file => {
    if (staged[bucket].length >= 3) return;
    try { validateImageFile(file); } catch (e) { showToast(e.message, 'warning'); return; }
    staged[bucket].push(file);
    const url   = URL.createObjectURL(file);
    const img   = document.createElement('img');
    img.src     = url;
    img.className = 'complete-thumb';
    thumbsEl.appendChild(img);
  });
}

async function confirmComplete() {
  setLoading('complete-confirm-btn', true);
  show('complete-upload-progress');

  const finalPriceRaw = document.getElementById('final-price-input').value;
  const finalPrice    = finalPriceRaw ? parseFloat(finalPriceRaw) : null;

  // Upload images
  const beforeUrls = await uploadImageBatch(staged.before, 'before', 'complete-progress-bar', 0,  0.5);
  const afterUrls  = await uploadImageBatch(staged.after,  'after',  'complete-progress-bar', 0.5, 1.0);

  const extra = {};
  if (beforeUrls.length) extra.before_image_urls = JSON.stringify(beforeUrls);
  if (afterUrls.length)  extra.after_image_urls  = JSON.stringify(afterUrls);
  if (finalPrice != null) extra.final_price = finalPrice;

  const ok = await changeStatus('completed', null, extra);
  setLoading('complete-confirm-btn', false);
  hide('complete-upload-progress');

  if (!ok) return;
  closeCompleteModal();
  refreshPage();
}

async function uploadImageBatch(files, folder, progressBarId, fromFrac, toFrac) {
  const urls = [];
  const bar  = document.getElementById(progressBarId);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = `bookings/${booking.id}/${folder}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    try {
      const url = await uploadImage(file, 'booking-images', path);
      if (url) urls.push(url);
    } catch (e) {
      showToast(`Failed to upload ${file.name}: ${e.message}`, 'warning');
    }
    const pct = fromFrac + (toFrac - fromFrac) * ((i + 1) / files.length);
    if (bar) bar.style.width = `${Math.round(pct * 100)}%`;
  }
  return urls;
}

// ── Reschedule respond (provider) ────────────────────────────
async function respondReschedule(responseStatus) {
  const updates = {
    reschedule_status: responseStatus,
    updated_at: new Date().toISOString(),
  };
  if (responseStatus === 'accepted' && booking.reschedule_proposed_time) {
    updates.scheduled_at = booking.reschedule_proposed_time;
  }

  const { error } = await window.supabase
    .from('bookings')
    .update(updates)
    .eq('id', booking.id);

  if (error) { showToast('Failed: ' + error.message, 'error'); return; }

  Object.assign(booking, updates);
  showToast(
    responseStatus === 'accepted' ? 'Reschedule accepted.' : 'Reschedule declined.',
    responseStatus === 'accepted' ? 'success' : 'info'
  );
  refreshPage();
}

// ── Review submit (customer) ──────────────────────────────────
async function submitReview() {
  const ratingEl = document.querySelector('#star-picker input[type="radio"]:checked');
  if (!ratingEl) {
    setText('review-rating-err', 'Please select a rating.');
    return;
  }
  clearText('review-rating-err');

  const rating  = parseInt(ratingEl.value, 10);
  const comment = document.getElementById('review-comment-input').value.trim();

  setLoading('review-submit-btn', true);
  hide('review-submit-err');

  const { data, error } = await window.supabase.from('reviews').insert({
    booking_id:  booking.id,
    customer_id: currentUser.id,
    provider_id: booking.provider_id,
    rating,
    comment:     comment || null,
    is_visible:  true,
  }).select('*').single();

  setLoading('review-submit-btn', false);

  if (error) {
    setText('review-submit-err-msg', error.message);
    show('review-submit-err');
    return;
  }

  existingReview = data;
  hide('review-form');
  renderReviewDisplay(data);
  showToast('Review submitted. Thank you!', 'success');
}

// ── Admin: update status ──────────────────────────────────────
async function adminUpdateStatus() {
  const newStatus = document.getElementById('admin-status-select').value;
  if (newStatus === booking.status) return;
  const btn = document.querySelector('#admin-status-select + button');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  const ok = await changeStatus(newStatus, 'Admin override');
  if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  if (ok) refreshPage();
}

// ── Phone contact reveal ──────────────────────────────────────
function togglePhone() {
  const reveal = document.getElementById('phone-reveal');
  const btn    = document.getElementById('contact-btn');
  if (reveal.classList.contains('shown')) {
    reveal.classList.remove('shown');
    btn.textContent = '📞 Show Contact';
  } else {
    reveal.classList.add('shown');
    btn.textContent = '🙈 Hide Contact';
  }
}

// ── Lightbox ──────────────────────────────────────────────────
function openLightbox(images, startIndex) {
  lightboxImages = images;
  lightboxIndex  = startIndex;
  renderLightboxImage();
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}
function lightboxNav(dir) {
  lightboxIndex = (lightboxIndex + dir + lightboxImages.length) % lightboxImages.length;
  renderLightboxImage();
}
function renderLightboxImage() {
  document.getElementById('lightbox-img').src = lightboxImages[lightboxIndex];
  document.getElementById('lightbox-prev').style.display = lightboxImages.length > 1 ? '' : 'none';
  document.getElementById('lightbox-next').style.display = lightboxImages.length > 1 ? '' : 'none';
}

// Close lightbox on background click
document.getElementById('lightbox').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox') closeLightbox();
});
// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('lightbox').classList.contains('open')) return;
  if (e.key === 'Escape')      closeLightbox();
  if (e.key === 'ArrowLeft')   lightboxNav(-1);
  if (e.key === 'ArrowRight')  lightboxNav(1);
});

// ── Realtime subscription ─────────────────────────────────────
function subscribeToChanges(bookingId) {
  window.supabase
    .channel(`booking-detail:${bookingId}`)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'bookings',
      filter: `id=eq.${bookingId}`,
    }, async (payload) => {
      const prev = booking.status;
      booking    = { ...booking, ...payload.new };
      if (prev !== booking.status) {
        showToast(`Status updated to: ${getStatusLabel(booking.status)}`, 'info');
      }
      // Re-fetch history then re-render
      const { data: hist } = await window.supabase
        .from('booking_status_history')
        .select(`
          id, status, note, created_at,
          changer:profiles!booking_status_history_changed_by_fkey ( id, name, role )
        `)
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: true });
      renderPage(hist ?? []);
    })
    .subscribe();
}

// ── Page helpers ──────────────────────────────────────────────
function refreshPage() {
  // Re-render everything in-place from current `booking` state
  loadBooking(booking.id).then(() => {});
}

function showAccessDenied(msg) {
  hide('page-skeleton');
  show('access-denied');
  if (msg) {
    const el = document.querySelector('#access-denied .denied-state-desc');
    if (el) el.textContent = msg;
  }
}

// ── DOM helpers ───────────────────────────────────────────────
function show(id)         { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hide(id)         { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
function clearText(id)    { setText(id, ''); }

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) btn.classList.add('loading'); else btn.classList.remove('loading');
}

function safeParseArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; }
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
