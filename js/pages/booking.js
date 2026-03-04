// ============================================================
// Tekpair – Booking Creation Logic  (js/pages/booking.js)
// Depends on: window.supabase, requireAuth(), requireRole(),
//             showToast(), formatPrice(), validateImageFile(),
//             uploadImage(), formatDate()
// ============================================================

// ── State ────────────────────────────────────────────────────
let providerData   = null;   // full provider_profiles row with joins
let currentUser    = null;
let selectedTime   = null;   // "HH:MM" string
let selectedFiles  = [];     // File[] – max 3

// ── Init ─────────────────────────────────────────────────────
(async () => {
  // Guard: must be logged-in customer
  const profile = await requireRole('customer');
  if (!profile) return;
  currentUser = profile;

  // Set date minimum to tomorrow
  const dateInput = document.getElementById('schedule-date');
  const tomorrow  = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  dateInput.min   = tomorrow.toISOString().split('T')[0];

  // Load provider from URL param
  const params     = new URLSearchParams(window.location.search);
  const providerUserId = params.get('provider');

  if (!providerUserId) {
    showProviderError();
    return;
  }

  await loadProvider(providerUserId);
})();

// ── Load provider ─────────────────────────────────────────────
async function loadProvider(userId) {
  const { data, error } = await window.supabase
    .from('provider_profiles')
    .select(`
      id,
      user_id,
      bio,
      years_experience,
      category_id,
      is_approved,
      is_available,
      rating_avg,
      rating_count,
      city,
      areas,
      categories ( id, name, icon, base_price, price_unit ),
      profiles   ( id, name, avatar_url )
    `)
    .eq('user_id', userId)
    .eq('is_approved', true)
    .single();

  if (error || !data) {
    showProviderError();
    return;
  }

  providerData = data;
  renderProviderCard(data);
  renderPriceEstimate(data);
}

function showProviderError() {
  document.getElementById('provider-card-skeleton').style.display = 'none';
  document.getElementById('provider-error-card').style.display    = 'block';
  document.getElementById('booking-form').style.display           = 'none';
}

// ── Render provider summary card ──────────────────────────────
function renderProviderCard(p) {
  const profile  = p.profiles  ?? {};
  const category = p.categories ?? {};
  const name     = profile.name ?? 'Provider';

  // Hide skeleton, show real card
  document.getElementById('provider-card-skeleton').style.display = 'none';
  document.getElementById('provider-card').style.display          = 'block';

  // Avatar
  const avatarWrap = document.getElementById('provider-avatar-wrap');
  if (profile.avatar_url) {
    avatarWrap.innerHTML = `<img src="${esc(profile.avatar_url)}" alt="${esc(name)}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.4);" />`;
  } else {
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    avatarWrap.innerHTML = `<div style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;color:#fff;border:3px solid rgba(255,255,255,0.4);">${initials}</div>`;
  }

  document.getElementById('provider-display-name').textContent = name;

  // Availability badge
  const availBadge = document.getElementById('provider-avail-badge');
  availBadge.innerHTML = p.is_available
    ? `<span class="badge" style="background:var(--color-success-light);color:var(--color-success);">🟢 Available</span>`
    : `<span class="badge badge-cancelled">Unavailable</span>`;

  // Details
  document.getElementById('provider-category-display').textContent =
    `${category.icon ?? ''} ${category.name ?? '—'}`.trim();

  const ratingNum = p.rating_avg ? Number(p.rating_avg).toFixed(1) : '—';
  document.getElementById('provider-rating-display').innerHTML =
    p.rating_count
      ? `⭐ ${ratingNum} <span style="color:var(--color-text-muted);font-size:var(--font-size-xs);">(${p.rating_count} reviews)</span>`
      : '—';

  document.getElementById('provider-price-display').textContent =
    category.base_price
      ? `${formatPrice(category.base_price)} / ${category.price_unit ?? 'job'}`
      : '—';

  document.getElementById('provider-city-display').textContent =
    p.city ?? '—';

  document.getElementById('provider-exp-display').textContent =
    p.years_experience ? `${p.years_experience} year${p.years_experience > 1 ? 's' : ''}` : 'Not specified';
}

// ── Price estimate ─────────────────────────────────────────────
function renderPriceEstimate(p) {
  const category = p.categories ?? {};
  const base     = category.base_price ? Number(category.base_price) : null;

  document.getElementById('est-base').textContent  = base ? formatPrice(base) : '—';
  document.getElementById('est-total').textContent = base ? formatPrice(base) : '—';
}

