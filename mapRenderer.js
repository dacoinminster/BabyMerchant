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

// Dependencies loaded before this file:
// - map.constants.js, map.math.js, map.layout.js, map.drawing.js
// - map.backgrounds.js, map.hittest.js, map.interactions.js, map.transitions.js
function getDevicePixelRatio() {
 return (window.devicePixelRatio || 1);
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
    _evtBound: false,
    _evtBoundHost: false,
    _evtBoundWin: false,
    _host: null,
    _bootLogged: false,
    _lastNodesLenLogged: -1,

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

      try {
        const cs = this._host ? getComputedStyle(this._host) : null;
        console.debug('[mapRenderer] init snapshot', {
          dpr: this._dpr, w: this._w, h: this._h,
          hostDisplay: cs ? cs.display : null,
          hostVisibility: cs ? cs.visibility : null,
          hasMapGraph: !!(window.MapGraph && typeof MapGraph.rebuildIfNeeded === 'function'),
          currLevel: window.currLevel,
          numLocations: (window.levelData && window.levelData[(window.currLevel||0)]) ? window.levelData[(window.currLevel||0)].numLocations : 'NA'
        });
      } catch (_) {}
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
      
      // Initialize MapTransitions
      if (window.MapTransitions && typeof MapTransitions.init === 'function') {
        MapTransitions.init(this);
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
      
      MapGraph.invalidate();
      this._positionsValid = false;

      // Cancel any in-flight transition if size changed
      this._prevFrameCanvas = null;
      // Cancel any in-flight transition if size changed
      if (window.MapTransitions && typeof MapTransitions.setPendingHold === 'function') {
        MapTransitions.setPendingHold(false);
      }
    },


    _buildGraphIfNeeded() {
      if (!window.MapGraph || typeof MapGraph.rebuildIfNeeded !== 'function') { try { console.error('[mapRenderer] MapGraph missing - check script tags and order'); } catch (_) {} return; }
      const level = (window.currLevel || 0);
      const res = MapGraph.rebuildIfNeeded({
        level,
        w: this._w,
        h: this._h,
        nodes: this._nodes,
        edges: this._edges,
        layoutMeta: this._layoutMeta
      });
      this._nodes = res.nodes;
      this._edges = res.edges;
      this._layoutMeta = res.layoutMeta;
      this._positionsValid = res.positionsValid;
      
    },

    _syncFromGameState() {
      const level = (window.currLevel || 0);
      const transit = (window.transitMoves || 0);
      const nextIdx = (typeof window.nextLocIndex === 'number' ? window.nextLocIndex : 0);
      const loc = (typeof window.locIndex === 'number' ? window.locIndex : 0);

      this._buildGraphIfNeeded();
      try {
        if (this._nodes && this._nodes.length !== this._lastNodesLenLogged) {
          console.debug('[mapRenderer] nodes len changed', { len: this._nodes.length, level, w: this._w, h: this._h });
          this._lastNodesLenLogged = this._nodes.length;
        }
      } catch (_) {}

      // Determine gossip highlight and destination green (read from DOM)
      let gossipIndex = (typeof window.gossipLocation === 'number' ? window.gossipLocation : -1);
      const gossipActive = !!window.showingGossipColors;
      this._gossipIndex = gossipActive ? gossipIndex : -1;

      // Travel state: treat any transitMoves > 0 as "en route"
      const wasLevel = this._lastCurrLevel;
      if (wasLevel !== level) {
        // Start a zoom transition between levels
        if (window.MapTransitions && typeof MapTransitions.beginLevelTransition === 'function') {
          MapTransitions.beginLevelTransition(level);
        }
        this._travelActive = false;
        MapGraph.invalidate();
        this._positionsValid = false;
      }
      // Update MapTransitions last level
      if (window.MapTransitions && typeof MapTransitions.updateLastLevel === 'function') {
        MapTransitions.updateLastLevel(level);
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
        MapGraph.invalidate();
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
      if (window.MapTransitions && typeof MapTransitions.isActive === 'function' && MapTransitions.isActive()) {
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
      
      // Delegate to interactions module (keeps renderer thin)
      MapInteractions.routeClick(hit, {
        transit: (window.transitMoves || 0),
        curr: (window.currLevel || 0),
        loc: (typeof window.locIndex === 'number' ? window.locIndex : 0),
        next: (typeof window.nextLocIndex === 'number' ? window.nextLocIndex : 0),
        maxLevel: (window.maxLevel || 0),
      }, {
        locomote,
        enterTrading,
        levelUp,
        levelDown,
        setNextLocIndex: (i) => { window.nextLocIndex = i; },
        syncRadio: (i) => { try { var rb = document.getElementById('nextLoc' + i); if (rb) rb.checked = true; } catch (_) {} },
        updateLocomoteButton: () => { if (typeof window.updateLocomoteButton === 'function') window.updateLocomoteButton(); },
        markInventoryChanged: () => { window.inventoryChanged = true; }
      });
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
      if (!this._bootLogged) { this._bootLogged = true; try { const host = this._host || (this._canvas ? this._canvas.parentElement : null); const cs = host ? getComputedStyle(host) : null; console.debug('[mapRenderer] first draw', { level: (window.currLevel||0), w: this._w, h: this._h, nodes: Array.isArray(this._nodes) ? this._nodes.length : 0, meta: this._layoutMeta ? Object.keys(this._layoutMeta) : [], hostDisplay: cs ? cs.display : null, hostVisibility: cs ? cs.visibility : null, transit: (window.transitMoves||0), uiMode: window.uiMode }); } catch (_) {} }

      // Detect parent size changes (e.g., title card hide/show) and resize canvas
      const parentRect = this._canvas.parentElement.getBoundingClientRect();
      const pw = Math.floor(parentRect.width), ph = Math.floor(parentRect.height);
      if (pw !== this._w || ph !== this._h) {
        
        this._resize();
      }

      ctx.clearRect(0, 0, this._w, this._h);
      
      this._buildGraphIfNeeded();

      // If app prepared a transition and level just changed but transition not started yet,
      // suppress drawing this frame to avoid a flash of the new level's walls/groups.
      if (window.MapTransitions && typeof MapTransitions.isPendingHold === 'function' &&
          window.MapTransitions.isPendingHold() &&
          (this._lastCurrLevel !== (window.currLevel || 0)) &&
          !window.MapTransitions.isActive()) {
        try { console.debug('[mapRenderer] draw suppressed to avoid flash before transition'); } catch (_) {}
        return;
      }

      // Defer drawing the progress baby until after nodes so it's always on top
      let __babyPos = null;

      // Level-specific background/decorations
      const levelNowForBG = (window.currLevel || 0);
      // Suppress normal background while explicit morphing; we'll draw transformed backgrounds ourselves
      if (!(window.MapTransitions && typeof MapTransitions.hasExplicitSnapshot === 'function' &&
             window.MapTransitions.hasExplicitSnapshot() && window.MapTransitions.isActive()) &&
         levelNowForBG === 2 && this._layoutMeta.level2) {
        MapBackgrounds.drawLevel2Background(ctx, this._nodes, { w: this._w, h: this._h }, this._layoutMeta);
      } else if (!(window.MapTransitions && typeof MapTransitions.hasExplicitSnapshot === 'function' &&
                  window.MapTransitions.hasExplicitSnapshot() && window.MapTransitions.isActive()) && levelNowForBG === 1) {
        MapBackgrounds.drawLevel1Background(ctx, this._nodes, { w: this._w, h: this._h }, this._layoutMeta);
      }

      // Level transition rendering: draw morph/zoom between levels
      let __transitionInfo = null;
      if (window.MapTransitions && typeof MapTransitions.drawTransition === 'function') {
        __transitionInfo = MapTransitions.drawTransition(ctx);
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
      if (this._travelActive && !(window.MapTransitions && typeof MapTransitions.hasExplicitSnapshot === 'function' &&
                                   window.MapTransitions.hasExplicitSnapshot() && window.MapTransitions.isActive())) {
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
      } else if (!(window.MapTransitions && typeof MapTransitions.hasExplicitSnapshot === 'function' &&
                   window.MapTransitions.hasExplicitSnapshot() && window.MapTransitions.isActive())) {
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
      if (window.MapTransitions && typeof MapTransitions.isPathSuppressedOnce === 'function' &&
          !window.MapTransitions.isPathSuppressedOnce() &&
          window.MapTransitions.hasExplicitSnapshot()) {
        try { console.debug('[mapRenderer] suppressing path rendering during level morph'); } catch (_) {}
        if (window.MapTransitions && typeof MapTransitions.setPathSuppressedOnce === 'function') {
          MapTransitions.setPathSuppressedOnce(true);
        }
      }

      // Draw nodes (respect discovery on level 0). Skip during explicit morph; custom block will draw.
      if (!(window.MapTransitions && typeof MapTransitions.hasExplicitSnapshot === 'function' &&
               window.MapTransitions.hasExplicitSnapshot() && window.MapTransitions.isActive())) {
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
      if (__babyPos && !(window.MapTransitions && typeof MapTransitions.hasExplicitSnapshot === 'function' &&
                         window.MapTransitions.hasExplicitSnapshot() && window.MapTransitions.isActive())) {
        drawProgressBaby(ctx, __babyPos.x, __babyPos.y, 22, window.currLevel);
      }

      // Custom morph handling for L0<->L1 when explicit snapshot is present
      if (window.MapTransitions && typeof MapTransitions.drawMorphTransition === 'function' &&
          window.MapTransitions.hasExplicitSnapshot()) {
        MapTransitions.drawMorphTransition(ctx, this._nodes);
      } else if (__transitionInfo) {
        // Finalize/cleanup transforms for default snapshot-based transition
        ctx.restore();
        if (__transitionInfo && __transitionInfo.t >= 1) {
          // Transition cleanup handled by MapTransitions
        }
      }
    },
    onHostVisibilityChange(show) {
      
      if (!show) return;
      // Force graph invalidation and schedule resize after layout becomes stable
      try { MapGraph.invalidate(); } catch (_) {}
      this._positionsValid = false;
      const doResize = () => {
        try { this._resize(); }
        catch (e) { try { console.warn('[mapRenderer] resize on visibility failed', e); } catch (_) {} }
      };
      // Attempt both next frame and microtask tick to catch various engines
      try { requestAnimationFrame(doResize); } catch (_) {}
      setTimeout(doResize, 0);
    }
  };

  window.mapRenderer = mapRenderer;

  // Public helper: await current/next level transition end
  mapRenderer.waitForTransition = function () {
    if (window.MapTransitions && typeof MapTransitions.waitForTransition === 'function') {
      return MapTransitions.waitForTransition();
    }
    // Fallback implementation
    return new Promise((resolve) => {
      // Resolve immediately if no transition system
      setTimeout(resolve, 0);
    });
  };

  // Public helper: prepare an explicit level transition BEFORE mutating window.currLevel
  // fromLevel/toLevel must match the levels you are transitioning between.
  mapRenderer.prepareLevelTransition = function (fromLevel, toLevel, fromLocIndex, toLocIndex) {
    if (window.MapTransitions && typeof MapTransitions.prepareLevelTransition === 'function') {
      return MapTransitions.prepareLevelTransition(fromLevel, toLevel, fromLocIndex, toLocIndex);
    }
    // Fallback implementation
    try {
      const snap = computeSnapshotForLevel(fromLevel, this._w || (this._canvas ? this._canvas.width : 0), this._h || (this._canvas ? this._canvas.height : 0));
      // In fallback, we would need to store this data somewhere, but since we're delegating to MapTransitions,
      // we don't need to implement the fallback fully
      console.debug('[mapRenderer] prepareLevelTransition delegated to MapTransitions');
    } catch (e) {
      try { console.warn('[mapRenderer] prepareLevelTransition failed', e); } catch (_) {}
    }
  };

  // Auto-init after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mapRenderer.init(), { once: true });
  } else {
    mapRenderer.init();
  }
})();
