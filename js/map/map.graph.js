'use strict';
(function () {
  // Simple singleton cache for the single in-page map instance
  let _invalid = true;
  let _lastLevel = -1;
  let _lastW = 0;
  let _lastH = 0;
  let _lastCount = 0;
  // Minimal-change logging: only when something meaningfully changes
  let _lastLog = { level: -1, nodes: -1, w: 0, h: 0 };
  let _fallbackLogged = false;

  // Resolve numLocations robustly from multiple sources to avoid blanks when globals aren't yet mirrored on window
  function resolveNumLocations(level) {
    try {
      if (typeof levelData !== 'undefined' && levelData && levelData[level] && typeof levelData[level].numLocations === 'number') {
        return levelData[level].numLocations;
      }
    } catch (_) {}
    try {
      if (typeof window !== 'undefined' && window.levelData && window.levelData[level] && typeof window.levelData[level].numLocations === 'number') {
        return window.levelData[level].numLocations;
      }
    } catch (_) {}
    try {
      if (typeof window !== 'undefined' && window.price && window.price[level] && typeof window.price[level].length === 'number' && window.price[level].length > 0) {
        return window.price[level].length;
      }
    } catch (_) {}
    try {
      if (typeof window !== 'undefined' && window.locationName && window.locationName[level] && typeof window.locationName[level].length === 'number' && window.locationName[level].length > 0) {
        return window.locationName[level].length;
      }
    } catch (_) {}
    try {
      if (typeof window !== 'undefined' && window.visitedLocation && window.visitedLocation[level] && typeof window.visitedLocation[level].length === 'number' && window.visitedLocation[level].length > 0) {
        return window.visitedLocation[level].length;
      }
    } catch (_) {}
    // Conservative default to prevent blank map if nothing else is available
    return 5;
  }
  function invalidate() {
    _invalid = true;
  }

  function rebuildIfNeeded(args) {
    const level = args.level || 0;
    const w = Math.max(1, Math.floor(args.w || 0));
    const h = Math.max(1, Math.floor(args.h || 0));
    const prevNodes = Array.isArray(args.nodes) ? args.nodes : [];
    const prevEdges = Array.isArray(args.edges) ? args.edges : [];
    const prevMeta = args.layoutMeta || {};
    const LD = (typeof levelData !== 'undefined' ? levelData : (window.levelData || null));

    const numLocations = resolveNumLocations(level);
    if (!numLocations) {
      // Fallback: build from computeSnapshotForLevel to avoid blank map when globals aren't ready yet
      try {
        const snap = (typeof computeSnapshotForLevel === 'function') ? computeSnapshotForLevel(level, w, h) : null;
        if (snap && snap.nodes && snap.nodes.length) {
          const layoutMeta = snap.layoutMeta || {};
          const nodes = [];
          const nCount = snap.nodes.length;
          for (let i = 0; i < nCount; i++) {
            const base = snap.nodes[i];
            const kind = getNodeKind(level, i);
            const visited = !!(window.visitedLocation && window.visitedLocation[level] && window.visitedLocation[level][i]);
            const nameKnown = (level === 0) ? visited : visited;
            const label = nameKnown
              ? (window.locationName && window.locationName[level] ? window.locationName[level][i] : '')
              : '';

            // Label layout hints (mirror L2 hints from normal path)
            let labelAlign = undefined;
            let labelDx = 0;
            let forceLabelBelow = false;
            if (level === 2) {
              if (i === 0) {
                forceLabelBelow = true;
                labelAlign = 'center';
              } else if (layoutMeta.level2) {
                const meta = layoutMeta.level2;
                const r = RADII[getNodeKind(2, i)] || 8;
                const isLeft = base.x < meta.centerX;
                if (isLeft) {
                  labelAlign = 'left'; labelDx = -r;
                } else {
                  labelAlign = 'right'; labelDx = r;
                }
              }
            }

            nodes.push({
              i,
              x: base.x,
              y: base.y,
              kind,
              discovered: (level === 0 ? visited : true),
              nameKnown,
              label,
              labelAlign,
              labelDx,
              forceLabelBelow
            });
          }

          const edges = [];
          for (let i = 1; i < nCount; i++) edges.push([0, i]);

          _lastLevel = level; _lastW = w; _lastH = h; _lastCount = nCount; _invalid = false;
          try { if (!_fallbackLogged) { console.debug('[MapGraph] fallback snapshot build', { nodes: nodes.length }); _fallbackLogged = true; } } catch(_) {}
          return { nodes, edges, layoutMeta, positionsValid: true };
        }
      } catch (_) {}

      // If snapshot also unavailable/empty, return empty but mark cache updated to avoid thrash
      _lastLevel = level; _lastW = w; _lastH = h; _lastCount = 0;
      _invalid = false;
      return {
        nodes: [],
        edges: [],
        layoutMeta: {},
        positionsValid: true
      };
    }

    const needRebuild =
      _invalid ||
      level !== _lastLevel ||
      w !== _lastW || h !== _lastH ||
      _lastCount !== numLocations ||
      prevNodes.length !== numLocations;

    if (needRebuild) {
      const pad = 12;
      const cx = w * 0.5, cy = h * 0.5;
      let layoutMeta = {};
      let pts = [];

      if (level === 2) {
        // Level 2: vertical hallway with walls and elevator at top
        const hallWidth = Math.min(w * 0.5, 140);
        const xLeft = cx - hallWidth * 0.5;
        const xRight = cx + hallWidth * 0.5;
        const yTop = pad + 24;
        const yBottom = h - pad - 8;
        const centerX = cx;

        const elevatorY = yTop + 20;
        pts[0] = [centerX, elevatorY];

        const usableHeight = (yBottom - (elevatorY + 40));
        const step = usableHeight / 4;
        for (let i = 1; i < numLocations; i++) {
          const trow = i; // 1..4
          const y = elevatorY + 40 + (trow - 1) * step + step * 0.5;
          const leftSide = (i % 2 === 1);
          const insideLeftX = xLeft + 16;     // place posts INSIDE hallway to avoid door collisions
          const insideRightX = xRight - 16;
          const x = leftSide ? insideLeftX : insideRightX;
          pts[i] = [x, y];
        }

        layoutMeta.level2 = { xLeft, xRight, yTop, yBottom, centerX };
      } else {
        // Levels 0 and 1: circle layout (with headroom adjustment for labels/doorway)
        let r = Math.max(20, Math.min(h * 0.5 - pad, w * 0.45 - pad));

        if (level === 1) {
          const rBoss = RADII[getNodeKind(1, 0)] || 10; // index 0 is doorway icon on L1
          const vGap = 16, doorH = 26, marginTop = rBoss + vGap + doorH + 8;
          const maxRForDoor = Math.max(20, (cy - (pad + marginTop)));
          r = Math.min(r, maxRForDoor);
          layoutMeta.level1 = { bossIndex: 0, rAdjusted: r };
        } else if (level === 0) {
          // Ensure headroom for L0 boss label above top node (index 0)
          const rBoss0 = RADII[getNodeKind(0, 0)] || 8;
          const labelH = 10, vGap0 = 10;
          const marginTop0 = rBoss0 + vGap0 + labelH + 6;
          const maxRForLabel0 = Math.max(20, (cy - (pad + marginTop0)));
          r = Math.min(r, maxRForLabel0);
          layoutMeta.level0 = { bossIndex: 0, rAdjusted: r };
        }

        pts = computeCirclePositions(numLocations, cx, cy, r);
      }

      // Build nodes
      const nodes = [];
      for (let i = 0; i < numLocations; i++) {
        const kind = getNodeKind(level, i);
        const visited = !!(window.visitedLocation && window.visitedLocation[level] && window.visitedLocation[level][i]);
        const nameKnown = (level === 0) ? visited : visited; // Level 1+: names revealed on visit
        const label = nameKnown
          ? (window.locationName && window.locationName[level] ? window.locationName[level][i] : '')
          : '';

        // Label layout hints
        let labelAlign = undefined;
        let labelDx = 0;
        let forceLabelBelow = false;

        if (level === 2) {
          if (i === 0) {
            // Keep the "final boss" (elevator) label below to avoid overlapping elevator drawing
            forceLabelBelow = true;
          } else {
            // Left side posts: left-justify text with left side of circle
            // Right side posts: right-justify text with right side of circle
            const meta = layoutMeta.level2;
            const x = pts[i][0];
            const r = RADII[getNodeKind(2, i)] || 8;
            const isLeft = x < meta.centerX;
            if (isLeft) {
              labelAlign = 'left';
              labelDx = -r; // align with left side of circle
            } else {
              labelAlign = 'right';
              labelDx = r; // align with right side of circle
            }
          }
        }

        nodes.push({
          i,
          x: pts[i][0],
          y: pts[i][1],
          kind,
          discovered: (level === 0 ? visited : true),
          nameKnown,
          label,
          labelAlign,
          labelDx,
          forceLabelBelow
        });
      }

      // Edges: simple star to index 0, except self
      const edges = [];
      for (let i = 1; i < numLocations; i++) {
        edges.push([0, i]);
      }

      // Update cache
      _lastLevel = level; _lastW = w; _lastH = h; _lastCount = numLocations; _invalid = false;
      try {
        const changed = (level !== _lastLog.level) || (nodes.length !== _lastLog.nodes) || (w !== _lastLog.w) || (h !== _lastLog.h);
        if (changed) {
          console.debug('[MapGraph] rebuilt', { level, nodes: nodes.length });
          _lastLog = { level, nodes: nodes.length, w, h };
        }
      } catch(_) {}

      return { nodes, edges, layoutMeta, positionsValid: true };
    } else {
      // Only update discovered/nameKnown/label without recomputing positions
      const nodes = prevNodes.map((n) => ({ ...n }));
      for (const n of nodes) {
        const i = n.i;
        const visited = !!(window.visitedLocation && window.visitedLocation[level] && window.visitedLocation[level][i]);
        n.discovered = (level === 0 ? visited : true);
        n.nameKnown = (level === 0 ? visited : visited);
        n.label = n.nameKnown
          ? (window.locationName && window.locationName[level] ? window.locationName[level][i] : '')
          : '';
        n.kind = getNodeKind(level, i);

        // Re-assert L2 label hints on each rebuild/update
        if (level === 2 && prevMeta.level2) {
          if (n.i === 0) {
            n.forceLabelBelow = true;
            n.labelAlign = 'center';
            n.labelDx = 0;
          } else {
            const meta = prevMeta.level2;
            const x = n.x;
            const r = RADII[getNodeKind(2, n.i)] || 8;
            const isLeft = x < meta.centerX;
            if (isLeft) {
              n.labelAlign = 'left';
              n.labelDx = -r; // align with left side of circle
            } else {
              n.labelAlign = 'right';
              n.labelDx = r; // align with right side of circle
            }
            n.forceLabelBelow = false;
          }
        }
      }
      return {
        nodes,
        edges: prevEdges,
        layoutMeta: prevMeta,
        positionsValid: true
      };
    }
  }

  window.MapGraph = {
    invalidate,
    rebuildIfNeeded
  };
})();