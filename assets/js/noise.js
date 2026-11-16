/* ============================================================
   Secure-aggregation + DP-noise hero.

   The name is rasterised once into a point cloud, and every point
   is dealt to one of five clients. The intro plays the protocol:

     01 Mask       each client's share sits in its own swirl —
                   alone, a masked share is indistinguishable from noise.
     02 Aggregate  pairwise masks ±m_ij grow between every pair of
                   clients and cancel where they meet; the shares stream
                   to the server and sum to the name.
     03 Release    the sum is perturbed by Laplace noise with scale
                   b = sensitivity / epsilon — the epsilon-DP mechanism.
                   Drag the dial to spend or save budget.

   Afterwards the clients rest as nodes under the name. Hover one to
   light up the fragment of the signal it contributed.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('nameCanvas');
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext('2d', { alpha: true });
  var slider = document.getElementById('epsSlider');   // .eps container (role=slider)
  var track = document.getElementById('epsTrack');
  var valEl = document.getElementById('epsVal');
  var stepEls = document.querySelectorAll('[data-sa-step]');
  var replayEl = document.getElementById('saReplay');

  var LINES = ['MARC MOLINA', 'VAN DEN BOSCH'];

  // Colour of a point with (near) zero displacement vs. a heavily displaced one.
  var SIGNAL = [94, 234, 212];
  var NOISY = [104, 118, 138];
  var HOT = [186, 255, 243];      // points flash bright while agitated

  // One hue per client — cool spectrum around the site's teal/blue.
  var CLIENTS = [
    [94, 234, 212],   // teal
    [124, 196, 250],  // sky
    [165, 180, 252],  // indigo
    [216, 180, 254],  // lavender
    [244, 164, 206]   // rose
  ];
  var NC = CLIENTS.length;
  var SUB = ['₁', '₂', '₃', '₄', '₅'];

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Intro timeline (ms) ---------- */
  var APPEAR = 800;                 // swirls bloom in
  var MESH0 = 450, MESH_D = 1050;   // mask lines grow from both ends and cancel
  var FLOW0 = 1900, FLOW_D = 1400;  // shares stream to their place in the sum
  var FLOW_SPREAD = 900;            // per-point departure stagger
  var NODE0 = 2500, NODE_D = 1200;  // swirls collapse into client nodes
  var EPS0 = 2600, EPS_D = 2400;    // released noise anneals toward rest epsilon
  var STEP1 = 1900, STEP2 = 3700;
  var INTRO_END = EPS0 + EPS_D;

  // Epsilon range, sampled logarithmically across the slider.
  var EPS_MIN = 0.08, EPS_MAX = 30;
  var EPS_START = 0.1;
  var EPS_REST = 18;     // resting epsilon — crisp, with a faint live shimmer

  /* ---------- State ---------- */
  var n = 0;                         // point count
  var TX, TY, CL, R0, TH0, DEL, CURV;
  var W = 0, H = 0, DPR = 1;
  var textH = 0, bandH = 0;          // device px
  var fontSize = 100;
  var noiseK = 18;                   // sensitivity Δ, in device px — scaled off fontSize
  var orbR = 0, nodeR = 0, nodeY = 0, textMid = 0, arcMax = 0;
  var imgData = null, buf32 = null;  // frame, written one 32-bit pixel at a time
  var glow = null, gctx = null;      // low-res bloom layer, upscaled and added
  var gImg = null, gbuf = null, gacc = null, gW = 0, gH = 0;
  var GLOW_DIV = 5;
  var sprites = [];                  // pre-rendered glows, one per client hue
  var lastRender = -1e9;

  var clock = 0, lastTs = null;
  var running = false, rafId = null;
  var introDone = reduceMotion;
  var step = -1;

  // We tween in *slider space*, not epsilon space: epsilon is log-scaled, so
  // easing it linearly would drag the slider across the track at a wildly
  // uneven rate. t is always in [0,1] and maps through sliderToEps().
  var eps = EPS_START;
  var tCur = 0, tRest = 0;
  var dragging = false, userEps = false;
  var EASE = 0.085;

  // Observation lens: the cursor is a query, and querying perturbs the data.
  var lensOn = false, lensT = 0, lensX = 0, lensY = 0;
  var lensR = 0, lensB = 0, lensPush = 0;

  var hoverC = -1, hoverT = 0;       // highlighted client and its eased presence
  var hoverLast = -1;
  var touchTimer = null;

  var pulses = [];                   // live aggregation rounds after the intro
  var flashes = [];
  var nextPulse = 0;

  /* ---------- Maths ---------- */
  // Unit Laplace samples, drawn once by inverse CDF:
  //   X = -sgn(u) * ln(1 - 2|u|),  u ~ Uniform(-1/2, 1/2)
  // and then indexed by a xorshift, so each frame's tens of thousands of
  // draws cost a table lookup instead of a log.
  var LAP_N = 1 << 14, LAP_MASK = LAP_N - 1;
  var LAP = new Float32Array(LAP_N);
  for (var li = 0; li < LAP_N; li++) {
    var lu = Math.random() - 0.5;
    LAP[li] = -(lu < 0 ? -1 : 1) * Math.log(1 - 2 * Math.abs(lu) + 1e-12);
  }
  var rng = (Math.random() * 0x7fffffff) | 1;
  function laplace(b) {
    rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5;
    return b * LAP[rng & LAP_MASK];
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function easeOutBack(p) { var c = 1.6; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
  function smooth(p) { return p * p * (3 - 2 * p); }

  function sliderToEps(t) {
    if (t >= 0.998) return Infinity;
    var lo = Math.log(EPS_MIN), hi = Math.log(EPS_MAX);
    return Math.exp(lo + (hi - lo) * t);
  }
  function epsToSlider(e) {
    if (!isFinite(e)) return 1;
    var lo = Math.log(EPS_MIN), hi = Math.log(EPS_MAX);
    return (Math.log(e) - lo) / (hi - lo);
  }
  function fmtEps(e) {
    if (!isFinite(e)) return 'ε = ∞  ·  no privacy';
    if (e >= 10) return 'ε = ' + e.toFixed(1);
    return 'ε = ' + e.toFixed(2);
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  // t in [0,1]: 0 = noise (top of track), 1 = crisp (bottom).
  function syncUI(t, e) {
    if (track) track.style.setProperty('--pct', (t * 100).toFixed(2) + '%');
    if (slider) slider.setAttribute('aria-valuenow', String(Math.round(t * 1000)));
    if (valEl) valEl.textContent = fmtEps(e);
  }

  function setStep(s) {
    if (s === step) return;
    step = s;
    for (var i = 0; i < stepEls.length; i++) {
      var k = +stepEls[i].getAttribute('data-sa-step');
      stepEls[i].classList.toggle('is-on', k === s);
      stepEls[i].classList.toggle('is-done', k < s);
    }
  }

  /* ---------- Geometry over time ---------- */
  function nodeK(t) { return smooth(clamp01((t - NODE0) / NODE_D)); }

  // Centre and radius of client c's swirl at time t (it collapses into a node).
  var oX = 0, oY = 0, oR = 0;
  function orb(c, t) {
    var k = nodeK(t);
    var grow = t >= APPEAR ? 1 : easeOutBack(clamp01(t / APPEAR));
    oX = W * (c + 0.5) / NC;
    oY = textMid + (nodeY - textMid) * k;
    oR = (orbR + (nodeR - orbR) * k) * grow;
  }

  // Masked position of point i at time t: a differential swirl inside its orb.
  var sX = 0, sY = 0;
  function swirl(i, t) {
    var c = CL[i];
    orb(c, t);
    var r = R0[i];
    var th = TH0[i] + (c % 2 ? -1 : 1) * (1.5 - r) * 1.7 * t * 0.001;
    sX = oX + Math.cos(th) * r * oR;
    sY = oY + Math.sin(th) * r * oR * 0.86;
  }

  /* ---------- Build the point cloud ---------- */
  function build() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);

    // The canvas is flex:1 beside the dial, so measure its own box, not the wrap.
    var cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
    if (!cssW) return;

    // Solve for the font size that makes the widest line fill the box.
    var probe = 100;
    ctx.font = '700 ' + probe + 'px "Space Grotesk", system-ui, sans-serif';
    var widest = 0;
    for (var i = 0; i < LINES.length; i++) {
      widest = Math.max(widest, ctx.measureText(LINES[i]).width);
    }
    fontSize = Math.min(probe * (cssW * 0.94 / widest), 96);

    var lineH = fontSize * 1.0;
    var cssTextH = Math.round(lineH * LINES.length + fontSize * 0.28);
    var cssBand = Math.round(Math.max(48, fontSize * 0.72));
    var cssH = cssTextH + cssBand;

    canvas.style.height = cssH + 'px';
    W = canvas.width = Math.round(cssW * DPR);
    H = canvas.height = Math.round(cssH * DPR);
    textH = cssTextH * DPR;
    bandH = cssBand * DPR;

    noiseK = fontSize * DPR * 0.09;
    lensR = fontSize * DPR * 0.55;
    lensB = fontSize * DPR * 0.13;
    lensPush = fontSize * DPR * 0.18;

    textMid = textH * 0.5;
    orbR = Math.min(W / NC * 0.43, textH * 0.5);
    nodeR = 3.6 * DPR;
    nodeY = textH + bandH * 0.26;
    arcMax = bandH * 0.62;

    // Rasterise the text, then read it back as points.
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '700 ' + (fontSize * DPR) + 'px "Space Grotesk", system-ui, sans-serif';
    for (var j = 0; j < LINES.length; j++) {
      var lw = ctx.measureText(LINES[j]).width;
      ctx.fillText(LINES[j], (W - lw) / 2, (fontSize * DPR * 0.14) + lineH * DPR * (j + 0.5));
    }

    var data = ctx.getImageData(0, 0, W, textH).data;
    var stepPx = Math.max(2, Math.round(1.9 * DPR));
    var xs = [], ys = [];
    for (var py = 0; py < textH; py += stepPx) {
      for (var px = 0; px < W; px += stepPx) {
        if (data[(py * W + px) * 4 + 3] > 128) { xs.push(px); ys.push(py); }
      }
    }

    n = xs.length;
    TX = new Float32Array(xs); TY = new Float32Array(ys);
    CL = new Uint8Array(n);
    R0 = new Float32Array(n); TH0 = new Float32Array(n);
    DEL = new Float32Array(n); CURV = new Float32Array(n);
    for (var p = 0; p < n; p++) {
      var c = (Math.random() * NC) | 0;
      CL[p] = c;
      R0[p] = Math.pow(Math.random(), 0.62);            // dense core, wispy rim
      TH0[p] = Math.random() * Math.PI * 2;
      // Departures sweep left to right, with jitter, so streams interleave.
      DEL[p] = (0.55 * TX[p] / W + 0.45 * Math.random()) * FLOW_SPREAD;
      CURV[p] = (c % 2 ? -1 : 1) * (0.12 + Math.random() * 0.32);
    }

    ctx.clearRect(0, 0, W, H);
    imgData = ctx.createImageData(W, H);
    buf32 = new Uint32Array(imgData.data.buffer);

    // Bloom is accumulated straight from the points into a small buffer,
    // rather than by reading the full-size frame back every frame.
    glow = glow || document.createElement('canvas');
    gW = glow.width = Math.max(1, Math.ceil(W / GLOW_DIV));
    gH = glow.height = Math.max(1, Math.ceil(H / GLOW_DIV));
    gctx = glow.getContext('2d');
    gImg = gctx.createImageData(gW, gH);
    gbuf = gImg.data;
    gacc = new Float32Array(gW * gH * 3);

    sprites = CLIENTS.concat([SIGNAL]).map(makeSprite);
  }

  // A soft glow with a bright core, drawn once and stamped with drawImage.
  function makeSprite(c) {
    var S = 64, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var g = cv.getContext('2d');
    var gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, rgba(c, 1));
    gr.addColorStop(0.25, rgba(c, 0.45));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(240,255,252,1)';
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.09, 0, Math.PI * 2); g.fill();
    return cv;
  }

  /* ---------- Render one frame ---------- */
  function render() {
    if (!buf32) return;
    buf32.fill(0);
    gacc.fill(0);
    var gInv = 1 / GLOW_DIV;
    var gK = (DPR >= 2 ? 4 : 1) / (GLOW_DIV * GLOW_DIV) / 255;   // dot area / cell area

    var t = clock;
    var b = isFinite(eps) ? noiseK / eps : 0;
    var dotR = DPR >= 2 ? 2 : 1;      // stamp size in device px
    var fade = 14 * DPR;              // displacement at which a point reads as "noise"
    var R2 = lensR * lensR;
    var lensLive = lensT > 0.01;
    var appearA = clamp01(t / APPEAR);
    var allHome = t >= FLOW0 + FLOW_SPREAD + FLOW_D;
    var hl = hoverT > 0.01 ? hoverLast : -1;
    var shimmer = 0.55 * DPR;

    for (var i = 0; i < n; i++) {
      var c = CL[i], col = CLIENTS[c];
      var x, y, dx = 0, dy = 0, r, g, bl, a, fh = 0;
      var depart = FLOW0 + DEL[i];

      if (!allHome && t < depart) {
        // 01 · masked share, swirling in its client's orb
        swirl(i, t);
        x = sX + laplace(shimmer); y = sY + laplace(shimmer);
        r = col[0]; g = col[1]; bl = col[2];
        a = (appearA * (120 + 135 * (1 - R0[i]))) | 0;
      } else if (!allHome && t < depart + FLOW_D) {
        // 02 · in flight along a curved stream to its place in the sum
        var e = easeInOut((t - depart) / FLOW_D);
        swirl(i, depart);
        var ex = TX[i] - sX, ey = TY[i] - sY;
        var cx = sX + ex * 0.5 - ey * CURV[i], cy = sY + ey * 0.5 + ex * CURV[i];
        var u = 1 - e;
        x = u * u * sX + 2 * u * e * cx + e * e * TX[i];
        y = u * u * sY + 2 * u * e * cy + e * e * TY[i];
        var nz = e * e * e;
        if (b) { dx = laplace(b) * nz; dy = laplace(b) * nz; }
        x += dx; y += dy;
        r = col[0] + (SIGNAL[0] - col[0]) * e;
        g = col[1] + (SIGNAL[1] - col[1]) * e;
        bl = col[2] + (SIGNAL[2] - col[2]) * e;
        a = 200 + 55 * e;
      } else {
        // 03 · released: the sum plus Laplace noise
        if (b) { dx = laplace(b); dy = laplace(b); }
        if (lensLive) {
          var lx = TX[i] - lensX, ly = TY[i] - lensY, d2 = lx * lx + ly * ly;
          if (d2 < R2) {
            var f = (1 - d2 / R2) * lensT, dist = Math.sqrt(d2) + 0.001;
            dx += laplace(lensB * f) + (lx / dist) * lensPush * f;
            dy += laplace(lensB * f) + (ly / dist) * lensPush * f;
            fh = f > 1 ? 1 : f;
          }
        }
        x = TX[i] + dx; y = TY[i] + dy;
        var d = Math.abs(dx) + Math.abs(dy);
        var k = d > fade ? 1 : d / fade;
        r = SIGNAL[0] + (NOISY[0] - SIGNAL[0]) * k;
        g = SIGNAL[1] + (NOISY[1] - SIGNAL[1]) * k;
        bl = SIGNAL[2] + (NOISY[2] - SIGNAL[2]) * k;
        a = 255 - 105 * k;
        if (fh > 0) {
          r += (HOT[0] - r) * fh; g += (HOT[1] - g) * fh; bl += (HOT[2] - bl) * fh;
          a = 255;
        }
      }

      // Hovered client: its fragment lights up in its own hue, the rest recedes.
      if (hl >= 0) {
        if (c === hl) {
          r += (col[0] - r) * hoverT; g += (col[1] - g) * hoverT; bl += (col[2] - bl) * hoverT;
          a += (255 - a) * hoverT;
        } else {
          a *= 1 - 0.84 * hoverT;
        }
      }

      x = x | 0; y = y | 0;
      if (x < 0 || y < 0 || x >= W - dotR || y >= H - dotR) continue;
      r = r | 0; g = g | 0; bl = bl | 0; a = a | 0;
      var px32 = ((a << 24) | (bl << 16) | (g << 8) | r) >>> 0;   // little-endian RGBA
      var row = y * W + x;
      buf32[row] = px32;
      if (dotR === 2) { buf32[row + 1] = px32; buf32[row + W] = px32; buf32[row + W + 1] = px32; }

      var gq = (((y * gInv) | 0) * gW + ((x * gInv) | 0)) * 3;
      var ga = a * gK;
      gacc[gq] += r * ga; gacc[gq + 1] += g * ga; gacc[gq + 2] += bl * ga;
    }
    ctx.putImageData(imgData, 0, 0);

    // Bloom: the low-res accumulation, smoothed on upscale, added back.
    if (gctx) {
      // Accumulated light is premultiplied; un-premultiply so alpha tracks brightness
      // ('lighter' adds alpha too, so an opaque layer would black out the backdrop).
      for (var ci3 = 0, ci4 = 0; ci3 < gacc.length; ci3 += 3, ci4 += 4) {
        var cr = gacc[ci3], cg = gacc[ci3 + 1], cb = gacc[ci3 + 2];
        var m = cr > cg ? (cr > cb ? cr : cb) : (cg > cb ? cg : cb);
        if (m < 0.5) { gbuf[ci4 + 3] = 0; continue; }
        if (m > 255) { var sc = 255 / m; cr *= sc; cg *= sc; cb *= sc; m = 255; }
        var inv = 255 / m;
        gbuf[ci4] = cr * inv; gbuf[ci4 + 1] = cg * inv; gbuf[ci4 + 2] = cb * inv; gbuf[ci4 + 3] = m;
      }
      gctx.putImageData(gImg, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(glow, 0, 0, W, H);
      ctx.restore();
    }

    drawProtocol(t);
  }

  /* ---------- Vector overlay: orbs, mask arcs, nodes ---------- */
  // Mask arc between clients i and j hangs below them as a quadratic.
  var aX = 0, aY = 0;
  function arcAt(ax, ay, bx, by, u) {
    var depth = Math.min(arcMax, Math.abs(bx - ax) * 0.3);
    var cx = (ax + bx) / 2, cy = Math.max(ay, by) + depth * 2;
    var v = 1 - u;
    aX = v * v * ax + 2 * v * u * cx + u * u * bx;
    aY = v * v * ay + 2 * v * u * cy + u * u * by;
  }

  function strokeArc(ax, ay, bx, by, u0, u1) {
    var SEG = 28;
    arcAt(ax, ay, bx, by, u0);
    ctx.moveTo(aX, aY);
    for (var s = 1; s <= SEG; s++) {
      arcAt(ax, ay, bx, by, u0 + (u1 - u0) * s / SEG);
      ctx.lineTo(aX, aY);
    }
  }

  function dot(x, y, rad, ci, a) {
    var R = rad * 4;
    ctx.globalAlpha = a;
    ctx.drawImage(sprites[ci], x - R, y - R, R * 2, R * 2);
    ctx.globalAlpha = 1;
  }

  function drawProtocol(t) {
    var k = nodeK(t);
    var cxs = [], cys = [];
    for (var c = 0; c < NC; c++) { orb(c, t); cxs.push(oX); cys.push(oY); }
    var hl = hoverT > 0.01 ? hoverLast : -1;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // Orb halos while the shares are still masked.
    var halo = clamp01(t / APPEAR) * (1 - k);
    if (halo > 0.01) {
      for (c = 0; c < NC; c++) {
        orb(c, t);
        var gr = ctx.createRadialGradient(oX, oY, 0, oX, oY, oR * 1.25);
        gr.addColorStop(0, rgba(CLIENTS[c], 0.16 * halo));
        gr.addColorStop(1, rgba(CLIENTS[c], 0));
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(oX, oY, oR * 1.25, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Pairwise mask arcs: grow from both ends, cancel in a flash where they meet.
    var pair = 0;
    for (var i = 0; i < NC; i++) {
      for (var j = i + 1; j < NC; j++, pair++) {
        var p0 = MESH0 + pair * 55;
        var prog = clamp01((t - p0) / MESH_D);
        if (prog <= 0) continue;
        var pe = easeInOut(prog);
        var lit = hl < 0 ? 0 : (hl === i || hl === j ? 1 : -0.6) * hoverT;
        var base = 0.36 + (0.13 - 0.36) * k;
        var alpha = Math.max(0.03, base + lit * 0.4);

        var lg = ctx.createLinearGradient(cxs[i], cys[i], cxs[j], cys[j]);
        lg.addColorStop(0, rgba(CLIENTS[i], alpha));
        lg.addColorStop(1, rgba(CLIENTS[j], alpha));
        ctx.strokeStyle = lg;
        ctx.lineWidth = (1 + 0.6 * Math.max(0, lit)) * DPR;
        ctx.beginPath();
        if (pe < 1) {
          strokeArc(cxs[i], cys[i], cxs[j], cys[j], 0, pe / 2);
          strokeArc(cxs[i], cys[i], cxs[j], cys[j], 1 - pe / 2, 1);
        } else {
          strokeArc(cxs[i], cys[i], cxs[j], cys[j], 0, 1);
        }
        ctx.stroke();

        if (pe < 1) {
          arcAt(cxs[i], cys[i], cxs[j], cys[j], pe / 2);
          dot(aX, aY, 2.2 * DPR, i, 0.95);
          arcAt(cxs[i], cys[i], cxs[j], cys[j], 1 - pe / 2);
          dot(aX, aY, 2.2 * DPR, j, 0.95);
        } else if (t - (p0 + MESH_D) < 700 && !introDone) {
          var fp = (t - (p0 + MESH_D)) / 700;
          arcAt(cxs[i], cys[i], cxs[j], cys[j], 0.5);
          ring(aX, aY, fp);
        }
      }
    }

    // Live rounds after the intro: masks travel and cancel again.
    for (var q = pulses.length - 1; q >= 0; q--) {
      var P = pulses[q], pp = (t - P.t0) / 950;
      if (pp >= 1) { flashes.push({ i: P.i, j: P.j, t0: t }); pulses.splice(q, 1); continue; }
      var ue = easeInOut(clamp01(pp)) / 2;
      arcAt(cxs[P.i], cys[P.i], cxs[P.j], cys[P.j], ue);
      dot(aX, aY, 1.8 * DPR, P.i, 0.85);
      arcAt(cxs[P.i], cys[P.i], cxs[P.j], cys[P.j], 1 - ue);
      dot(aX, aY, 1.8 * DPR, P.j, 0.85);
    }
    for (q = flashes.length - 1; q >= 0; q--) {
      var F = flashes[q], fp2 = (t - F.t0) / 650;
      if (fp2 >= 1) { flashes.splice(q, 1); continue; }
      arcAt(cxs[F.i], cys[F.i], cxs[F.j], cys[F.j], 0.5);
      ring(aX, aY, fp2);
    }

    // Client nodes, once the swirls have collapsed.
    if (k > 0.02) {
      ctx.font = (10.5 * DPR) + 'px "Space Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      for (c = 0; c < NC; c++) {
        var on = hl === c ? hoverT : 0;
        var rad = nodeR * (1 + 0.45 * on);
        var nodeA = k * (hl >= 0 && hl !== c ? 1 - 0.5 * hoverT : 1);
        ctx.globalAlpha = 0.4 * nodeA;
        ctx.drawImage(sprites[c], cxs[c] - rad * 5, cys[c] - rad * 5, rad * 10, rad * 10);
        ctx.globalAlpha = 1;

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#0a0b0d';
        ctx.beginPath(); ctx.arc(cxs[c], cys[c], rad, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba(CLIENTS[c], 0.95 * nodeA);
        ctx.lineWidth = 1.4 * DPR;
        ctx.stroke();
        ctx.fillStyle = rgba(CLIENTS[c], 0.9 * nodeA);
        ctx.beginPath(); ctx.arc(cxs[c], cys[c], rad * 0.45, 0, Math.PI * 2); ctx.fill();

        var la = smooth(clamp01((k - 0.55) / 0.45)) * (0.8 + 0.2 * on) *
          (hl >= 0 && hl !== c ? 1 - hoverT : 1);   // only the hovered label speaks
        var label = 'c' + SUB[c] + (on > 0.05 ? '  ·  ⅕ of the signal' : '');
        ctx.fillStyle = on > 0.05 ? rgba(CLIENTS[c], la) : 'rgba(151,157,165,' + la + ')';
        ctx.textAlign = c === NC - 1 && on > 0.05 ? 'right' : 'left';
        var lxo = ctx.textAlign === 'right' ? -(rad + 7 * DPR) : rad + 7 * DPR;
        ctx.fillText(label, cxs[c] + lxo, cys[c] - 1 * DPR);
        ctx.globalCompositeOperation = 'lighter';
      }
    }
    ctx.restore();
  }

  function ring(x, y, p) {
    var e = 1 - Math.pow(1 - p, 3);
    ctx.strokeStyle = 'rgba(214,255,248,' + (0.9 * (1 - p)) + ')';
    ctx.lineWidth = 1.3 * DPR;
    ctx.beginPath(); ctx.arc(x, y, (2 + 11 * e) * DPR, 0, Math.PI * 2); ctx.stroke();
    var gr = ctx.createRadialGradient(x, y, 0, x, y, 9 * DPR);
    gr.addColorStop(0, 'rgba(214,255,248,' + (0.7 * (1 - p)) + ')');
    gr.addColorStop(1, 'rgba(214,255,248,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y, 9 * DPR, 0, Math.PI * 2); ctx.fill();
  }

  /* ---------- Loop ---------- */
  function frame(ts) {
    if (!running) return;
    var dt = lastTs === null ? 16 : Math.min(ts - lastTs, 50);
    lastTs = ts;
    clock += dt;

    if (!introDone) {
      if (!userEps) {
        var k = easeInOut(clamp01((clock - EPS0) / EPS_D));
        eps = Math.exp(Math.log(EPS_START) + (Math.log(EPS_REST) - Math.log(EPS_START)) * k);
        tCur = epsToSlider(eps);
        syncUI(tCur, eps);
      }
      setStep(clock < STEP1 ? 0 : clock < STEP2 ? 1 : 2);
      if (clock >= INTRO_END) {
        introDone = true;
        nextPulse = clock + 1200;
      }
    }
    if ((introDone || userEps) && !dragging) {
      var d = tRest - tCur;
      tCur = Math.abs(d) < 0.0004 ? tRest : tCur + d * EASE;
      eps = sliderToEps(tCur);
      syncUI(tCur, eps);
    }

    if (introDone && clock >= nextPulse) {
      var i = (Math.random() * NC) | 0, j = (i + 1 + ((Math.random() * (NC - 1)) | 0)) % NC;
      pulses.push({ i: Math.min(i, j), j: Math.max(i, j), t0: clock });
      nextPulse = clock + 2200 + Math.random() * 1800;
    }

    lensT += ((lensOn ? 1 : 0) - lensT) * 0.14;
    if (!lensOn && lensT < 0.01) lensT = 0;
    if (hoverC >= 0) hoverLast = hoverC;
    hoverT += ((hoverC >= 0 ? 1 : 0) - hoverT) * 0.16;
    if (hoverC < 0 && hoverT < 0.01) { hoverT = 0; hoverLast = -1; }

    // Once the intro is over and nobody is touching it, the shimmer reads
    // the same at half rate — so spend half the frames.
    var idle = introDone && !dragging && lensT === 0 && hoverT === 0 && Math.abs(tRest - tCur) < 0.0004;
    if (!idle || ts - lastRender > 30) {
      lastRender = ts;
      render();
    }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastTs = null;
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function replay() {
    clock = 0;
    introDone = false;
    userEps = false;
    pulses.length = 0; flashes.length = 0;
    tRest = epsToSlider(EPS_REST);
    step = -1;
    if (reduceMotion) { clock = INTRO_END; introDone = true; setStep(2); render(); }
    else start();
  }

  /* ---------- Wire up ---------- */
  function init() {
    var hero = canvas.closest('.hero');

    // Reveal the canvas before measuring — a display:none parent has no width.
    if (hero) hero.classList.add('canvas-on');

    build();

    // If the cloud is empty the raster failed; fall back to the real <h1>.
    if (!n) {
      if (hero) hero.classList.remove('canvas-on');
      return;
    }

    tRest = epsToSlider(EPS_REST);
    tCur = epsToSlider(EPS_START);

    if (reduceMotion) {
      // Static: the protocol's end state, re-rendered only on interaction.
      clock = INTRO_END;
      tCur = tRest; eps = EPS_REST;
      syncUI(tCur, eps);
      setStep(2);
      render();
    } else {
      setStep(0);
      start();
    }

    if (replayEl) replayEl.addEventListener('click', replay);

    // Vertical drag: pointer Y over the track -> t in [0,1], top=0 (noise),
    // bottom=1 (crisp). Dragging down resolves the name.
    if (slider && track) {
      var setFromPointer = function (clientY) {
        var r = track.getBoundingClientRect();
        var t = clamp01((clientY - r.top) / r.height);
        userEps = true;
        dragging = true;
        tCur = tRest = t;                       // new resting point
        eps = sliderToEps(tCur);
        syncUI(tCur, eps);
        if (reduceMotion) render();
      };

      slider.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        slider.classList.add('dragging');
        slider.setPointerCapture && slider.setPointerCapture(e.pointerId);
        setFromPointer(e.clientY);
      });
      slider.addEventListener('pointermove', function (e) {
        if (dragging) setFromPointer(e.clientY);
      });
      var endDrag = function () { dragging = false; slider.classList.remove('dragging'); };
      slider.addEventListener('pointerup', endDrag);
      slider.addEventListener('pointercancel', endDrag);

      // Keyboard: up/down nudge epsilon (down = resolve, matching the drag).
      slider.addEventListener('keydown', function (e) {
        var st = e.shiftKey ? 0.1 : 0.03;
        var nt = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nt = tRest + st;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nt = tRest - st;
        else if (e.key === 'Home') nt = 0;
        else if (e.key === 'End') nt = 1;
        if (nt === null) return;
        e.preventDefault();
        userEps = true;
        tRest = clamp01(nt);
        if (reduceMotion) { tCur = tRest; eps = sliderToEps(tCur); syncUI(tCur, eps); render(); }
      });
    }

    // Pointer over the canvas: a client node under it highlights that share;
    // over the name, the observation lens perturbs what it touches.
    function nodeAt(px, py) {
      if (nodeK(clock) < 0.6) return -1;
      var best = -1, bestD = 18 * DPR;
      for (var c = 0; c < NC; c++) {
        var dx = px - W * (c + 0.5) / NC, dy = py - nodeY;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    }
    function toDevice(e) {
      var r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
    }

    if (window.matchMedia('(hover: hover)').matches) {
      canvas.addEventListener('pointermove', function (e) {
        var p = toDevice(e);
        hoverC = nodeAt(p[0], p[1]);
        canvas.style.cursor = hoverC >= 0 ? 'pointer' : 'crosshair';
        if (p[1] < textH && !reduceMotion) { lensX = p[0]; lensY = p[1]; lensOn = true; }
        else lensOn = false;
        if (reduceMotion) { hoverT = hoverC >= 0 ? 1 : 0; hoverLast = hoverC; render(); }
      });
      canvas.addEventListener('pointerleave', function () {
        lensOn = false; hoverC = -1;
        if (reduceMotion) { hoverT = 0; render(); }
      });
    }

    // Touch: tap a node to light its share for a moment.
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      var p = toDevice(e);
      var c = nodeAt(p[0], p[1]);
      if (c < 0) return;
      hoverC = c;
      clearTimeout(touchTimer);
      touchTimer = setTimeout(function () { hoverC = -1; if (reduceMotion) { hoverT = 0; render(); } }, 2200);
      if (reduceMotion) { hoverT = 1; hoverLast = c; render(); }
    });

    // Don't burn cycles when the hero is off-screen.
    if ('IntersectionObserver' in window && !reduceMotion) {
      new IntersectionObserver(function (entries) {
        entries[0].isIntersecting ? start() : stop();
      }, { threshold: 0 }).observe(canvas);
    }

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        build();
        if (reduceMotion) render();
      }, 160);
    });
  }

  // Wait for Space Grotesk, otherwise we rasterise a fallback face and the
  // point cloud is built from the wrong glyphs.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(init);
  } else {
    window.addEventListener('load', init);
  }
})();
