/* Nav state, scroll reveals, card cursor glow. */
(function () {
  'use strict';

  // --- Nav border on scroll ---
  var nav = document.querySelector('.nav');
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle('scrolled', window.scrollY > 24);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // --- Reveal on scroll ---
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  // --- Cursor-tracking glow on cards ---
  document.querySelectorAll('.card').forEach(function (card) {
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  // --- Stagger reveal children ---
  document.querySelectorAll('[data-stagger]').forEach(function (group) {
    Array.prototype.forEach.call(group.children, function (child, i) {
      child.style.transitionDelay = Math.min(i * 60, 400) + 'ms';
    });
  });
})();

/* Decode effect: text resolves out of glyph noise, once, on first appearance —
   the hero's signal-from-noise move, carried through the rest of the page.
   Unresolved glyphs re-randomise on a slow clock instead of every frame, and
   the resolve front is eased, so the effect reads as settling, not flicker. */
(function () {
  'use strict';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var GLYPHS = '▓▒░<>/|=+*·:εδΣπΛ';
  var CHURN_MS = 80;   // how often unresolved glyphs change — slower = calmer

  function ease(p) { return p * p * (3 - 2 * p); }   // smoothstep

  // Scramble only the text nodes inside el, so links and bolds survive.
  function scramble(el, dur) {
    if (el.dataset.decoded) return;                  // once only
    el.dataset.decoded = '1';
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var nodes = [], originals = [], offsets = [], total = 0, n;
    while ((n = walker.nextNode())) {
      nodes.push(n);
      originals.push(n.nodeValue);
      offsets.push(total);
      total += n.nodeValue.length;
    }
    if (!total) return;

    var start = null, lastChurn = -1e9, churn = {};
    function tick(ts) {
      if (start === null) start = ts;
      var front = total * ease(Math.min((ts - start) / dur, 1));
      var doChurn = ts - lastChurn > CHURN_MS;
      if (doChurn) lastChurn = ts;

      for (var k = 0; k < nodes.length; k++) {
        var src = originals[k], off = offsets[k], out = '';
        for (var i = 0; i < src.length; i++) {
          var c = src[i];
          if (off + i < front || c === ' ' || c === '\n') { out += c; continue; }
          var key = off + i;
          if (doChurn || churn[key] === undefined) {
            churn[key] = GLYPHS[(Math.random() * GLYPHS.length) | 0];
          }
          out += churn[key];
        }
        nodes[k].nodeValue = out;
      }

      if (front < total) {
        requestAnimationFrame(tick);
      } else {
        for (var k2 = 0; k2 < nodes.length; k2++) nodes[k2].nodeValue = originals[k2];
      }
    }
    requestAnimationFrame(tick);
  }

  // Panel labels and article titles decode as they first enter view.
  var heads = document.querySelectorAll('.panel__label, .article__title');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          scramble(en.target, 900);
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.4 });
    heads.forEach(function (el) { io.observe(el); });
  }

  // The hero's main text decodes in step with its fade-in: animationstart
  // fires when each element's CSS delay elapses, so the two stay in sync.
  ['.hero__role', '.hero__affil'].forEach(function (sel) {
    var el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener('animationstart', function () { scramble(el, 1100); }, { once: true });
  });
})();
