# molinamarcvdb.github.io

Personal site — Marc Molina Van den Bosch. Static, no build step, no dependencies.

Live at **https://molinamarcvdb.github.io**

## The hero

The name is not an image or a font render. It's rasterised once into a point cloud, then every
point is displaced each frame by a sample from a **Laplace distribution** with scale `b = Δ/ε` —
the actual mechanism that gives ε-differential privacy. The vertical dial (left of the name)
sets global ε: drag down to spend budget and resolve the name; at low ε it genuinely disappears
into the noise. Points are coloured by displacement magnitude, so signal visibly separates from
noise.

The cursor is a query: points near it take extra Laplace noise plus a radial push, flashing
bright while agitated — the data perturbs locally under observation and heals when the query
moves on. Section headings decode out of glyph noise on scroll (`main.js`), carrying the same
signal-from-noise move through the page.

See `assets/js/noise.js`.

## Structure

```
index.html                        landing: hero, about, research, publications, experience, kosmico, contact
research/
  async-distributed-dp.html       NeurIPS 2026 (under review)
  dp-kfc.html                     ICML 2026 + MICCAI 2026
  synthetic-data.html             KSA applied work
assets/
  css/style.css                   all styling, one file
  js/noise.js                     DP-noise hero canvas
  js/main.js                      nav, scroll reveals, card glow
  marc-molina-cv.pdf              downloadable CV
.nojekyll                         serve files as-is, skip Jekyll
```

## Deploying

First time:

```bash
cd molinamarcvdb.github.io
git init
git add -A
git commit -m "Personal site"
git branch -M main
gh repo create molinamarcvdb.github.io --public --source=. --push
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `root`**.

Live in ~1 minute at `https://molinamarcvdb.github.io`. A repo named `<username>.github.io`
serves from the root domain — no project subpath.

Updates after that are just `git push`.

## Local preview

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. No build step — edit and refresh.

`file://` works too, but prefer the server: it matches how GitHub Pages serves the site.

## Updating the CV

The PDF is copied from the LaTeX project:

```bash
cp ../CV/main_cv.pdf assets/marc-molina-cv.pdf
```

## Custom domain later

Add a `CNAME` file containing the domain, then point DNS at GitHub:
`A` records to `185.199.108–111.153`, or a `CNAME` to `molinamarcvdb.github.io`.
Enable "Enforce HTTPS" in Settings → Pages.
