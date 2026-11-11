// motion.js - the one tokens file. Classic script (ES modules do not load from file:// in Chrome).
// Exposes window.M. Build only from these tokens: no inline easing curves or durations.
(function () {
  // cubic-bezier(x1,y1,x2,y2) as a pure function of u in [0,1]
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (s) => ((ax * s + bx) * s + cx) * s;
    const sy = (s) => ((ay * s + by) * s + cy) * s;
    const dx = (s) => (3 * ax * s + 2 * bx) * s + cx;
    return function (u) {
      if (u <= 0) return 0;
      if (u >= 1) return 1;
      let s = u;
      for (let i = 0; i < 8; i++) {               // Newton
        const e = sx(s) - u, d = dx(s);
        if (Math.abs(e) < 1e-6) return sy(s);
        if (Math.abs(d) < 1e-6) break;
        s -= e / d;
      }
      let lo = 0, hi = 1; s = u;                   // bisection fallback
      for (let i = 0; i < 30; i++) { const v = sx(s); if (Math.abs(v - u) < 1e-6) break; if (v < u) lo = s; else hi = s; s = (lo + hi) / 2; }
      return sy(s);
    };
  }

  const EASE = {
    enter: bezier(0.16, 1, 0.3, 1),     // ease-out-expo: text and logo reveals
    premium: bezier(0.22, 1, 0.36, 1),  // ease-out-quint: premium entrances
    move: bezier(0.76, 0, 0.24, 1),     // ease-in-out-quart: moves and camera
    exit: bezier(0.7, 0, 0.84, 0),      // ease-in-expo: fast exits
    pop: bezier(0.34, 1.56, 0.64, 1),   // ease-out-back: playful overshoot
    linear: (u) => u,                   // rotation, progress bars, loop phase ONLY
  };
  const MS = { feedback: 150, move: 400, hero: 750, exit: 240 };
  const STAGGER = { letter: 1 / 30, word: 0.09, item: 0.06 };   // seconds

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  // progress 0..1 of a tween from t0 to t1 (seconds) through an easing
  const tween = (t, t0, t1, ease = EASE.move) => ease(clamp((t - t0) / (t1 - t0)));
  // value from a to b over [t0,t1]
  const fromTo = (t, t0, t1, a, b, ease) => lerp(a, b, tween(t, t0, t1, ease));

  // damping ratio from any library's numbers: 1 = no bounce
  const dampingRatio = (k, d, m = 1) => d / (2 * Math.sqrt(k * m));
  // closed-form spring, 0 -> 1. zeta: 1 none, 0.8 premium, 0.5 playful. f: speed in Hz.
  function spring(t, zeta = 0.7, f = 2) {
    if (t <= 0) return 0;
    const w = 2 * Math.PI * f;
    if (zeta >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
    const wd = w * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t));
  }
  // spring that starts at t0 and moves a -> b
  const springTo = (t, t0, a, b, zeta, f) => lerp(a, b, spring(t - t0, zeta, f));
  // retarget without a jump: keys = [[t0, v0], [t1, v1], ...]; each segment springs from the
  // previous segment's value at its own start time.
  function trackSpring(t, keys, zeta = 0.8, f = 2) {
    let t0 = keys[0][0], a = keys[0][1], b = keys[0][1];
    for (let i = 1; i < keys.length && t >= keys[i][0]; i++) {
      a = springTo(keys[i][0], t0, a, b, zeta, f);   // where the previous segment is at the retarget
      b = keys[i][1]; t0 = keys[i][0];
    }
    return springTo(t, t0, a, b, zeta, f);
  }

  // seeded random (mulberry32). Never Math.random.
  function rng(seed = 1) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // cheap smooth periodic noise for loops: whole cycles over period P
  const loopNoise = (t, P, seed = 1, harmonics = 3) => {
    const r = rng(seed); let v = 0, amp = 1, sum = 0;
    for (let h = 1; h <= harmonics; h++) { v += amp * Math.sin(2 * Math.PI * h * t / P + r() * 6.283); sum += amp; amp *= 0.5; }
    return v / sum;
  };

  // beat grid: time of beat n, computed per beat (never accumulate rounded frames)
  const beatT = (n, bpm = 120) => n * 60 / bpm;
  const beatF = (n, bpm = 120, fps = 30) => Math.round(n * 60 / bpm * fps);
  // text hold: 0.3 s per word + 0.5 s
  const holdFor = (text) => 0.3 * String(text).trim().split(/\s+/).length + 0.5;

  window.M = { bezier, EASE, MS, STAGGER, clamp, lerp, tween, fromTo, dampingRatio, spring, springTo,
    trackSpring, rng, loopNoise, beatT, beatF, holdFor };
})();
