// ============================================================
// Tekpair – Homepage Browse Logic  (js/pages/browse.js)
// Depends on: window.supabase, showToast(), debounce()
// ============================================================

// ── State ────────────────────────────────────────────────────
let allProviders   = [];   // raw data from Supabase
let allCategories  = [];
let activeCategoryId = null;
let availOnlyFilter  = false;
let realtimeChannel  = null;

// ── Debounced filter (bound after DOM ready) ─────────────────
const debouncedFilter = debounce(applyFilters, 320);

// ── Bootstrap ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCategories(), loadProviders()]);
  
  // Parse URL Parameters
  const params = new URLSearchParams(window.location.search);
  const q = (params.get('q') || '').toLowerCase().trim();
  const catParam = (params.get('category') || '').toLowerCase().trim();
  
  // Handle Search Query
  if(q) {
      const searchInput = document.getElementById('search-input');
      if(searchInput) {
          searchInput.value = q;
      }
      
      // Try to match category name roughly from query if no category param
      if(!catParam) {
          const matchedCat = allCategories.find(c => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase()));
          if (matchedCat) {
              activeCategoryId = matchedCat.id;
          }
      }
  }
  
  // Handle Category Param (supports ID or fuzzy name match)
  if(catParam) {
      // 1. Try exact ID match
      let matched = allCategories.find(c => c.id === catParam);
      
      // 2. Try fuzzy name match (e.g. "ac" matches "AC Repair")
      if (!matched) {
          matched = allCategories.find(c => {
             const cName = c.name.toLowerCase();
             // Check if category name contains the param (e.g. "ac repair" contains "ac")
             // or if param contains category name (less likely but possible)
             // simplified: check if category name words include partial match
             return cName.includes(catParam) || catParam.includes(cName);
          });
      }
      
      if(matched) {
          activeCategoryId = matched.id;
      }
  }
  
  // Update UI & Filter
  if(activeCategoryId) {
      const catSelect = document.getElementById('filter-category');
      if(catSelect) catSelect.value = activeCategoryId;
  }
  
  applyFilters();
  
  subscribeToProviderUpdates();
  syncNavRole();
  
  // Bind search input
  const sInput = document.getElementById('search-input');
  if(sInput) sInput.addEventListener('input', debouncedFilter);
});

// ── Load + render categories ─────────────────────────────────
async function loadCategories() {
  const { data, error } = await window.supabase
    .from('categories')
    .select('id, name, icon, base_price, price_unit, description')
    .eq('is_active', true)
    .order('name');

  if (error) {
    showToast('Failed to load categories.', 'error');
    console.error(error);
    return;
  }

  allCategories = data ?? [];
  renderCategories();
  populateCategoryFilter();
}

function renderCategories() {
  const grid = document.getElementById('categories-grid');
  if (!grid) return;

  if (!allCategories.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="empty-state-icon">🏗</div>
      <div class="empty-state-title">No categories yet</div>
      <p class="empty-state-desc">Check back soon!</p>
    </div>`;
    return;
  }

  grid.innerHTML = allCategories.map(cat => `
    <div
      class="category-card ${activeCategoryId === cat.id ? 'active' : ''}"
      id="cat-card-${cat.id}"
      onclick="filterByCategory('${cat.id}')"
      tabindex="0"
      role="button"
      aria-label="Browse ${cat.name} providers"
      onkeydown="if(event.key==='Enter'||event.key===' ')filterByCategory('${cat.id}')"
    >
      <span class="category-icon">${cat.icon ?? '🔧'}</span>
      <div class="category-name">${escHtml(cat.name)}</div>
      <div class="category-price">${formatPrice(cat.base_price)} / ${cat.price_unit ?? 'job'}</div>
      <button class="btn btn-outline btn-sm" style="margin-top:auto;">View Providers</button>
    </div>
  `).join('');
}

function populateCategoryFilter() {
  const sel = document.getElementById('filter-category');
  if (!sel) return;
  // keep the "All" option, append the rest
  sel.innerHTML = '<option value="">All Categories</option>' +
    allCategories.map(c => `<option value="${c.id}">${c.icon ?? ''} ${escHtml(c.name)}</option>`).join('');
  if (activeCategoryId) sel.value = activeCategoryId;
}

// ── Load + render providers ──────────────────────────────────
async function loadProviders() {
  const { data, error } = await window.supabase
    .from('provider_profiles')
    .select(`
      id,
      user_id,
      bio,
      years_experience,
      category_id,
      is_available,
      rating_avg,
      rating_count,
      city,
      areas,
      categories ( id, name, icon, base_price, price_unit ),
      profiles ( id, name, avatar_url )
    `)
    .eq('is_approved', true)
    .order('rating_avg', { ascending: false });

  if (error) {
    showToast('Failed to load providers.', 'error');
    console.error(error);
    document.getElementById('providers-grid').innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state-icon">😕</div>
        <div class="empty-state-title">Couldn't load providers</div>
        <p class="empty-state-desc">Please refresh the page.</p>
      </div>`;
    return;
  }

  allProviders = data ?? [];
  applyFilters();
}

