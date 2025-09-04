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

  window.MapBackgrounds = {
    drawLevel1Background,
    drawLevel2Background
  };
})();