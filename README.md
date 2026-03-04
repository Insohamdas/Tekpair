# 🔧 Tekpair — Local Services Booking Platform

A full-featured, production-ready local services marketplace connecting homeowners with trusted professionals. Built entirely with vanilla HTML, CSS, and JavaScript backed by Supabase.

---

## 🖼️ Features

### For Customers
- **Browse providers** by category, location, and rating
- **Book services** with date/time selection and address entry
- **Live booking tracking** — status timeline from request to completion
- **Before/after photos** — view work images uploaded by providers
- **Inline reviews** — rate and comment directly on the booking detail page
- **Reschedule requests** — propose and accept/reject new times
- **Real-time notifications** — bell icon with Supabase Realtime

### For Providers
- **Job dashboard** — all incoming/active/completed jobs in one view
- **Job detail page** — full customer info, inline notes, inline photo upload
- **Status management** — confirm → start → complete with optional final pricing
- **Profile management** — bio, services offered, rates, and verification status

### For Admins
- **Platform dashboard** — key stats and recent activity
- **Provider verification** — approve/reject provider applications
- **Category management** — CRUD for service categories
- **Review moderation** — flag or remove inappropriate reviews

---

## 🛠️ Tech Stack

| Layer        | Technology |
|--------------|------------|
| Frontend     | Vanilla HTML5, CSS3, JavaScript (ES2020+) |
| Backend/DB   | [Supabase](https://supabase.com) (PostgreSQL + Auth + Storage + Realtime) |
| Hosting      | [Netlify](https://netlify.com) (static hosting with SPA redirect) |
| Fonts        | Google Fonts — Inter |
| Avatars      | [DiceBear](https://dicebear.com) initials SVG |

---

## 🚀 Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Open the **SQL Editor** and run the contents of `supabase/schema.sql` to create all tables, RLS policies, storage buckets, and seed data.

### 2. Configure Keys

Open `js/supabase.js` and replace the placeholder values:

```js
const SUPABASE_URL  = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_KEY';
```

Both values are found in **Supabase dashboard → Settings → API**.

### 3. Enable Storage Buckets

In the Supabase dashboard go to **Storage** and ensure these buckets exist (created by the SQL script):
- `avatars` — public
- `work-images` — public

### 4. Run Locally

No build step required. Serve the root folder with any static server:

```bash
# Using Python
python3 -m http.server 3000

# Using Node http-server
npx http-server . -p 3000

# Using VS Code Live Server extension — open landing.html → Go Live
```

Then open [http://localhost:3000](http://localhost:3000).

### 5. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. Push this repository to GitHub.
2. Import the repo in Vercel. Framework preset: **Other**. Build command: *(leave blank)*. Output directory: `.`
3. Vercel reads `vercel.json` automatically — the SPA redirect and cache headers are handled.

> `netlify.toml` is also included if you prefer Netlify.

---

## 📁 Project Structure

```
tekpair/
├── landing.html              # Browse / homepage
├── index.html               # Sign in / register
├── bookings.html           # Customer bookings list
├── booking-detail.html     # Booking detail (customer + provider shared)
├── booking.html            # New booking form
├── 404.html                # Not found page
├── provider/
│   ├── dashboard.html      # Provider job list
│   ├── profile.html        # Provider profile editor
│   └── job-detail.html     # Provider-focused job management
├── admin/
│   ├── dashboard.html      # Admin overview
│   ├── providers.html      # Provider management
│   ├── categories.html     # Category management
│   └── reviews.html        # Review moderation
├── css/
│   ├── main.css            # Base variables, typography, layout
│   └── components.css      # UI components (cards, modals, badges, …)
├── js/
│   ├── supabase.js         # Supabase client initialisation
│   ├── auth.js             # Auth helpers + nav UI
│   ├── utils.js            # Shared utilities (toast, format, cache, …)
│   ├── notifications.js    # Real-time notification bell
│   └── pages/             # Page-specific JS modules
│       ├── browse.js
│       ├── my-bookings.js
│       ├── booking.js
│       ├── booking-detail.js
│       ├── provider-dashboard.js
│       ├── provider-profile.js
│       ├── provider-job-detail.js
│       ├── admin-dashboard.js
│       ├── admin-providers.js
│       ├── admin-categories.js
│       └── admin-reviews.js
└── supabase/
    └── schema.sql          # Full database schema + RLS + seed
```

---

## 🔑 Default Roles

| Role       | Access |
|------------|--------|
| `customer` | Browse, book, review |
| `provider` | Manage their own jobs and profile |
| `admin`    | Full platform management |

Set a user's role in the `profiles` table `role` column via the Supabase dashboard or SQL.

---

## 📄 License

MIT © 2026 Tekpair
