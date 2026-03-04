// ============================================================
// Tekpair – Admin Categories (js/pages/admin-categories.js)
// Depends on: window.supabase, requireRole(), showToast(),
//             formatPrice(), updateNavUI(), logout()
// ============================================================

// ── Emoji list ────────────────────────────────────────────────
const ICONS = [
  '🔧','🔨','⚡','🚿','🛁','🌿','🏠','🖥️','📱','❄️',
  '🔥','🚗','🎨','🧹','💡','🔑','🛠️','🧰','🪛','🔩',
  '🚪','🪟','🏗️','🌡️','🔌','💧','🪣','🧱','🌳','🛻',
];

// ── State ─────────────────────────────────────────────────────
let allCategories = [];
let editTargetId  = null;   // null = new, uuid = edit
let selectedIcon  = '🔧';

// ── Bootstrap ─────────────────────────────────────────────────
(async () => {
  const profile = await requireRole('admin');
  if (!profile) return;
  updateNavUI(profile);
  buildIconPicker();
  await loadCategories();
})();

// ── Data loading ──────────────────────────────────────────────
async function loadCategories() {
  const { data, error } = await window.supabase
    .from('categories')
    .select('*')
    .order('name', { ascending: true });

  if (error) { showToast('Failed to load categories: ' + error.message, 'error'); return; }

  allCategories = data ?? [];
  setText('cat-count', `${allCategories.length} categor${allCategories.length === 1 ? 'y' : 'ies'}`);
  renderTable();
}

// ── Table rendering ───────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('cat-tbody');
  if (!allCategories.length) {
    tbody.innerHTML = `<tr><td class="empty-cell" colspan="7" style="text-align:center;padding:var(--spacing-12) var(--spacing-4);color:var(--color-text-muted);">
      No categories yet. Click "Add Category" to create one.</td></tr>`;
    return;
  }
  tbody.innerHTML = allCategories.map(cat => catRowHTML(cat)).join('');
}

function catRowHTML(cat) {
  const price = cat.base_price
    ? `${formatPrice(cat.base_price)} <span style="color:var(--color-text-muted);font-size:.75rem;">${unitLabel(cat.price_unit)}</span>`
    : '—';
  return `
  <tr id="tr-${cat.id}">
    <td class="td-icon">${esc(cat.icon ?? '🔧')}</td>
    <td class="td-name">${esc(cat.name)}</td>
    <td class="td-desc" title="${esc(cat.description ?? '')}">${esc(truncate(cat.description ?? '', 60))}</td>
    <td class="td-price">${price}</td>
    <td style="color:var(--color-text-secondary);font-size:var(--font-size-xs);">${unitLabel(cat.price_unit)}</td>
    <td>
      <label class="row-toggle" title="${cat.is_active ? 'Active – click to deactivate' : 'Inactive – click to activate'}">
        <input type="checkbox" ${cat.is_active ? 'checked' : ''}
               onchange="toggleActive('${cat.id}', this.checked)" />
        <span class="row-toggle-track"></span>
      </label>
    </td>
    <td>
      <div class="td-actions">
        <button class="btn btn-outline btn-sm" onclick="openCatModal('${cat.id}')" title="Edit">✏️ Edit</button>
        <button class="btn btn-outline btn-sm" style="color:var(--color-danger);border-color:var(--color-danger);"
                onclick="deleteCategory('${cat.id}')" title="Delete">🗑</button>
      </div>
    </td>
  </tr>`;
}

function unitLabel(unit) {
  const map = { per_hour: '/hr', per_job: '/job', per_sqft: '/sqft' };
  return map[unit] ?? (unit ?? '');
}

// ── Icon picker ───────────────────────────────────────────────
function buildIconPicker() {
  const picker = document.getElementById('icon-picker');
  picker.innerHTML = ICONS.map(ic =>
    `<button type="button" class="icon-btn${ic === selectedIcon ? ' selected' : ''}"
             data-icon="${ic}" onclick="selectIcon('${ic}')">${ic}</button>`
  ).join('');
}

function selectIcon(icon) {
  selectedIcon = icon;
  document.getElementById('icon-preview').textContent = icon;
  document.querySelectorAll('.icon-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.icon === icon);
  });
}

