/* ============================================================
   Lattice backdrop.

   A skewed 2-D lattice  L = { i·b1 + j·b2 : i, j ∈ Z }  — the object
   lattice-based cryptography is built on — laid out as a plane receding
   in perspective behind the page. It drifts by whole periods (so it reads
   as infinite), turns slowly, leans toward the pointer, and parallaxes
   with scroll. Now and then a spark runs along a basis direction.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.createElement('canvas');
  canvas.className = 'lattice';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, document.body.firstChild);
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Basis: deliberately non-orthogonal, the way a "bad" basis hides a lattice.
  var B1 = [1, 0];
  var B2 = [0.38, 0.92];
  var N = 30;                  // half-extent in lattice steps
  var FADE_R = N - 2;          // plane-space radius where points vanish
  var TEAL = '94,234,212';
  var BUCKETS = 7;             // alpha buckets: lines and dots are batched per bucket
  var FRAME_MS = 32;           // ~30fps is plenty for something this slow

  var W = 0, H = 0, DPR = 1, f = 600, cx = 0, cy = 0;
  var D = 9;                   // camera distance, in lattice units
  var t0 = null, last = 0;
  var running = false, rafId = null;

  var mx = 0.5, my = 0.5, emx = 0.5, emy = 0.5;   // pointer, eased
  var mouseX = -1e4, mouseY = -1e4;                // in device px
  var sparks = [], nextSpark = 0;
  var spark = makeSpark();

  // Projected grid, reused every frame.
  var SZ = 2 * N + 1;
  var PX = new Float32Array(SZ * SZ), PY = new Float32Array(SZ * SZ);
  var PA = new Float32Array(SZ * SZ), PS = new Float32Array(SZ * SZ);

  // Spark glow, drawn once and stamped with drawImage.
  function makeSpark() {
    var S = 64, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var g = cv.getContext('2d');
    var gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(200,255,246,0.8)');
    gr.addColorStop(0.3, 'rgba(' + TEAL + ',0.3)');
    gr.addColorStop(1, 'rgba(' + TEAL + ',0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return cv;
  }

  function resize() {
    // A faint, soft backdrop doesn't need retina pixels; 1x quarters the fill cost.
    DPR = 1;
    W = canvas.width = Math.round(window.innerWidth * DPR);
    H = canvas.height = Math.round(window.innerHeight * DPR);
    f = Math.max(window.innerWidth, window.innerHeight) * 0.62 * DPR;
    cx = W * 0.5;
    cy = H * 0.34;
  }

  function smooth(a, b, x) {
    var t = (x - a) / (b - a);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  // Project lattice point (i + ox, j + oy) onto the screen; returns false if behind camera.
  var sx = 0, sy = 0, depth = 0, alpha = 0;
  function project(u, v, cosT, sinT, cosP, sinP) {
    var x = u * B1[0] + v * B2[0];
    var y = u * B1[1] + v * B2[1];
    var r = Math.sqrt(x * x + y * y);
    var xr = x * cosT - y * sinT;
    var yr = x * sinT + y * cosT;
    var yp = yr * cosP;
    var zp = yr * sinP;           // + is away from the camera
    var zc = D + zp;
    if (zc < 0.8) return false;
    var k = f / zc;
    sx = cx + xr * k;
    sy = cy - yp * k + H * 0.42;  // horizon sits high, the floor fills the page
    depth = zc;
    // Vignette in screen space, so the edges of the page stay quiet.
    var ex = (sx - cx) / (W * 0.85), ey = (sy - H * 0.62) / (H * 0.75);
    var vig = 1 - smooth(0.35, 1, Math.sqrt(ex * ex + ey * ey));
    alpha = smooth(FADE_R, FADE_R - 9, r) * smooth(D * 4.2, D * 0.9, zc) * vig;
    return true;
  }

  function frame(ts) {
    if (!running) return;
    if (ts - last < FRAME_MS) { rafId = requestAnimationFrame(frame); return; }
    last = ts;
    if (t0 === null) t0 = ts;
    draw((ts - t0) / 1000);
    rafId = requestAnimationFrame(frame);
  }

  function draw(time) {
    ctx.clearRect(0, 0, W, H);

    emx += (mx - emx) * 0.04;
    emy += (my - emy) * 0.04;

    var theta = 0.22 + time * 0.012 + (emx - 0.5) * 0.16;
    var phi = 1.02 + (emy - 0.5) * 0.1;
    var cosT = Math.cos(theta), sinT = Math.sin(theta);
    var cosP = Math.cos(phi), sinP = Math.sin(phi);

    // Drift and scroll parallax, both wrapped to one period so the lattice is endless.
    var scroll = (window.scrollY || 0) / (window.innerHeight || 1);
    var du = time * 0.05;
    var dv = time * 0.11 + scroll * 1.6;
    var ou = du - Math.floor(du), ov = dv - Math.floor(dv);

    var i, j, idx;
    for (j = -N; j <= N; j++) {
      for (i = -N; i <= N; i++) {
        idx = (j + N) * SZ + (i + N);
        if (project(i - ou, j - ov, cosT, sinT, cosP, sinP) && alpha > 0.005) {
          PX[idx] = sx; PY[idx] = sy; PA[idx] = alpha; PS[idx] = f / depth;
        } else {
          PA[idx] = 0;
        }
      }
    }

    // Lines along b1 and b2, batched into depth buckets (one stroke each).
    ctx.lineWidth = DPR * 0.8;
    for (var bkt = 1; bkt <= BUCKETS; bkt++) {
      var lo = (bkt - 1) / BUCKETS, hi = bkt / BUCKETS;
      ctx.beginPath();
      var any = false;
      for (j = -N; j <= N; j++) {
        for (i = -N; i <= N; i++) {
          idx = (j + N) * SZ + (i + N);
          var a = PA[idx];
          if (!a) continue;
          if (i < N) {
            var a2 = Math.min(a, PA[idx + 1]);
            if (a2 > lo && a2 <= hi) { ctx.moveTo(PX[idx], PY[idx]); ctx.lineTo(PX[idx + 1], PY[idx + 1]); any = true; }
          }
          if (j < N) {
            var a3 = Math.min(a, PA[idx + SZ]);
            if (a3 > lo && a3 <= hi) { ctx.moveTo(PX[idx], PY[idx]); ctx.lineTo(PX[idx + SZ], PY[idx + SZ]); any = true; }
          }
        }
      }
      if (any) {
        ctx.strokeStyle = 'rgba(' + TEAL + ',' + (0.075 * (lo + hi) / 2).toFixed(4) + ')';
        ctx.stroke();
      }
    }

    // Lattice points, one fill per alpha bucket; those near the pointer light up.
    var R = 170 * DPR, R2 = R * R;
    for (bkt = 1; bkt <= BUCKETS; bkt++) {
      lo = (bkt - 1) / BUCKETS; hi = bkt / BUCKETS;
      ctx.beginPath();
      any = false;
      for (idx = 0; idx < PA.length; idx++) {
        var pa = PA[idx];
        if (!pa) continue;
        var dx = PX[idx] - mouseX, dy = PY[idx] - mouseY;
        var d2 = dx * dx + dy * dy;
        var near = d2 < R2 ? 1 - d2 / R2 : 0;
        var lum = pa * (0.3 + 0.6 * near * near) / 0.9;   // 0..1
        if (lum <= lo || lum > hi) continue;
        var s = Math.max(0.9 * DPR, PS[idx] * 0.028) * (1 + near * 0.8);
        ctx.rect(PX[idx] - s / 2, PY[idx] - s / 2, s, s);
        any = true;
      }
      if (any) {
        ctx.fillStyle = 'rgba(' + TEAL + ',' + (0.9 * (lo + hi) / 2).toFixed(3) + ')';
        ctx.fill();
      }
    }

    // Sparks: a short bright run along one basis direction.
    if (!reduceMotion) {
      if (time > nextSpark && sparks.length < 5) {
        sparks.push({
          i: ((Math.random() * 2 - 1) * N * 0.45) | 0,
          j: ((Math.random() * 1.2 - 0.2) * N * 0.45) | 0,
          dir: Math.random() < 0.5 ? 0 : 1,
          sgn: Math.random() < 0.5 ? -1 : 1,
          t0: time, dur: 2.4 + Math.random() * 1.6, len: 5 + ((Math.random() * 4) | 0)
        });
        nextSpark = time + 0.6 + Math.random() * 1.4;
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var q = sparks.length - 1; q >= 0; q--) {
        var S = sparks[q], p = (time - S.t0) / S.dur;
        if (p >= 1) { sparks.splice(q, 1); continue; }
        var env = Math.sin(Math.PI * p);
        var TRAIL = 6;
        for (var k = 0; k <= TRAIL; k++) {
          var along = (p * S.len - k * 0.12) * S.sgn;
          var u = S.i + (S.dir === 0 ? along : 0) - ou;
          var v = S.j + (S.dir === 1 ? along : 0) - ov;
          if (!project(u, v, cosT, sinT, cosP, sinP) || alpha < 0.01) continue;
          var ka = env * alpha * (1 - k / (TRAIL + 1));
          var rad = Math.max(1.2 * DPR, (f / depth) * 0.05) * (k === 0 ? 1 : 0.7) * 4;
          ctx.globalAlpha = ka;
          ctx.drawImage(spark, sx - rad, sy - rad, rad * 2, rad * 2);
        }
      }
      ctx.restore();
    }
  }

  function start() {
    if (running || reduceMotion) return;
    running = true;
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
  }

  resize();
  if (reduceMotion) draw(0); else start();

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resize(); if (reduceMotion) draw(0); }, 120);
  });
  window.addEventListener('pointermove', function (e) {
    mx = e.clientX / window.innerWidth;
    my = e.clientY / window.innerHeight;
    mouseX = e.clientX * DPR;
    mouseY = e.clientY * DPR;
  }, { passive: true });
  document.addEventListener('pointerleave', function () { mouseX = mouseY = -1e4; });
  if (reduceMotion) window.addEventListener('scroll', function () { draw(0); }, { passive: true });
  document.addEventListener('visibilitychange', function () {
    document.hidden ? stop() : start();
  });
})();