// ── Filter + render providers ────────────────────────────────
function applyFilters() {
  const cityVal   = (document.getElementById('filter-city')?.value ?? '').trim().toLowerCase();
  const areaVal   = (document.getElementById('filter-area')?.value ?? '').trim().toLowerCase();
  const catVal    = document.getElementById('filter-category')?.value ?? '';
  const searchVal = (document.getElementById('search-input')?.value ?? '').trim().toLowerCase();

  // Sync activeCategoryId with dropdown
  if (catVal) activeCategoryId = catVal;
  else if (searchVal) {
      // If user clears category but has search, keep category open or match by text? 
      // Let's rely on explicit category selection OR text search.
      // If dropdown is "All", activeCategoryId might be null, but maybe text search implies a category.
      // For now, let dropdown rule the strict category filter.
      if(!activeCategoryId) activeCategoryId = null; 
  }

  let filtered = allProviders.filter(p => {
    // 1. Category Filter (Strict)
    if (activeCategoryId && p.category_id !== activeCategoryId) {
         // Exception: If search term explicitly matches this provider's category name, allow it?
         // No, if a Category is selected in dropdown, show ONLY that category.
         return false;
    }

    // 2. City Filter
    if (cityVal && !(p.city ?? '').toLowerCase().includes(cityVal)) return false;

    // 3. Area Filter
    if (areaVal) {
      const areasMatch = (p.areas ?? []).some(a => a.toLowerCase().includes(areaVal));
      if (!areasMatch) return false;
    }

    // 4. Availability Filter
    if (availOnlyFilter && !p.is_available) return false;
    
    // 5. Keyword Search (Name, Bio, Service Name)
    if (searchVal) {
        const nameMatch = (p.profiles?.name ?? '').toLowerCase().includes(searchVal);
        const bioMatch  = (p.bio ?? '').toLowerCase().includes(searchVal);
        const catMatch  = (p.categories?.name ?? '').toLowerCase().includes(searchVal);
        
        if (!nameMatch && !bioMatch && !catMatch) return false;
    }

    return true;
  });

  renderProviders(filtered);
}

