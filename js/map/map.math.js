'use strict';

// Easing and math helpers
function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function lerp(a, b, t) { return a + (b - a) * t; }

// Geometry helpers
function centroidOf(nodes) {
  if (!nodes || !nodes.length) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const n of nodes) { sx += n.x; sy += n.y; }
  return { x: sx / nodes.length, y: sy / nodes.length };
}

function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    len += Math.hypot(dx, dy);
  }
  return len;
}