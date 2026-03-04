// ============================================================
// Tekpair – Admin Reviews (js/pages/admin-reviews.js)
// Depends on: window.supabase, requireRole(), showToast(),
//             formatDate(), updateNavUI(), logout()
// ============================================================

// ── State ─────────────────────────────────────────────────────
let allReviews  = [];
let visFilter   = 'all';   // 'all' | 'visible' | 'hidden'
let starFilter  = 0;       // 0 = all, 1-5 = exact star match
let searchQuery = '';

// ── Bootstrap ─────────────────────────────────────────────────
(async () => {
  const profile = await requireRole('admin');
  if (!profile) return;
  updateNavUI(profile);
  await loadReviews();
})();

// ── Data loading ──────────────────────────────────────────────
async function loadReviews() {
  const { data, error } = await window.supabase
    .from('reviews')
    .select(`
      id, rating, comment, is_visible, created_at,
      booking_id,
      customer:profiles!reviews_customer_id_fkey ( id, name, avatar_url ),
      provider:profiles!reviews_provider_id_fkey ( id, name )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    showToast('Failed to load reviews: ' + error.message, 'error');
    return;
  }

  allReviews = data ?? [];
  renderStats();

  hide('reviews-skeleton');
  show('reviews-list');
  applyFilters();
}

// ── Summary stats ─────────────────────────────────────────────
function renderStats() {
  const total    = allReviews.length;
  const hidden   = allReviews.filter(r => !r.is_visible).length;
  const fiveStar = allReviews.filter(r => r.rating === 5).length;
  const avg      = total
    ? (allReviews.reduce((s, r) => s + r.rating, 0) / total).toFixed(1)
    : '—';

  setText('stat-total',    total);
  setText('stat-avg',      total ? `${avg} ★` : '—');
  setText('stat-hidden',   hidden);
  setText('stat-fivestar', fiveStar);
}

// ── Filter controls ───────────────────────────────────────────
function setVisFilter(val) {
  visFilter = val;
  document.querySelectorAll('.filter-btn[data-vis]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.vis === val);
  });
  applyFilters();
}

function setStarFilter(val) {
  starFilter = val;
  document.querySelectorAll('.star-filter-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.star) === val);
  });
  applyFilters();
}

function handleSearch(val) {
  searchQuery = val.toLowerCase().trim();
  applyFilters();
}

// ── Apply all filters → render ────────────────────────────────
function applyFilters() {
  let list = allReviews.slice();

  // Visibility
  if (visFilter === 'visible') list = list.filter(r =>  r.is_visible);
  if (visFilter === 'hidden')  list = list.filter(r => !r.is_visible);

  // Stars
  if (starFilter > 0) list = list.filter(r => r.rating === starFilter);

  // Search
  if (searchQuery) {
    list = list.filter(r => {
      const custName = (r.customer?.name ?? '').toLowerCase();
      const provName = (r.provider?.name ?? '').toLowerCase();
      return custName.includes(searchQuery) || provName.includes(searchQuery);
    });
  }

  renderReviews(list);
}

// ── Render review cards ───────────────────────────────────────
function renderReviews(list) {
  const container = document.getElementById('reviews-list');
  if (!list.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">⭐</div>
      <div class="empty-state-title">No reviews found</div>
      <p class="empty-state-desc">Try adjusting your filters or search query.</p>
    </div>`;
    return;
  }
  container.innerHTML = list.map(r => reviewCardHTML(r)).join('');
}

function reviewCardHTML(r) {
  const custName = r.customer?.name ?? 'Unknown Customer';
  const provName = r.provider?.name ?? 'Unknown Provider';
  const stars    = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
  const dateStr  = r.created_at ? formatDateShort(r.created_at) : '—';
  const initials = custInitials(custName);

  return `
  <div class="review-card${r.is_visible ? '' : ' hidden-review'}" id="rv-${r.id}">
    <div class="review-card-head">
      <div style="display:flex;align-items:flex-start;gap:var(--spacing-3);">
        ${r.customer?.avatar_url
          ? `<img src="${esc(r.customer.avatar_url)}" alt="${esc(custName)}"
                  style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--color-border);flex-shrink:0;" />`
          : `<div style="width:40px;height:40px;border-radius:50%;background:var(--color-primary);
                          color:#fff;font-size:var(--font-size-base);font-weight:700;
                          display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>`
        }
        <div class="review-meta">
          <div class="review-names">
            ${esc(custName)}
            <span>→</span>
            ${esc(provName)}
          </div>
          <div class="review-stars">${stars}</div>
          <div class="review-date">${dateStr}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:var(--spacing-2);flex-shrink:0;">
        ${!r.is_visible
          ? `<span class="badge badge-danger" style="font-size:.6rem;">Hidden</span>`
          : `<span class="badge badge-success" style="font-size:.6rem;">Visible</span>`}
      </div>
    </div>
    ${r.comment ? `
    <div class="review-card-body">
      <div class="review-comment">${esc(r.comment)}</div>
    </div>` : ''}
    <div class="review-card-foot">
      <a href="/booking-detail.html?id=${r.booking_id}" class="review-booking-link">
        📋 Booking #${r.booking_id.slice(0, 8)}…
      </a>
      <div class="review-visibility-row">
        <span class="review-vis-label" id="vis-label-${r.id}">${r.is_visible ? 'Visible' : 'Hidden'}</span>
        <label class="vis-toggle" title="Toggle visibility">
          <input type="checkbox" id="vis-toggle-${r.id}"
                 ${r.is_visible ? 'checked' : ''}
                 onchange="toggleVisibility('${r.id}', this.checked)" />
          <span class="vis-track"></span>
        </label>
      </div>
    </div>
  </div>`;
}

// ── Toggle visibility ─────────────────────────────────────────
async function toggleVisibility(reviewId, isVisible) {
  // Optimistic UI
  const card  = document.getElementById(`rv-${reviewId}`);
  const label = document.getElementById(`vis-label-${reviewId}`);
  if (card)  card.classList.toggle('hidden-review', !isVisible);
  if (label) label.textContent = isVisible ? 'Visible' : 'Hidden';

  const { error } = await window.supabase
    .from('reviews')
    .update({ is_visible: isVisible, updated_at: new Date().toISOString() })
    .eq('id', reviewId);

  if (error) {
    // Revert
    const cb = document.getElementById(`vis-toggle-${reviewId}`);
    if (cb)    cb.checked = !isVisible;
    if (card)  card.classList.toggle('hidden-review', isVisible);
    if (label) label.textContent = isVisible ? 'Hidden' : 'Visible';
    showToast('Update failed: ' + error.message, 'error');
    return;
  }

  // Update local state
  const idx = allReviews.findIndex(r => r.id === reviewId);
  if (idx !== -1) allReviews[idx].is_visible = isVisible;

  showToast(isVisible ? 'Review is now visible.' : 'Review hidden from public.', 'success');
  renderStats();

  // Update badge label in card header without full re-render
  const badgeEl = card?.querySelector('.badge');
  if (badgeEl) {
    badgeEl.className = `badge ${isVisible ? 'badge-success' : 'badge-danger'}`;
    badgeEl.textContent = isVisible ? 'Visible' : 'Hidden';
  }
}

// ── Helpers ────────────────────────────────────────────────────
function formatDateShort(str) {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function custInitials(name) {
  return (name ?? '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function show(id)     { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hide(id)     { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = String(val); }

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
