'use strict';
'use strict';

// DOM label helpers
function getLabelElementForIndex(i) {
  // Destination labels are rendered as: <label for="nextLocN">...
  return document.querySelector('label[for="nextLoc' + i + '"]');
}

function getComputedColorForLabel(i) {
  const el = getLabelElementForIndex(i);
  if (!el) return null;
  const style = getComputedStyle(el);
  return style && style.color ? style.color : null; // e.g., "rgb(0, 200, 0)" when gossip highlights
}

// Drawing helpers
function drawNode(ctx, node, showName, hasGossip, labelText, ringColor) {
  const r = RADII[node.kind];

  // core
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  ctx.fillStyle = FILL;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = STROKE;
  ctx.stroke();

  if (hasGossip) {
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = ringColor || STROKE;
    ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (showName && labelText) {
    ctx.font = LABEL_FONT;
    ctx.fillStyle = STROKE;

    // Label alignment/offset hints possibly supplied by layout
    const align = node.labelAlign || 'center';
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';

    // Y placement: default above; can be forced below; clamp if too close to top
    let labelY = node.forceLabelBelow ? (node.y + r + 10) : (node.y - r - 6);
    if (!node.forceLabelBelow && labelY < 10) {
      labelY = node.y + r + 10;
    }

    const labelX = node.x + (node.labelDx || 0);
    ctx.fillText(labelText, labelX, labelY);
  }
}

function drawEdge(ctx, ax, ay, bx, by) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineWidth = 1;
  ctx.strokeStyle = STROKE;
  ctx.setLineDash([]);
  ctx.stroke();
}

function drawDashedPath(ctx, ax, ay, bx, by, strokeStyle) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = strokeStyle || STROKE;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}

// Draw a dashed polyline for routed paths (e.g., level 2 hallway)
function drawDashedPolyline(ctx, pts, strokeStyle, alpha = 1) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = strokeStyle || STROKE;
  ctx.globalAlpha = alpha;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();
  ctx.restore();
}

// t in [0,1]
function pointAlongPolyline(pts, t) {
  if (!pts || pts.length === 0) return [0, 0];
  if (pts.length === 1) return pts[0];
  const total = polylineLength(pts);
  if (total === 0) return pts[pts.length - 1];
  let dist = t * total;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1];
    const bx = pts[i][0], by = pts[i][1];
    const seg = Math.hypot(bx - ax, by - ay);
    if (dist <= seg || i === pts.length - 1) {
      const tt = seg ? dist / seg : 0;
      return [lerp(ax, bx, tt), lerp(ay, by, tt)];
    }
    dist -= seg;
  }
  return pts[pts.length - 1];
}

// Route computation by level
function getRouteBetweenNodes(level, meta, fromNode, toNode) {
  if (!fromNode || !toNode) return [[0, 0], [0, 0]];
  if (level === 2 && meta && meta.level2) {
    const cx = meta.level2.centerX;
    const a = [fromNode.x, fromNode.y];
    const b = [toNode.x, toNode.y];
    const aOnCenter = Math.abs(a[0] - cx) < 1e-3;
    const bOnCenter = Math.abs(b[0] - cx) < 1e-3;
    const p1 = aOnCenter ? a : [cx, a[1]];
    const p2 = bOnCenter ? b : [cx, b[1]];
    const pts = [a];
    if (!aOnCenter) pts.push(p1);
    if (!bOnCenter && (pts.length === 1 || (pts[pts.length - 1][0] !== p2[0] || pts[pts.length - 1][1] !== p2[1]))) {
      // vertical spine
      pts.push(p2);
    }
    pts.push(b);
    // Remove any consecutive duplicates
    const dedup = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = dedup[dedup.length - 1];
      if (Math.abs(prev[0] - pts[i][0]) > 1e-6 || Math.abs(prev[1] - pts[i][1]) > 1e-6) {
        dedup.push(pts[i]);
      }
    }
    return dedup;
  }
  // Default straight
  return [[fromNode.x, fromNode.y], [toNode.x, toNode.y]];
}

