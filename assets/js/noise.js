/* ============================================================
   DP-noise hero.

   The name is rasterised once into a point cloud. Every frame,
   each point is displaced by a sample from a Laplace distribution
   with scale b = sensitivity / epsilon — the same mechanism that
   gives epsilon-differential privacy. Drag epsilon down and the
   signal genuinely disappears into the noise.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('nameCanvas');
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext('2d', { alpha: true });
  var slider = document.getElementById('epsSlider');   // .eps container (role=slider)
  var track = document.getElementById('epsTrack');
  var fill = document.getElementById('epsFill');
  var thumb = document.getElementById('epsThumb');
  var valEl = document.getElementById('epsVal');

  var LINES = ['MARC MOLINA', 'VAN DEN BOSCH'];

  // Colour of a point with (near) zero displacement vs. a heavily displaced one.
  var SIGNAL = [94, 234, 212];
  var NOISY = [104, 118, 138];

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var points = [];       // {x, y} in device pixels
  var W = 0, H = 0, DPR = 1;
  var fontSize = 100;
  var noiseK = 18;       // sensitivity Δ, in device px — scaled off fontSize
  var imgData = null;
  var buf = null;
  var running = false;
  var rafId = null;

  // Epsilon range, sampled logarithmically across the slider.
  var EPS_MIN = 0.08, EPS_MAX = 30;

  var eps = 0.1;         // current
  var introStart = null;
  var introDone = reduceMotion;
  var INTRO_MS = 2200;
  var INTRO_TO = 18;     // resting epsilon — crisp, with a faint live shimmer

  // We tween in *slider space*, not epsilon space: epsilon is log-scaled, so
  // easing it linearly would drag the slider across the track at a wildly
  // uneven rate. t is always in [0,1] and maps through sliderToEps().
  var tCur = 0;
  var tRest = 0;         // where the slider returns to (user-settable)
  var dragging = false;
  var EASE = 0.085;

  // Observation lens: the cursor is a query, and querying perturbs the data.
  // Points near the pointer take extra Laplace noise plus a radial push, so
  // the name scatters locally under inspection and heals when it moves on.
  var lensOn = false;
  var lensT = 0;                  // eased 0..1 presence of the lens
  var lensX = 0, lensY = 0;       // cursor in device pixels
  var lensR = 0, lensB = 0, lensPush = 0;   // set in build() off fontSize
  var HOT = [186, 255, 243];      // points flash bright while agitated

  /* ---------- Laplace sampling ----------
     Inverse-CDF: X = -b * sgn(u) * ln(1 - 2|u|),  u ~ Uniform(-1/2, 1/2) */
  function laplace(b) {
    var u = Math.random() - 0.5;
    var s = u < 0 ? -1 : 1;
    return -b * s * Math.log(1 - 2 * Math.abs(u) + 1e-12);
  }

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

  // t in [0,1]: 0 = noise (top of track), 1 = crisp (bottom). The fill and
  // thumb both key off --pct, so raising t pushes the thumb DOWN and grows the
  // fill downward — signal returning as you spend budget.
  function paintSlider(t) {
    if (track) track.style.setProperty('--pct', (t * 100).toFixed(2) + '%');
    if (slider) slider.setAttribute('aria-valuenow', String(Math.round(t * 1000)));
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
    var targetW = cssW * 0.94;
    fontSize = Math.min(probe * (targetW / widest), 96);

    var lineH = fontSize * 1.0;
    var cssH = Math.round(lineH * LINES.length + fontSize * 0.28);

    canvas.style.height = cssH + 'px';
    W = canvas.width = Math.round(cssW * DPR);
    H = canvas.height = Math.round(cssH * DPR);

    noiseK = fontSize * DPR * 0.09;
    lensR = fontSize * DPR * 0.55;
    lensB = fontSize * DPR * 0.13;
    lensPush = fontSize * DPR * 0.18;

    // Rasterise the text, then read it back as points.
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '700 ' + (fontSize * DPR) + 'px "Space Grotesk", system-ui, sans-serif';

    for (var j = 0; j < LINES.length; j++) {
      var lw = ctx.measureText(LINES[j]).width;
      var x = (W - lw) / 2;
      var y = (fontSize * DPR * 0.14) + lineH * DPR * (j + 0.5);
      ctx.fillText(LINES[j], x, y);
    }

    var data = ctx.getImageData(0, 0, W, H).data;
    var step = Math.max(2, Math.round(1.9 * DPR));
    points.length = 0;
    for (var py = 0; py < H; py += step) {
      for (var px = 0; px < W; px += step) {
        if (data[(py * W + px) * 4 + 3] > 128) {
          points.push(px, py); // flat array: x,y,x,y...
        }
      }
    }

    ctx.clearRect(0, 0, W, H);
    imgData = ctx.createImageData(W, H);
    buf = imgData.data;
  }

  /* ---------- Render one frame ---------- */
  function render(e) {
    if (!buf) return;
    buf.fill(0);

    var b = isFinite(e) ? noiseK / e : 0;
    var dotR = DPR >= 2 ? 2 : 1;      // stamp size in device px
    var fade = 14 * DPR;              // displacement at which a point reads as "noise"
    var R2 = lensR * lensR;
    var lensLive = lensT > 0.01;

    for (var i = 0; i < points.length; i += 2) {
      var dx = b ? laplace(b) : 0;
      var dy = b ? laplace(b) : 0;
      var fh = 0;

      if (lensLive) {
        var lx = points[i] - lensX;
        var ly = points[i + 1] - lensY;
        var d2 = lx * lx + ly * ly;
        if (d2 < R2) {
          var f = (1 - d2 / R2) * lensT;
          var dist = Math.sqrt(d2) + 0.001;
          dx += laplace(lensB * f) + (lx / dist) * lensPush * f;
          dy += laplace(lensB * f) + (ly / dist) * lensPush * f;
          fh = f > 1 ? 1 : f;
        }
      }

      var x = (points[i] + dx) | 0;
      var y = (points[i + 1] + dy) | 0;
      if (x < 0 || y < 0 || x >= W - dotR || y >= H - dotR) continue;

      var d = Math.abs(dx) + Math.abs(dy);
      var t = d > fade ? 1 : d / fade;
      var r = (SIGNAL[0] + (NOISY[0] - SIGNAL[0]) * t) | 0;
      var g = (SIGNAL[1] + (NOISY[1] - SIGNAL[1]) * t) | 0;
      var bl = (SIGNAL[2] + (NOISY[2] - SIGNAL[2]) * t) | 0;
      var a = (255 - 105 * t) | 0;

      if (fh > 0) {
        r = (r + (HOT[0] - r) * fh) | 0;
        g = (g + (HOT[1] - g) * fh) | 0;
        bl = (bl + (HOT[2] - bl) * fh) | 0;
        a = 255;
      }

      for (var oy = 0; oy < dotR; oy++) {
        var row = (y + oy) * W;
        for (var ox = 0; ox < dotR; ox++) {
          var p = (row + x + ox) * 4;
          buf[p] = r; buf[p + 1] = g; buf[p + 2] = bl; buf[p + 3] = a;
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  /* ---------- UI sync ---------- */
  function syncUI(t, e) {
    paintSlider(t);
    if (valEl) valEl.textContent = fmtEps(e);
  }

  /* ---------- Loop ---------- */
  function frame(ts) {
    if (!running) return;

    if (!introDone) {
      if (introStart === null) introStart = ts;
      var k = Math.min((ts - introStart) / INTRO_MS, 1);
      var easal = 1 - Math.pow(2, -10 * k);              // easeOutExpo
      eps = 0.1 + (INTRO_TO - 0.1) * easal;
      tCur = epsToSlider(eps);
      if (k >= 1) {
        introDone = true;
        tCur = tRest;
        eps = sliderToEps(tCur);
      }
      syncUI(tCur, eps);
    } else if (!dragging) {
      var d = tRest - tCur;
      if (Math.abs(d) < 0.0004) {
        tCur = tRest;
      } else {
        tCur += d * EASE;
      }
      eps = sliderToEps(tCur);
      syncUI(tCur, eps);
    }

    lensT += ((lensOn ? 1 : 0) - lensT) * 0.14;
    if (!lensOn && lensT < 0.01) lensT = 0;

    render(eps);
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  /* ---------- Wire up ---------- */
  function init() {
    var hero = canvas.closest('.hero');

    // Reveal the canvas before measuring — a display:none parent has no width.
    if (hero) hero.classList.add('canvas-on');

    build();

    // If the cloud is empty the raster failed; fall back to the real <h1>.
    if (!points.length) {
      if (hero) hero.classList.remove('canvas-on');
      return;
    }

    tRest = epsToSlider(INTRO_TO);
    tCur = epsToSlider(0.1);

    if (reduceMotion) {
      tCur = tRest;
      eps = INTRO_TO;
      syncUI(tCur, eps);
      render(eps);
      // Static: one pass, no loop, no hover response.
    } else {
      start();
    }

    // Vertical drag: pointer Y over the track -> t in [0,1], top=0 (noise),
    // bottom=1 (crisp). Dragging down resolves the name.
    if (slider && track) {
      var setFromPointer = function (clientY) {
        var r = track.getBoundingClientRect();
        var t = (clientY - r.top) / r.height;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        introDone = true;
        dragging = true;
        tCur = tRest = t;                       // new resting point
        eps = sliderToEps(tCur);
        syncUI(tCur, eps);
        if (reduceMotion) render(eps);
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
        var step = e.shiftKey ? 0.1 : 0.03;
        var nt = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nt = tRest + step;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nt = tRest - step;
        else if (e.key === 'Home') nt = 0;
        else if (e.key === 'End') nt = 1;
        if (nt === null) return;
        e.preventDefault();
        introDone = true;
        tRest = nt < 0 ? 0 : nt > 1 ? 1 : nt;
        if (reduceMotion) { tCur = tRest; eps = sliderToEps(tCur); syncUI(tCur, eps); render(eps); }
      });
    }

    // The observation lens: points under the cursor perturb, the rest of the
    // name stays crisp, and everything heals when the query moves on.
    if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
      canvas.addEventListener('pointermove', function (e) {
        var r = canvas.getBoundingClientRect();
        lensX = (e.clientX - r.left) * (W / r.width);
        lensY = (e.clientY - r.top) * (H / r.height);
        lensOn = true;
      });
      canvas.addEventListener('pointerleave', function () { lensOn = false; });
    }

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
        if (reduceMotion) render(eps);
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
