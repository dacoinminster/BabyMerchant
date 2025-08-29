/* Minimal monochrome map overlay renderer for Baby Merchant
   - Draws trading posts (nodes) and simple edges
   - Visualizes movement with a dashed path and a moving 👶 marker
   - Uses the same programmatic green as the destination label by reading computed style
   - Gossip indicator: double-ring around the gossiped destination (only when gossip colors showing)
   - Respects reveal rules:
     * Level 0: nodes appear as discovered (visitedLocation true)
     * Level 1+: all nodes shown, names revealed on visit
   - Size differences:
     * baby (level 0 non-boss): small
     * leader (level 0 boss; level 1+ non-zero): medium
     * doorway (level 1+ index 0): large
   - Emoji is rendered grayscale via ctx.filter, with a pixel fallback when unsupported
*/
(function () {
  'use strict';

  const RADII = { baby: 6, leader: 8, doorway: 10 };
  const LABEL_FONT = '10px monospace';
  const STROKE = '#000';
  const FILL = '#fff';
  const TRANSITION_DEFAULT_MS = 700;

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function getDevicePixelRatio() {
    return (window.devicePixelRatio || 1);
  }

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

  // Determines node kind based on level/index and spec
  function getNodeKind(level, index) {
    if (level === 0) {
      return index === 0 ? 'leader' : 'baby';
    } else {
      return index === 0 ? 'doorway' : 'leader';
    }
  }

  // Deterministic layout (circle) for now; refined per-level below
  function computeCirclePositions(num, cx, cy, r) {
    const pts = [];
    for (let i = 0; i < num; i++) {
      const t = (i / num) * Math.PI * 2 - Math.PI / 2;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return pts;
  }

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

  function polylineLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      len += Math.hypot(dx, dy);
    }
    return len;
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

  function drawProgressBaby(ctx, x, y, px = 22) {
    // Grayscale emoji rendering. Use filter when available, else pixel fallback.
    const supportsFilter = ('filter' in ctx);
    ctx.save();
    ctx.font = `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",emoji,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
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

  const mapRenderer = {
    _canvas: null,
    _ctx: null,
    _dpr: 1,
    _w: 0,
    _h: 0,
    _inited: false,
    _intervalId: null,
    _rafHandle: 0,
    _resizeListenerAdded: false,

    // Level transition animation
    _transitionActive: false,
    _transitionStart: 0,
    _transitionDir: 'up',
    _transitionDurationMs: TRANSITION_DEFAULT_MS,
    _prevFrameCanvas: null,

    // Game-state mirrors to detect transitions without invasive hooks
    _lastTransitMoves: 0,
    _lastLocIndex: 0,
    _lastCurrLevel: 0,

    // Graph cache
    _nodes: [], // {i, x, y, kind, discovered, nameKnown, label, labelAlign?, labelDx?, forceLabelBelow?}
    _edges: [], // pairs of node indices (indices into _nodes)
    _positionsValid: false,
    _layoutMeta: {},

    // Travel visualization
    _travelActive: false,
    _travelFrom: 0,
    _travelTo: 0,
    _travelTotalSteps: 0,
    _travelProgressSteps: 0,
    _travelColor: STROKE,

    init() {
      const host = document.getElementById('mapGoesHere');
      if (!host) return; // map container not present yet

      // Ensure canvas exists inside the host
      let c = document.getElementById('mapCanvas');
      if (!c) {
        c = document.createElement('canvas');
        c.id = 'mapCanvas';
        c.style.width = '100%';
        c.style.height = '100%';
        c.style.display = 'block';
        c.style.pointerEvents = 'none';
        host.appendChild(c);
      }

      // (Re)bind context and size
      this._canvas = c;
      this._ctx = c.getContext('2d');
      this._dpr = getDevicePixelRatio();
      this._resize();

      // Add resize listener only once
      if (!this._resizeListenerAdded) {
        window.addEventListener('resize', () => this._resize(), { passive: true });
        this._resizeListenerAdded = true;
      }

      // Start sync/draw loops once; allow re-init after DOM restore without duplicating loops
      if (!this._inited) {
        // Bootstrap mirrors
        this._lastTransitMoves = (window.transitMoves || 0);
        this._lastLocIndex = (window.locIndex || 0);
        this._lastCurrLevel = (window.currLevel || 0);

        // Sync loop
        this._intervalId = setInterval(() => {
          this._syncFromGameState();
        }, 100);

        // Draw loop
        const loop = () => {
          this._draw();
          this._rafHandle = requestAnimationFrame(loop);
        };
        this._rafHandle = requestAnimationFrame(loop);

        this._inited = true;
      }
    },

    _resize() {
      const dpr = this._dpr = getDevicePixelRatio();
      const rect = this._canvas.parentElement.getBoundingClientRect();
      this._w = Math.max(1, Math.floor(rect.width));
      this._h = Math.max(1, Math.floor(rect.height));
      this._canvas.width = Math.floor(this._w * dpr);
      this._canvas.height = Math.floor(this._h * dpr);
      // CSS size already 100%
      const ctx = this._ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._positionsValid = false;

      // Cancel any in-flight transition if size changed
      this._prevFrameCanvas = null;
      this._transitionActive = false;
    },

    _beginLevelTransition(newLevel) {
      const prevLevel = this._lastCurrLevel || 0;
      this._transitionDir = (newLevel > prevLevel) ? 'up' : 'down';
      this._transitionDurationMs = TRANSITION_DEFAULT_MS;
      // Capture previous frame
      try {
        const off = document.createElement('canvas');
        off.width = this._canvas.width;
        off.height = this._canvas.height;
        const octx = off.getContext('2d');
        octx.drawImage(this._canvas, 0, 0);
        this._prevFrameCanvas = off;
      } catch (e) {
        this._prevFrameCanvas = null;
      }
      this._transitionStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      this._transitionActive = true;
    },

    _buildGraphIfNeeded() {
      const level = (window.currLevel || 0);
      const numLocations = (levelData && levelData[level] ? levelData[level].numLocations : 0);
      if (!numLocations) {
        this._nodes = [];
        this._edges = [];
        return;
      }

      if (!this._positionsValid || this._nodes.length !== numLocations) {
        this._layoutMeta = {};
        let pts = [];
        const pad = 12;
        const cx = this._w * 0.5, cy = this._h * 0.5;

        if (level === 2) {
          // Level 2: vertical hallway with walls and elevator at top
          const hallWidth = Math.min(this._w * 0.5, 140);
          const xLeft = cx - hallWidth * 0.5;
          const xRight = cx + hallWidth * 0.5;
          const yTop = pad + 24;
          const yBottom = this._h - pad - 8;
          const centerX = cx;

          // Elevator node (index 0) near top center (moved back up for proper spacing)
          const elevatorY = yTop + 20;
          pts[0] = [centerX, elevatorY];

          // Four door nodes along hallway, alternating sides
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

          this._layoutMeta.level2 = { xLeft, xRight, yTop, yBottom, centerX };
        } else {
          // Levels 0 and 1: circle layout (with headroom adjustment for L1 doorway)
          let r = Math.max(20, Math.min(this._h * 0.5 - pad, this._w * 0.45 - pad));

          if (level === 1) {
            // Ensure there is headroom above index 0 for the doorway graphic
            const rBoss = RADII[getNodeKind(1, 0)] || 10; // index 0 is doorway icon on L1
            const vGap = 16, doorH = 26, marginTop = rBoss + vGap + doorH + 8;
            const maxRForDoor = Math.max(20, (cy - (pad + marginTop)));
            r = Math.min(r, maxRForDoor);
            this._layoutMeta.level1 = { bossIndex: 0, rAdjusted: r };
          }

          pts = computeCirclePositions(numLocations, cx, cy, r);
        }

        this._nodes = [];
        for (let i = 0; i < numLocations; i++) {
          const kind = getNodeKind(level, i);
          const visited = !!(window.visitedLocation && window.visitedLocation[level] && window.visitedLocation[level][i]);
          const nameKnown = (level === 0) ? visited : visited; // Level 1+: names revealed on visit
          const label = nameKnown
            ? (window.locationName && window.locationName[level] ? window.locationName[level][i] : '')
            : ''; // minimalist: hide labels when unknown

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
              const meta = this._layoutMeta.level2;
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

          this._nodes.push({
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
        this._edges = [];
        for (let i = 1; i < numLocations; i++) {
          this._edges.push([0, i]);
        }

        this._positionsValid = true;
      } else {
        // Update discovered/nameKnown/label without recompute positions
        for (const n of this._nodes) {
          const i = n.i;
          const visited = !!(window.visitedLocation && window.visitedLocation[level] && window.visitedLocation[level][i]);
          n.discovered = (level === 0 ? visited : true);
          n.nameKnown = (level === 0 ? visited : visited);
          n.label = n.nameKnown
            ? (window.locationName && window.locationName[level] ? window.locationName[level][i] : '')
            : '';
          n.kind = getNodeKind(level, i);

          // Re-assert L2 label hints on each rebuild
          if (level === 2 && this._layoutMeta.level2) {
            if (n.i === 0) {
              n.forceLabelBelow = true;
              n.labelAlign = 'center';
              n.labelDx = 0;
            } else {
              // Left side posts: left-justify text with left side of circle
              // Right side posts: right-justify text with right side of circle
              const meta = this._layoutMeta.level2;
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
      }
    },

    _syncFromGameState() {
      const level = (window.currLevel || 0);
      const transit = (window.transitMoves || 0);
      const nextIdx = (typeof window.nextLocIndex === 'number' ? window.nextLocIndex : 0);
      const loc = (typeof window.locIndex === 'number' ? window.locIndex : 0);

      this._buildGraphIfNeeded();

      // Determine gossip highlight and destination green (read from DOM)
      let gossipIndex = (typeof window.gossipLocation === 'number' ? window.gossipLocation : -1);
      const gossipActive = !!window.showingGossipColors;
      this._gossipIndex = gossipActive ? gossipIndex : -1;

      // Travel state: treat any transitMoves > 0 as "en route"
      const wasLevel = this._lastCurrLevel;
      if (wasLevel !== level) {
        // Start a zoom transition between levels
        this._beginLevelTransition(level);
        this._travelActive = false;
        this._positionsValid = false;
      }

      if (transit > 0) {
        this._travelActive = true;
        this._travelFrom = loc;
        this._travelTo = nextIdx;
        const total = (window.travelTime && typeof window.travelTime[level] === 'number') ? window.travelTime[level] : (this._travelTotalSteps || transit);
        this._travelTotalSteps = total;
        this._travelProgressSteps = (total - transit);
      } else {
        if (this._travelActive) {
          // Just arrived
          this._travelProgressSteps = this._travelTotalSteps;
          this._positionsValid = false; // discovery/labels may change
        }
        this._travelActive = false;
      }

      this._lastTransitMoves = transit;
      this._lastLocIndex = loc;
      this._lastCurrLevel = level;
    },

    _draw() {
      const ctx = this._ctx;
      if (!ctx) return;

      // Detect parent size changes (e.g., title card hide/show) and resize canvas
      const parentRect = this._canvas.parentElement.getBoundingClientRect();
      if (Math.floor(parentRect.width) !== this._w || Math.floor(parentRect.height) !== this._h) {
        this._resize();
      }

      ctx.clearRect(0, 0, this._w, this._h);

      // Defer drawing the progress baby until after nodes so it's always on top
      let __babyPos = null;

      // Level-specific background/decorations
      const levelNowForBG = (window.currLevel || 0);
      if (levelNowForBG === 2 && this._layoutMeta.level2) {
        // Draw hallway walls with doorway gaps, a closed elevator door at the top, and a bottom cap
        const { xLeft, xRight, yTop, yBottom, centerX } = this._layoutMeta.level2;
        const doorGapHalf = 10;

        // Collect doorway y-positions per side from node layout (indices 1..)
        const leftGaps = [];
        const rightGaps = [];
        for (const n of this._nodes) {
          if (n.i === 0) continue;
          // Determine which side this door is on by proximity to walls
          if (n.x < centerX) {
            leftGaps.push(n.y);
          } else {
            rightGaps.push(n.y);
          }
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
        const bossNode = this._nodes.find(n => n.i === 0);
        const elevW = Math.min(52, xRight - xLeft - 8);
        const elevH = 28;
        const elevX = centerX - elevW * 0.5;
        let elevY = yTop + 2;
        if (bossNode) {
          const rBoss = RADII[bossNode.kind] || 10;
          // place the elevator block just above the boss node (and thus above its label, which sits below)
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
        // Hinge leaves from the wall edges (gap endpoints) so they visually connect to frames
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
      } else if (levelNowForBG === 1) {
        // Draw room walls around baby groups with top doorway and inward diagonal doors
        const pad = 8;

        // Calculate bounds of all nodes including boss/upgrade post
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of this._nodes) {
          const r = RADII[n.kind] || 8;
          // Include extra space for labels above nodes
          const labelHeight = n.forceLabelBelow ? 0 : 16; // space for label above
          minX = Math.min(minX, n.x - r);
          maxX = Math.max(maxX, n.x + r);
          minY = Math.min(minY, n.y - r - labelHeight);
          maxY = Math.max(maxY, n.y + r);
        }

        // Add generous padding around all bounds for walls and text clearance
        const wallPad = 25;
        const roomLeft = Math.max(pad, minX - wallPad);
        const roomRight = Math.min(this._w - pad, maxX + wallPad);
        const roomBottom = Math.min(this._h - pad, maxY + wallPad);
        const roomTop = Math.max(pad, minY - wallPad);

        // Doorway gap in the top wall
        const doorGapWidth = 50;
        const doorGapCenter = this._w * 0.5;
        const doorGapLeft = doorGapCenter - doorGapWidth * 0.5;
        const doorGapRight = doorGapCenter + doorGapWidth * 0.5;

        ctx.save();
        ctx.strokeStyle = STROKE;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);

        // Draw room walls with doorway gap in top
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

        // Double doors: single diagonal lines descending down and outward from door jambs
        ctx.lineWidth = 3;

        // Left door: diagonal from top-left of gap down and left
        ctx.beginPath();
        ctx.moveTo(doorGapLeft, roomTop);
        ctx.lineTo(doorGapLeft - 12, roomTop + 12);
        ctx.stroke();

        // Right door: diagonal from top-right of gap down and right
        ctx.beginPath();
        ctx.moveTo(doorGapRight, roomTop);
        ctx.lineTo(doorGapRight + 12, roomTop + 12);
        ctx.stroke();

        ctx.restore();
      }

      // Level transition rendering: draw previous snapshot shrinking/fading, and scale current scene
      let __transitionInfo = null;
      if (this._transitionActive && this._prevFrameCanvas) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const t = clamp01((now - this._transitionStart) / this._transitionDurationMs);
        const e = easeInOutQuad(t);
        __transitionInfo = { t, e, dir: this._transitionDir };
        const cx = this._w * 0.5, cy = this._h * 0.5;

        // Previous level snapshot
        ctx.save();
        ctx.globalAlpha = 1 - e;
        const scalePrev = lerp(1, 0.2, e);
        ctx.translate(cx, cy);
        ctx.scale(scalePrev, scalePrev);
        ctx.translate(-cx, -cy);
        ctx.drawImage(this._prevFrameCanvas, 0, 0, this._w, this._h);
        ctx.restore();

        // Prepare transform for current scene
        ctx.save();
        const scaleNew = (this._transitionDir === 'up') ? lerp(1.2, 1, e) : lerp(0.2, 1, e);
        ctx.translate(cx, cy);
        ctx.scale(scaleNew, scaleNew);
        ctx.translate(-cx, -cy);
      }

      // Draw edges first (disabled: keep map minimalist; only show dashed active/preview path)
      const showEdges = false;
      if (showEdges) {
        for (const e of this._edges) {
          const a = this._nodes[e[0]];
          const b = this._nodes[e[1]];
          if (!a || !b) continue;
          if ((this._lastCurrLevel === 0) && (!a.discovered || !b.discovered)) continue;
          drawEdge(ctx, a.x, a.y, b.x, b.y);
        }
      }

      // Highlighted path: from current to destination when traveling or about to move
      if (this._travelActive) {
        const fromNode = this._nodes.find(n => n.i === this._travelFrom);
        const toNode = this._nodes.find(n => n.i === this._travelTo);
        if (fromNode && toNode) {
          const levelNow = (window.currLevel || 0);
          const allowPath = (levelNow === 0) ? true : (fromNode.discovered && toNode.discovered);
          if (allowPath) {
            const pathColor = getComputedColorForLabel(toNode.i) || STROKE;
            const route = getRouteBetweenNodes(levelNow, this._layoutMeta, fromNode, toNode);
            drawDashedPolyline(ctx, route, pathColor, 0.5);
            // Progress along routed path
            const t = this._travelTotalSteps ? clamp01(this._travelProgressSteps / this._travelTotalSteps) : 0;
            const p = pointAlongPolyline(route, t);
            __babyPos = { x: p[0], y: p[1] };
          }
        }
      } else {
        // Not traveling: if a destination is selected, we can faintly show the intended path
        const nextIdx = (typeof window.nextLocIndex === 'number' ? window.nextLocIndex : 0);
        const loc = (typeof window.locIndex === 'number' ? window.locIndex : 0);
        const fromNode = this._nodes.find(n => n.i === loc);
        const toNode = this._nodes.find(n => n.i === nextIdx);
        if (fromNode && toNode && fromNode.i !== toNode.i) {
          const levelNow = (window.currLevel || 0);
          const allowPath = (levelNow === 0) ? true : (fromNode.discovered && toNode.discovered);
          if (allowPath) {
            const pathColor = getComputedColorForLabel(toNode.i) || STROKE;
            const route = getRouteBetweenNodes(levelNow, this._layoutMeta, fromNode, toNode);
            drawDashedPolyline(ctx, route, pathColor, 0.5);
          }
          // Place baby at current location after nodes
          __babyPos = { x: fromNode.x, y: fromNode.y };
        } else if (fromNode) {
          __babyPos = { x: fromNode.x, y: fromNode.y };
        }
      }

      // Draw nodes (respect discovery on level 0)
      const level = (window.currLevel || 0);
      for (const n of this._nodes) {
        if (level === 0 && !n.discovered && n.i !== (window.locIndex || 0)) {
          continue; // hide undiscovered at level 0
        }
        const showName = (!__transitionInfo) && !!n.nameKnown;
        const labelText = n.label;
        const hasGossip = (this._gossipIndex === n.i);
        const ringColor = hasGossip ? (getComputedColorForLabel(n.i) || STROKE) : undefined;
        drawNode(ctx, n, showName, hasGossip, labelText, ringColor);

        // Level-specific embellishments (minimalist)
        if (level === 1 && n.i > 0) {
          // Four larger circles arranged in a row directly below the trading post
          const rdot = 4.6;
          const gap = 14;
          const below = RADII[n.kind] + 12;
          const baseY = n.y + below;
          const baseX = n.x;

          const offsets = [-1.5 * gap, -0.5 * gap, 0.5 * gap, 1.5 * gap];

          ctx.save();
          ctx.fillStyle = FILL;
          ctx.strokeStyle = STROKE;
          ctx.lineWidth = 2;
          for (let idx = 0; idx < offsets.length; idx++) {
            const dx = offsets[idx];
            const isOuter = (idx === 0 || idx === offsets.length - 1);
            const cxDot = baseX + dx;
            const cyDot = baseY - (isOuter ? rdot * 0.5 : 0); // raise outer two to suggest a semicircle
            ctx.beginPath();
            ctx.arc(cxDot, cyDot, rdot, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // Draw progress baby above nodes
      if (__babyPos) {
        drawProgressBaby(ctx, __babyPos.x, __babyPos.y, 22);
      }

      // Finalize/cleanup transition transforms
      if (__transitionInfo) {
        ctx.restore();
        if (__transitionInfo.t >= 1) {
          this._transitionActive = false;
          this._prevFrameCanvas = null;
        }
      }
    }
  };

  window.mapRenderer = mapRenderer;

  // Auto-init after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mapRenderer.init(), { once: true });
  } else {
    mapRenderer.init();
  }
})();
