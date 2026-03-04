// ============================================================
// Tekpair – Admin Dashboard (js/pages/admin-dashboard.js)
// Depends on: window.supabase, requireRole(), showToast(),
//             formatDate(), formatPrice(), getStatusColor(), getStatusLabel()
// ============================================================

// ── Status chart config ───────────────────────────────────────
const STATUS_CHART_CONFIG = [
  { key: 'requested',   label: 'Requested',   color: '#6366F1' },
  { key: 'confirmed',   label: 'Confirmed',   color: '#2563EB' },
  { key: 'in_progress', label: 'In Progress', color: '#D97706' },
  { key: 'completed',   label: 'Completed',   color: '#16A34A' },
  { key: 'cancelled',   label: 'Cancelled',   color: '#6B7280' },
  { key: 'rejected',    label: 'Rejected',    color: '#DC2626' },
];

// ── Bootstrap ─────────────────────────────────────────────────
(async () => {
  const profile = await requireRole('admin');
  if (!profile) return;

  updateNavUI(profile);

  const now  = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  setText('dash-sub', `${greet}, ${profile.name?.split(' ')[0] ?? 'Admin'}! Here's what's happening today.`);

  await Promise.all([loadStats(), loadActivity(), loadChart()]);
})();

// ── Stats ─────────────────────────────────────────────────────
async function loadStats() {
  const [usersRes, providersRes, bookingsRes, pendingRes] = await Promise.all([
    window.supabase.from('profiles').select('id', { count: 'exact', head: true }),
    window.supabase.from('provider_profiles').select('id', { count: 'exact', head: true }),
    window.supabase.from('bookings').select('id', { count: 'exact', head: true }),
    window.supabase
      .from('provider_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_approved', false),
  ]);

  setText('stat-users',    usersRes.count    ?? '—');
  setText('stat-providers', providersRes.count ?? '—');
  setText('stat-bookings',  bookingsRes.count  ?? '—');
  setText('stat-pending',   pendingRes.count   ?? '—');
}

// ── Recent Activity table ─────────────────────────────────────
async function loadActivity() {
  const { data, error } = await window.supabase
    .from('bookings')
    .select(`
      id, status, scheduled_at, created_at,
      estimated_price, final_price,
      customer:profiles!bookings_customer_id_fkey ( id, name ),
      provider:profiles!bookings_provider_id_fkey ( id, name )
    `)
    .order('created_at', { ascending: false })
    .limit(10);

  hide('activity-skeleton');
  show('activity-table-wrap');

  if (error || !data?.length) {
    document.getElementById('activity-tbody').innerHTML =
      `<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted);padding:var(--spacing-8);">
         No bookings found.</td></tr>`;
    return;
  }

  document.getElementById('activity-tbody').innerHTML = data.map(b => {
    const price = b.final_price ?? b.estimated_price;
    return `<tr onclick="window.location='/booking-detail.html?id=${b.id}'">
      <td>${esc(b.customer?.name ?? '—')}</td>
      <td>${esc(b.provider?.name  ?? '—')}</td>
      <td><span class="badge ${getStatusColor(b.status)}">${getStatusLabel(b.status)}</span></td>
      <td class="td-mono">${b.scheduled_at ? formatDateShort(b.scheduled_at) : '—'}</td>
      <td class="td-mono">${price ? formatPrice(price) : '—'}</td>
    </tr>`;
  }).join('');
}

// ── Bookings by Status chart ──────────────────────────────────
async function loadChart() {
  const { data, error } = await window.supabase
    .from('bookings')
    .select('status');

  hide('chart-skeleton');
  show('chart-wrap');

  if (error || !data?.length) {
    document.getElementById('chart-wrap').innerHTML =
      `<p style="text-align:center;color:var(--color-text-muted);padding:var(--spacing-6);">No data.</p>`;
    return;
  }

  // Count per status
  const counts = {};
  data.forEach(b => { counts[b.status] = (counts[b.status] ?? 0) + 1; });
  const max    = Math.max(...Object.values(counts), 1);

  const chartEl = document.getElementById('chart-wrap');
  chartEl.innerHTML = STATUS_CHART_CONFIG
    .filter(cfg => counts[cfg.key] !== undefined)
    .sort((a, b) => (counts[b.key] ?? 0) - (counts[a.key] ?? 0))
    .map(cfg => {
      const count = counts[cfg.key] ?? 0;
      const pct   = Math.round((count / max) * 100);
      return `
      <div class="chart-row">
        <div class="chart-row-top">
          <span class="chart-row-label">${cfg.label}</span>
          <span class="chart-row-count">${count}</span>
        </div>
        <div class="chart-track">
          <div class="chart-fill" style="width:0%;background:${cfg.color};"
               data-target="${pct}"></div>
        </div>
      </div>`;
    }).join('');

  // Animate bars after paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.chart-fill[data-target]').forEach(el => {
        el.style.width = el.dataset.target + '%';
      });
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────
function formatDateShort(str) {
  if (!str) return '—';
  const d  = new Date(str);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
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
