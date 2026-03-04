// ============================================================
// Tekpair – Notifications System (js/notifications.js)
// Self-contained: injects bell UI, manages localStorage,
// subscribes to Supabase Realtime for the current user.
// Load AFTER supabase.js, auth.js, utils.js.
// ============================================================

const NotifManager = (() => {
  // ── Constants ──────────────────────────────────────────────
  const STORE_KEY = 'tekpair_notifs';
  const MAX_STORE = 50;
  const MAX_SHOW  = 10;

  // ── Message templates ──────────────────────────────────────
  const TEMPLATES = {
    // Customer notifications
    booking_confirmed:    d => `✅ Your booking was confirmed by ${d.provider ?? 'your provider'}`,
    booking_started:      d => `🔧 ${d.provider ?? 'Your provider'} has started your job`,
    booking_completed:    _  => `🎉 Job completed! Leave a review for your provider`,
    booking_rejected:     _  => `❌ Your booking was rejected by the provider`,
    reschedule_accepted:  _  => `📅 Reschedule accepted — check your updated schedule`,
    reschedule_rejected:  _  => `📅 Reschedule request was declined`,
    // Provider notifications
    booking_new:          d => `🆕 New booking request from ${d.customer ?? 'a customer'}`,
    reschedule_requested: _  => `📅 A customer wants to reschedule their booking`,
  };

  // ── Status → notification type map for customers ───────────
  const STATUS_TYPE_MAP = {
    confirmed:    'booking_confirmed',
    in_progress:  'booking_started',
    completed:    'booking_completed',
    rejected:     'booking_rejected',
  };

  // ── DOM refs ───────────────────────────────────────────────
  let bellBtn, badge, dropdown, list;
  let realtimeChannel = null;

  // ── Storage ────────────────────────────────────────────────
  function getAll() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? []; } catch { return []; }
  }
  function save(items) {
    localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, MAX_STORE)));
  }

  // ── Add notification ───────────────────────────────────────
  function add(type, data = {}) {
    const tmpl = TEMPLATES[type];
    if (!tmpl) return null;
    const msg  = tmpl(data);
    const item = {
      id:   `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      msg,
      read: false,
      ts:   new Date().toISOString(),
    };
    const all = getAll();
    all.unshift(item);
    save(all);
    updateBadge();
    if (list) renderList();
    return item;
  }

  // ── Mark all read ──────────────────────────────────────────
  function markAllRead() {
    save(getAll().map(n => ({ ...n, read: true })));
    updateBadge();
    renderList();
  }

  // ── Unread count ───────────────────────────────────────────
  function unreadCount() {
    return getAll().filter(n => !n.read).length;
  }

  // ── Update badge + bell animation ─────────────────────────
  function updateBadge() {
    if (!badge || !bellBtn) return;
    const count = unreadCount();
    if (count > 0) {
      badge.textContent     = count > 9 ? '9+' : String(count);
      badge.style.display   = 'flex';
      bellBtn.classList.add('has-unread');
    } else {
      badge.style.display   = 'none';
      bellBtn.classList.remove('has-unread');
    }
  }

  // ── Toggle dropdown ────────────────────────────────────────
  function toggle() {
    if (!dropdown) return;
    const isOpen = dropdown.classList.toggle('open');
    if (isOpen) renderList();
  }

  // ── Render list ────────────────────────────────────────────
  function renderList() {
    if (!list) return;
    const items = getAll().slice(0, MAX_SHOW);
    if (!items.length) {
      list.innerHTML = `<div class="notif-empty">🔕 No notifications yet</div>`;
      return;
    }
    list.innerHTML = items.map(n => `
      <div class="notif-item${n.read ? '' : ' unread'}">
        <div class="notif-item-msg">${escHtml(n.msg)}</div>
        <div class="notif-item-time">${timeAgo(n.ts)}</div>
      </div>`).join('');
  }

  // ── Inject bell HTML ───────────────────────────────────────
  function injectBell() {
    const bellHTML = `
      <div class="notif-bell-wrap" id="notif-bell-wrap">
        <button class="notif-bell-btn" id="notif-bell-btn" aria-label="Notifications" aria-haspopup="true">
          <span class="notif-bell-icon" aria-hidden="true">🔔</span>
          <span class="notif-badge" id="notif-badge" style="display:none;"></span>
        </button>
        <div class="notif-dropdown" id="notif-dropdown" role="dialog" aria-label="Notifications panel">
          <div class="notif-dropdown-head">
            <span class="notif-dropdown-title">Notifications</span>
            <button class="notif-mark-all" id="notif-mark-all" type="button">Mark all read</button>
          </div>
          <div class="notif-list" id="notif-list"></div>
        </div>
      </div>`;

    // ── Non-admin pages: insert before #user-menu ────────────
    const userMenu = document.getElementById('user-menu');
    if (userMenu && userMenu.parentElement) {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'contents';
      wrapper.innerHTML     = bellHTML.trim();
      const bellWrap = wrapper.firstElementChild;
      // Mirror data-auth so auth.js updateNavUI shows/hides it
      bellWrap.setAttribute('data-auth', 'user');
      bellWrap.style.display = 'none';
      userMenu.parentElement.insertBefore(bellWrap, userMenu);
      return;
    }

    // ── Admin pages: insert inside data-auth="user" span ────
    // Find the span that contains the logout button
    const authSpans = document.querySelectorAll('[data-auth="user"]');
    for (const span of authSpans) {
      const logoutBtn = span.querySelector('button[onclick*="logout"]');
      if (logoutBtn) {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'contents';
        wrapper.innerHTML     = bellHTML.trim();
        span.insertBefore(wrapper.firstElementChild, logoutBtn);
        return;
      }
    }
  }

  // ── Inject Dashboard link into nav dropdown ───────────────
  function injectDashboardLink(role) {
    const dropdownMenu = document.querySelector('.nav-dropdown-menu');
    if (!dropdownMenu) return;
    // Don't duplicate
    if (dropdownMenu.querySelector('[data-notif-dash]')) return;

    const dashMap = {
      customer: { href: '/bookings.html',          label: '📋 My Bookings'  },
      provider: { href: '/provider/dashboard.html', label: '📊 Dashboard'    },
      admin:    { href: '/admin/dashboard.html',    label: '🛡️ Admin Panel'  },
    };
    const entry = dashMap[role];
    if (!entry) return;

    // Check if there's already a dashboard-like link
    const existingLinks = Array.from(dropdownMenu.querySelectorAll('a'));
    const alreadyExists = existingLinks.some(a =>
      a.href.includes('dashboard') || a.href.includes('bookings')
    );
    if (alreadyExists) return;

    const link = document.createElement('a');
    link.href             = entry.href;
    link.className        = 'nav-dropdown-item';
    link.textContent      = entry.label;
    link.dataset.notifDash = '1';

    // Insert after the first item (My Profile)
    const firstItem = dropdownMenu.querySelector('.nav-dropdown-item');
    if (firstItem && firstItem.nextSibling) {
      dropdownMenu.insertBefore(link, firstItem.nextSibling);
    } else {
      dropdownMenu.appendChild(link);
    }
  }

  // ── Wire event listeners ───────────────────────────────────
  function wireEvents() {
    bellBtn  = document.getElementById('notif-bell-btn');
    badge    = document.getElementById('notif-badge');
    dropdown = document.getElementById('notif-dropdown');
    list     = document.getElementById('notif-list');
    const markAllBtn = document.getElementById('notif-mark-all');

    if (bellBtn) {
      bellBtn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    }
    if (markAllBtn) {
      markAllBtn.addEventListener('click', e => { e.stopPropagation(); markAllRead(); });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', e => {
      if (!dropdown || !dropdown.classList.contains('open')) return;
      const wrap = document.getElementById('notif-bell-wrap');
      if (wrap && !wrap.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });

    // Close on Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && dropdown?.classList.contains('open')) {
        dropdown.classList.remove('open');
        bellBtn?.focus();
      }
    });
  }

  // ── Realtime subscription ──────────────────────────────────
  function subscribeToBookings(userId, role) {
    if (!window.supabase || role === 'admin') return;

    const filterKey = role === 'provider' ? 'provider_id' : 'customer_id';

    realtimeChannel = window.supabase
      .channel(`notif:${userId}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'bookings',
        filter: `${filterKey}=eq.${userId}`,
      }, async payload => {
        if (role === 'provider') {
          const b = payload.new;
          let customerName = 'a customer';
          if (b?.customer_id) {
            const { data } = await window.supabase
              .from('profiles')
              .select('name')
              .eq('id', b.customer_id)
              .single();
            if (data?.name) customerName = data.name;
          }
          const notif = add('booking_new', { customer: customerName });
          if (notif && typeof showToast === 'function') showToast(notif.msg, 'info');
        }
        // Customers don't get a notification on their own INSERT
      })
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'bookings',
        filter: `${filterKey}=eq.${userId}`,
      }, async payload => {
        const newRow = payload.new ?? {};
        const oldRow = payload.old ?? {};

        if (newRow.status === oldRow.status) return; // No status change

        if (role === 'customer') {
          const type = STATUS_TYPE_MAP[newRow.status];
          if (!type) return;

          let providerName = 'your provider';
          if (newRow.provider_id) {
            const { data } = await window.supabase
              .from('profiles')
              .select('name')
              .eq('id', newRow.provider_id)
              .single();
            if (data?.name) providerName = data.name;
          }
          const notif = add(type, { provider: providerName });
          if (notif && typeof showToast === 'function') showToast(notif.msg, 'info');
        }

        if (role === 'provider') {
          // Check for reschedule request from customer
          const wasRescheduled =
            newRow.reschedule_requested_at &&
            newRow.reschedule_requested_at !== oldRow.reschedule_requested_at;
          if (wasRescheduled) {
            const notif = add('reschedule_requested', {});
            if (notif && typeof showToast === 'function') showToast(notif.msg, 'info');
          }
        }
      })
      .subscribe();
  }

  // ── Main init ──────────────────────────────────────────────
  async function init() {
    if (!window.supabase) return;

    // Wait for DOM
    if (document.readyState === 'loading') {
      await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    }

    injectBell();
    wireEvents();
    updateBadge();
    renderList();

    // Get auth state
    const { data: { session } } = await window.supabase.auth.getSession();
    if (!session?.user) return;

    // Show bell now (auth.js may already have run updateNavUI, but in case it sets
    // display:none on data-auth="user" elements, the bell needs to be shown too)
    const bellWrap = document.getElementById('notif-bell-wrap');
    if (bellWrap && bellWrap.getAttribute('data-auth') === 'user') {
      // auth.js's updateNavUI will handle this — just ensure it's styled inline
      bellWrap.style.display = '';
    }

    // Get role
    const { data: profile } = await window.supabase
      .from('profiles')
      .select('role, name')
      .eq('id', session.user.id)
      .single();

    if (!profile) return;
    const { role } = profile;

    // Inject dashboard link into nav dropdown
    injectDashboardLink(role);

    // Subscribe
    subscribeToBookings(session.user.id, role);
  }

  // ── Helpers ────────────────────────────────────────────────
  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Boot ───────────────────────────────────────────────────
  init();

  // ── Public API ─────────────────────────────────────────────
  return {
    add,
    markAllRead,
    toggle,
    getAll,
  };
})();
