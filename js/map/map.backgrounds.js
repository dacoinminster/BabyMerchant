'use strict';
(function () {

  function drawLevel2Background(ctx, nodes, dims, layoutMeta) {
    if (!layoutMeta || !layoutMeta.level2) return;
    const { xLeft, xRight, yTop, yBottom, centerX } = layoutMeta.level2;
    const doorGapHalf = 10;

    // Collect doorway y-positions per side from node layout (indices 1..)
    const leftGaps = [];
    const rightGaps = [];
    for (const n of nodes) {
      if (n.i === 0) continue;
      if (n.x < centerX) leftGaps.push(n.y);
      else rightGaps.push(n.y);
    }
    leftGaps.sort((a, b) => a - b);
    rightGaps.sort((a, b) => a - b);

    // Helper to draw a vertical line with gaps
    const drawGappedWall = (x, gaps) => {
      ctx.beginPath();
      let yCursor = yTop;
      for (const gy of gaps) {
        const y1 = Math.max(yTop, gy - doorGapHalf);
        const y2 = Math.min(yBottom, gy + doorGapHalf);
        if (y1 > yCursor) {
          ctx.moveTo(x, yCursor);
          ctx.lineTo(x, y1);
        }
        yCursor = y2;
      }
      if (yCursor < yBottom) {
        ctx.moveTo(x, yCursor);
        ctx.lineTo(x, yBottom);
      }
      ctx.stroke();
    };

    ctx.save();
    ctx.strokeStyle = STROKE;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    // Left and right walls with gaps for doorways
    drawGappedWall(xLeft, leftGaps);
    drawGappedWall(xRight, rightGaps);

    // Elevator header (top lintel) across the hall
    ctx.beginPath();
    ctx.moveTo(xLeft, yTop);
    ctx.lineTo(xRight, yTop);
    ctx.stroke();

    // Closed elevator door (rectangle with center line), positioned above the boss label
    const bossNode = nodes.find(n => n.i === 0);
    const elevW = Math.min(52, xRight - xLeft - 8);
    const elevH = 28;
    const elevX = centerX - elevW * 0.5;
    let elevY = yTop + 2;
    if (bossNode) {
      const rBoss = RADII[bossNode.kind] || 10;
      elevY = bossNode.y - (rBoss + 10) - elevH;
    }
    ctx.beginPath();
    ctx.rect(elevX, elevY, elevW, elevH);
    ctx.stroke();

    // Bottom cap to close the hallway
    ctx.beginPath();
    ctx.moveTo(xLeft, yBottom);
    ctx.lineTo(xRight, yBottom);
    ctx.stroke();

    // Open door leaves at each hallway doorway (open into the rooms, away from hallway)
    ctx.lineWidth = 3;

    for (const gy of leftGaps) {
      const y1 = Math.max(yTop, gy - doorGapHalf);
      const y2 = Math.min(yBottom, gy + doorGapHalf);
      // Top leaf (hinge at top gap edge)
      ctx.beginPath();
      ctx.moveTo(xLeft, y1);
      ctx.lineTo(xLeft - 12, y1 - 10);
      ctx.stroke();
      // Bottom leaf (hinge at bottom gap edge)
      ctx.beginPath();
      ctx.moveTo(xLeft, y2);
      ctx.lineTo(xLeft - 12, y2 + 10);
      ctx.stroke();
    }
    for (const gy of rightGaps) {
      const y1 = Math.max(yTop, gy - doorGapHalf);
      const y2 = Math.min(yBottom, gy + doorGapHalf);
      // Top leaf
      ctx.beginPath();
      ctx.moveTo(xRight, y1);
      ctx.lineTo(xRight + 12, y1 - 10);
      ctx.stroke();
      // Bottom leaf
      ctx.beginPath();
      ctx.moveTo(xRight, y2);
      ctx.lineTo(xRight + 12, y2 + 10);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawLevel1Background(ctx, nodes, dims, layoutMeta) {
    const pad = 8;

    // Calculate bounds of all nodes including boss/upgrade post
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const r = RADII[n.kind] || 8;
      const labelHeight = n.forceLabelBelow ? 0 : 16; // space for label above
      minX = Math.min(minX, n.x - r);
      maxX = Math.max(maxX, n.x + r);
      minY = Math.min(minY, n.y - r - labelHeight);
      maxY = Math.max(maxY, n.y + r);
    }

    // Add generous padding around all bounds for walls and text clearance
    const wallPad = 25;
    const roomLeft = Math.max(pad, minX - wallPad);
    const roomRight = Math.min(dims.w - pad, maxX + wallPad);
    const roomBottom = Math.min(dims.h - pad, maxY + wallPad);
    const roomTop = Math.max(pad, minY - wallPad);

    // Doorway gap in the top wall
    const doorGapWidth = 50;
    const doorGapCenter = dims.w * 0.5;
    const doorGapLeft = doorGapCenter - doorGapWidth * 0.5;
    const doorGapRight = doorGapCenter + doorGapWidth * 0.5;

    ctx.save();
    ctx.strokeStyle = STROKE;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    // Top wall with gap for doorway
    ctx.beginPath();
    ctx.moveTo(roomLeft, roomTop);
    ctx.lineTo(doorGapLeft, roomTop);
    ctx.moveTo(doorGapRight, roomTop);
    ctx.lineTo(roomRight, roomTop);
    ctx.stroke();

    // Left wall
    ctx.beginPath();
    ctx.moveTo(roomLeft, roomTop);
    ctx.lineTo(roomLeft, roomBottom);
    ctx.stroke();

    // Right wall
    ctx.beginPath();
    ctx.moveTo(roomRight, roomTop);
    ctx.lineTo(roomRight, roomBottom);
    ctx.stroke();

    // Bottom wall
    ctx.beginPath();
    ctx.moveTo(roomLeft, roomBottom);
    ctx.lineTo(roomRight, roomBottom);
    ctx.stroke();

    // Double doors: single diagonal lines
    ctx.lineWidth = 3;

    // Left door
    ctx.beginPath();
    ctx.moveTo(doorGapLeft, roomTop);
    ctx.lineTo(doorGapLeft - 12, roomTop + 12);
    ctx.stroke();

    // Right door
    ctx.beginPath();
    ctx.moveTo(doorGapRight, roomTop);
    ctx.lineTo(doorGapRight + 12, roomTop + 12);
    ctx.stroke();

    ctx.restore();
  }

  // Generic, data-driven background renderer that reads per-level backgroundSpec from levelData
  function drawLevelBackground(ctx, nodes, dims, layoutMeta, levelIndex) {
    var LD = null;
    try {
      LD = (typeof levelData !== 'undefined' && levelData) ? levelData : (window.levelData || null);
    } catch (_) {}
    var spec = (LD && LD[levelIndex] && LD[levelIndex].backgroundSpec) ? LD[levelIndex].backgroundSpec : null;

    // Fallback to legacy hardcoded backgrounds when no spec is present or empty
    if (!spec || !spec.ops || !spec.ops.length) {
      if (levelIndex === 2 && layoutMeta && layoutMeta.level2) {
        return drawLevel2Background(ctx, nodes, dims, layoutMeta);
      }
      if (levelIndex === 1) {
        return drawLevel1Background(ctx, nodes, dims, layoutMeta);
      }
      return; // No background for level 0
    }

    // Executor for vector ops
    ctx.save();
    try {
      var context = {
        nodes: nodes,
        dims: dims,
        layoutMeta: layoutMeta,
        RADII: RADII,
        STROKE: STROKE,
        doorGapHalf: spec.doorGapHalf || 10
      };

      // Execute preComputes first
      if (spec.preComputes) {
        for (var pi = 0; pi < spec.preComputes.length; pi++) {
          var pc = spec.preComputes[pi];
          var pcType = pc.type;
          var storeAs = pc.storeAs;
          if (pcType === 'computeRoomBounds') {
            context[storeAs] = computeRoomBounds(nodes, dims, pc.pad || 8, pc.wallPad || 25);
          } else if (pcType === 'computeDoorGapLeft') {
            var doorGapWidth = pc.doorGapWidth || 50;
            context[storeAs] = dims.w * 0.5 - doorGapWidth / 2;
          } else if (pcType === 'computeDoorGapRight') {
            var doorGapWidth = pc.doorGapWidth || 50;
            context[storeAs] = dims.w * 0.5 + doorGapWidth / 2;
          } else if (pcType === 'computeLeftGaps') {
            var centerX = layoutMeta.level2 ? layoutMeta.level2.centerX : dims.w * 0.5;
            context[storeAs] = nodes.filter(function(n) { return n.i > 0 && n.x < centerX; }).map(function(n) { return n.y; }).sort(function(a,b) { return a - b; });
          } else if (pcType === 'computeRightGaps') {
            var centerX = layoutMeta.level2 ? layoutMeta.level2.centerX : dims.w * 0.5;
            context[storeAs] = nodes.filter(function(n) { return n.i > 0 && n.x > centerX; }).map(function(n) { return n.y; }).sort(function(a,b) { return a - b; });
          } else if (pcType === 'computeBossNode') {
            context[storeAs] = nodes.find(function(n) { return n.i === 0; });
          } else if (pcType === 'computeElevatorParams') {
            var lm2 = layoutMeta.level2;
            if (!lm2) continue;
            var boss = context.bossNode || nodes.find(function(n) { return n.i === 0; });
            var elevWMax = pc.elevWMax || 52;
            var elevH = pc.elevH || 28;
            var elevW = Math.min(elevWMax, lm2.xRight - lm2.xLeft - 8);
            var elevX = lm2.centerX - elevW * 0.5;
            var elevY = lm2.yTop + 2;
            if (boss) {
              var rBoss = RADII[boss.kind] || 10;
              elevY = boss.y - (rBoss + 10) - elevH;
            }
            context[storeAs] = { x: elevX, y: elevY, w: elevW, h: elevH };
          }
          // Add more preCompute types as needed
        }
      }

      // Helper to resolve param value from context or expression
      function resolveParam(param) {
        if (typeof param === 'number') return param;
        if (typeof param !== 'string') return param;
        try {
          // Allow identifiers (doorGapLeft), dot paths (bounds.roomTop), and simple arithmetic (a - 12)
          return Function('ctx', 'with (ctx) { return (' + param + '); }')(context);
        } catch (e) {
          // Fallback: dot-path lookup
          try {
            var parts = String(param).split('.');
            var val = context;
            for (var j = 0; j < parts.length; j++) {
              if (val === undefined || val === null) return undefined;
              val = val[parts[j]];
            }
            return val;
          } catch (_) {
            return undefined;
          }
        }
      }

      // Execute ops
      for (var i = 0; i < spec.ops.length; i++) {
        var op = spec.ops[i];
        var opType = op.type;
        var params = op.params || {};
        var style = op.style || {};
        var resolvedParams = {};
        for (var k in params) {
          resolvedParams[k] = resolveParam(params[k]);
        }
        if (opType === 'line') {
          drawLine(ctx, resolvedParams.x1, resolvedParams.y1, resolvedParams.x2, resolvedParams.y2, style);
        } else if (opType === 'rect') {
          drawRect(ctx, resolvedParams.x, resolvedParams.y, resolvedParams.w, resolvedParams.h, style);
        } else if (opType === 'gappedVerticalLine') {
          drawGappedVerticalLine(ctx, resolvedParams.x, resolvedParams.yTop, resolvedParams.yBottom, resolvedParams.gaps, style);
        } else if (opType === 'forEach') {
          var over = resolveParam(op.over);
          if (Array.isArray(over)) {
            for (var fi = 0; fi < over.length; fi++) {
              context.current = over[fi];
              for (var foi = 0; foi < op.forEachOp.length; foi++) {
                var fop = op.forEachOp[foi];
                var fopType = fop.type;
                var fparams = fop.params || {};
                var fstyle = fop.style || {};
                var fresolved = {};
                for (var fk in fparams) {
                  fresolved[fk] = resolveParam(fparams[fk]);
                }
                if (fopType === 'line') {
                  drawLine(ctx, fresolved.x1, fresolved.y1, fresolved.x2, fresolved.y2, fstyle);
                }
                // Add more forEach op types as needed
              }
            }
          }
        }
        // Add more op types as needed
      }
    } finally {
      ctx.restore();
    }
  }

  // Legacy function, deprecated after migration to vector ops
  function _drawLevel1RoomFromSpec(ctx, nodes, dims, cfg) {
    // Implementation removed; use vector ops instead
    console.warn('Legacy _drawLevel1RoomFromSpec called; migrate to vector ops');
  }

  // Implements current Level 2 hallway using parameters from spec
  function _drawLevel2HallwayFromSpec(ctx, nodes, dims, layoutMeta, cfg) {
    if (!layoutMeta || !layoutMeta.level2) return;
    var xLeft = layoutMeta.level2.xLeft;
    var xRight = layoutMeta.level2.xRight;
    var yTop = layoutMeta.level2.yTop;
    var yBottom = layoutMeta.level2.yBottom;
    var centerX = layoutMeta.level2.centerX;

    var doorGapHalf = (cfg && typeof cfg.doorGapHalf === 'number') ? cfg.doorGapHalf : 10;
    var lineWidthWalls = (cfg && typeof cfg.lineWidthWalls === 'number') ? cfg.lineWidthWalls : 2;
    var lineWidthLeaves = (cfg && typeof cfg.lineWidthLeaves === 'number') ? cfg.lineWidthLeaves : 3;
    var leafOffsetX = (cfg && typeof cfg.leafOffsetX === 'number') ? cfg.leafOffsetX : 12;
    var leafOffsetY = (cfg && typeof cfg.leafOffsetY === 'number') ? cfg.leafOffsetY : 10;
    var elevWMax = (cfg && typeof cfg.elevWMax === 'number') ? cfg.elevWMax : 52;
    var elevH = (cfg && typeof cfg.elevH === 'number') ? cfg.elevH : 28;

    // Collect doorway y-positions per side from node layout (indices 1..)
    var leftGaps = [];
    var rightGaps = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.i === 0) continue;
      if (n.x < centerX) leftGaps.push(n.y);
      else rightGaps.push(n.y);
    }
    leftGaps.sort(function (a, b) { return a - b; });
    rightGaps.sort(function (a, b) { return a - b; });

    function drawGappedWall(x, gaps) {
      ctx.beginPath();
      var yCursor = yTop;
      for (var gi = 0; gi < gaps.length; gi++) {
        var gy = gaps[gi];
        var y1 = Math.max(yTop, gy - doorGapHalf);
        var y2 = Math.min(yBottom, gy + doorGapHalf);
        if (y1 > yCursor) {
          ctx.moveTo(x, yCursor);
          ctx.lineTo(x, y1);
        }
        yCursor = y2;
      }
      if (yCursor < yBottom) {
        ctx.moveTo(x, yCursor);
        ctx.lineTo(x, yBottom);
      }
      ctx.stroke();
    }

    ctx.save();
    ctx.strokeStyle = STROKE;
    ctx.lineWidth = lineWidthWalls;
    ctx.setLineDash([]);

    // Left and right walls with gaps for doorways
    drawGappedWall(xLeft, leftGaps);
    drawGappedWall(xRight, rightGaps);

    // Elevator header (top lintel) across the hall
    ctx.beginPath();
    ctx.moveTo(xLeft, yTop);
    ctx.lineTo(xRight, yTop);
    ctx.stroke();

    // Closed elevator door (rectangle with center line), positioned above the boss label
    var bossNode = null;
    for (var bi = 0; bi < nodes.length; bi++) {
      if (nodes[bi].i === 0) { bossNode = nodes[bi]; break; }
    }
    var elevW = Math.min(elevWMax, xRight - xLeft - 8);
    var elevX = centerX - elevW * 0.5;
    var elevY = yTop + 2;
    if (bossNode) {
      var rBoss = RADII[bossNode.kind] || 10;
      elevY = bossNode.y - (rBoss + 10) - elevH;
    }
    ctx.beginPath();
    ctx.rect(elevX, elevY, elevW, elevH);
    ctx.stroke();

    // Bottom cap to close the hallway
    ctx.beginPath();
    ctx.moveTo(xLeft, yBottom);
    ctx.lineTo(xRight, yBottom);
    ctx.stroke();

    // Open door leaves at each hallway doorway (open into the rooms, away from hallway)
    ctx.lineWidth = lineWidthLeaves;

    for (var li = 0; li < leftGaps.length; li++) {
      var gyL = leftGaps[li];
      var y1 = Math.max(yTop, gyL - doorGapHalf);
      var y2 = Math.min(yBottom, gyL + doorGapHalf);
      // Top leaf (hinge at top gap edge)
      ctx.beginPath();
      ctx.moveTo(xLeft, y1);
      ctx.lineTo(xLeft - leafOffsetX, y1 - leafOffsetY);
      ctx.stroke();
      // Bottom leaf (hinge at bottom gap edge)
      ctx.beginPath();
      ctx.moveTo(xLeft, y2);
      ctx.lineTo(xLeft - leafOffsetX, y2 + leafOffsetY);
      ctx.stroke();
    }
    for (var ri = 0; ri < rightGaps.length; ri++) {
      var gyR = rightGaps[ri];
      var y1r = Math.max(yTop, gyR - doorGapHalf);
      var y2r = Math.min(yBottom, gyR + doorGapHalf);
      // Top leaf
      ctx.beginPath();
      ctx.moveTo(xRight, y1r);
      ctx.lineTo(xRight + leafOffsetX, y1r - leafOffsetY);
      ctx.stroke();
      // Bottom leaf
      ctx.beginPath();
      ctx.moveTo(xRight, y2r);
      ctx.lineTo(xRight + leafOffsetX, y2r + leafOffsetY);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Primitive drawing functions for vector ops

  // Draw a straight line
  function drawLine(ctx, x1, y1, x2, y2, style) {
    const lw = style.lineWidth || 2;
    const strokeStyle = style.strokeStyle || STROKE;
    const dash = style.dash || [];
    ctx.save();
    ctx.lineWidth = lw;
    ctx.strokeStyle = strokeStyle;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  // Draw a rectangle outline
  function drawRect(ctx, x, y, w, h, style) {
    const lw = style.lineWidth || 2;
    const strokeStyle = style.strokeStyle || STROKE;
    ctx.save();
    ctx.lineWidth = lw;
    ctx.strokeStyle = strokeStyle;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.stroke();
    ctx.restore();
  }

  // Draw a vertical gapped line: x fixed, from yTop to yBottom with gaps at given y positions
  function drawGappedVerticalLine(ctx, x, yTop, yBottom, gaps, style) {
    if (!gaps || gaps.length === 0) {
      drawLine(ctx, x, yTop, x, yBottom, style);
      return;
    }
    gaps = gaps.slice().sort((a,b) => a - b);
    const gapHalf = style.gapHalf || 10;
    const lw = style.lineWidth || 2;
    const strokeStyle = style.strokeStyle || STROKE;
    ctx.save();
    ctx.lineWidth = lw;
    ctx.strokeStyle = strokeStyle;
    ctx.setLineDash([]);
    ctx.beginPath();
    let yCursor = yTop;
    for (let i = 0; i < gaps.length; i++) {
      const gy = gaps[i];
      const y1 = Math.max(yTop, gy - gapHalf);
      const y2 = Math.min(yBottom, gy + gapHalf);
      if (y1 > yCursor) {
        ctx.moveTo(x, yCursor);
        ctx.lineTo(x, y1);
      }
      yCursor = y2;
    }
    if (yCursor < yBottom) {
      ctx.moveTo(x, yCursor);
      ctx.lineTo(x, yBottom);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Compute room bounds for level 1-like layouts
  function computeRoomBounds(nodes, dims, pad = 8, wallPad = 25) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const r = RADII[n.kind] || 8;
      const labelHeight = n.forceLabelBelow ? 0 : 16;
      minX = Math.min(minX, n.x - r);
      maxX = Math.max(maxX, n.x + r);
      minY = Math.min(minY, n.y - r - labelHeight);
      maxY = Math.max(maxY, n.y + r);
    }
    return {
      roomLeft: Math.max(pad, minX - wallPad),
      roomRight: Math.min(dims.w - pad, maxX + wallPad),
      roomTop: Math.max(pad, minY - wallPad),
      roomBottom: Math.min(dims.h - pad, maxY + wallPad)
    };
  }

  window.MapBackgrounds = {
    drawLevel1Background,
    drawLevel2Background,
    drawLevelBackground,
    drawLine,
    drawRect,
    drawGappedVerticalLine,
    computeRoomBounds
  };
})();