function drawProgressBaby(ctx, x, y, px = 22, level = 0) {
  // Grayscale emoji rendering. Use filter when available, else pixel fallback.
  const supportsFilter = ('filter' in ctx);
  ctx.save();
  ctx.font = `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",emoji,sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Apply level-specific transformations when travel is active and animation is within its duration
  if (window.mapRenderer && window.mapRenderer._travelActive && window.mapRenderer._stepAnimationStartTime > 0) {
    const animationDurationPerStep = 800; // Duration for one step's animation
    const elapsedTime = performance.now() - window.mapRenderer._stepAnimationStartTime;
    const animationProgress = clamp01(elapsedTime / animationDurationPerStep);

    if (animationProgress < 1) { // Only animate if within the step's animation duration
      if (window.currLevel === 1) {
        // Level 1: Rolling over (360 rotation)
        const rotation = animationProgress * Math.PI * 2; // 360 degrees in radians
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.translate(-x, -y);
      } else if (window.currLevel === 0) {
        // Level 0: Thrashing about
        const shakeCycleDuration = 100; // 100ms cycle for thrashing
        const shakeProgress = (elapsedTime % shakeCycleDuration) / shakeCycleDuration;
        const shakeX = Math.sin(shakeProgress * Math.PI * 2) * 2; // 2px shake
        const shakeY = Math.cos(shakeProgress * Math.PI * 2) * 2; // 2px shake
        ctx.translate(x + shakeX, y + shakeY);
        ctx.translate(-x, -y);
      }
    }
  }
  // Level 2: Crawling (three quick scootches) is handled by modifying the 't' value in _draw.

  if (supportsFilter) {
    ctx.filter = 'grayscale(1) contrast(1.1)';
    ctx.fillText('👶', x, y);
  } else {
    // Fallback: offscreen canvas, convert to luminance
    const w = px * 2, h = px * 2;
    const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
    const octx = oc.getContext('2d');
    octx.font = `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",emoji,sans-serif`;
    octx.textAlign = 'center'; octx.textBaseline = 'middle';
    octx.fillText('👶', w / 2, h / 2);
    const img = octx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const yLum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      d[i] = d[i + 1] = d[i + 2] = yLum;
    }
    octx.putImageData(img, 0, 0);
    ctx.drawImage(oc, Math.round(x - w / 2), Math.round(y - h / 2));
  }
  ctx.restore();
}

function dist(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return Math.hypot(dx, dy);
}
// Data-driven helpers for Level 1 group mini-circles (shared by renderer and transitions)
function getLevel1MiniSpec() {
  try {
    const LD = (typeof levelData !== 'undefined' && levelData) ? levelData : (window.levelData || null);
    const t = (LD && LD[1] && LD[1].transitionSpecs) ? LD[1].transitionSpecs : null;
    const spec = (t && t['0->1']) || (t && t['1->0']) || null;
    const mini = spec && spec.l0l1 && spec.l0l1.mini;
    if (mini) return mini;
  } catch (_) {}
  return { rdot: 4.6, gap: 14, belowOffset: 12, offsetMultipliers: [-1.5, -0.5, 0.5, 1.5], outerLift: 0.5 };
}

function computeGroupCirclePositions(node, miniSpec) {
  const mini = miniSpec || getLevel1MiniSpec();
  const rdot = (typeof mini.rdot === 'number') ? mini.rdot : 4.6;
  const gap = (typeof mini.gap === 'number') ? mini.gap : 14;
  const below = (RADII[node.kind] + (typeof mini.belowOffset === 'number' ? mini.belowOffset : 12));
  const baseY = node.y + below;
  const baseX = node.x;
  const multipliers = Array.isArray(mini.offsetMultipliers) ? mini.offsetMultipliers : [-1.5, -0.5, 0.5, 1.5];
  const outerLift = (typeof mini.outerLift === 'number') ? mini.outerLift : 0.5;

  const pts = [];
  for (let idx = 0; idx < multipliers.length; idx++) {
    const dx = multipliers[idx] * gap;
    const isOuter = (idx === 0 || idx === multipliers.length - 1);
    const cxDot = baseX + dx;
    const cyDot = baseY - (isOuter ? rdot * outerLift : 0); // raise outer dots to suggest a semicircle
    pts.push({ x: cxDot, y: cyDot, r: rdot });
  }
  return pts;
}

function drawGroupMiniCircles(ctx, node, miniSpec) {
  const circles = computeGroupCirclePositions(node, miniSpec);
  ctx.save();
  ctx.fillStyle = FILL;
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 2;
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// Expose helpers on window for cross-module use
try {
  window.getLevel1MiniSpec = getLevel1MiniSpec;
  window.computeGroupCirclePositions = computeGroupCirclePositions;
  window.drawGroupMiniCircles = drawGroupMiniCircles;
} catch (_) {}