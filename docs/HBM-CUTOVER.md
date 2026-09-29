# HBM cutover (next week)

Ship when ready. CI already builds on GitHub; this is the **name/path** cutover only.

## Already done (do not redo)

- Workflow: **Deploy HBM Dashboard** (`.github/workflows/deploy.yml`)
- Pattern: CI `npm run build` with `VITE_*` secrets → SCP `dist/` → droplet `npm ci --omit=dev` → `pm2 restart`
- GitHub secrets: `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_PRIVATE_KEY`, `VITE_API_SECRET`, `VITE_ANTHROPIC_API_KEY`
- Runtime secrets stay on droplet `.env` only (`MIX_*`, `API_SECRET`, `PORT`, `LAFARGE_ORG_ID`, etc.)
- Live path today: `/var/www/larfarge-dashboard`, PM2 `larfarge-dashboard`, nginx → `localhost:3003`, host `larfarge.bestpracticesltd.com.ng`

## Next-week checklist

### 1. Droplet paths & process

```bash
# stop serving under old name
pm2 stop larfarge-dashboard

# move code (preserves .env, logs, node_modules, dist)
mv /var/www/larfarge-dashboard /var/www/hbm-dashboard

cd /var/www/hbm-dashboard
# ensure PORT stays 3003 for nginx until you change that too
grep -q '^PORT=' .env && sed -i 's/^PORT=.*/PORT=3003/' .env || echo 'PORT=3003' >> .env

pm2 delete larfarge-dashboard || true
PORT=3003 pm2 start server.js --name hbm-dashboard --node-args='--max-old-space-size=768'
pm2 save
```

Optional: keep a symlink during DNS transition:

```bash
ln -sfn /var/www/hbm-dashboard /var/www/larfarge-dashboard
```

### 2. Nginx + TLS

- Copy `/etc/nginx/sites-available/larfarge-dashboard` → `hbm-dashboard`
- `server_name hbm.bestpracticesltd.com.ng;` (and keep `larfarge.…` as alias until DNS/clients move)
- `proxy_pass http://localhost:3003;`
- DNS A record for `hbm.bestpracticesltd.com.ng` → droplet `138.68.186.213`
- `certbot --nginx -d hbm.bestpracticesltd.com.ng`
- `nginx -t && systemctl reload nginx`

Timeouts and the friendly "busy, please refresh" page (`public/hbm-busy.html`, deployed to `dist/`). Served by nginx straight from disk, so it still shows while Node is stuck. Inside the `server { ... }` block for `hbm.bestpracticesltd.com.ng` (443):

```nginx
    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_connect_timeout 10s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
        # ... existing proxy_set_header lines ...
    }

    error_page 502 503 504 /hbm-busy.html;
    location = /hbm-busy.html {
        root /var/www/hbm-dashboard/dist;
        internal;
        add_header Cache-Control "no-store" always;
    }
```

The original status code (502/504) is kept, so API calls still see a failed response. The app's own 503s (stats warming) pass through unchanged, because `proxy_intercept_errors` is off.

### 3. GitHub workflow paths

In `.github/workflows/deploy.yml`, replace:


| Today                         | Next week                |
| ----------------------------- | ------------------------ |
| `/var/www/larfarge-dashboard` | `/var/www/hbm-dashboard` |
| `pm2 … larfarge-dashboard`    | `pm2 … hbm-dashboard`    |
| artifact `hbm-dist`           | keep                     |


Push to `main` after path edit so the next deploy targets HBM only.

### 4. Repo / branding (optional same day)

- Rename GitHub repo `Larfarge-Dashboard` → `HBM-Dashboard` (update local `git remote`)
- UI copy: Lafarge → HBM (Settings client name, Safety subtitle, SafeIQ prompt, etc.)
- Env alias: accept `HBM_ORG_ID` with fallback to `LAFARGE_ORG_ID` in scripts/`mix-test.js`

### 5. Auth go-live (before first users)

Login UI is already in the SPA (`/#/login`). On the droplet `.env` (not GitHub):

```bash
NODE_ENV=production
AUTH_COOKIE_SECURE=1
AUTH_BOOTSTRAP_EMAIL=you@bestpracticesltd.com.ng
AUTH_BOOTSTRAP_PASSWORD='strong-unique-password'
AUTH_BOOTSTRAP_NAME='Platform Admin'
```

- Bootstrap admin is created **only if** `fleet.db` has zero users (file is gitignored — survives deploys).
- Sequence: deploy → open `https://hbm…/#/login` → sign in with bootstrap → forced password change → Settings → Users to provision staff.
- nginx must forward cookies / HTTPS (`proxy_set_header X-Forwarded-Proto $scheme;` and `Host`).
- After first login, remove or rotate `AUTH_BOOTSTRAP_PASSWORD` from `.env` (it is unused once users exist).

### 6. Verify

```bash
curl -sf -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3003/
curl -skI https://hbm.bestpracticesltd.com.ng | head -5
# Auth smoke (expect 401 without cookie)
curl -s -o /dev/null -w "%{http_code}\n" https://hbm.bestpracticesltd.com.ng/api/auth/me
pm2 show HBM-Dashboard | grep -E 'status|exec cwd|script path'
```

Hard-refresh the browser after deploy (new `dist/` hashes).

## Also stacked: make GitHub repo private

Repo is still **public**. Flipping private will break droplet `git fetch` until auth is fixed.

Droplet today: `https://github.com/ipinnu/Larfarge-Dashboard.git` with **no** token/deploy key.

**Before private:**

1. On droplet, create a read-only deploy key and add it under GitHub → repo → Settings → Deploy keys
2. Switch remote: `git remote set-url origin git@github.com:ipinnu/Larfarge-Dashboard.git`
3. Test: `git fetch origin`
4. Then set visibility to private
5. Run one Actions deploy to confirm

(Or use a fine-grained PAT in the HTTPS remote — deploy key is cleaner.)

## Do not

- Rebuild Vite on the droplet (OOM on ~1GB box)
- Put `MIX_*` / private keys in GitHub — only `VITE_*` + SSH
- Expect `pm2 restart` alone to fix a bad frontend bake
- Make the repo private before droplet git auth is fixed

