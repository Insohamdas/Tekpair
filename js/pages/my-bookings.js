// ============================================================
// Tekpair – My Bookings Page  (js/pages/my-bookings.js)
// Depends on: window.supabase, requireRole(), showToast(),
//             formatDate(), formatPrice(), starsHTML()
// ============================================================

// ── State ────────────────────────────────────────────────────
let allBookings     = [];
let currentFilter   = 'all';
let currentUser     = null;
let activeCancelId  = null;   // booking id being cancelled
let activeReschedId = null;   // booking id being rescheduled
let activeReviewId  = null;   // booking id being reviewed
let rescheduleTime  = null;   // selected time string
let reviewedIds     = new Set(); // booking ids that already have a review

// ── Bootstrap ─────────────────────────────────────────────────
(async () => {
  const profile = await requireRole('customer');
  if (!profile) return;
  currentUser = profile;

  await loadBookings();
  subscribeToBookingChanges();

  // Set reschedule date minimum
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];
  const rd = document.getElementById('reschedule-date');
  if (rd) rd.min = minDate;

  // Wire reschedule time slots
  document.querySelectorAll('#reschedule-time-slots .time-slot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#reschedule-time-slots .time-slot-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      rescheduleTime = btn.dataset.time;
      clearErr('reschedule-time-error');
    });
  });
})();

// ── Fetch bookings ────────────────────────────────────────────
async function loadBookings() {
  const { data, error } = await window.supabase
    .from('bookings')
    .select(`
      id,
      customer_id,
      provider_id,
      category_id,
      address_city,
      address_area,
      scheduled_at,
      status,
      estimated_price,
      final_price,
      customer_notes,
      cancel_reason,
      reschedule_status,
      created_at,
      updated_at,
      categories ( id, name, icon ),
      provider:profiles!bookings_provider_id_fkey ( id, name, avatar_url )
    `)
    .eq('customer_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    showToast('Failed to load bookings.', 'error');
    console.error(error);
    document.getElementById('bookings-list').innerHTML = errorState();
    return;
  }

  allBookings = data ?? [];

  // Check which completed bookings already have reviews
  if (allBookings.some(b => b.status === 'completed')) {
    await fetchReviewedIds();
  }

  updateTabCounts();
  renderBookings();
}

async function fetchReviewedIds() {
  const completedIds = allBookings
    .filter(b => b.status === 'completed')
    .map(b => b.id);

  if (!completedIds.length) return;

  const { data } = await window.supabase
    .from('reviews')
    .select('booking_id')
    .in('booking_id', completedIds);

  reviewedIds = new Set((data ?? []).map(r => r.booking_id));
}

