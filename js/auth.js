// ============================================================
// Tekpair – Auth Helpers
// ============================================================

// ── Inline profile cache (sessionStorage, 10 min TTL) ───────
// utils.js loads after auth.js so we inline a minimal cache here.
const _PROFILE_CACHE_KEY = 'tp_profile';
function _profileCacheGet() {
  try {
    const raw = sessionStorage.getItem(_PROFILE_CACHE_KEY);
    if (!raw) return null;
    const { data, exp } = JSON.parse(raw);
    if (Date.now() > exp) { sessionStorage.removeItem(_PROFILE_CACHE_KEY); return null; }
    return data;
  } catch { return null; }
}
function _profileCacheSet(profile) {
  try {
    sessionStorage.setItem(_PROFILE_CACHE_KEY, JSON.stringify({
      data: profile,
      exp:  Date.now() + 10 * 60_000,
    }));
  } catch { /* storage full – skip */ }
}
function _profileCacheClear() {
  sessionStorage.removeItem(_PROFILE_CACHE_KEY);
}

// ── Local SVG initials avatar (no external CDN call) ────────
function _initialsAvatar(name) {
  const initials = (name ?? 'U')
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const COLORS = ['#2563EB','#16A34A','#D97706','#DC2626',
                  '#7C3AED','#0891B2','#BE185D','#059669'];
  const color = COLORS[(name ?? 'U').charCodeAt(0) % COLORS.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'><rect width='64' height='64' rx='32' fill='${color}'/><text x='32' y='32' dominant-baseline='central' text-anchor='middle' font-family='Inter,system-ui,sans-serif' font-size='22' font-weight='600' fill='#fff'>${initials}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// ── Get current signed-in user ───────────────────────────────
async function getCurrentUser() {
  const { data: { session } } = await window.supabase.auth.getSession();
  return session?.user ?? null;
}

// ── Fetch profile (with sessionStorage cache) ────────────────
async function getUserProfile(userId) {
  const cached = _profileCacheGet();
  if (cached && cached.id === userId) return cached;

  const { data, error } = await window.supabase
    .from('profiles').select('*').eq('id', userId).single();

  if (error) { console.error('getUserProfile:', error.message); return null; }
  _profileCacheSet(data);
  return data;
}

// ── Redirect to index.html if no session ─────────────────────
async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) { window.location.href = '/index.html'; return null; }
  return user;
}

// ── Redirect if role doesn't match ──────────────────────────
async function requireRole(allowedRoles) {
  const user = await requireAuth();
  if (!user) return null;
  const profile = await getUserProfile(user.id);
  if (!profile) { window.location.href = '/index.html'; return null; }
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  if (!roles.includes(profile.role)) { redirectToDashboard(profile.role); return null; }
  return profile;
}

// ── Navigate to role dashboard ───────────────────────────────
function redirectToDashboard(role) {
  const dest = {
    customer: '/landing.html',
    provider: '/provider/dashboard.html',
    admin:    '/admin/dashboard.html',
  };
  window.location.href = dest[role] ?? '/landing.html';
}

// ── Sign out ─────────────────────────────────────────────────
async function logout() {
  _profileCacheClear();
  await window.supabase.auth.signOut();
  window.location.href = '/index.html';
}

// ── Update nav UI ────────────────────────────────────────────
// Handles: [data-auth="guest|user"] and [data-role-show="customer|provider|admin"]
function updateNavUI(profile) {
  // Show/hide guest vs logged-in elements
  document.querySelectorAll('[data-auth="guest"]').forEach(el => {
    el.style.display = profile ? 'none' : '';
  });
  document.querySelectorAll('[data-auth="user"]').forEach(el => {
    el.style.display = profile ? '' : 'none';
  });

  // Show only the nav links that match the user's role
  document.querySelectorAll('[data-role-show]').forEach(el => {
    const allowed = el.dataset.roleShow.split(',').map(r => r.trim());
    el.style.display = (profile && allowed.includes(profile.role)) ? '' : 'none';
  });

  // Fill name + avatar
  if (profile) {
    document.querySelectorAll('[data-user-name]').forEach(el => {
      el.textContent = profile.name ?? 'User';
    });
    document.querySelectorAll('[data-user-avatar]').forEach(el => {
      el.src = profile.avatar_url || _initialsAvatar(profile.name);
    });
  }
}

// ── Hide page loader ─────────────────────────────────────────
function hidePageLoader() {
  clearTimeout(window._loaderTimer);
  window._loaderTimer = null;
  const loader = document.getElementById('page-loader');
  if (!loader) return;
  loader.classList.add('loaded');
  const remove = () => { if (loader.parentNode) loader.parentNode.removeChild(loader); };
  loader.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 600);
}

// ── Auth state listener ──────────────────────────────────────
// onAuthStateChange fires INITIAL_SESSION immediately on subscribe —
// this replaces the old separate bootstrap IIFE (which caused double fetches).
window.supabase.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    // Avoid redundant DB hit on token refresh if profile is already cached
    const profile = (event === 'TOKEN_REFRESHED' && _profileCacheGet()?.id === session.user.id)
      ? _profileCacheGet()
      : await getUserProfile(session.user.id);
    updateNavUI(profile);
    window._currentProfile = profile;
  } else {
    _profileCacheClear();
    updateNavUI(null);
    window._currentProfile = null;
  }

  // Hide the loading screen once we know the initial auth state
  if (event === 'INITIAL_SESSION') hidePageLoader();
});
