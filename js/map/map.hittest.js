'use strict';
(function () {

  function distancePointToSegment(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(px - ax, py - ay);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(px - bx, py - by);
    const t = c1 / c2;
    const qx = ax + t * vx, qy = ay + t * vy;
    return Math.hypot(px - qx, py - qy);
  }

  function distancePointToPolyline(p, pts) {
    if (!pts || pts.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], ay = pts[i - 1][1];
      const bx = pts[i][0], by = pts[i][1];
      const d = distancePointToSegment(p.x, p.y, ax, ay, bx, by);
      if (d < best) best = d;
    }
    return best;
  }

  function computeL1DoorwayRect(nodes, dims) {
    const pad = 8;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const r = RADII[n.kind] || 8;
      const labelHeight = n.forceLabelBelow ? 0 : 16;
      minX = Math.min(minX, n.x - r);
      maxX = Math.max(maxX, n.x + r);
      minY = Math.min(minY, n.y - r - labelHeight);
      maxY = Math.max(maxY, n.y + r);
    }
    const wallPad = 25;
    const roomLeft = Math.max(pad, minX - wallPad);
    const roomRight = Math.min(dims.w - pad, maxX + wallPad);
    const roomTop = Math.max(pad, minY - wallPad);
    const doorGapWidth = 50;
    const doorGapCenter = dims.w * 0.5;
    const doorGapLeft = doorGapCenter - doorGapWidth * 0.5;
    const doorGapRight = doorGapCenter + doorGapWidth * 0.5;
    return {
      x: doorGapLeft - 8,
      y: roomTop - 12,
      w: (doorGapRight - doorGapLeft) + 16,
      h: 30
    };
  }

  function computeL2ElevatorRect(nodes, layoutMeta) {
    if (!layoutMeta || !layoutMeta.level2) return null;
    const { xLeft, xRight, yTop, centerX } = layoutMeta.level2;
    const bossNode = nodes.find(n => n.i === 0);
    const elevW = Math.min(52, xRight - xLeft - 8);
    const elevH = 28;
    const elevX = centerX - elevW * 0.5;
    let elevY = yTop + 2;
    if (bossNode) {
      const rBoss = RADII[bossNode.kind] || 10;
      elevY = bossNode.y - (rBoss + 10) - elevH;
    }
    return { x: elevX - 4, y: elevY - 4, w: elevW + 8, h: elevH + 8 };
  }

  // Expose the standard L2 doorway half-gap used in background/hit-test
  function getL2DoorGapHalf() {
    // Keep this in sync with map.backgrounds.js and hit-test usage
    return 10;
  }

  // Main hit test entry point (delegated by mapRenderer)
  // ctx is used for label measurement; state carries current snapshot/meta
  function atPoint(ctx, p, state) {
    const level = state.level || 0;
    const nodes = state.nodes || [];
    const meta = state.layoutMeta || {};
    const dims = state.dims || { w: 0, h: 0 };
    const loc = (typeof state.locIndex === 'number' ? state.locIndex : 0);
    const next = (typeof state.nextLocIndex === 'number' ? state.nextLocIndex : 0);

    // 2) Node circles and labels
    ctx.save();
    ctx.font = LABEL_FONT;
    for (const n of nodes) {
      if (level === 0 && !n.discovered && n.i !== loc) {
        continue;
      }
      const rr = (RADII[n.kind] || 8) + 6;
      if (dist(p.x, p.y, n.x, n.y) <= rr) { ctx.restore(); return { type: 'node', index: n.i }; }

      if (n.label && n.nameKnown) {
        const r = RADII[n.kind] || 8;
        const align = n.labelAlign || 'center';
        let labelY = n.forceLabelBelow ? (n.y + r + 10) : (n.y - r - 6);
        if (!n.forceLabelBelow && labelY < 10) labelY = n.y + r + 10;
        const labelX = n.x + (n.labelDx || 0);
        const w = ctx.measureText(n.label).width;
        const h = 12;
        let x0;
        if (align === 'left') x0 = labelX;
        else if (align === 'right') x0 = labelX - w;
        else x0 = labelX - w * 0.5;
        const y0 = labelY - 10;
        if (p.x >= x0 && p.x <= x0 + w && p.y >= y0 && p.y <= y0 + h) {
          ctx.restore();
          return { type: 'node', index: n.i };
        }
      }
    }
    ctx.restore();

    // 3) Level 1: group-circle cluster under each trading post
    if (level === 1) {
      for (const n of nodes) {
        if (n.i === 0) continue; // skip doorway node
        const rdot = 4.6;
        const gap = 14;
        const below = (RADII[n.kind] || 8) + 12;
        const baseY = n.y + below;
        const baseX = n.x;
        const offsets = [-1.5 * gap, -0.5 * gap, 0.5 * gap, 1.5 * gap];
        for (let idx = 0; idx < offsets.length; idx++) {
          const dx = offsets[idx];
          const isOuter = (idx === 0 || idx === offsets.length - 1);
          const cxDot = baseX + dx;
          const cyDot = baseY - (isOuter ? rdot * 0.5 : 0);
          if (dist(p.x, p.y, cxDot, cyDot) <= 8) {
            return { type: 'groupCircles', index: n.i };
          }
        }
      }
    }

    // 4) Level 1: doorway gap at top
    if (level === 1) {
      const rc = computeL1DoorwayRect(nodes, dims);
      if (rc && p.x >= rc.x && p.x <= rc.x + rc.w && p.y >= rc.y && p.y <= rc.y + rc.h) {
        return { type: 'doorwayL1' };
      }
    }

    // 5) Level 2: elevator at top
    if (level === 2) {
      const rc2 = computeL2ElevatorRect(nodes, meta);
      if (rc2 && p.x >= rc2.x && p.x <= rc2.x + rc2.w && p.y >= rc2.y && p.y <= rc2.y + rc2.h) {
        return { type: 'elevatorL2' };
      }
    }

    // 5b) Level 2: doorway gaps along the hallway (treat as clickable targets)
    if (level === 2 && meta.level2) {
      const { xLeft, xRight, yTop, yBottom, centerX } = meta.level2;
      const doorGapHalf = 10;
      const wallHitThickness = 14; // px
      for (const n of nodes) {
        if (n.i === 0) continue; // skip elevator node
        const isLeft = n.x < centerX;
        const wallX = isLeft ? xLeft : xRight;
        const x0 = isLeft ? (wallX - wallHitThickness) : wallX;
        const w = wallHitThickness;
        const y0 = Math.max(yTop, n.y - (doorGapHalf + 6));
        const h = Math.min(yBottom, n.y + (doorGapHalf + 6)) - y0;
        if (p.x >= x0 && p.x <= x0 + w && p.y >= y0 && p.y <= y0 + h) {
          return { type: 'doorL2', index: n.i };
        }
      }
    }

    // 6) Dotted path between current and next destination
    if (loc !== next) {
      const fromNode = nodes.find(n => n.i === loc);
      const toNode = nodes.find(n => n.i === next);
      if (fromNode && toNode) {
        const route = getRouteBetweenNodes(level, meta, fromNode, toNode);
        const d = distancePointToPolyline(p, route);
        if (d <= 10) return { type: 'path' };
      }
    }

    return null;
  }

  window.MapHitTest = {
    atPoint,
    distancePointToSegment,
    distancePointToPolyline,
    computeL1DoorwayRect,
    computeL2ElevatorRect,
    getL2DoorGapHalf,
  };
})();