// ── Modal open / close ────────────────────────────────────────
function openCatModal(catId = null) {
  editTargetId = catId;
  const cat    = catId ? allCategories.find(c => c.id === catId) : null;

  // Populate
  selectedIcon = cat?.icon ?? '🔧';
  document.getElementById('icon-preview').textContent = selectedIcon;
  buildIconPicker();
  document.getElementById('cat-name').value   = cat?.name        ?? '';
  document.getElementById('cat-desc').value   = cat?.description ?? '';
  document.getElementById('cat-price').value  = cat?.base_price  ?? '';
  document.getElementById('cat-unit').value   = cat?.price_unit  ?? 'per_job';
  document.getElementById('cat-active').checked = cat ? (cat.is_active ?? true) : true;

  document.getElementById('cat-modal-title').textContent = cat ? 'Edit Category' : 'Add Category';
  document.getElementById('cat-save-btn').textContent    = cat ? 'Save Changes' : 'Save Category';
  document.getElementById('cat-modal').classList.add('open');
  document.getElementById('cat-name').focus();
}

function closeCatModal() {
  document.getElementById('cat-modal').classList.remove('open');
  editTargetId = null;
}

// ── Save category (add / edit) ────────────────────────────────
async function saveCategory() {
  const name = document.getElementById('cat-name').value.trim();
  if (!name) { showToast('Category name is required.', 'warning'); document.getElementById('cat-name').focus(); return; }

  const payload = {
    icon:        selectedIcon,
    name,
    description: document.getElementById('cat-desc').value.trim()  || null,
    base_price:  parseFloat(document.getElementById('cat-price').value) || null,
    price_unit:  document.getElementById('cat-unit').value,
    is_active:   document.getElementById('cat-active').checked,
    updated_at:  new Date().toISOString(),
  };

  setBtnLoading('cat-save-btn', true);
  let error;

  if (editTargetId) {
    ({ error } = await window.supabase
      .from('categories')
      .update(payload)
      .eq('id', editTargetId));
  } else {
    payload.created_at = new Date().toISOString();
    ({ error } = await window.supabase
      .from('categories')
      .insert(payload));
  }

  setBtnLoading('cat-save-btn', false);
  if (error) { showToast('Save failed: ' + error.message, 'error'); return; }

  showToast(editTargetId ? 'Category updated!' : 'Category created!', 'success');
  closeCatModal();
  await loadCategories();
}

// ── Toggle active inline ──────────────────────────────────────
async function toggleActive(catId, isActive) {
  const { error } = await window.supabase
    .from('categories')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', catId);

  if (error) {
    showToast('Update failed: ' + error.message, 'error');
    // Revert UI
    const row = document.getElementById(`tr-${catId}`);
    if (row) {
      const cb = row.querySelector('input[type=checkbox]');
      if (cb) cb.checked = !isActive;
    }
    return;
  }

  const idx = allCategories.findIndex(c => c.id === catId);
  if (idx !== -1) allCategories[idx].is_active = isActive;
  showToast(isActive ? 'Category activated.' : 'Category deactivated.', 'success');
}

// ── Delete category ───────────────────────────────────────────
async function deleteCategory(catId) {
  // Guard: check if any bookings reference this category
  const { count, error: cntErr } = await window.supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', catId);

  if (cntErr) { showToast('Could not check bookings: ' + cntErr.message, 'error'); return; }

  if (count > 0) {
    showToast(`Cannot delete — this category has ${count} booking${count > 1 ? 's' : ''} associated with it.`, 'warning');
    return;
  }

  if (!confirm('Are you sure you want to delete this category? This cannot be undone.')) return;

  const { error } = await window.supabase
    .from('categories')
    .delete()
    .eq('id', catId);

  if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }

  allCategories = allCategories.filter(c => c.id !== catId);
  setText('cat-count', `${allCategories.length} categor${allCategories.length === 1 ? 'y' : 'ies'}`);
  renderTable();
  showToast('Category deleted.', 'success');
}

// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCatModal();
});

// ── Helpers ────────────────────────────────────────────────────
function setText(id, val)     { const el = document.getElementById(id); if (el) el.textContent = String(val); }
function setBtnLoading(id, v) { const el = document.getElementById(id); if (!el) return; el.disabled = v; el.classList.toggle('loading', v); }
function truncate(str, max)   { return str.length > max ? str.slice(0, max - 1) + '…' : str; }

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
