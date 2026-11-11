# FlowPOS holding page

A simple one-page holding site for FlowPOS (EPOS, payments, banking, e-commerce, pricing, FAQ, contact).

## Run locally

No build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Files

- `index.html` – all page content
- `privacy-policy.html` – privacy policy, served at `/privacy-policy` (styles in `assets/css/legal.css`)
- `assets/css/site.css` – styles
- `assets/js/site.js` – tabs, mobile menu, scroll effects, contact form
- `assets/img/` – logos, icons, screenshots
- `assets/fonts/inter-var.woff2` – Inter font, self-hosted

## To do

- Privacy policy: fill in the yellow `[bracket]` blanks (ICO number, analytics tool, cookie settings link, keep-times, data protection contact).
- Contact form: set the real endpoint in the form `action` in `index.html` (it is a `TODO` placeholder now).

## Deploy (Cloudflare Workers)

The site is served as static files by a Cloudflare Worker (`wrangler.jsonc`).
`.assetsignore` keeps non-site files (like `.git`, this README and the config) private,
and `_headers` sets security headers and 1-day caching for `assets/`.

**One-time setup (auto-deploy from GitHub):**

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Pick `FlowPosLtd/main`.
3. Project name: `main` (must match `name` in `wrangler.jsonc`).
4. Build command: leave empty. Deploy command: `npx wrangler deploy`.
5. Production branch: `main`. Save and deploy.

After that, every push to `main` goes live at `https://main.<your-subdomain>.workers.dev`.
To use your own domain later: Worker → **Settings** → **Domains & Routes** → **Add** → Custom domain.

**Preview locally like Cloudflare does:**

```bash
npx wrangler dev
```