// ── Render ────────────────────────────────────────────────────
function renderBookings() {
  const list      = document.getElementById('bookings-list');
  const subtitle  = document.getElementById('bookings-subtitle');
  const filtered  = filterBookings(allBookings, currentFilter);

  subtitle.textContent = `${allBookings.length} total booking${allBookings.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    list.innerHTML = emptyState(currentFilter);
    return;
  }

  list.innerHTML = filtered
    .map(b => bookingCardHTML(b))
    .join('');
}

function filterBookings(bookings, filter) {
  if (filter === 'all')       return bookings;
  if (filter === 'active')    return bookings.filter(b => ['requested','confirmed','in_progress'].includes(b.status));
  if (filter === 'completed') return bookings.filter(b => b.status === 'completed');
  if (filter === 'cancelled') return bookings.filter(b => ['cancelled','rejected'].includes(b.status));
  return bookings;
}

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === filter);
  });
  renderBookings();
}

function updateTabCounts() {
  document.getElementById('count-all').textContent       = allBookings.length;
  document.getElementById('count-active').textContent    = allBookings.filter(b => ['requested','confirmed','in_progress'].includes(b.status)).length;
  document.getElementById('count-completed').textContent = allBookings.filter(b => b.status === 'completed').length;
  document.getElementById('count-cancelled').textContent = allBookings.filter(b => ['cancelled','rejected'].includes(b.status)).length;
}

// ── Card HTML ─────────────────────────────────────────────────
function bookingCardHTML(b) {
  const provider = b.provider  ?? {};
  const category = b.categories ?? {};
  const name     = esc(provider.name ?? 'Provider');
  const initials = (provider.name ?? 'P').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);

  const avatarHTML = provider.avatar_url
    ? `<img src="${esc(provider.avatar_url)}" alt="${name}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;" />`
    : `<div style="width:48px;height:48px;border-radius:50%;background:var(--color-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;flex-shrink:0;">${initials}</div>`;

  const statusBadge = `<span class="badge ${getStatusColor(b.status)}">${getStatusLabel(b.status)}</span>`;
  const shortId     = b.id.slice(0,8).toUpperCase();
  const dateStr     = b.scheduled_at ? formatDate(b.scheduled_at) : '—';
  const location    = [b.address_area, b.address_city].filter(Boolean).join(', ') || '—';
  const price       = b.final_price ?? b.estimated_price;

  return `
  <div class="booking-card" id="booking-${b.id}" onclick="goToDetail(event,'${b.id}')">
    <!-- Header -->
    <div class="booking-card-header">
      <div class="booking-card-provider">
        ${avatarHTML}
        <div class="booking-card-meta">
          <div class="booking-card-name">
            ${name}
            <span class="verified-badge" style="font-size:0.6rem;">✓ Verified</span>
          </div>
          <span class="booking-card-category">${esc(category.icon ?? '')} ${esc(category.name ?? '—')}</span>
        </div>
      </div>
      <div class="booking-card-right">
        ${statusBadge}
        <span class="booking-card-id">#${shortId}</span>
      </div>
    </div>

    <!-- Info row -->
    <div class="booking-card-divider"></div>
    <div class="booking-card-info">
      <div class="booking-info-item">
        <span class="booking-info-label">Scheduled</span>
        <span class="booking-info-value">${esc(dateStr)}</span>
      </div>
      <div class="booking-info-item">
        <span class="booking-info-label">Location</span>
        <span class="booking-info-value">📍 ${esc(location)}</span>
      </div>
      ${b.reschedule_status === 'pending' ? `
      <div class="booking-info-item">
        <span class="booking-info-label">Reschedule</span>
        <span class="booking-info-value" style="color:var(--color-warning);">⏳ Pending approval</span>
      </div>` : ''}
    </div>

    <!-- Timeline -->
    <div class="booking-timeline">
      ${timelineHTML(b.status)}
    </div>

    <!-- Footer -->
    <div class="booking-card-footer">
      <div class="booking-card-price">
        ${price
          ? `Est. <strong>${formatPrice(price)}</strong>`
          : '<span style="color:var(--color-text-muted);font-size:var(--font-size-sm);">Price TBD</span>'}
      </div>
      <div class="booking-card-actions" onclick="event.stopPropagation()">
        ${actionsHTML(b)}
      </div>
    </div>
  </div>`;
}

// ── Timeline HTML ─────────────────────────────────────────────
const TIMELINE_STEPS = [
  { key: 'requested',   label: 'Requested'   },
  { key: 'confirmed',   label: 'Confirmed'   },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed',   label: 'Completed'   },
];
const STATUS_ORDER = ['requested','confirmed','in_progress','completed'];

function timelineHTML(status) {
  const isCancelled = ['cancelled','rejected'].includes(status);
  const currentIdx  = STATUS_ORDER.indexOf(status);

  return `<div class="bk-timeline">
    ${TIMELINE_STEPS.map((step, i) => {
      let cls = '';
      if (isCancelled) {
        cls = i === 0 ? 'done' : '';
      } else {
        if (i < currentIdx) cls = 'done';
        else if (i === currentIdx) cls = 'active';
      }
      const dotContent = cls === 'done' ? '✓' : (i + 1);
      return `
      <div class="bk-step ${cls} ${isCancelled && i === 0 ? status : ''}">
        <div class="bk-dot">${dotContent}</div>
        <div class="bk-label">${step.label}</div>
      </div>`;
    }).join('')}
    ${isCancelled ? `
      <div class="bk-step ${status}" style="flex:0;margin-left:var(--spacing-2);">
        <div class="bk-dot">✕</div>
        <div class="bk-label" style="color:var(--color-danger);">${status === 'rejected' ? 'Rejected' : 'Cancelled'}</div>
      </div>` : ''}
  </div>`;
}

// ── Action buttons ────────────────────────────────────────────
function actionsHTML(b) {
  switch (b.status) {
    case 'requested':
    case 'confirmed':
      return `
        <button class="btn btn-secondary btn-sm" onclick="openReschedule('${b.id}')">📅 Reschedule</button>
        <button class="btn btn-danger btn-sm"    onclick="openCancel('${b.id}')">Cancel</button>`;
    case 'in_progress':
      return `<div class="in-progress-indicator"><div class="in-progress-dot"></div>In Progress…</div>`;
    case 'completed':
      return `
        ${!reviewedIds.has(b.id) ? `<button class="btn btn-primary btn-sm" onclick="openReview('${b.id}','${esc(b.provider?.name ?? '')}','${b.provider_id}')">⭐ Leave Review</button>` : '<span class="badge badge-completed" style="font-size:0.65rem;">Reviewed ✓</span>'}
        <a href="/booking-detail.html?id=${b.id}" class="btn btn-secondary btn-sm">View Details</a>`;
    case 'cancelled':
    case 'rejected':
      return `<a href="/landing.html" class="btn btn-outline btn-sm">🔄 Book Again</a>`;
    default:
      return '';
  }
}

// ── Navigate to detail ────────────────────────────────────────
function goToDetail(event, id) {
  // Don't navigate if a button inside the card was clicked
  if (event.target.closest('button, a')) return;
  window.location.href = `/booking-detail.html?id=${id}`;
}

// ── Cancel flow ───────────────────────────────────────────────
function openCancel(bookingId) {
  activeCancelId = bookingId;
  document.getElementById('cancel-reason').value = '';
  document.getElementById('cancel-reason-error').textContent = '';
  document.getElementById('cancel-reason').classList.remove('error');
  document.getElementById('cancel-modal').classList.add('open');
}

function closeCancelModal() {
  document.getElementById('cancel-modal').classList.remove('open');
  activeCancelId = null;
}

async function confirmCancel() {
  const reason = document.getElementById('cancel-reason').value.trim();
  if (!reason) {
    document.getElementById('cancel-reason-error').textContent = 'Please provide a reason.';
    document.getElementById('cancel-reason').classList.add('error');
    return;
  }

  const btn = document.getElementById('cancel-confirm-btn');
  btn.disabled = true;
  btn.classList.add('loading');

  const { error } = await window.supabase
    .from('bookings')
    .update({ status: 'cancelled', cancel_reason: reason })
    .eq('id', activeCancelId)
    .eq('customer_id', currentUser.id);

  if (error) {
    showToast('Failed to cancel booking: ' + error.message, 'error');
    btn.disabled = false;
    btn.classList.remove('loading');
    return;
  }

  // Log to history
  await window.supabase.from('booking_status_history').insert({
    booking_id: activeCancelId,
    status:     'cancelled',
    changed_by: currentUser.id,
    note:       reason,
  });

  // Update in-memory
  patchBooking(activeCancelId, { status: 'cancelled', cancel_reason: reason });

  closeCancelModal();
  showToast('Booking cancelled.', 'success');

  btn.disabled = false;
  btn.classList.remove('loading');
}

// ── Reschedule flow ───────────────────────────────────────────
function openReschedule(bookingId) {
  activeReschedId = bookingId;
  rescheduleTime  = null;
  document.getElementById('reschedule-date').value = '';
  document.querySelectorAll('#reschedule-time-slots .time-slot-btn').forEach(b => b.classList.remove('selected'));
  clearErr('reschedule-date-error');
  clearErr('reschedule-time-error');
  document.getElementById('reschedule-modal').classList.add('open');
}

function closeRescheduleModal() {
  document.getElementById('reschedule-modal').classList.remove('open');
  activeReschedId = null;
}

async function confirmReschedule() {
  const dateVal = document.getElementById('reschedule-date').value;
  let valid = true;
  if (!dateVal) { setErr('reschedule-date-error', 'Please select a date.'); valid = false; }
  if (!rescheduleTime) { setErr('reschedule-time-error', 'Please select a time slot.'); valid = false; }
  if (!valid) return;

  const btn = document.getElementById('reschedule-confirm-btn');
  btn.disabled = true;
  btn.classList.add('loading');

  const proposedTime = new Date(`${dateVal}T${rescheduleTime}:00`).toISOString();

  const { error } = await window.supabase
    .from('bookings')
    .update({
      reschedule_proposed_time:  proposedTime,
      reschedule_requested_by:   currentUser.id,
      reschedule_status:         'pending',
    })
    .eq('id', activeReschedId)
    .eq('customer_id', currentUser.id);

  if (error) {
    showToast('Failed to send reschedule request: ' + error.message, 'error');
    btn.disabled = false;
    btn.classList.remove('loading');
    return;
  }

  patchBooking(activeReschedId, {
    reschedule_proposed_time: proposedTime,
    reschedule_requested_by:  currentUser.id,
    reschedule_status:        'pending',
  });

  closeRescheduleModal();
  showToast('Reschedule request sent to provider!', 'success');

  btn.disabled = false;
  btn.classList.remove('loading');
}

// ── Review flow ───────────────────────────────────────────────
function openReview(bookingId, providerName, providerId) {
  activeReviewId = bookingId;
  // store provider id on modal for submit
  document.getElementById('review-modal').dataset.providerId = providerId;

  document.getElementById('review-provider-label').textContent =
    `How was your experience with ${providerName || 'this provider'}?`;
  document.getElementById('review-comment').value = '';
  document.querySelectorAll('#star-input input').forEach(i => i.checked = false);
  clearErr('review-rating-error');
  document.getElementById('review-error').style.display = 'none';
  document.getElementById('review-modal').classList.add('open');
}

function closeReviewModal() {
  document.getElementById('review-modal').classList.remove('open');
  activeReviewId = null;
}

async function submitReview() {
  const ratingInput = document.querySelector('#star-input input:checked');
  if (!ratingInput) {
    setErr('review-rating-error', 'Please select a rating.');
    return;
  }
  const rating    = parseInt(ratingInput.value, 10);
  const comment   = document.getElementById('review-comment').value.trim();
  const providerId = document.getElementById('review-modal').dataset.providerId;

  const btn = document.getElementById('review-submit-btn');
  btn.disabled = true;
  btn.classList.add('loading');

  const { error } = await window.supabase.from('reviews').insert({
    booking_id:  activeReviewId,
    customer_id: currentUser.id,
    provider_id: providerId,
    rating,
    comment:     comment || null,
    is_visible:  true,
  });

  if (error) {
    document.getElementById('review-error-msg').textContent = error.message;
    document.getElementById('review-error').style.display   = 'flex';
    btn.disabled = false;
    btn.classList.remove('loading');
    return;
  }

  // Update provider rating_avg optimistically via RPC or just reload
  reviewedIds.add(activeReviewId);
  closeReviewModal();
  showToast('Review submitted! Thank you.', 'success');

  // Re-render the card to flip action button → "Reviewed ✓"
  const booking = allBookings.find(b => b.id === activeReviewId);
  if (booking) rerenderCard(booking);

  btn.disabled = false;
  btn.classList.remove('loading');
}

// ── In-memory state helpers ───────────────────────────────────
function patchBooking(id, patch) {
  const idx = allBookings.findIndex(b => b.id === id);
  if (idx === -1) return;
  allBookings[idx] = { ...allBookings[idx], ...patch };
  rerenderCard(allBookings[idx]);
  updateTabCounts();
  // If current filter no longer includes this booking, re-render list
  const visible = document.getElementById(`booking-${id}`);
  if (visible && !filterBookings([allBookings[idx]], currentFilter).length) {
    visible.style.animation = 'fadeOut 0.3s forwards';
    setTimeout(() => renderBookings(), 350);
  }
}

function rerenderCard(booking) {
  const el = document.getElementById(`booking-${booking.id}`);
  if (!el) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = bookingCardHTML(booking);
  const newCard = tmp.firstElementChild;
  el.replaceWith(newCard);
}

// ── Realtime subscription ─────────────────────────────────────
function subscribeToBookingChanges() {
  window.supabase
    .channel(`bookings:customer:${currentUser.id}`)
    .on(
      'postgres_changes',
      {
        event:  '*',
        schema: 'public',
        table:  'bookings',
        filter: `customer_id=eq.${currentUser.id}`,
      },
      async (payload) => {
        const updated = payload.new;
        if (!updated) return;

        const idx = allBookings.findIndex(b => b.id === updated.id);
        if (idx !== -1) {
          const old = allBookings[idx];
          allBookings[idx] = { ...old, ...updated };

          // Status change notification
          if (old.status !== updated.status) {
            showToast(
              `Booking #${updated.id.slice(0,8).toUpperCase()} status: ${getStatusLabel(updated.status)}`,
              updated.status === 'confirmed' || updated.status === 'completed' ? 'success' : 'info'
            );
          }
          // Reschedule accepted/rejected notification
          if (old.reschedule_status !== updated.reschedule_status && updated.reschedule_status) {
            showToast(
              `Reschedule request ${updated.reschedule_status}`,
              updated.reschedule_status === 'accepted' ? 'success' : 'warning'
            );
          }

          rerenderCard(allBookings[idx]);
          updateTabCounts();
        } else {
          // New booking (e.g. created from another device) — reload
          await loadBookings();
        }
      }
    )
    .subscribe();
}

