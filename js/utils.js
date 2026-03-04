// ============================================================
// Tekpair – Utility Helpers
// ============================================================

// ── Toast notifications ──────────────────────────────────────
// type: 'success' | 'error' | 'warning' | 'info'
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✓',
    error:   '✕',
    warning: '⚠',
    info:    'ℹ',
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] ?? icons.info}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(toast);

  // Trigger enter animation on next frame
  requestAnimationFrame(() => toast.classList.add('toast-show'));

  // Auto-dismiss after 3 s
  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3000);
}

// ── Skeleton loading ─────────────────────────────────────────
const _loadingOriginals = new Map();

function showLoading(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  _loadingOriginals.set(elementId, el.innerHTML);
  el.innerHTML = `
    <div class="skeleton-card">
      <div class="skeleton skeleton-text" style="width:60%"></div>
      <div class="skeleton skeleton-text" style="width:80%"></div>
      <div class="skeleton skeleton-text" style="width:40%"></div>
    </div>`;
}

function hideLoading(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const original = _loadingOriginals.get(elementId);
  if (original !== undefined) {
    el.innerHTML = original;
    _loadingOriginals.delete(elementId);
  }
}

// ── Date formatting ──────────────────────────────────────────
// "Mon, 15 Jan 2024 at 2:30 PM"
function formatDate(dateString) {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (isNaN(d)) return '—';

  const dayName  = d.toLocaleDateString('en-IN', { weekday: 'short' });
  const day      = d.getDate();
  const month    = d.toLocaleDateString('en-IN', { month: 'short' });
  const year     = d.getFullYear();
  const time     = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

  return `${dayName}, ${day} ${month} ${year} at ${time}`;
}

// ── Price formatting ─────────────────────────────────────────
// "₹1,200" / "₹1,200.50"
function formatPrice(amount) {
  if (amount === null || amount === undefined) return '—';
  const num = Number(amount);
  if (isNaN(num)) return '—';

  const formatted = num.toLocaleString('en-IN', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `₹${formatted}`;
}

// ── Status helpers ───────────────────────────────────────────
const STATUS_CONFIG = {
  requested:   { cssClass: 'badge-requested',   label: 'Requested'    },
  confirmed:   { cssClass: 'badge-confirmed',   label: 'Confirmed'    },
  in_progress: { cssClass: 'badge-in_progress', label: 'In Progress'  },
  completed:   { cssClass: 'badge-completed',   label: 'Completed'    },
  cancelled:   { cssClass: 'badge-cancelled',   label: 'Cancelled'    },
  rejected:    { cssClass: 'badge-rejected',    label: 'Rejected'     },
};

function getStatusColor(status) {
  return STATUS_CONFIG[status]?.cssClass ?? 'badge-requested';
}

function getStatusLabel(status) {
  return STATUS_CONFIG[status]?.label ?? status;
}

// ── Supabase Storage upload ──────────────────────────────────
// Returns the public URL string on success, throws on error.
async function uploadImage(file, bucket, path) {
  validateImageFile(file); // throws if invalid

  const { error: uploadError } = await window.supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true });

  if (uploadError) throw new Error(uploadError.message);

  const { data } = window.supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// ── Image file validation ────────────────────────────────────
// Throws a descriptive Error if the file is invalid.
function validateImageFile(file) {
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_SIZE_MB   = 5;

  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Only JPG, PNG, and WebP images are allowed.');
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`Image must be smaller than ${MAX_SIZE_MB} MB.`);
  }
  return true;
}

// ── Debounce ─────────────────────────────────────────────────
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ── Truncate long text ───────────────────────────────────────
function truncate(str, maxLen = 80) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

// ── Generate a short unique path for storage uploads ─────────
function makeStoragePath(folder, filename) {
  const ext  = filename.split('.').pop();
  const uid  = crypto.randomUUID?.() ?? Date.now().toString(36);
  return `${folder}/${uid}.${ext}`;
}

// ── Render star rating HTML ──────────────────────────────────
// Returns HTML string of filled/empty stars.
function starsHTML(rating, max = 5) {
  let html = '';
  for (let i = 1; i <= max; i++) {
    html += `<span class="star ${i <= rating ? 'star-filled' : 'star-empty'}">★</span>`;
  }
  return html;
}

// ── Image lazy loading ───────────────────────────────────────
// Call after adding images to the DOM.
// Mark images with data-src instead of src; this function swaps them in.
function lazyLoadImages(root = document) {
  const imgs = root.querySelectorAll('img[data-src]');
  if (!imgs.length) return;

  if (!('IntersectionObserver' in window)) {
    // Fallback: load everything immediately
    imgs.forEach(img => { img.src = img.dataset.src; img.removeAttribute('data-src'); });
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
      obs.unobserve(img);
    });
  }, { rootMargin: '200px 0px' });

  imgs.forEach(img => observer.observe(img));
}

// ── Infinite scroll helper ───────────────────────────────────
// Calls loadFn() whenever the user scrolls near the bottom of `sentinel`.
// sentinel: a DOM element placed after the last list item ("load more" spacer).
// loadFn: async function — should return false when there are no more items.
function setupInfiniteScroll(sentinel, loadFn) {
  if (!sentinel || !loadFn) return;

  let loading = false;
  let done    = false;

  const observer = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || loading || done) return;
    loading = true;
    const hasMore = await loadFn();
    if (hasMore === false) {
      done = true;
      observer.disconnect();
    }
    loading = false;
  }, { rootMargin: '300px 0px' });

  observer.observe(sentinel);

  // Expose a way to reset (e.g. after filter change)
  return {
    reset() { done = false; loading = false; },
    disconnect() { observer.disconnect(); },
  };
}

// ── Session-storage cache helpers ───────────────────────────
// cacheSet(key, data, ttlMinutes) — stores { data, exp } JSON
// cacheGet(key) — returns data if not expired, else null
const _CACHE_PREFIX = 'tp_cache_';

function cacheSet(key, data, ttlMinutes = 5) {
  const exp = Date.now() + ttlMinutes * 60_000;
  try {
    sessionStorage.setItem(_CACHE_PREFIX + key, JSON.stringify({ data, exp }));
  } catch (e) {
    // sessionStorage full or unavailable — silently skip
  }
}

function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(_CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, exp } = JSON.parse(raw);
    if (Date.now() > exp) {
      sessionStorage.removeItem(_CACHE_PREFIX + key);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

function cacheClear(key) {
  sessionStorage.removeItem(_CACHE_PREFIX + key);
}

function cacheClearAll() {
  Object.keys(sessionStorage)
    .filter(k => k.startsWith(_CACHE_PREFIX))
    .forEach(k => sessionStorage.removeItem(k));
}