function renderProviders(providers) {
  const grid = document.getElementById('providers-grid');
  const countText = document.getElementById('providers-count-text');
  if (!grid) return;

  if (countText) {
    countText.textContent = providers.length
      ? `Showing ${providers.length} professional${providers.length !== 1 ? 's' : ''}`
      : 'No professionals match your filters';
  }

  if (!providers.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-title">No providers found</div>
        <p class="empty-state-desc">Try adjusting your filters or clearing the category selection.</p>
        <button class="btn btn-outline btn-sm mt-4" onclick="clearAllFilters()">Clear Filters</button>
      </div>`;
    return;
  }

  grid.innerHTML = providers.map(p => providerCardHTML(p)).join('');
}

function providerCardHTML(p) {
  const profile  = p.profiles ?? {};
  const category = p.categories ?? {};
  const name     = escHtml(profile.name ?? 'Provider');
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const avatar   = profile.avatar_url
    ? `<img src="${escHtml(profile.avatar_url)}" alt="${name}" class="avatar avatar-lg" />`
    : `<div class="avatar-initials avatar-lg">${initials}</div>`;

  const stars   = starsHTML(Math.round(p.rating_avg ?? 0));
  const rating  = p.rating_avg ? Number(p.rating_avg).toFixed(1) : '—';
  const reviews = p.rating_count ?? 0;

  const areas   = (p.areas ?? []).slice(0, 3).map(a => escHtml(a)).join(', ');
  const cityStr = escHtml(p.city ?? '');
  const exp     = p.years_experience ? `${p.years_experience}yr exp` : '';

  const availBadge = p.is_available
    ? `<span class="avail-badge-available">Available Now</span>`
    : `<span class="avail-badge-unavailable">Unavailable</span>`;

  const priceStr = category.base_price
    ? `Starting <strong>${formatPrice(category.base_price)}</strong> / ${category.price_unit ?? 'job'}`
    : '';

  const bookHref = `/booking.html?provider=${p.user_id}`;
  const bookOnClick = `handleBookNow('${p.user_id}')`;

  return `
    <div class="provider-card">
      <div class="provider-card-top">
        ${avatar}
        <div class="provider-info">
          <div class="provider-name-row">
            <h3 class="provider-name">${name}</h3>
            <span class="verified-badge">✓ Verified</span>
          </div>
          ${category.name ? `<div class="provider-category">${category.icon ?? ''} ${escHtml(category.name)}</div>` : ''}
          <div class="provider-meta">
            ${cityStr ? `<span>📍 ${cityStr}</span>` : ''}
            ${areas   ? `<span class="provider-meta-sep">·</span><span>${areas}</span>` : ''}
            ${exp     ? `<span class="provider-meta-sep">·</span><span>${exp}</span>` : ''}
          </div>
        </div>
        <div style="flex-shrink:0;">${availBadge}</div>
      </div>
      <div class="provider-card-divider"></div>
      <div class="provider-card-bottom">
        <div>
          <div class="provider-rating">
            <span class="star-rating" style="font-size:0.85rem;">${stars}</span>
            <span class="provider-rating-score">${rating}</span>
            <span class="provider-rating-count">(${reviews})</span>
          </div>
          ${priceStr ? `<div class="provider-price mt-1">${priceStr}</div>` : ''}
        </div>
        <button
          class="btn btn-primary btn-sm"
          onclick="${bookOnClick}"
          ${!p.is_available ? 'disabled title="Provider is currently unavailable"' : ''}
        >Book Now</button>
      </div>
    </div>
  `;
}

// ── Book now handler ─────────────────────────────────────────
async function handleBookNow(providerId) {
  const { data: { session } } = await window.supabase.auth.getSession();
  if (!session) {
    showToast('Please sign in to book a provider.', 'info');
    setTimeout(() => { window.location.href = '/index.html'; }, 900);
    return;
  }
  window.location.href = `/booking.html?provider=${providerId}`;
}

// ── Category filter ──────────────────────────────────────────
function filterByCategory(categoryId) {
  activeCategoryId = activeCategoryId === categoryId ? null : categoryId;

  // Update card highlights
  document.querySelectorAll('.category-card').forEach(card => {
    card.classList.toggle('active', card.id === `cat-card-${activeCategoryId}`);
  });

  // Sync dropdown
  const sel = document.getElementById('filter-category');
  if (sel) sel.value = activeCategoryId ?? '';

  // Scroll to providers
  document.getElementById('providers-section')?.scrollIntoView({ behavior: 'smooth' });

  applyFilters();
}

function clearCategoryFilter() {
  activeCategoryId = null;
  document.querySelectorAll('.category-card').forEach(c => c.classList.remove('active'));
  const sel = document.getElementById('filter-category');
  if (sel) sel.value = '';
  applyFilters();
}

// ── Availability toggle ──────────────────────────────────────
function toggleAvailFilter(el) {
  availOnlyFilter = !availOnlyFilter;
  el.classList.toggle('on', availOnlyFilter);
  applyFilters();
}

// ── Hero search → apply to filter bar + scroll ───────────────
function applySearch() {
  const city = document.getElementById('search-city')?.value.trim();
  const area = document.getElementById('search-area')?.value.trim();
  if (city) {
    const fc = document.getElementById('filter-city');
    if (fc) fc.value = city;
  }
  if (area) {
    const fa = document.getElementById('filter-area');
    if (fa) fa.value = area;
  }
  document.getElementById('providers-section')?.scrollIntoView({ behavior: 'smooth' });
  applyFilters();
}

// ── Clear all filters ────────────────────────────────────────
function clearAllFilters() {
  activeCategoryId = null;
  availOnlyFilter  = false;
  document.querySelectorAll('.category-card').forEach(c => c.classList.remove('active'));
  const ids = ['filter-city', 'filter-area', 'search-city', 'search-area'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const sel = document.getElementById('filter-category');
  if (sel) sel.value = '';
  const toggle = document.getElementById('avail-toggle');
  if (toggle) toggle.classList.remove('on');
  applyFilters();
}

// ── Realtime: provider availability updates ──────────────────
function subscribeToProviderUpdates() {
  realtimeChannel = window.supabase
    .channel('public:provider_profiles')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'provider_profiles' },
      (payload) => {
        const updated = payload.new;
        if (!updated) return;

        // Patch in-memory array
        const idx = allProviders.findIndex(p => p.id === updated.id);
        if (idx !== -1) {
          // Preserve joined data (profiles, categories)
          allProviders[idx] = { ...allProviders[idx], ...updated };
        } else if (payload.eventType === 'INSERT' && updated.is_approved) {
          // New provider approved — reload fresh to get joined data
          loadProviders();
          return;
        }

        applyFilters();
        if (payload.eventType === 'UPDATE') {
          const name = allProviders[idx]?.profiles?.name ?? 'A provider';
          const msg  = updated.is_available
            ? `${name} is now available!`
            : `${name} is currently unavailable.`;
          showToast(msg, 'info');
        }
      }
    )
    .subscribe();
}

// ── Sync nav role-based links ────────────────────────────────
async function syncNavRole() {
  const { data: { session } } = await window.supabase.auth.getSession();
  if (!session) return;

  const { data: profile } = await window.supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();

  if (!profile) return;
  const role = profile.role;

  // Show the correct role-specific nav section
  document.querySelectorAll('[data-role-show]').forEach(el => {
    el.style.display = el.dataset.roleShow === role ? 'flex' : 'none';
  });
}

// ── Utility: HTML-escape ─────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
