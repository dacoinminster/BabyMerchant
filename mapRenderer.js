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




  function getDevicePixelRatio() {
    return (window.devicePixelRatio || 1);
  }



  // Determines node kind based on level/index and spec

  // Deterministic layout (circle) for now; refined per-level below



  // Utility: centroid of nodes array

  // Build a snapshot of node positions for an arbitrary level using current viewport


  // Draw a dashed polyline for routed paths (e.g., level 2 hallway)


  // t in [0,1]

  // Route computation by level



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
    _evtBound: false,
    _evtBoundHost: false,
    _evtBoundWin: false,
    _host: null,

    // Level transition animation
    _transitionActive: false,
    _transitionStart: 0,
    _transitionDir: 'up',
    _transitionDurationMs: TRANSITION_DEFAULT_MS,
    _prevFrameCanvas: null,
    _onTransitionDone: [], // array of resolve callbacks
    _onNextTransitionWaiters: [], // resolvers waiting for the next transition to start, then finish
    _transitionContext: null, // details for logging
    _preparedTransition: null, // {fromLevel,toLevel,fromIdx,toIdx,fromSnap}
    _explicitFromSnapshot: null, // snapshot to use for morph when provided
    _pendingTransitionHold: false, // between prepare() and _beginLevelTransition()
    _scaleBoost: SCALE_BOOST_L0L1,
    _loggedPathSuppressedOnce: false,
    _lastMorphLogStage: '',
    _pendingTransitionHold: false, // true between prepare() and _beginLevelTransition()
    _scaleBoost: SCALE_BOOST_L0L1,

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
    _stepAnimationStartTime: 0, // New variable to track animation start time for each step

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

      // Enable interactions on the canvas
      this._canvas.style.pointerEvents = 'auto';
      this._canvas.style.zIndex = '1'; // ensure above any backgrounds inside wrapper
      if (!this._evtBound) {
        this._canvas.addEventListener('click', (e) => this._handleClick(e));
        this._canvas.addEventListener('mousemove', (e) => this._handleMouseMove(e));
        this._evtBound = true;
        try { console.debug('[mapRenderer] canvas event listeners bound'); } catch (_) {}
      }

      // Also bind on host as a fallback (in case the canvas isn't receiving events in some browsers)
      this._host = host;
      this._host.style.pointerEvents = 'auto';
      this._host.style.zIndex = '1';
      if (!this._evtBoundHost) {
        this._host.addEventListener('click', (e) => {
          // If canvas already handles, this will be stopped in _handleClick
          this._handleClick(e);
        });
        this._host.addEventListener('mousemove', (e) => this._handleMouseMove(e));
        // Basic touch support
        this._host.addEventListener('touchstart', (e) => {
          try {
            const t = e.touches && e.touches[0] ? e.touches[0] : e;
            this._handleClick(t);
          } catch (_) {}
        }, { passive: true });
        this._evtBoundHost = true;
        try { console.debug('[mapRenderer] host event listeners bound'); } catch (_) {}
      }

      // As a final fallback, bind capture-phase listeners on window to handle cases where
      // other elements intercept/bubble differently (e.g., Chrome oddities).
      if (!this._evtBoundWin) {
        const clickCap = (e) => this._handleClick(e);
        const moveCap = (e) => this._handleMouseMove(e);
        window.addEventListener('click', clickCap, { capture: true });
        window.addEventListener('mousemove', moveCap, { capture: true });
        // Basic pointer support where mousemove may be throttled/absent
        window.addEventListener('pointermove', moveCap, { capture: true });
        this._evtBoundWin = true;
        try { console.debug('[mapRenderer] window capture event listeners bound'); } catch (_) {}
      }

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
      // Make L0<->L1 transitions a bit longer
      if ((prevLevel === 0 && newLevel === 1) || (prevLevel === 1 && newLevel === 0)) {
        this._transitionDurationMs = TRANSITION_L0_L1_MS;
      } else {
        this._transitionDurationMs = TRANSITION_DEFAULT_MS;
      }
      // If we have an explicit prepared snapshot for this exact transition,
      // use it and skip capturing the canvas (prevents "double image" race).
      if (this._preparedTransition &&
          this._preparedTransition.fromLevel === prevLevel &&
          this._preparedTransition.toLevel === newLevel) {
        this._explicitFromSnapshot = this._preparedTransition.fromSnap;
        this._prevFrameCanvas = null;
      } else {
        // Fallback: capture previous frame
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
      }
      this._transitionStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      this._transitionActive = true;
      this._pendingTransitionHold = false;
      this._loggedPathSuppressedOnce = false;
      this._lastMorphLogStage = '';

      // Attach any next-transition waiters to this transition's completion list
      if (this._onNextTransitionWaiters.length) {
        this._onTransitionDone.push.apply(this._onTransitionDone, this._onNextTransitionWaiters);
        this._onNextTransitionWaiters.length = 0;
      }

      // Build diagnostic transition context for logs
      try {
        const snapFrom = this._explicitFromSnapshot || computeSnapshotForLevel(prevLevel, this._w, this._h);
        const snapTo = computeSnapshotForLevel(newLevel, this._w, this._h);
        const cenFrom = centroidOf(snapFrom.nodes);
        const cenTo = centroidOf(snapTo.nodes);
        // Derive location indices (safe defaults)
        const locFrom = (this._preparedTransition ? this._preparedTransition.fromIdx : ((typeof this._lastLocIndex === 'number') ? this._lastLocIndex : 0));
        const locTo = (this._preparedTransition ? this._preparedTransition.toIdx : ((typeof window.locIndex === 'number') ? window.locIndex : 0));
        const nodeFrom = snapFrom.nodes.find(n => n.i === locFrom) || snapFrom.nodes[0] || { x: 0, y: 0 };
        const nodeTo = snapTo.nodes.find(n => n.i === locTo) || snapTo.nodes[0] || { x: 0, y: 0 };
        this._transitionContext = {
          fromLevel: prevLevel,
          toLevel: newLevel,
          dir: this._transitionDir,
          canvas: { w: this._w, h: this._h, dpr: this._dpr },
          fromLocIndex: locFrom,
          toLocIndex: locTo,
          centroidFrom: { x: Math.round(cenFrom.x), y: Math.round(cenFrom.y) },
          centroidTo: { x: Math.round(cenTo.x), y: Math.round(cenTo.y) },
          nodeFrom: { x: Math.round(nodeFrom.x), y: Math.round(nodeFrom.y) },
          nodeTo: { x: Math.round(nodeTo.x), y: Math.round(nodeTo.y) },
          ts: Date.now(),
        };
        console.log('[mapRenderer] level transition start', this._transitionContext);
      } catch (_) { /* ignore logging errors */ }
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
          // Levels 0 and 1: circle layout (with headroom adjustment for labels/doorway)
          let r = Math.max(20, Math.min(this._h * 0.5 - pad, this._w * 0.45 - pad));

          if (level === 1) {
            // Ensure there is headroom above index 0 for the doorway graphic
            const rBoss = RADII[getNodeKind(1, 0)] || 10; // index 0 is doorway icon on L1
            const vGap = 16, doorH = 26, marginTop = rBoss + vGap + doorH + 8;
            const maxRForDoor = Math.max(20, (cy - (pad + marginTop)));
            r = Math.min(r, maxRForDoor);
            this._layoutMeta.level1 = { bossIndex: 0, rAdjusted: r };
          } else if (level === 0) {
            // Ensure headroom for L0 boss label above top node (index 0)
            const rBoss0 = RADII[getNodeKind(0, 0)] || 8;
            const labelH = 10, vGap0 = 10;
            const marginTop0 = rBoss0 + vGap0 + labelH + 6;
            const maxRForLabel0 = Math.max(20, (cy - (pad + marginTop0)));
            r = Math.min(r, maxRForLabel0);
            this._layoutMeta.level0 = { bossIndex: 0, rAdjusted: r };
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

      // Determine if travel is active based on transitMoves
      const isCurrentlyTraveling = (transit > 0);

      // If a new step has started (transitMoves changed from last frame), reset animation start time
      // Or if we just started traveling
      if (isCurrentlyTraveling && (this._lastTransitMoves === 0 || this._lastTransitMoves !== transit)) {
        this._stepAnimationStartTime = performance.now();
      }

      this._travelActive = isCurrentlyTraveling; // Set travel active based on transitMoves
      this._travelFrom = loc;
      this._travelTo = nextIdx;
      const total = (window.travelTime && typeof window.travelTime[level] === 'number') ? window.travelTime[level] : (this._travelTotalSteps || transit);
      this._travelTotalSteps = total;
      this._travelProgressSteps = (total - transit);

      // If we just arrived (transitMoves was 1 and now is 0), ensure positions are re-evaluated
      if (this._lastTransitMoves === 1 && transit === 0) {
        this._positionsValid = false;
      }

      // Reset step animation time if not traveling
      if (!isCurrentlyTraveling) {
        this._stepAnimationStartTime = 0;
      }

      this._lastTransitMoves = transit;
      this._lastLocIndex = loc;
      this._lastCurrLevel = level;
    },

    // Interactivity helpers
    _cssPointFromEvent(e) {
      const rect = this._canvas.getBoundingClientRect();
      // Support touch/pointer fallback
      const cx = (typeof e.clientX === 'number') ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const cy = (typeof e.clientY === 'number') ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
      return { x: cx - rect.left, y: cy - rect.top };
    },



    _computeBabyPos() {
      const level = (window.currLevel || 0);
      const loc = (typeof window.locIndex === 'number' ? window.locIndex : 0);
      const fromNode = this._nodes.find(n => n.i === loc);
      if (this._travelActive) {
        const toIdx = (typeof window.nextLocIndex === 'number' ? window.nextLocIndex : 0);
        const toNode = this._nodes.find(n => n.i === toIdx);
        if (fromNode && toNode) {
          const route = getRouteBetweenNodes(level, this._layoutMeta, fromNode, toNode);
          let t = this._travelTotalSteps ? clamp01(this._travelProgressSteps / this._travelTotalSteps) : 0;
          const p = pointAlongPolyline(route, t);
          return { x: p[0], y: p[1] };
        }
      }
      return fromNode ? { x: fromNode.x, y: fromNode.y } : { x: 0, y: 0 };
    },



    _hitTest(p) {
      const level = (window.currLevel || 0);
      this._buildGraphIfNeeded();

      // 1) Player icon stays handled here
      const baby = this._computeBabyPos();
      if (dist(p.x, p.y, baby.x, baby.y) <= 16) return { type: 'player' };

      const state = {
        level,
        nodes: this._nodes,
        layoutMeta: this._layoutMeta,
        dims: { w: this._w, h: this._h },
        locIndex: (typeof window.locIndex === 'number' ? window.locIndex : 0),
        nextLocIndex: (typeof window.nextLocIndex === 'number' ? window.nextLocIndex : 0),
      };
      return MapHitTest.atPoint(this._ctx, p, state);
    },

    _handleClick(e) {
      // Only intercept clicks that occur inside the map host bounds and when the map is visible
      const hostEl = this._host || this._canvas;
      if (!hostEl) return;
      const rectAbs = hostEl.getBoundingClientRect();
      const cx = (typeof e.clientX === 'number') ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : -Infinity);
      const cy = (typeof e.clientY === 'number') ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : -Infinity);
      const insideAbs = (cx >= rectAbs.left && cx <= rectAbs.right && cy >= rectAbs.top && cy <= rectAbs.bottom);
      const visible = hostEl.offsetParent !== null && getComputedStyle(hostEl).display !== 'none' && getComputedStyle(hostEl).visibility !== 'hidden';
      if (!insideAbs || !visible) {
        return; // do not interfere with clicks elsewhere (e.g., title screen buttons)
      }

      // Swallow map clicks while level transition animation is active
      if (this._transitionActive) {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        try { console.debug('[mapRenderer] click ignored during level transition'); } catch (_) {}
        return;
      }

      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      if (e && typeof e.preventDefault === 'function') e.preventDefault();

      const p = this._cssPointFromEvent(e);
      try {
        const tgt = (e && e.target && e.target.id) ? ('#' + e.target.id) : (e && e.target ? e.target.tagName : 'unknown');
        console.debug('[mapRenderer] click @', { x: Math.round(p.x), y: Math.round(p.y), target: tgt, level: window.currLevel, transitMoves: window.transitMoves, locIndex: window.locIndex, nextLocIndex: window.nextLocIndex });
      } catch (_) {}
      const hit = this._hitTest(p);
      if (!hit) {
        try { console.debug('[mapRenderer] no hit'); } catch (_) {}
        return;
      }
      try { console.debug('[mapRenderer] hit', hit); } catch (_) {}

      const transit = (window.transitMoves || 0);
      const curr = (window.currLevel || 0);
      const loc = (typeof window.locIndex === 'number' ? window.locIndex : 0);

      const locomote = () => { if (typeof window.doButtonAction === 'function') window.doButtonAction('locomote'); };
      const enterTrading = () => { if (typeof window.doButtonAction === 'function') window.doButtonAction('enterTrading'); };
      const levelUp = () => { if (typeof window.doButtonAction === 'function') window.doButtonAction('levelUp'); };
      const levelDown = () => { if (typeof window.doButtonAction === 'function') window.doButtonAction('levelDown'); };

      switch (hit.type) {
        case 'player':
          if (transit > 0) { try { console.debug('[mapRenderer] action: locomote (player, in transit)'); } catch(_){}; locomote(); }
          else { try { console.debug('[mapRenderer] action: enterTrading (player, idle)'); } catch(_){}; enterTrading(); }
          break;

        case 'path':
          if (transit > 0 || ((typeof window.nextLocIndex === 'number') && window.nextLocIndex !== loc)) { try { console.debug('[mapRenderer] action: locomote (path)'); } catch(_){}; locomote(); }
          break;

        case 'doorwayL1':
        case 'elevatorL2':
          if (transit > 0) {
            try { console.debug('[mapRenderer] action: locomote (door/elevator, in transit)'); } catch(_){}
            locomote();
          } else if ((window.maxLevel || 0) > curr) {
            try { console.debug('[mapRenderer] action: levelUp (door/elevator)'); } catch(_){}
            levelUp();
          } else {
            try { console.debug('[mapRenderer] levelUp locked; maxLevel<=curr'); } catch(_){}
          }
          break;

        case 'doorL2': {
          const i = (hit.index !== undefined ? hit.index : -1);
          if (i === -1) break;
          if (transit > 0) {
            try { console.debug('[mapRenderer] action: locomote (L2 doorway, in transit)'); } catch(_){}
            locomote();
          } else if (i === loc) {
            try { console.debug('[mapRenderer] action: levelDown (L2 doorway @ current)'); } catch(_){}
            levelDown(); // Return to level 1 from the door's trading post
          } else {
            try { console.debug('[mapRenderer] action: set nextLocIndex (L2 doorway) ->', i); } catch(_){}
            window.nextLocIndex = i;
            try {
              var rb2 = document.getElementById('nextLoc' + i);
              if (rb2) rb2.checked = true;
            } catch (_) {}
            if (typeof window.updateLocomoteButton === 'function') window.updateLocomoteButton();
            window.inventoryChanged = true;
          }
          break;
        }

        case 'groupCircles':
        case 'node': {
          const i = (hit.index !== undefined ? hit.index : -1);
          if (i === -1) break;

          if (transit > 0) {
            try { console.debug('[mapRenderer] action: locomote (node/group, in transit)'); } catch(_){}
            locomote();
          } else if (i === loc) {
            // Special cases when clicking the current post
            if (curr === 1 && hit.type === 'groupCircles') {
              try { console.debug('[mapRenderer] action: levelDown (L1 group circles @ current)'); } catch(_){}
              levelDown(); // Return to level 0 from the group's trading post
            } else if (curr === 2 && i > 0 && hit.type === 'node') {
              try { console.debug('[mapRenderer] action: levelDown (L2 door @ current)'); } catch(_){}
              levelDown(); // Return to level 1 from door trading post
            } else {
              try { console.debug('[mapRenderer] action: enterTrading (current location)'); } catch(_){}
              enterTrading(); // Enter trading/upgrading at current location
            }
          } else if (curr === 0) {
            if (typeof window.typeText === 'function') {
              try { console.debug('[mapRenderer] message: level 0 chaotic movement'); } catch(_){}
              window.typeText("Can't choose destination when thrashing about.");
            }
          } else if (typeof window.nextLocIndex === 'number' && i === window.nextLocIndex) {
            // Clicking the already-selected destination commences movement
            try { console.debug('[mapRenderer] action: locomote (clicked selected destination)'); } catch(_){}
            locomote();
          } else {
            // Level 1+ and at a trading/upgrade post: set next destination
            try { console.debug('[mapRenderer] action: set nextLocIndex ->', i); } catch(_){}
            window.nextLocIndex = i;

            // Sync the radio button selection so updateLocomoteButton doesn't overwrite nextLocIndex
            try {
              var rb = document.getElementById('nextLoc' + i);
              if (rb) {
                rb.checked = true;
              }
            } catch (_) {}

            if (typeof window.updateLocomoteButton === 'function') window.updateLocomoteButton();
            window.inventoryChanged = true; // trigger UI refresh next tick
          }
          break;
        }

        default:
          break;
      }
    },

    _handleMouseMove(e) {
      const p = this._cssPointFromEvent(e);
      const hit = this._hitTest(p);
      const cur = hit ? 'pointer' : 'default';
      this._canvas.style.cursor = cur;
      if (this._host) this._host.style.cursor = cur;

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

      // If app prepared a transition and level just changed but transition not started yet,
      // suppress drawing this frame to avoid a flash of the new level's walls/groups.
      if (this._preparedTransition && (this._lastCurrLevel !== (window.currLevel || 0)) && !this._transitionActive && this._pendingTransitionHold) {
        try { console.log('[mapRenderer] draw suppressed to avoid flash before transition'); } catch (_) {}
        return;
      }

      // Defer drawing the progress baby until after nodes so it's always on top
      let __babyPos = null;

      // Level-specific background/decorations
      const levelNowForBG = (window.currLevel || 0);
      // Suppress normal background while explicit morphing; we'll draw transformed backgrounds ourselves
      if (!(this._transitionActive && this._explicitFromSnapshot) && levelNowForBG === 2 && this._layoutMeta.level2) {
        MapBackgrounds.drawLevel2Background(ctx, this._nodes, { w: this._w, h: this._h }, this._layoutMeta);
      } else if (!(this._transitionActive && this._explicitFromSnapshot) && levelNowForBG === 1) {
        MapBackgrounds.drawLevel1Background(ctx, this._nodes, { w: this._w, h: this._h }, this._layoutMeta);
      }

      // Level transition rendering: draw morph/zoom between levels
      let __transitionInfo = null;
      if (this._transitionActive && this._prevFrameCanvas) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const t = clamp01((now - this._transitionStart) / this._transitionDurationMs);
        const e = easeInOutQuad(t);
        __transitionInfo = { t, e, dir: this._transitionDir };
        const cx = this._w * 0.5, cy = this._h * 0.5;

        // Default behavior when we have a previous canvas snapshot: cross-zoom
        // If we have an explicit morph snapshot, handle later without snapshot use
        if (!this._explicitFromSnapshot) {
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
      if (this._travelActive && !(this._transitionActive && this._explicitFromSnapshot)) {
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
            let t = this._travelTotalSteps ? clamp01(this._travelProgressSteps / this._travelTotalSteps) : 0;

            // Apply scootch animation for Level 2 when travel is active and animation is within its duration
            if (this._travelActive && window.currLevel === 2 && this._stepAnimationStartTime > 0) {
              const animationDurationPerStep = 800; // Duration for one step's animation
              const elapsedTime = performance.now() - this._stepAnimationStartTime;
              const animationProgress = clamp01(elapsedTime / animationDurationPerStep);

              if (animationProgress < 1) { // Only animate if within the step's animation duration
                const scootchCycles = 3; // Three scootches per step
                const cycleDuration = animationDurationPerStep / scootchCycles;
                const timeIntoCycle = elapsedTime % cycleDuration;
                const cycleProgress = timeIntoCycle / cycleDuration; // 0 to 1 within each scootch cycle

                // Use a sine wave to create a forward-backward motion within each scootch
                const scootchAmplitude = 0.05; // Increased for visibility

                // Modify 't' to include the scootch effect
                // This makes the baby move slightly forward and then back within each "scootch"
                t += Math.sin(cycleProgress * Math.PI * 2) * scootchAmplitude;
                t = clamp01(t); // Ensure t stays within [0, 1]
              }
            }

            const p = pointAlongPolyline(route, t);
            __babyPos = { x: p[0], y: p[1] };
          }
        }
      } else if (!(this._transitionActive && this._explicitFromSnapshot)) {
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
      if (this._transitionActive && this._explicitFromSnapshot && !this._loggedPathSuppressedOnce) {
        try { console.log('[mapRenderer] suppressing path rendering during level morph'); } catch (_) {}
        this._loggedPathSuppressedOnce = true;
      }

      // Draw nodes (respect discovery on level 0). Skip during explicit morph; custom block will draw.
      if (!(this._transitionActive && this._explicitFromSnapshot)) {
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
      }

      // Draw progress baby above nodes
      if (__babyPos && !(this._transitionActive && this._explicitFromSnapshot)) {
        drawProgressBaby(ctx, __babyPos.x, __babyPos.y, 22, window.currLevel);
      }

      // Custom morph handling for L0<->L1 when explicit snapshot is present
      if (this._transitionActive && this._explicitFromSnapshot) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const t = clamp01((now - this._transitionStart) / this._transitionDurationMs);
        const e = easeInOutQuad(t);

        const fromL = this._preparedTransition ? this._preparedTransition.fromLevel : this._lastCurrLevel;
        const toL = (window.currLevel || 0);
        // Only morph for 0<->1
        if ((fromL === 0 && toL === 1) || (fromL === 1 && toL === 0)) {
          const snapFrom = this._explicitFromSnapshot; // {nodes}
          const snapTo = computeSnapshotForLevel(toL, this._w, this._h);

          // Determine L1 group node and its mini cluster positions
          function groupCirclePositions(node) {
            const rdot = 4.6, gap = 14;
            const below = (RADII[node.kind] + 12);
            const baseY = node.y + below;
            const baseX = node.x;
            const offsets = [-1.5 * gap, -0.5 * gap, 0.5 * gap, 1.5 * gap];
            const pts = [];
            for (let idx = 0; idx < offsets.length; idx++) {
              const dx = offsets[idx];
              const isOuter = (idx === 0 || idx === offsets.length - 1);
              const cxDot = baseX + dx;
              const cyDot = baseY - (isOuter ? rdot * 0.5 : 0);
              pts.push({ x: cxDot, y: cyDot, r: rdot });
            }
            return pts;
          }

          function angleOf(p, c) { return Math.atan2(p.y - c.y, p.x - c.x); }
          function centroidPts(arr) {
            if (!arr.length) return { x: 0, y: 0 };
            let sx = 0, sy = 0; for (const p of arr) { sx += p.x; sy += p.y; }
            return { x: sx / arr.length, y: sy / arr.length };
          }

          // Build morph pairs
          let pairs = [];
          if (fromL === 0 && toL === 1) {
            const toIdx = (this._preparedTransition ? this._preparedTransition.toIdx : (typeof window.locIndex === 'number' ? window.locIndex : 1));
            const gNode = snapTo.nodes.find(n => n.i === toIdx) || snapTo.nodes[1];
            const mini = groupCirclePositions(gNode);
            // Boss mapping
            const f0 = snapFrom.nodes[0];
            pairs.push({ fx: f0.x, fy: f0.y, fr: RADII[getNodeKind(0,0)] || 8, tx: gNode.x, ty: gNode.y, tr: RADII[getNodeKind(1, gNode.i)] || 8, fi: 0 });
            // Angle-consistent mapping for 4 satellites
            const fromSats = [];
            for (let i = 1; i < Math.min(5, snapFrom.nodes.length); i++) fromSats.push({ i, x: snapFrom.nodes[i].x, y: snapFrom.nodes[i].y, r: RADII[getNodeKind(0,i)] || 6 });
            const cFrom = centroidPts(fromSats);
            fromSats.sort((a,b) => angleOf(a, cFrom) - angleOf(b, cFrom));
            const miniSats = mini.slice();
            const cMini = centroidPts(miniSats);
            miniSats.sort((a,b) => angleOf(a, cMini) - angleOf(b, cMini));
            for (let k = 0; k < Math.min(fromSats.length, miniSats.length); k++) {
              const f = fromSats[k], m = miniSats[k];
              pairs.push({ fx: f.x, fy: f.y, fr: f.r, tx: m.x, ty: m.y, tr: m.r, fi: f.i });
            }
          } else if (fromL === 1 && toL === 0) {
            const fromIdx = (this._preparedTransition ? this._preparedTransition.fromIdx : (typeof window.locIndex === 'number' ? window.locIndex : 1));
            const gNode = this._explicitFromSnapshot.nodes.find(n => n.i === fromIdx) || this._explicitFromSnapshot.nodes[1];
            const mini = groupCirclePositions(gNode);
            // Group node -> L0 boss
            const t0 = snapTo.nodes[0];
            pairs.push({ fx: gNode.x, fy: gNode.y, fr: RADII[getNodeKind(1,gNode.i)] || 8, tx: t0.x, ty: t0.y, tr: RADII[getNodeKind(0,0)] || 8, ti: 0 });
            // Angle-consistent mapping for 4 satellites
            const toSats = [];
            for (let i = 1; i < Math.min(5, snapTo.nodes.length); i++) toSats.push({ i, x: snapTo.nodes[i].x, y: snapTo.nodes[i].y, r: RADII[getNodeKind(0,i)] || 6 });
            const cTo = centroidPts(toSats);
            toSats.sort((a,b) => angleOf(a, cTo) - angleOf(b, cTo));
            const miniSats = mini.slice();
            const cMini = centroidPts(miniSats);
            miniSats.sort((a,b) => angleOf(a, cMini) - angleOf(b, cMini));
            for (let k = 0; k < Math.min(toSats.length, miniSats.length); k++) {
              const f = miniSats[k], tpt = toSats[k];
              pairs.push({ fx: f.x, fy: f.y, fr: f.r, tx: tpt.x, ty: tpt.y, tr: tpt.r, ti: tpt.i });
            }
          }

          // Log first and last frames for diagnostics
          if (t === 0 || t === 1) {
            try {
              console.debug('[mapRenderer] morph pairs', { step: (t===0?'start':'end'), pairs: pairs.map(p => ({ fx: Math.round(p.fx), fy: Math.round(p.fy), tx: Math.round(p.tx), ty: Math.round(p.ty), fr: p.fr, tr: p.tr }))});
            } catch (_) {}
          }

          // Draw transformed background for L1 (walls + other groups) or L1 fading away
          // First, determine the destination/source group node for pivoting transforms
          const toIdxBG = (this._preparedTransition ? (fromL===0? this._preparedTransition.toIdx : this._preparedTransition.fromIdx) : 1);
          let gNodeBG = null;
          if (fromL === 0 && toL === 1) gNodeBG = snapTo.nodes.find(n => n.i === toIdxBG) || snapTo.nodes[1];
          if (fromL === 1 && toL === 0) gNodeBG = this._explicitFromSnapshot.nodes.find(n => n.i === toIdxBG) || this._explicitFromSnapshot.nodes[1];

          // Compute an exact scale based on d0/d1:
          // d0: L0 distance between trading posts 0 and 2 (from L0 snapshot)
          // d1: L1 distance between a group post and its inner-right mini-circle (dx=+0.5*gap, below the post)
          let sStart = 2.6; // default fallback
          try {
            if (fromL === 0 && toL === 1) {
              // Use current L0 snapshot (snapFrom) and target L1 mini-circle at index 2
              const f0 = snapFrom.nodes.find(n => n.i === 0);
              const f2 = snapFrom.nodes.find(n => n.i === 2);
              const d0 = (f0 && f2) ? Math.hypot(f2.x - f0.x, f2.y - f0.y) : 0;
              const minis = groupCirclePositions(gNodeBG);
              const mr = minis && minis[2] ? minis[2] : null; // inner-right
              const d1 = mr ? Math.hypot(mr.x - gNodeBG.x, mr.y - gNodeBG.y) : 0.0001;
              const ratio = d0 / Math.max(1e-3, d1);
              sStart = ratio * (this._scaleBoost || 1.0);
              try { console.debug('[mapRenderer] computed exact scaleStart L0->L1', { d0: d0.toFixed(2), d1: d1.toFixed(2), ratio: ratio.toFixed(2), boost: (this._scaleBoost||1), sStart }); } catch (_) {}
            } else if (fromL === 1 && toL === 0) {
              // Use target L0 snapshot (snapTo) and current L1 mini-circle at index 2
              const t0 = snapTo.nodes.find(n => n.i === 0);
              const t2 = snapTo.nodes.find(n => n.i === 2);
              const d0 = (t0 && t2) ? Math.hypot(t2.x - t0.x, t2.y - t0.y) : 0;
              const minis = groupCirclePositions(gNodeBG);
              const mr = minis && minis[2] ? minis[2] : null; // inner-right
              const d1 = mr ? Math.hypot(mr.x - gNodeBG.x, mr.y - gNodeBG.y) : 0.0001;
              const ratio = d0 / Math.max(1e-3, d1);
              sStart = ratio * (this._scaleBoost || 1.0);
              try { console.debug('[mapRenderer] computed exact scaleStart L1->L0', { d0: d0.toFixed(2), d1: d1.toFixed(2), ratio: ratio.toFixed(2), boost: (this._scaleBoost||1), sStart }); } catch (_) {}
            }
          } catch (_) {}
          const cx = this._w * 0.5, cy = this._h * 0.5;

          function drawL1WallsFromNodes(ctx2, nodes, alpha) {
            if (!nodes || !nodes.length) return;
            let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
            for (const n of nodes) {
              const r = RADII[n.kind] || 8;
              const labelHeight = 16;
              minX = Math.min(minX, n.x - r);
              maxX = Math.max(maxX, n.x + r);
              minY = Math.min(minY, n.y - r - labelHeight);
              maxY = Math.max(maxY, n.y + r);
            }
            const pad = 8, wallPad = 25;
            const roomLeft = Math.max(pad, minX - wallPad);
            const roomRight = Math.min(this._w - pad, maxX + wallPad);
            const roomBottom = Math.min(this._h - pad, maxY + wallPad);
            const roomTop = Math.max(pad, minY - wallPad);
            const doorGapWidth = 50;
            const doorGapCenter = this._w * 0.5;
            const doorGapLeft = doorGapCenter - doorGapWidth * 0.5;
            const doorGapRight = doorGapCenter + doorGapWidth * 0.5;
            ctx2.save();
            ctx2.globalAlpha = alpha;
            ctx2.strokeStyle = STROKE;
            ctx2.lineWidth = 2;
            ctx2.setLineDash([]);
            ctx2.beginPath(); ctx2.moveTo(roomLeft, roomTop); ctx2.lineTo(doorGapLeft, roomTop); ctx2.moveTo(doorGapRight, roomTop); ctx2.lineTo(roomRight, roomTop); ctx2.stroke();
            ctx2.beginPath(); ctx2.moveTo(roomLeft, roomTop); ctx2.lineTo(roomLeft, roomBottom); ctx2.stroke();
            ctx2.beginPath(); ctx2.moveTo(roomRight, roomTop); ctx2.lineTo(roomRight, roomBottom); ctx2.stroke();
            ctx2.beginPath(); ctx2.moveTo(roomLeft, roomBottom); ctx2.lineTo(roomRight, roomBottom); ctx2.stroke();
            // Door diagonal leaves
            ctx2.lineWidth = 3;
            ctx2.beginPath(); ctx2.moveTo(doorGapLeft, roomTop); ctx2.lineTo(doorGapLeft - 12, roomTop + 12); ctx2.stroke();
            ctx2.beginPath(); ctx2.moveTo(doorGapRight, roomTop); ctx2.lineTo(doorGapRight + 12, roomTop + 12); ctx2.stroke();
            ctx2.restore();
            return { roomLeft, roomRight, roomTop, roomBottom };
          }

          // Apply pivoted scale to background around the group node so it moves into view
          if (gNodeBG) {
            if (fromL === 0 && toL === 1) {
              const s = lerp(sStart, 1, e);
              ctx.save();
              ctx.translate(gNodeBG.x, gNodeBG.y); ctx.scale(s, s); ctx.translate(-gNodeBG.x, -gNodeBG.y);
              // Draw walls first
              const rcWalls = drawL1WallsFromNodes.call(this, ctx, snapTo.nodes, e);
              try { if (e < 0.02 || Math.abs(e-0.25)<0.01 || Math.abs(e-0.5)<0.01 || Math.abs(e-0.75)<0.01 || e>0.98) console.log('[mapRenderer] L0->L1 walls bbox@e', e.toFixed(2), rcWalls); } catch(_){}
              // Draw other groups (exclude the active group node) as full groups (post + four dots) with labels
              ctx.globalAlpha = e;
              for (const n of snapTo.nodes) {
                if (n.i === toIdxBG) continue;
                drawNode(ctx, n, false, false, '', undefined);
                if (n.i > 0) {
                  const circ = groupCirclePositions(n);
                  for (const c of circ) {
                    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                  }
                  // Label above the group post (show even if not visited, fallback to generic label)
                  try {
                    const lvl = 1; const idx = n.i;
                    let labelText = '';
                    const visited = (window.visitedLocation && window.visitedLocation[lvl] && window.visitedLocation[lvl][idx]);
                    if (visited && window.locationName && window.locationName[lvl] && window.locationName[lvl][idx]) {
                      labelText = window.locationName[lvl][idx];
                    } else if (window.levelData && window.levelData[lvl]) {
                      labelText = (window.levelData[lvl].locationLabel[idx] || 'group') + (idx > 0 ? (' #' + idx) : '');
                    }
                    if (labelText) {
                      ctx.save();
                      ctx.font = LABEL_FONT; ctx.fillStyle = STROKE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                      ctx.fillText(labelText, n.x, n.y - (RADII[n.kind]||8) - 6);
                      ctx.restore();
                    }
                  } catch (_) {}
                }
              }
              ctx.restore();
            } else if (fromL === 1 && toL === 0) {
              const s = lerp(1, sStart, e);
              ctx.save();
              ctx.translate(gNodeBG.x, gNodeBG.y); ctx.scale(s, s); ctx.translate(-gNodeBG.x, -gNodeBG.y);
              // Draw walls fading out
              const rcWalls2 = drawL1WallsFromNodes.call(this, ctx, this._explicitFromSnapshot.nodes, 1 - e);
              try { if (e < 0.02 || Math.abs(e-0.25)<0.01 || Math.abs(e-0.5)<0.01 || Math.abs(e-0.75)<0.01 || e>0.98) console.log('[mapRenderer] L1->L0 walls bbox@e', e.toFixed(2), rcWalls2); } catch(_){}
              // Draw other groups fading out (exclude the active group node) as full groups with labels
              ctx.globalAlpha = 1 - e;
              for (const n of this._explicitFromSnapshot.nodes) {
                if (n.i === toIdxBG) continue;
                drawNode(ctx, n, false, false, '', undefined);
                if (n.i > 0) {
                  const circ = groupCirclePositions(n);
                  for (const c of circ) {
                    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                  }
                  // Label above the group post
                  try {
                    const lvl = 1; const idx = n.i;
                    let labelText = '';
                    const visited = (window.visitedLocation && window.visitedLocation[lvl] && window.visitedLocation[lvl][idx]);
                    if (visited && window.locationName && window.locationName[lvl] && window.locationName[lvl][idx]) {
                      labelText = window.locationName[lvl][idx];
                    } else if (window.levelData && window.levelData[lvl]) {
                      labelText = (window.levelData[lvl].locationLabel[idx] || 'group') + (idx > 0 ? (' #' + idx) : '');
                    }
                    if (labelText) {
                      ctx.save();
                      ctx.font = LABEL_FONT; ctx.fillStyle = STROKE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                      ctx.fillText(labelText, n.x, n.y - (RADII[n.kind]||8) - 6);
                      ctx.restore();
                    }
                  } catch (_) {}
                }
              }
              ctx.restore();
            }
          }

          // Draw morphing circles and labels for the active cluster
          ctx.save();
          ctx.globalAlpha = 1.0;
          ctx.fillStyle = FILL;
          ctx.strokeStyle = STROKE;
          ctx.lineWidth = 2;
          for (const p of pairs) {
            const x = lerp(p.fx, p.tx, e);
            const y = lerp(p.fy, p.ty, e);
            const r = lerp(p.fr, p.tr, e);
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Draw labels: L0 labels shrink out on 0->1, L1 labels grow in on 1->0
            try {
              const baseFontPx = 10;
              if (fromL === 0 && toL === 1 && typeof p.fi === 'number') {
                const lvl = 0, idx = p.fi;
                let text = '';
                if (window.locationName && window.locationName[lvl] && window.locationName[lvl][idx]) {
                  text = window.locationName[lvl][idx];
                } else if (window.levelData && window.levelData[lvl]) {
                  text = (window.levelData[lvl].locationLabel[idx] || 'spot') + (idx > 0 ? (' #' + idx) : '');
                }
                if (text) {
                  const ls = Math.max(0.15, 1 - e);
                  ctx.save();
                  ctx.font = Math.round(baseFontPx * ls) + 'px monospace';
                  ctx.fillStyle = STROKE;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'alphabetic';
                  ctx.globalAlpha = (1 - e);
                  ctx.fillText(text, x, y - r - 6);
                  ctx.restore();
                }
              }
              if (fromL === 1 && toL === 0 && typeof p.ti === 'number') {
                const lvl = 0, idx = p.ti;
                let text = '';
                if (window.locationName && window.locationName[lvl] && window.locationName[lvl][idx]) {
                  text = window.locationName[lvl][idx];
                } else if (window.levelData && window.levelData[lvl]) {
                  text = (window.levelData[lvl].locationLabel[idx] || 'spot') + (idx > 0 ? (' #' + idx) : '');
                }
                if (text) {
                  const ls = Math.max(0.15, e);
                  ctx.save();
                  ctx.font = Math.round(baseFontPx * ls) + 'px monospace';
                  ctx.fillStyle = STROKE;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'alphabetic';
                  ctx.globalAlpha = e;
                  ctx.fillText(text, x, y - r - 6);
                  ctx.restore();
                }
              }
            } catch (_) {}
          }
          ctx.restore();

          // Boss↔Group label morph at constant size, moving along the link path
          try {
            const baseFontPx = 10;
            if (fromL === 0 && toL === 1) {
              const f0 = snapFrom.nodes.find(n => n.i === 0);
              const idxG = (this._preparedTransition ? this._preparedTransition.toIdx : 1);
              const gN = snapTo.nodes.find(n => n.i === idxG) || snapTo.nodes[1];
              if (f0 && gN) {
                const r0 = RADII[getNodeKind(0,0)] || 8;
                const rG = RADII[getNodeKind(1,idxG)] || 8;
                const x0 = f0.x, y0 = f0.y - r0 - 6;
                const x1 = gN.x, y1 = gN.y - rG - 6;
                const xm = lerp(x0, x1, e), ym = lerp(y0, y1, e);
                let bossText = '';
                if (window.locationName && window.locationName[0] && window.locationName[0][0]) bossText = window.locationName[0][0];
                if (!bossText && window.levelData && window.levelData[0]) bossText = (window.levelData[0].locationLabel[0]||'spot');
                let groupText = '';
                if (window.locationName && window.locationName[1] && window.locationName[1][idxG]) groupText = window.locationName[1][idxG];
                if (!groupText && window.levelData && window.levelData[1]) groupText = (window.levelData[1].locationLabel[idxG]||'group') + (idxG>0?(' #'+idxG):'');
                ctx.save();
                ctx.font = baseFontPx + 'px monospace';
                ctx.fillStyle = STROKE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                // Move L0 label to L1 label position with fading out
                if (bossText) { ctx.globalAlpha = 1 - e; ctx.fillText(bossText, xm, ym); }
                // Move L1 group label along same path fading in
                if (groupText) { ctx.globalAlpha = e; ctx.fillText(groupText, xm, ym); }
                ctx.restore();
              }
            } else if (fromL === 1 && toL === 0) {
              const idxG = (this._preparedTransition ? this._preparedTransition.fromIdx : 1);
              const gN = this._explicitFromSnapshot.nodes.find(n => n.i === idxG) || this._explicitFromSnapshot.nodes[1];
              const t0 = snapTo.nodes.find(n => n.i === 0);
              if (gN && t0) {
                const r0 = RADII[getNodeKind(0,0)] || 8;
                const rG = RADII[getNodeKind(1,idxG)] || 8;
                const x0 = gN.x, y0 = gN.y - rG - 6;
                const x1 = t0.x, y1 = t0.y - r0 - 6;
                const xm = lerp(x0, x1, e), ym = lerp(y0, y1, e);
                let bossText = '';
                if (window.locationName && window.locationName[0] && window.locationName[0][0]) bossText = window.locationName[0][0];
                if (!bossText && window.levelData && window.levelData[0]) bossText = (window.levelData[0].locationLabel[0]||'spot');
                let groupText = '';
                if (window.locationName && window.locationName[1] && window.locationName[1][idxG]) groupText = window.locationName[1][idxG];
                if (!groupText && window.levelData && window.levelData[1]) groupText = (window.levelData[1].locationLabel[idxG]||'group') + (idxG>0?(' #'+idxG):'');
                ctx.save();
                ctx.font = baseFontPx + 'px monospace';
                ctx.fillStyle = STROKE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                // Move L1 group label toward L0 boss label, fading out
                if (groupText) { ctx.globalAlpha = 1 - e; ctx.fillText(groupText, xm, ym); }
                // Move L0 boss label along same path fading in
                if (bossText) { ctx.globalAlpha = e; ctx.fillText(bossText, xm, ym); }
                ctx.restore();
              }
            }
          } catch (_) {}

          // Log key morph stages with current scale and pivot
          try {
            const stage = (e < 0.02) ? '0%' : (e < 0.27 ? '25%' : (e < 0.52 ? '50%' : (e < 0.77 ? '75%' : (e > 0.98 ? '100%' : ''))));
            if (stage && stage !== this._lastMorphLogStage) {
              const sNow = (fromL === 0 && toL === 1) ? lerp(sStart, 1, e) : lerp(1, sStart, e);
              console.log('[mapRenderer] morph stage', stage, {
                fromL, toL,
                pivot: gNodeBG ? { x: Math.round(gNodeBG.x), y: Math.round(gNodeBG.y) } : null,
                sStart: Number.isFinite(sStart) ? sStart.toFixed(2) : sStart,
                sNow: Number.isFinite(sNow) ? sNow.toFixed(2) : sNow,
                e: e.toFixed(2)
              });
              this._lastMorphLogStage = stage;
            }
          } catch (_) {}

          // Active group label scaling
          try {
            const baseFontPx = 10;
            if (gNodeBG) {
              if (fromL === 0 && toL === 1) {
                // Draw level 1 group label scaling in
                const s = lerp(sStart, 1, e);
                const idx = (this._preparedTransition ? this._preparedTransition.toIdx : 1);
                let name = '';
                if (window.locationName && window.locationName[1] && window.locationName[1][idx]) name = window.locationName[1][idx];
                if (!name && window.levelData && window.levelData[1]) name = (window.levelData[1].locationLabel[idx] || 'group') + (idx>0?(' #'+idx):'');
                if (name) {
                  ctx.save();
                  ctx.translate(gNodeBG.x, gNodeBG.y); ctx.scale(s, s); ctx.translate(-gNodeBG.x, -gNodeBG.y);
                  ctx.font = baseFontPx + 'px monospace';
                  ctx.fillStyle = STROKE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                  ctx.globalAlpha = e;
                  ctx.fillText(name, gNodeBG.x, gNodeBG.y - (RADII[getNodeKind(1, idx)]||8) - 6);
                  ctx.restore();
                }
              } else if (fromL === 1 && toL === 0) {
                // Draw level 1 group label scaling out
                const s = lerp(1, sStart, e);
                const idx = (this._preparedTransition ? this._preparedTransition.fromIdx : 1);
                let name = '';
                if (window.locationName && window.locationName[1] && window.locationName[1][idx]) name = window.locationName[1][idx];
                if (!name && window.levelData && window.levelData[1]) name = (window.levelData[1].locationLabel[idx] || 'group') + (idx>0?(' #'+idx):'');
                if (name) {
                  ctx.save();
                  ctx.translate(gNodeBG.x, gNodeBG.y); ctx.scale(s, s); ctx.translate(-gNodeBG.x, -gNodeBG.y);
                  ctx.font = baseFontPx + 'px monospace';
                  ctx.fillStyle = STROKE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                  ctx.globalAlpha = (1 - e);
                  ctx.fillText(name, gNodeBG.x, gNodeBG.y - (RADII[getNodeKind(1, idx)]||8) - 6);
                  ctx.restore();
                }
              }
            }
          } catch (_) {}
        }

        // Finish
        if (t >= 1) {
          this._transitionActive = false;
          this._prevFrameCanvas = null;
          this._explicitFromSnapshot = null;
          this._preparedTransition = null;
          try {
            if (this._transitionContext) {
              const endInfo = Object.assign({}, this._transitionContext, { doneTs: Date.now() });
              console.debug('[mapRenderer] level transition end', endInfo);
            }
          } catch (_) {}
          const waiters = this._onTransitionDone.splice(0, this._onTransitionDone.length);
          for (const res of waiters) { try { res(); } catch (_) {} }
          this._transitionContext = null;
        }
      } else if (__transitionInfo) {
        // Finalize/cleanup transforms for default snapshot-based transition
        ctx.restore();
        if (__transitionInfo.t >= 1) {
          this._transitionActive = false;
          this._prevFrameCanvas = null;
          try {
            if (this._transitionContext) {
              const endInfo = Object.assign({}, this._transitionContext, { doneTs: Date.now() });
              console.debug('[mapRenderer] level transition end', endInfo);
            }
          } catch (_) {}
          const waiters = this._onTransitionDone.splice(0, this._onTransitionDone.length);
          for (const res of waiters) { try { res(); } catch (_) {} }
          this._transitionContext = null;
        }
      }
    }
  };

  window.mapRenderer = mapRenderer;

  // Public helper: await current/next level transition end
  mapRenderer.waitForTransition = function () {
    return new Promise((resolve) => {
      if (this._transitionActive) {
        this._onTransitionDone.push(resolve);
      } else {
        // Queue for the next transition that starts
        this._onNextTransitionWaiters.push(resolve);
      }
    });
  };

  // Public helper: prepare an explicit level transition BEFORE mutating window.currLevel
  // fromLevel/toLevel must match the levels you are transitioning between.
  mapRenderer.prepareLevelTransition = function (fromLevel, toLevel, fromLocIndex, toLocIndex) {
    try {
      const snap = computeSnapshotForLevel(fromLevel, this._w || (this._canvas ? this._canvas.width : 0), this._h || (this._canvas ? this._canvas.height : 0));
      this._preparedTransition = {
        fromLevel,
        toLevel,
        fromIdx: (typeof fromLocIndex === 'number' ? fromLocIndex : 0),
        toIdx: (typeof toLocIndex === 'number' ? toLocIndex : 0),
        fromSnap: snap,
      };
      this._pendingTransitionHold = true;
      console.debug('[mapRenderer] prepared level transition', { fromLevel, toLevel, fromIdx: this._preparedTransition.fromIdx, toIdx: this._preparedTransition.toIdx, centroidFrom: centroidOf(snap.nodes) });
    } catch (e) {
      try { console.warn('[mapRenderer] prepareLevelTransition failed', e); } catch (_) {}
      this._preparedTransition = null;
      this._pendingTransitionHold = false;
    }
  };

  // Auto-init after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mapRenderer.init(), { once: true });
  } else {
    mapRenderer.init();
  }
})();
