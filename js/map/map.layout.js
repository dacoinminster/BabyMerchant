'use strict';

// Node kind per level/index
function getNodeKind(level, index) {
  if (level === 0) {
    return index === 0 ? 'leader' : 'baby';
  } else {
    return index === 0 ? 'doorway' : 'leader';
  }
}

// Deterministic circle layout
function computeCirclePositions(num, cx, cy, r) {
  const pts = [];
  for (let i = 0; i < num; i++) {
    const t = (i / num) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

// Build a snapshot of node positions for an arbitrary level using current viewport
function computeSnapshotForLevel(level, w, h) {
  // Prefer the same logic used by the live map so snapshots match exactly
  try {
    if (window.MapGraph && typeof window.MapGraph.rebuildIfNeeded === 'function') {
      const built = window.MapGraph.rebuildIfNeeded({ level, w, h, nodes: [], edges: [], layoutMeta: {} });
      // Return a compatible snapshot object
      return {
        nodes: built.nodes || [],
        layoutMeta: built.layoutMeta || {},
        level
      };
    }
  } catch (_) {}

  // Fallback: local computation that mirrors MapGraph (kept in sync)
  const numLocations = (levelData && levelData[level] ? levelData[level].numLocations : 0);
  const nodes = [];
  if (!numLocations) return { nodes, layoutMeta: {}, level };
  const pad = 12;
  const cx = w * 0.5, cy = h * 0.5;

  if (level === 2) {
    const hallWidth = Math.min(w * 0.5, 140);
    const xLeft = cx - hallWidth * 0.5;
    const xRight = cx + hallWidth * 0.5;
    const yTop = pad + 24;
    const yBottom = h - pad - 8;
    const centerX = cx;
    const elevatorY = yTop + 20;
    const pts = [];
    pts[0] = [centerX, elevatorY];
    const usableHeight = (yBottom - (elevatorY + 40));
    const step = usableHeight / 4;
    for (let i = 1; i < numLocations; i++) {
      const trow = i;
      const y = elevatorY + 40 + (trow - 1) * step + step * 0.5;
      const leftSide = (i % 2 === 1);
      const insideLeftX = xLeft + 16;
      const insideRightX = xRight - 16;
      const x = leftSide ? insideLeftX : insideRightX;
      pts[i] = [x, y];
    }
    for (let i = 0; i < numLocations; i++) {
      const kind = getNodeKind(level, i);
      nodes.push({ i, x: pts[i][0], y: pts[i][1], kind });
    }
    return { nodes, layoutMeta: { level2: { xLeft, xRight, yTop, yBottom, centerX } }, level };
  }

  // Levels 0 and 1: circle (with headroom for labels/doorway)
  let r = Math.max(20, Math.min(h * 0.5 - pad, w * 0.45 - pad));
  let layoutMeta = {};
  if (level === 1) {
    const rBoss = RADII[getNodeKind(1, 0)] || 10;
    const vGap = 16, doorH = 26, marginTop = rBoss + vGap + doorH + 8;
    const maxRForDoor = Math.max(20, (cy - (pad + marginTop)));
    r = Math.min(r, maxRForDoor);
    layoutMeta.level1 = { bossIndex: 0, rAdjusted: r };
  } else if (level === 0) {
    // Mirror MapGraph: headroom for boss label above index 0
    const rBoss0 = RADII[getNodeKind(0, 0)] || 8;
    const labelH = 10, vGap0 = 10;
    const marginTop0 = rBoss0 + vGap0 + labelH + 6;
    const maxRForLabel0 = Math.max(20, (cy - (pad + marginTop0)));
    r = Math.min(r, maxRForLabel0);
    layoutMeta.level0 = { bossIndex: 0, rAdjusted: r };
  }
  const pts = computeCirclePositions(numLocations, cx, cy, r);
  for (let i = 0; i < numLocations; i++) {
    const kind = getNodeKind(level, i);
    nodes.push({ i, x: pts[i][0], y: pts[i][1], kind });
  }
  return { nodes, layoutMeta, level };
}
