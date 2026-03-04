// ============================================================
// Tekpair – Supabase Client Initialisation
// ============================================================

const SUPABASE_URL     = 'https://egvtujsdeabykedzrxxx.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVndnR1anNkZWFieWtlZHpyeHh4Iiw' +
  'icm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NjkyMDYsImV4cCI6MjA4ODA0NTIwNn0.' +
  '-iqKuNBmo8WTL5kCGMXdSXlel5CE4oJ6WYVCQVCJX7o';

// The Supabase v2 CDN sets window.supabase = { createClient, ... } (the module).
// We must always call createClient() to get an actual client instance.
// Store it as window.supabase so all other scripts use it via that name.
const { createClient } = window.supabase;
window.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
