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

  // Levels 0 and 1: circle
  let r = Math.max(20, Math.min(h * 0.5 - pad, w * 0.45 - pad));
  if (level === 1) {
    const rBoss = RADII[getNodeKind(1, 0)] || 10;
    const vGap = 16, doorH = 26, marginTop = rBoss + vGap + doorH + 8;
    const maxRForDoor = Math.max(20, (cy - (pad + marginTop)));
    r = Math.min(r, maxRForDoor);
  }
  const pts = computeCirclePositions(numLocations, cx, cy, r);
  for (let i = 0; i < numLocations; i++) {
    const kind = getNodeKind(level, i);
    nodes.push({ i, x: pts[i][0], y: pts[i][1], kind });
  }
  const layoutMeta = (level === 1) ? { level1: { rAdjusted: r } } : {};
  return { nodes, layoutMeta, level };
}