// ── Empty / error states ──────────────────────────────────────
function emptyState(filter) {
  const messages = {
    all:       { icon: '📋', title: 'No bookings yet', desc: 'Browse services and make your first booking!', btn: true },
    active:    { icon: '⏳', title: 'No active bookings', desc: 'All your bookings have been completed or cancelled.', btn: true },
    completed: { icon: '✅', title: 'No completed bookings', desc: 'Your completed bookings will appear here.', btn: false },
    cancelled: { icon: '🚫', title: 'No cancelled bookings', desc: "You haven't cancelled any bookings.", btn: false },
  };
  const m = messages[filter] ?? messages.all;
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${m.icon}</div>
      <div class="empty-state-title">${m.title}</div>
      <p class="empty-state-desc">${m.desc}</p>
      ${m.btn ? `<a href="/landing.html" class="btn btn-primary mt-4" style="margin-top:var(--spacing-4);">Browse Services</a>` : ''}
    </div>`;
}

function errorState() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">😕</div>
      <div class="empty-state-title">Couldn't load bookings</div>
      <p class="empty-state-desc">Please refresh the page to try again.</p>
      <button class="btn btn-outline btn-sm mt-4" style="margin-top:var(--spacing-4);" onclick="loadBookings()">Retry</button>
    </div>`;
}

// ── Tiny helpers ──────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function setErr(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}
function clearErr(id) { setErr(id, ''); }
