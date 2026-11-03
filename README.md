# FlowPOS main site

A one-page landing site with a live Three.js scene showing what FlowPOS does:
a sale made on the **point of sale**, **kiosk**, **online store**, **payment link** or **subscription** flies to the
**FlowPOS Cloud**, then lands on the **kitchen screen** and the **dashboard**.
Scrolling moves the camera from device to device.

## Run locally

No build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Files

- `index.html` – page content and sections (each `data-shot` section = one camera stop)
- `styles.css` – layout, text cards, mobile styles
- `main.js` – the 3D scene, device screens, order animation, scroll camera
- `vendor/three.module.min.js` – Three.js r160, self-hosted (no CDN needed)

## Editing

- **Text:** change it in `index.html`.
- **Menu items / demo numbers on screens:** `MENU` and `S` near the top of `main.js`.
- **Colours:** `C` in `main.js` and `:root` in `styles.css`.
- **"Book a demo" link:** set the `mailto:` in the last section of `index.html`.

Respects `prefers-reduced-motion`, and falls back to a plain gradient if WebGL is not available.

## Deploy (Cloudflare Workers)

The site is served as static files by a Cloudflare Worker (`wrangler.jsonc`).
`.assetsignore` keeps non-site files (like `.git`, this README and the config) private,
and `_headers` sets security headers and long caching for `vendor/`.

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