// ── Time slot selection ────────────────────────────────────────
function selectTime(btn) {
  document.querySelectorAll('.time-slot-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedTime = btn.dataset.time;
  clearFieldError('schedule-time-error');
}

// ── Image handling ─────────────────────────────────────────────
function handleImageSelect(event) {
  addFiles(Array.from(event.target.files));
  event.target.value = ''; // reset so same file can be re-added after removal
}

function handleDragOver(event) {
  event.preventDefault();
  document.getElementById('upload-area').classList.add('drag-over');
}

function handleDragLeave(event) {
  document.getElementById('upload-area').classList.remove('drag-over');
}

function handleDrop(event) {
  event.preventDefault();
  document.getElementById('upload-area').classList.remove('drag-over');
  addFiles(Array.from(event.dataTransfer.files));
}

function addFiles(files) {
  clearFieldError('image-error');
  for (const file of files) {
    if (selectedFiles.length >= 3) {
      showToast('Maximum 3 images allowed.', 'warning');
      break;
    }
    try {
      validateImageFile(file);
      selectedFiles.push(file);
    } catch (err) {
      setFieldError('image-error', err.message);
    }
  }
  renderImagePreviews();
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderImagePreviews();
}

function renderImagePreviews() {
  const container = document.getElementById('image-previews');
  if (!selectedFiles.length) { container.innerHTML = ''; return; }

  container.innerHTML = selectedFiles.map((file, i) => {
    const url = URL.createObjectURL(file);
    return `
      <div class="preview-item">
        <img src="${url}" alt="Preview ${i + 1}" />
        <button type="button" class="preview-remove" onclick="removeFile(${i})" title="Remove">✕</button>
      </div>`;
  }).join('');

  // Update upload area appearance
  const ua = document.getElementById('upload-area');
  ua.style.opacity = selectedFiles.length >= 3 ? '0.5' : '1';
  ua.style.pointerEvents = selectedFiles.length >= 3 ? 'none' : '';
}

// ── Validation helpers ─────────────────────────────────────────
function setFieldError(errorId, msg) {
  const el = document.getElementById(errorId);
  if (!el) return;
  el.textContent = msg;
  const inputId = errorId.replace('-error', '');
  const input   = document.getElementById(inputId);
  if (input) input.classList.toggle('error', !!msg);
}

function clearFieldError(errorId) {
  setFieldError(errorId, '');
}

function validateForm() {
  let valid = true;

  // Address
  const street  = v('address-street');
  const city    = v('address-city');
  const area    = v('address-area');
  const pincode = v('address-pincode');

  if (!street)  { setFieldError('address-street-error',  'Street address is required.'); valid = false; }
  if (!city)    { setFieldError('address-city-error',    'City is required.'); valid = false; }
  if (!area)    { setFieldError('address-area-error',    'Area is required.'); valid = false; }
  if (!pincode) { setFieldError('address-pincode-error', 'Pincode is required.'); valid = false; }
  else if (!/^\d{6}$/.test(pincode)) { setFieldError('address-pincode-error', 'Enter a valid 6-digit pincode.'); valid = false; }

  // Schedule
  const date = v('schedule-date');
  if (!date) { setFieldError('schedule-date-error', 'Please select a date.'); valid = false; }
  if (!selectedTime) { setFieldError('schedule-time-error', 'Please select a time slot.'); valid = false; }

  return valid;
}

function v(id) { return (document.getElementById(id)?.value ?? '').trim(); }

// ── Open confirm modal ─────────────────────────────────────────
function openConfirmModal() {
  // Clear all errors first
  ['address-street','address-city','address-area','address-pincode','schedule-date']
    .forEach(id => clearFieldError(id + '-error'));
  clearFieldError('schedule-time-error');

  if (!validateForm()) {
    showToast('Please fill in all required fields.', 'warning');
    // Scroll to first error
    const firstErr = document.querySelector('.form-input.error, .form-select.error');
    firstErr?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  populateConfirmModal();
  document.getElementById('confirm-modal').classList.add('open');
}

function closeConfirmModal() {
  document.getElementById('confirm-modal').classList.remove('open');
  document.getElementById('confirm-warning').style.display = 'none';
}

function populateConfirmModal() {
  const category = providerData?.categories ?? {};
  const profile  = providerData?.profiles  ?? {};

  // Provider info row in modal
  const name     = profile.name ?? 'Provider';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const avatarEl = document.getElementById('modal-provider-avatar');
  if (profile.avatar_url) {
    avatarEl.innerHTML = `<img src="${esc(profile.avatar_url)}" alt="${esc(name)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;" />`;
  } else {
    avatarEl.innerHTML = `<div style="width:44px;height:44px;border-radius:50%;background:var(--color-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;">${initials}</div>`;
  }
  document.getElementById('modal-provider-name').textContent     = name;
  document.getElementById('modal-provider-category').textContent =
    `${category.icon ?? ''} ${category.name ?? '—'}`.trim();

  // Build the date+time label
  const dateVal  = v('schedule-date');
  const timeLabel = document.querySelector(`.time-slot-btn[data-time="${selectedTime}"]`)?.textContent ?? selectedTime;
  const dtStr    = dateVal && selectedTime ? `${dateVal}T${selectedTime}:00` : null;
  const formattedDt = dtStr ? formatDate(dtStr) : '—';

  const address = [v('address-street'), v('address-area'), v('address-city'), v('address-pincode')]
    .filter(Boolean).join(', ');

  const rows = [
    { label: 'Provider',       value: name },
    { label: 'Service',        value: `${category.icon ?? ''} ${category.name ?? '—'}` },
    { label: 'Address',        value: address },
    { label: 'Date & Time',    value: formattedDt },
    { label: 'Notes',          value: v('job-notes') || 'None' },
    { label: 'Images',         value: selectedFiles.length ? `${selectedFiles.length} image(s) attached` : 'None' },
    { label: 'Est. Price',     value: category.base_price ? formatPrice(category.base_price) : 'TBD by provider' },
  ];

  document.getElementById('confirm-summary-rows').innerHTML = rows.map(r => `
    <div class="confirm-summary-row">
      <span class="confirm-summary-label">${esc(r.label)}</span>
      <span class="confirm-summary-value">${esc(String(r.value))}</span>
    </div>`).join('');
}

// ── Submit booking ─────────────────────────────────────────────
async function submitBooking() {
  if (!providerData || !currentUser) return;

  const confirmBtn = document.getElementById('confirm-btn');
  confirmBtn.disabled = true;
  confirmBtn.classList.add('loading');

  // Hide any previous warning
  document.getElementById('confirm-warning').style.display = 'none';

  let imageUrls = [];

  // ── Step A: upload images ──────────────────────────────────
  if (selectedFiles.length > 0) {
    const progressWrap = document.getElementById('upload-progress');
    const progressBar  = document.getElementById('upload-progress-bar');
    const progressText = document.getElementById('upload-progress-text');
    progressWrap.style.display = 'flex';

    for (let i = 0; i < selectedFiles.length; i++) {
      const file      = selectedFiles[i];
      const timestamp = Date.now();
      const safeName  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path      = `bookings/${currentUser.id}/${timestamp}_${safeName}`;

      try {
        const url = await uploadImage(file, 'booking-images', path);
        imageUrls.push(url);
      } catch (err) {
        console.error('Upload error:', err);
        showToast(`Image upload failed: ${err.message}`, 'error');
        // Continue without this image rather than blocking the booking
      }

      const pct = Math.round(((i + 1) / selectedFiles.length) * 100);
      progressBar.style.width  = `${pct}%`;
      progressText.textContent = `${pct}%`;
    }

    progressWrap.style.display = 'none';
  }

  // ── Step B: build scheduled_at timestamp ──────────────────
  const dateVal = v('schedule-date');
  const scheduledAt = dateVal && selectedTime
    ? new Date(`${dateVal}T${selectedTime}:00`).toISOString()
    : null;

  // ── Step C: insert booking row ─────────────────────────────
  const bookingPayload = {
    customer_id:          currentUser.id,
    provider_id:          providerData.user_id,
    category_id:          providerData.category_id,
    address_street:       v('address-street'),
    address_city:         v('address-city'),
    address_area:         v('address-area'),
    address_pincode:      v('address-pincode'),
    scheduled_at:         scheduledAt,
    status:               'requested',
    estimated_price:      providerData.categories?.base_price ?? null,
    customer_notes:       v('job-notes') || null,
    customer_image_urls:  imageUrls.length ? imageUrls : null,
  };

  const { data: booking, error: bookingError } = await window.supabase
    .from('bookings')
    .insert(bookingPayload)
    .select()
    .single();

  if (bookingError) {
    confirmBtn.disabled = false;
    confirmBtn.classList.remove('loading');

    const warnEl  = document.getElementById('confirm-warning');
    const warnMsg = document.getElementById('confirm-warning-msg');
    warnMsg.textContent = bookingError.message ?? 'Failed to create booking. Please try again.';
    warnEl.style.display = 'flex';
    return;
  }

  // ── Step D: insert status history row ─────────────────────
  await window.supabase
    .from('booking_status_history')
    .insert({
      booking_id: booking.id,
      status:     'requested',
      changed_by: currentUser.id,
      note:       'Booking created by customer',
    });

  // ── Step E: success ────────────────────────────────────────
  closeConfirmModal();
  showToast('Booking created! Redirecting to your bookings…', 'success');
  setTimeout(() => { window.location.href = '/bookings.html'; }, 1200);
}

// ── Tiny escape util (XSS guard for innerHTML) ─────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Live blur validation ───────────────────────────────────────
['address-street','address-city','address-area'].forEach(id => {
  document.getElementById(id)?.addEventListener('blur', function () {
    if (!this.value.trim()) setFieldError(id + '-error', 'This field is required.');
    else clearFieldError(id + '-error');
  });
});

document.getElementById('address-pincode')?.addEventListener('blur', function () {
  if (!this.value.trim()) setFieldError('address-pincode-error', 'Pincode is required.');
  else if (!/^\d{6}$/.test(this.value.trim())) setFieldError('address-pincode-error', 'Enter a valid 6-digit pincode.');
  else clearFieldError('address-pincode-error');
});

document.getElementById('schedule-date')?.addEventListener('change', function () {
  clearFieldError('schedule-date-error');
});
