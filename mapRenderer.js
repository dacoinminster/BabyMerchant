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
    // Destination labels are rendered as: <label for="nextLoci">...
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

  // Deterministic layout (circle) for now; refine per-level later
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
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      // If label would be too close to the top edge (e.g., boss at 12 o'clock),
      // draw it below the node to avoid clipping.
      let labelY = node.y - r - 6;
      if (labelY < 10) {
        labelY = node.y + r + 10;
      }
      ctx.fillText(labelText, node.x, labelY);
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
    _nodes: [], // {i, x, y, kind, discovered, nameKnown, label}
    _edges: [], // pairs of node indices (indices into _nodes)
    _positionsValid: false,

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
        // Layout circle
        const pad = 12;
        const cx = this._w * 0.5, cy = this._h * 0.5;
        const r = Math.max(20, Math.min(this._h * 0.5 - pad, this._w * 0.45 - pad));
        const pts = computeCirclePositions(numLocations, cx, cy, r);

        this._nodes = [];
        for (let i = 0; i < numLocations; i++) {
          const kind = getNodeKind(level, i);
          const visited = !!(window.visitedLocation && window.visitedLocation[level] && window.visitedLocation[level][i]);
          const nameKnown = (level === 0)
            ? visited
            : visited; // Level 1+: names revealed on visit
          const label = nameKnown
            ? (window.locationName && window.locationName[level] ? window.locationName[level][i] : '')
            : ''; // minimalist: hide labels when unknown
          this._nodes.push({
            i,
            x: pts[i][0],
            y: pts[i][1],
            kind,
            discovered: (level === 0 ? visited : true),
            nameKnown,
            label
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
            ctx.save();
            ctx.globalAlpha = 0.5;
            drawDashedPath(ctx, fromNode.x, fromNode.y, toNode.x, toNode.y, pathColor);
            ctx.restore();
          }

          // Progress along line
          const t = this._travelTotalSteps ? clamp01(this._travelProgressSteps / this._travelTotalSteps) : 0;
          const px = lerp(fromNode.x, toNode.x, t);
          const py = lerp(fromNode.y, toNode.y, t);
          __babyPos = { x: px, y: py };
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
            ctx.save();
            ctx.globalAlpha = 0.5;
            drawDashedPath(ctx, fromNode.x, fromNode.y, toNode.x, toNode.y, pathColor);
            ctx.restore();
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
