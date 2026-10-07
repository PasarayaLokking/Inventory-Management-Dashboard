# Stock Management System

This is an inventory management dashboard for managing stock in a traditional shoe management system , it is able to key in / out stock and manage stock including sales insights together to set alarm for stock management to alert shop owner if their product is close to empty.

Every phone, tablet and PC sees the same numbers and updates live.

- **Frontend:** React + Vite, hosted free on Cloudflare (static files only).
- **Backend:** Supabase free tier, which provides the Postgres database, logins and live updates. There is no server of our own.
- **Design source:** `design/Shoe Stock Control.dc.html` (the Claude Design prototype this app was built from).

## How stock is kept

Stock is never typed over. Every change (a sale, stock in, return, count or exchange) is saved as a **movement** with who, when and why. Stock on the shelf is the sum of those movements (`stock` view). This has three consequences:

- **Undo** marks a movement as voided. Nothing is deleted, so the history stays complete.
- A **stock count** records only the difference between what you counted and what the card says.
- The rules live in the database, so a staff phone cannot bypass them. The two functions `record_movement` and `void_movement` check them:
  - Staff may only record sales and stock in, and undo only their own entries from today.
  - Admins may do everything.

## One-time setup

### 1. Supabase project
1. Create a free project at [supabase.com](https://supabase.com). Pick the Singapore region.
2. Open **SQL Editor**, paste all of [supabase/migrations/0001_schema.sql](supabase/migrations/0001_schema.sql) and click **Run**.
3. Go to **Authentication → Sign In / Providers → Email**:
   - Turn **off** "Allow new users to sign up". This is important: otherwise anyone could register and read your stock.
   - Keep the minimum password length at 6.
4. Go to **Project Settings → API** and copy the **Project URL** and the **anon / publishable key**.

### 2. Local settings
```bash
cp .env.example .env      # then paste the URL and key into .env
npm install
npm run dev               # opens http://localhost:5173
```

### 3. Staff logins
Staff sign in with a **username** and a **6-digit PIN**. Supabase needs an email address, so each login is created as `<username>@kasut.local`. No email is ever sent to that address.

**Add a person:** go to Authentication → Users → **Add user → Create new user**.
- Email: `aina@kasut.local`
- Password: their 6-digit PIN
- Tick **Auto Confirm User**

The app shows them by their username with a capital letter (e.g. Aina) and gives them the **staff** role. To change the name or make someone an admin, run this in the SQL Editor:
```sql
update profiles set display_name = 'Aina binti Ali' where username = 'aina';
update profiles set role = 'admin' where username = 'hafiz';
```

**Reset a PIN** (SQL Editor):
```sql
update auth.users set encrypted_password = extensions.crypt('654321', extensions.gen_salt('bf'))
where email = 'aina@kasut.local';
```

**Someone leaves:** block their login. Do not delete the user, because their past entries point to them.
```sql
update auth.users set banned_until = 'infinity' where email = 'aina@kasut.local';
```

### 4. Import the current stock (once)
1. Export the shop's stock sheet as CSV, with one row per item and size. Use these columns:
   `Item, Colour, Brand, Details, Category, Size system, Size, Pairs in stock`
   - Size system is UK, EU or Capal.
   - Only Item, Size system, Size and Pairs are required.
   - This is the same layout the app's **Stock → Download CSV** produces.
2. Put the **service_role** key in `.env` as `SUPABASE_SERVICE_ROLE_KEY`. It is in Project Settings → API. Keep it secret: it bypasses all rules, and it is never shipped to the website.
3. Do a dry run first. It checks the file and changes nothing:
   ```bash
   npm run import -- stock.csv
   npm run import -- stock.csv --commit
   ```

The import refuses to run twice, so the stock can't be doubled by accident. Sales charts start empty and fill up as sales are keyed in.

### 5. Put it online (Cloudflare, free)
```bash
npx wrangler login        # once; opens the browser
npm run deploy            # builds with the values in .env, then uploads
```
Wrangler prints the address, e.g. `https://kasut-stock-card.<your-name>.workers.dev`. Bookmark it on every shop device. To publish changes later, run `npm run deploy` again.

## Looking after it
- **Pausing:** Supabase pauses free projects after 7 days with no use. Daily shop use prevents that. If it ever pauses, press **Restore** in the Supabase dashboard.
- **Offline:** if the Wi-Fi drops, saving shows an error and the typed lines stay on screen. Press Save again when the connection is back.

## Development
```bash
npm run dev        # local app
npm test           # stock/sales maths (src/lib/stats.ts)
npm run test:db    # runs the real migration in an in-memory Postgres and checks roles, RLS, undo, counts
npm run build      # type-check + production build
```

| Where | What |
|---|---|
| [supabase/migrations/0001_schema.sql](supabase/migrations/0001_schema.sql) | tables, stock/sales views, `record_movement` / `void_movement`, row-level security, realtime |
| [src/lib/stats.ts](src/lib/stats.ts) | sales windows, weeks of cover, search, alarms (ported from the design) |
| [src/lib/data.tsx](src/lib/data.tsx) | loads everything, refreshes live on any change |
| [src/App.tsx](src/App.tsx) | sidebar, drawers, pop-ups, shared save/undo/alarm actions |
| `src/pages/*`, `src/drawers/*` | New sale / Stock in, Stock, Sales; item card, edit item, alarms |
| [scripts/import-stock.mjs](scripts/import-stock.mjs) | one-time sheet import |
