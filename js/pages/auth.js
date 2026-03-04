// ============================================================
// Tekpair – Auth Page Logic  (js/pages/auth.js)
// Depends on: window.supabase, showToast(), redirectToDashboard()
// ============================================================

// ── Redirect if already logged in ───────────────────────────
(async () => {
  const { data: { session } } = await window.supabase.auth.getSession();
  if (session?.user) {
    const { data: profile } = await window.supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();
    if (profile) {
      redirectToDashboard(profile.role);
    }
  }
})();

// ── Helpers ──────────────────────────────────────────────────

function setFieldError(fieldId, message) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  el.textContent = message;
  const input = document.getElementById(fieldId.replace('-error', ''));
  if (input) {
    if (message) input.classList.add('error');
    else input.classList.remove('error');
  }
}

function clearFieldErrors(...fieldIds) {
  fieldIds.forEach(id => setFieldError(id, ''));
}

function showFormError(wrapperId, msgId, message) {
  const wrapper = document.getElementById(wrapperId);
  const msg     = document.getElementById(msgId);
  if (!wrapper || !msg) return;
  msg.textContent = message;
  wrapper.style.display = 'flex';
}

function hideFormError(wrapperId) {
  const wrapper = document.getElementById(wrapperId);
  if (wrapper) wrapper.style.display = 'none';
}

function setButtonLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

function getSelectedRole() {
  const selected = document.querySelector('.role-card.selected');
  return selected ? selected.dataset.role : 'customer';
}

// ── Validation ───────────────────────────────────────────────

function validateLoginForm(email, password) {
  let valid = true;
  clearFieldErrors('login-email-error', 'login-password-error');

  if (!email) {
    setFieldError('login-email-error', 'Email is required.');
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError('login-email-error', 'Enter a valid email address.');
    valid = false;
  }

  if (!password) {
    setFieldError('login-password-error', 'Password is required.');
    valid = false;
  }

  return valid;
}

function validateRegisterForm({ name, email, password, city }) {
  let valid = true;
  clearFieldErrors(
    'reg-name-error',
    'reg-email-error',
    'reg-password-error',
    'reg-city-error',
    'reg-role-error',
  );

  if (!name || name.trim().length < 2) {
    setFieldError('reg-name-error', 'Full name must be at least 2 characters.');
    valid = false;
  }

  if (!email) {
    setFieldError('reg-email-error', 'Email is required.');
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError('reg-email-error', 'Enter a valid email address.');
    valid = false;
  }

  if (!password) {
    setFieldError('reg-password-error', 'Password is required.');
    valid = false;
  } else if (password.length < 6) {
    setFieldError('reg-password-error', 'Password must be at least 6 characters.');
    valid = false;
  }

  if (!city || city.trim().length < 2) {
    setFieldError('reg-city-error', 'Please enter your city.');
    valid = false;
  }

  return valid;
}

// ── LOGIN ────────────────────────────────────────────────────

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideFormError('login-error');

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!validateLoginForm(email, password)) return;

  setButtonLoading('login-btn', true);

  try {
    const { data, error } = await window.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    // Fetch profile to determine role
    const { data: profile, error: profileError } = await window.supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile) {
      // Profile missing – still let them in as customer
      showToast('Signed in! Redirecting…', 'success');
      setTimeout(() => { window.location.href = '/landing.html'; }, 800);
      return;
    }

    showToast('Welcome back! Redirecting…', 'success');
    setTimeout(() => redirectToDashboard(profile.role), 800);

  } catch (err) {
    let msg = err.message ?? 'Sign in failed. Please try again.';
    if (msg.toLowerCase().includes('invalid login')) {
      msg = 'Incorrect email or password.';
    }
    showFormError('login-error', 'login-error-msg', msg);
  } finally {
    setButtonLoading('login-btn', false);
  }
});

// ── REGISTER ─────────────────────────────────────────────────

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideFormError('register-error');

  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const phone    = document.getElementById('reg-phone').value.trim();
  const city     = document.getElementById('reg-city').value.trim();
  const role     = getSelectedRole();

  if (!validateRegisterForm({ name, email, password, city })) return;

  setButtonLoading('register-btn', true);

  try {
    // 1. Create auth user
    const { data: signUpData, error: signUpError } = await window.supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, role },   // stored in raw_user_meta_data (used by DB trigger)
      },
    });

    if (signUpError) throw signUpError;

    const userId = signUpData.user?.id;
    if (!userId) throw new Error('User creation failed. Please try again.');

    // 2. Upsert profile row only when we have an active session.
    //    If email confirmation is enabled in Supabase, signUpData.session is
    //    null here — the DB trigger (handle_new_user) creates the profile row
    //    automatically using the metadata we passed to signUp().
    //    If confirmation is OFF, session is active and we upsert immediately.
    if (signUpData.session) {
      const { error: profileError } = await window.supabase
        .from('profiles')
        .upsert({
          id:    userId,
          name,
          email,
          phone: phone || null,
          city,
          role,
        }, { onConflict: 'id' });

      // Ignore RLS / conflict errors — the DB trigger already created the row
      if (profileError && !profileError.message.includes('row-level security') && profileError.code !== '23505') {
        throw profileError;
      }
    }

    // 3. Redirect or prompt email confirmation
    if (!signUpData.session) {
      // Email confirmation required — show message, don't redirect yet
      showFormError('register-error', 'register-error-msg',
        '✅ Account created! Check your email to confirm your address, then sign in.');
      document.getElementById('register-error').style.background = '#EFF6FF';
      document.getElementById('register-error').style.borderColor = '#3B82F6';
      document.getElementById('register-error').style.color = '#1D4ED8';
      setButtonLoading('register-btn', false);
      return;
    }

    showToast('Account created! Setting up your dashboard…', 'success');

    setTimeout(() => {
      if (role === 'provider') {
        window.location.href = '/provider/profile.html?setup=true';
      } else {
        window.location.href = '/landing.html';
      }
    }, 900);

  } catch (err) {
    let msg = err.message ?? 'Registration failed. Please try again.';
    if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists')) {
      msg = 'An account with this email already exists. Try signing in.';
    }
    showFormError('register-error', 'register-error-msg', msg);
  } finally {
    setButtonLoading('register-btn', false);
  }
});

// ── FORGOT PASSWORD ──────────────────────────────────────────

document.getElementById('forgot-link').addEventListener('click', (e) => {
  e.preventDefault();
  showToast('Password reset is coming soon!', 'info');
});

// ── Live field validation (blur) ─────────────────────────────

document.getElementById('login-email').addEventListener('blur', function () {
  if (this.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value)) {
    setFieldError('login-email-error', 'Enter a valid email address.');
  } else {
    setFieldError('login-email-error', '');
  }
});

document.getElementById('reg-email').addEventListener('blur', function () {
  if (this.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value)) {
    setFieldError('reg-email-error', 'Enter a valid email address.');
  } else {
    setFieldError('reg-email-error', '');
  }
});

document.getElementById('reg-password').addEventListener('input', function () {
  if (this.value.length > 0 && this.value.length < 6) {
    setFieldError('reg-password-error', 'Password must be at least 6 characters.');
  } else {
    setFieldError('reg-password-error', '');
  }
});
