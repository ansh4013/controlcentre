# Nexora Login → Supabase (Full Setup)

All login data is stored in **your** Supabase project.  
No Google Sheets. Free tier is enough for normal traffic.

---

## Files in this package

| File | Purpose |
|------|---------|
| `nexora-login-supabase.html` | Login page (UI + form + Supabase insert) |
| `supabase-schema.sql` | Creates table + security policies |
| `nexora-gate.js` | Optional: forces the login page on first visit |
| `SUPABASE-SETUP.md` | This guide |

---

## Step 1 — Create a free Supabase project

1. Go to **https://supabase.com** → Sign in / Sign up  
2. **New project**  
   - Name: e.g. `nexora`  
   - Database password: save it somewhere safe  
   - Region: closest to your users  
3. Wait until the project is ready (green status)

---

## Step 2 — Create the table

1. In the Supabase dashboard open **SQL Editor** → **New query**  
2. Paste the entire contents of `supabase-schema.sql`  
3. Click **Run**  

You should see: `Success. No rows returned`

Check: **Table Editor** → you now have a table named `nexora_logins`.

---

## Step 3 — Get your API keys

1. Go to **Project Settings** (gear icon) → **API**  
2. Copy:
   - **Project URL** → looks like `https://abcdefgh.supabase.co`  
   - **anon public** key → long JWT starting with `eyJ...`

---

## Step 4 — Configure the login page

Open `nexora-login-supabase.html` and replace these two lines:

```js
const SUPABASE_URL  = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON = 'YOUR_SUPABASE_ANON_KEY';
```

with the real values you copied.

Also check / change if needed:

```js
const DEFAULT_REDIRECT = 'https://ansh4013.github.io/aichatbot-/';
```

---

## Step 5 — Host the login page

Upload `nexora-login-supabase.html` to a public URL, for example:

- Same Vercel project as Nexora  
- GitHub Pages  
- Any static host  

Example final URL:  
`https://ansh4013.github.io/aichatbot-/login.html`

---

## Step 6 — Force the gate on Nexora (recommended)

Add this near the top of the main Nexora page (`<body>`):

```html
<script
  src="https://YOUR-HOST/nexora-gate.js"
  data-login-url="https://YOUR-HOST/nexora-login-supabase.html"
  defer>
</script>
```

Replace `YOUR-HOST` with the real domain where you uploaded the files.

After a successful login the script sets `sessionStorage.nexora_logged_in`, so the same browser is not asked again in that session.

---

## Step 7 — Test

1. Open the login page in an **incognito / private** window  
2. Fill name + email → submit  
3. You should see “Welcome! Redirecting…” and land on Nexora  
4. In Supabase → **Table Editor** → `nexora_logins` → a new row appears  

---

## What is stored

| Column      | Content                          |
|-------------|----------------------------------|
| id          | Auto number                      |
| created_at  | Server timestamp                 |
| name        | Form                             |
| email       | Form (lowercased)                |
| role        | Dropdown                         |
| interest    | Dropdown                         |
| message     | Optional free text               |
| page        | Login page URL                   |
| user_agent  | Browser string (truncated)         |

**No passwords** are collected or stored.

---

## Security (already configured)

- **Row Level Security (RLS)** is enabled  
- Public (anon) users can only **INSERT**  
- They **cannot** SELECT / UPDATE / DELETE other people’s rows  
- You view data only while logged into the Supabase dashboard (or with the `service_role` key, which must never be put in frontend code)

**Never put the `service_role` key in the HTML or any public JavaScript.**

---

## Viewing & exporting data

- **Table Editor** in Supabase → see all rows live  
- **Export** → CSV from the table menu  
- Or connect any BI tool / spreadsheet using the Supabase API  

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| “Supabase keys not configured” | You still have the placeholder text in the HTML |
| Insert error / RLS | Re-run `supabase-schema.sql` and confirm the policy “Allow public insert” exists |
| CORS error | Make sure you use the official `@supabase/supabase-js` CDN and the correct Project URL |
| Nothing appears in the table | Check browser console (F12) for the exact error message |

---

## Quick checklist

- [ ] Supabase project created  
- [ ] `supabase-schema.sql` run successfully  
- [ ] Project URL + anon key copied  
- [ ] Keys pasted into `nexora-login-supabase.html`  
- [ ] Login page uploaded to a public URL  
- [ ] Gate script added to main Nexora page (optional)  
- [ ] Tested in incognito → row appears in Table Editor  

That’s the complete solution. All data now goes to Supabase instead of Google Sheets.
