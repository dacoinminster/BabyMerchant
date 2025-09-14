/* Level transition system for Baby Merchant map
   - Handles level transitions with animations
   - Manages transition state and callbacks
   - Provides prepare/wait APIs for smooth transitions
*/
(function () {
  'use strict';

  // Dependencies loaded before this file:
  // - map.constants.js, map.math.js, map.layout.js, map.drawing.js

/* Router delegation toggles for adjacency modules (safe rollout gates) */
const ENABLE_DELEGATE_L0L1 = true; // handle 0↔1 in js/map/transitions.l0l1.js when true
const ENABLE_DELEGATE_L1L2 = true; // handle 1↔2 in js/map/transitions.l1l2.js when true
  /*
   * MapTransitions facade
   * - Lifecycle/state and cross-zoom snapshot handling during transitions
   * - API methods:
   *   init(renderer) – store renderer and seed last level
   *   beginLevelTransition(newLevel) – set duration, pin time source, capture snapshot, preselect adjacency
   *   drawTransition(ctx) – cross-zoom when previous-frame canvas is present
   *   drawMorphTransition(ctx,nodes) – affine pan/zoom/rotate path + overlays + diagnostics
   *   waitForTransition() – resolves when active transition completes
   *   prepareLevelTransition(fromLevel,toLevel,fromIdx,toIdx,reverse?) – capture explicit snapshot/params
   *   updateLastLevel(level) – mirror game state to detect direction
   *   getters: isActive, isPendingHold, setPendingHold, isPathSuppressedOnce, setPathSuppressedOnce, hasExplicitSnapshot
   * - Router note: Preselects adjacency (L0L1/L1L2) during begin; delegation will be introduced later.
   * - Baselines for parity checks: see docs/transition-baselines.md
   */
  const MapTransitions = {
    // Transition state
    _transitionActive: false,
    _transitionStart: 0,
    _transitionDir: 'up',
    _transitionDurationMs: TRANSITION_DEFAULT_MS,
    _usePerfNow: false,
    _prevFrameCanvas: null,
    _onTransitionDone: [], // array of resolve callbacks
    _onNextTransitionWaiters: [], // resolvers waiting for the next transition to start, then finish
    _transitionContext: null, // details for logging
    _preparedTransition: null, // {fromLevel,toLevel,fromIdx,toIdx,fromSnap,reverse}
    _explicitFromSnapshot: null, // snapshot to use for morph when provided
    _pendingTransitionHold: false, // between prepare() and _beginLevelTransition()
    _loggedPathSuppressedOnce: false,
    
    _affineLoggedStart: false,
    _affineLoggedEnd: false,
    _affineOverlayLoggedStart: false,
    _affineOverlayLoggedEnd: false,

    // Router preselection (set on begin; not used yet)
    _activeAdjName: null,
    _activeAdjModule: null,
    
    // Game-state mirrors to detect transitions without invasive hooks
    _lastCurrLevel: 0,
    
    // Reference to mapRenderer for callbacks
    _renderer: null,
    
    init(renderer) {
      this._renderer = renderer;
      this._lastCurrLevel = (window.currLevel || 0);
    },
    
    // Begin a transition: uses levelData to set duration, preselects adjacency, and snapshots previous frame
    beginLevelTransition(newLevel) {
      const prevLevel = this._lastCurrLevel || 0;
      this._transitionDir = (newLevel > prevLevel) ? 'up' : 'down';
      // Duration and scaleBoost from levelData transitionSpecs when available
      const spec = (function(){ try { const hi = Math.max(prevLevel, newLevel); const LD = (typeof levelData !== 'undefined' && levelData) ? levelData : (window.levelData || null); const specs = (LD && LD[hi] && LD[hi].transitionSpecs) ? LD[hi].transitionSpecs : null; const key = String(prevLevel) + '->' + String(newLevel); return specs && specs[key] ? specs[key] : null; } catch (_) { return null; } })();
      if (spec && typeof spec.durationMs === 'number') {
        this._transitionDurationMs = spec.durationMs;
      } else if ((prevLevel === 0 && newLevel === 1) || (prevLevel === 1 && newLevel === 0)) {
        this._transitionDurationMs = TRANSITION_L0_L1_MS;
      } else if ((prevLevel === 1 && newLevel === 2) || (prevLevel === 2 && newLevel === 1)) {
        this._transitionDurationMs = (typeof TRANSITION_L1_L2_MS !== 'undefined') ? TRANSITION_L1_L2_MS : TRANSITION_DEFAULT_MS;
      } else {
        this._transitionDurationMs = TRANSITION_DEFAULT_MS;
      }

      // Pre-select adjacency module (no delegation yet; for future router)
      try {
        const lo = Math.min(prevLevel, newLevel), hi = Math.max(prevLevel, newLevel);
        const key = String(lo) + '-' + String(hi);
        if (key === '0-1' && window.MapTransitionsL0L1) {
          this._activeAdjName = 'L0L1';
          this._activeAdjModule = window.MapTransitionsL0L1;
        } else if (key === '1-2' && window.MapTransitionsL1L2) {
          this._activeAdjName = 'L1L2';
          this._activeAdjModule = window.MapTransitionsL1L2;
        } else {
          this._activeAdjName = null;
          this._activeAdjModule = null;
        }
      } catch(_) {
        this._activeAdjName = null;
        this._activeAdjModule = null;
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
          off.width = this._renderer._canvas.width;
          off.height = this._renderer._canvas.height;
          const octx = off.getContext('2d');
          octx.drawImage(this._renderer._canvas, 0, 0);
          this._prevFrameCanvas = off;
        } catch (e) {
          this._prevFrameCanvas = null;
        }
      }
      // Pin time source choice for start and subsequent sampling to avoid mismatches
      this._usePerfNow = !!(typeof performance !== 'undefined' && performance.now);
      this._transitionStart = this._usePerfNow ? performance.now() : Date.now();
      this._transitionActive = true;
      this._pendingTransitionHold = false;
      this._loggedPathSuppressedOnce = false;
      
      this._affineLoggedStart = false;
      this._affineLoggedEnd = false;
      this._affineOverlayLoggedStart = false;
      this._affineOverlayLoggedEnd = false;
       
      // Attach any next-transition waiters to this transition's completion list
      if (this._onNextTransitionWaiters.length) {
        this._onTransitionDone.push.apply(this._onTransitionDone, this._onNextTransitionWaiters);
        this._onNextTransitionWaiters.length = 0;
      }
      
      // Build diagnostic transition context for logs
      try {
        const snapFrom = this._explicitFromSnapshot || computeSnapshotForLevel(prevLevel, this._renderer._w, this._renderer._h);
        const snapTo = computeSnapshotForLevel(newLevel, this._renderer._w, this._renderer._h);
        const cenFrom = centroidOf(snapFrom.nodes);
        const cenTo = centroidOf(snapTo.nodes);
        // Derive location indices (safe defaults)
        const locFrom = (this._preparedTransition ? this._preparedTransition.fromIdx : ((typeof this._renderer._lastLocIndex === 'number') ? this._renderer._lastLocIndex : 0));
        const locTo = (this._preparedTransition ? this._preparedTransition.toIdx : ((typeof window.locIndex === 'number') ? window.locIndex : 0));
        const nodeFrom = snapFrom.nodes.find(n => n.i === locFrom) || snapFrom.nodes[0] || { x: 0, y: 0 };
        const nodeTo = snapTo.nodes.find(n => n.i === locTo) || snapTo.nodes[0] || { x: 0, y: 0 };
        this._transitionContext = {
          fromLevel: prevLevel,
          toLevel: newLevel,
          dir: this._transitionDir,
          canvas: { w: this._renderer._w, h: this._renderer._h, dpr: this._renderer._dpr },
          fromLocIndex: locFrom,
          toLocIndex: locTo,
          centroidFrom: { x: Math.round(cenFrom.x), y: Math.round(cenFrom.y) },
          centroidTo: { x: Math.round(cenTo.x), y: Math.round(cenTo.y) },
          nodeFrom: { x: Math.round(nodeFrom.x), y: Math.round(nodeFrom.y) },
          nodeTo: { x: Math.round(nodeTo.x), y: Math.round(nodeTo.y) },
          ts: Date.now(),
        };
        if (window.DEBUG_AFFINE) console.debug('[MapTransitions] level transition start', this._transitionContext);
      } catch (_) { /* ignore logging errors */ }
    },
    
    // Draw level transition effects
    // Cross-zoom of previous frame → current level when no explicit morph snapshot is used
    drawTransition(ctx) {
      // Level transition rendering: draw morph/zoom between levels
      let __transitionInfo = null;
      if (this._transitionActive && this._prevFrameCanvas) {
        const now = this._usePerfNow ? performance.now() : Date.now();
        const t = clamp01((now - this._transitionStart) / this._transitionDurationMs);
        const e = easeInOutQuad(t);
        const eMotion = (typeof easeInOutCubic === 'function') ? easeInOutCubic(t) : e;
        __transitionInfo = { t, e, dir: this._transitionDir };
        const cx = this._renderer._w * 0.5, cy = this._renderer._h * 0.5;
        
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
          ctx.drawImage(this._prevFrameCanvas, 0, 0, this._renderer._w, this._renderer._h);
          ctx.restore();
          
          // Prepare transform for current scene
          ctx.save();
          const scaleNew = (this._transitionDir === 'up') ? lerp(1.2, 1, e) : lerp(0.2, 1, e);
          ctx.translate(cx, cy);
          ctx.scale(scaleNew, scaleNew);
          ctx.translate(-cx, -cy);

          // When the cross-zoom reaches the end, mark transition complete here.
          // MapRenderer will handle ctx.restore() at the end of its draw pass.
          if (t >= 1) {
            this._transitionActive = false;
            this._prevFrameCanvas = null;
            try {
              if (this._transitionContext) {
                const endInfo = Object.assign({}, this._transitionContext, { doneTs: Date.now() });
                if (window.DEBUG_AFFINE) console.debug('[MapTransitions] level transition end', endInfo);
              }
            } catch (_) {}
            const waiters = this._onTransitionDone.splice(0, this._onTransitionDone.length);
            for (const res of waiters) { try { res(); } catch (_) {} }
            this._transitionContext = null;
          }
        }
      }
      
      return __transitionInfo;
    },
    
    // Draw custom morph handling for L0<->L1 when explicit snapshot is present
    // Affine morph renderer: reads forward (lo→hi) spec and applies reverse automatically; overlays + diagnostics
    drawMorphTransition(ctx, nodes) {
      if (this._transitionActive && this._explicitFromSnapshot) {
        const now = this._usePerfNow ? performance.now() : Date.now();
        const t = clamp01((now - this._transitionStart) / this._transitionDurationMs);
        const e = easeInOutQuad(t);
        const eMotion = (typeof easeInOutCubic === 'function') ? easeInOutCubic(t) : e;

        const fromL = this._preparedTransition ? this._preparedTransition.fromLevel : this._lastCurrLevel;
        const toL = (window.currLevel || 0);
        // Always resolve forward spec (low->high) and derive reverse from actual direction
        const __pairSpecResolve = (function () {
          try {
            const lo = Math.min(fromL, toL), hi = Math.max(fromL, toL);
            const LD = (typeof levelData !== 'undefined' && levelData) ? levelData : (window.levelData || null);
            const specs = (LD && LD[hi] && LD[hi].transitionSpecs) ? LD[hi].transitionSpecs : null;
            const key = String(lo) + '->' + String(hi);
            return specs && specs[key] ? specs[key] : null;
          } catch (_) { return null; }
        })();
        const pairSpec = __pairSpecResolve;
        const hasAffine = !!(pairSpec && pairSpec.affine);
        const reverse = (this._preparedTransition && typeof this._preparedTransition.reverse === "boolean") ? this._preparedTransition.reverse : (fromL > toL);

        // Attempt router delegation for 0↔1 and 1↔2 (kept behind flags for safe rollout)
        // Note: Allows temporary override via window.__FORCE_DELEGATE_L0L1 / __FORCE_DELEGATE_L1L2 for parity testing.
        let __delegated = false;
        try {
          if (this._activeAdjName === 'L0L1' && (ENABLE_DELEGATE_L0L1 || (window && window.__FORCE_DELEGATE_L0L1)) &&
              window.MapTransitionsL0L1 &&
              typeof window.MapTransitionsL0L1.drawMorphTransition === 'function') {
            __delegated = !!window.MapTransitionsL0L1.drawMorphTransition(ctx, this);
          } else if (!__delegated && this._activeAdjName === 'L1L2' && (ENABLE_DELEGATE_L1L2 || (window && window.__FORCE_DELEGATE_L1L2)) &&
                     window.MapTransitionsL1L2 &&
                     typeof window.MapTransitionsL1L2.drawMorphTransition === 'function') {
            __delegated = !!window.MapTransitionsL1L2.drawMorphTransition(ctx, this);
          }
        } catch (_) {}

        // Unified affine morph path (pan/zoom/rotate) driven entirely by params in levelData.transitionSpecs[].affine
        if (!__delegated && hasAffine) {
          const w = this._renderer._w, h = this._renderer._h;
          const snapFrom = this._explicitFromSnapshot; // source snapshot is captured before level switch
          const snapTo = computeSnapshotForLevel(toL, w, h);

          // Resolve indices used by anchors/mapping
          const fromIdx = (this._preparedTransition ? this._preparedTransition.fromIdx : ((typeof this._renderer._lastLocIndex === 'number') ? this._renderer._lastLocIndex : 0));
          const toIdx = (this._preparedTransition ? this._preparedTransition.toIdx : ((typeof window.locIndex === 'number') ? window.locIndex : 0));

          // Helper: draw a snapshot (background + nodes) using vector backgrounds; also add L1 mini-circles
          // hideSet: optional Set of node indices to omit (to avoid duplicates when animating overlays)
          function drawSnapshotAff(ctx2, level, snap, hideSet) {
            if (!snap || !Array.isArray(snap.nodes)) return;
            try {
              MapBackgrounds.drawLevelBackground(ctx2, snap.nodes, { w, h }, snap.layoutMeta || {}, level);
            } catch (_) {}
            for (const n of snap.nodes) {
              if (hideSet && hideSet.has(n.i)) continue;
              const showName = !!n.nameKnown;
              const labelText = n.label;
              const hasGossip = false;
              drawNode(ctx2, n, showName, hasGossip, labelText, undefined);
              try {
                const loL = Math.min(fromL, toL);
                const role = (snap.level === loL) ? 'low' : 'high';
                const showSubs = !!(aff.sceneDrawHints && aff.sceneDrawHints[role] && aff.sceneDrawHints[role].showSubLocations);
                if (showSubs && n.i > 0) {
                  if (typeof window.drawGroupMiniCircles === 'function') {
                    window.drawGroupMiniCircles(ctx2, n);
                  }
                }
              } catch (_) {}
            }
          }

          // Anchor resolution
          function resolveIndex(which, snap) {
            if (window.TransitionsCommon && typeof TransitionsCommon.resolveIndex === 'function') {
              return TransitionsCommon.resolveIndex(which, snap, fromL, toL, fromIdx, toIdx);
            }
            // Fallback to local computation (should not be used if transitionsCommon is loaded)
            const lo = Math.min(fromL, toL);
            const hi = Math.max(fromL, toL);
            const idxAtLo = (fromL === lo) ? fromIdx : toIdx;
            const idxAtHi = (fromL === hi) ? fromIdx : toIdx;
            if (which === 'fromIndex') return (snap && snap.level === lo) ? idxAtLo : idxAtHi;
            if (which === 'toIndex')   return (snap && snap.level === hi) ? idxAtHi : idxAtLo;
            return 0;
          }
          function resolveAnchor(desc, snap) {
            if (window.TransitionsCommon && typeof TransitionsCommon.resolveAnchor === 'function') {
              return TransitionsCommon.resolveAnchor(desc, snap, { w, h }, fromL, toL, fromIdx, toIdx);
            }
            // Fallback: original inline computation
            if (!desc) return { x: w * 0.5, y: h * 0.5 };
            if (desc.type === 'node') {
              const i = (desc.which === 'fixed') ? (desc.index || 0) : resolveIndex(desc.which, snap);
              const n = snap.nodes.find(nn => nn.i === i) || snap.nodes[0] || { x: w * 0.5, y: h * 0.5 };
              return { x: n.x, y: n.y };
            }
            if (desc.type === 'doorCenterForNode') {
              const i = (desc.which === 'fixed') ? (desc.index || 0) : resolveIndex(desc.which, snap);
              const n = snap.nodes.find(nn => nn.i === i) || snap.nodes[0] || { x: w * 0.5, y: h * 0.5 };
              try {
                if (snap.level === 1 && i === 0) {
                  const rc = MapHitTest.computeL1DoorwayRect(snap.nodes, { w, h });
                  if (rc) return { x: rc.x + rc.w * 0.5, y: rc.y + rc.h * 0.5 };
                }
              } catch (_) {}
              try {
                const meta2 = snap.layoutMeta && snap.layoutMeta.level2;
                if (meta2) {
                  const wallX = (n.x < meta2.centerX) ? meta2.xLeft : meta2.xRight;
                  return { x: wallX, y: n.y };
                }
              } catch (_) {}
              return { x: n.x, y: n.y };
            }
            return { x: w * 0.5, y: h * 0.5 };
          }

          const aff = pairSpec.affine || {};
          // Always interpret anchors using the forward (lo->hi) semantics to ensure exact reversals.
          // Resolve anchors generically from forward spec; reverse swaps descriptors.
          // Forward semantics: anchors.from applies to the lo scene; anchors.to applies to the hi scene.
          // For reverse direction, swap them so we always read a single forward spec.
          const loPair = Math.min(fromL, toL);
          let anchorFrom, anchorTo;
          const anchorFromSpec = (aff.anchors && (reverse ? aff.anchors.to : aff.anchors.from));
          const anchorToSpec   = (aff.anchors && (reverse ? aff.anchors.from : aff.anchors.to));
          anchorFrom = resolveAnchor(anchorFromSpec, snapFrom);
          anchorTo   = resolveAnchor(anchorToSpec, snapTo);

          // Rotation target (constant or sideAngles; enforce reversal symmetry)
          let rotAlpha = 0;
          if (aff.rotation && aff.rotation.mode === 'constant') {
            rotAlpha = aff.rotation.value || 0;
          } else if (aff.rotation && aff.rotation.mode === 'sideAngles') {
            // If targeting L1 doorway (toIdx==0), base side on the source L2 door (fromIdx)
            const useFrom = (typeof toIdx === 'number' && toIdx === 0);
            const refSnap = useFrom ? snapFrom : snapTo;
            const refIdx = useFrom ? fromIdx : toIdx;
            const refNode = refSnap.nodes.find(n => n.i === refIdx) || { x: w * 0.5, y: h * 0.5 };
            const centerX = (refSnap.layoutMeta && refSnap.layoutMeta.level2) ? refSnap.layoutMeta.level2.centerX : (w * 0.5);
            const isLeft = refNode.x < centerX;
            const rot = aff.rotation;
            const isCenter = (!useFrom && typeof toIdx === 'number' && toIdx === 0);
            rotAlpha = isCenter ? (rot.center || 0) : (isLeft ? (rot.left || -Math.PI / 2) : (rot.right || Math.PI / 2));
          }
          const alphaGoal = reverse ? -rotAlpha : rotAlpha;
          // Adjust spin for sideAngles so Level 2 starts above the room (180° flip) but ends upright.
          // We rotate both scenes by alphaSpin and pre-rotate the destination by -alphaSpin so it ends identity.
          let alphaSpin = alphaGoal;
          if (aff.rotation && aff.rotation.mode === 'sideAngles') {
            const sgn = (alphaGoal >= 0 ? 1 : -1);
            alphaSpin = alphaGoal - sgn * Math.PI;
          }
          // Pre-rotate the destination scene so it starts aligned and ends upright
          const preRotTo = -alphaSpin;

          // Scale ratio computation
          function computePairToMiniRatio() {
            // Prefer shared helper when available to centralize logic
            if (window.TransitionsCommon && typeof TransitionsCommon.computePairToMiniRatio === 'function') {
              const pair = (aff.scale && Array.isArray(aff.scale.pair)) ? aff.scale.pair : [0, 2];
              const miniIdx = (aff.scale && typeof aff.scale.miniIdx === 'number') ? aff.scale.miniIdx : 2;
              return TransitionsCommon.computePairToMiniRatio({
                snapFrom, snapTo, fromL, toL, fromIdx, toIdx, pair, miniIdx
              });
            }
            // Local fallback (parity with legacy inline computation)
            // d0 from two L0 nodes; d1 from L1 group to selected mini circle
            const snapL0 = (snapFrom.level === 0) ? snapFrom : (snapTo.level === 0 ? snapTo : null);
            const pair = (aff.scale && Array.isArray(aff.scale.pair)) ? aff.scale.pair : [0, 2];
            let d0 = 1;
            if (snapL0) {
              const a = snapL0.nodes.find(n => n.i === pair[0]);
              const b = snapL0.nodes.find(n => n.i === pair[1]);
              d0 = (a && b) ? Math.hypot(b.x - a.x, b.y - a.y) : 1;
            }
            const snapL1 = (snapFrom.level === 1) ? snapFrom : (snapTo.level === 1 ? snapTo : null);
            const gIndex = (snapTo.level === 1) ? toIdx : (snapFrom.level === 1 ? fromIdx : 1);
            let d1 = 1;
            if (snapL1) {
              const gNode = snapL1.nodes.find(n => n.i === gIndex) || snapL1.nodes[1] || snapL1.nodes[0];
              let minis = null;
              if (typeof window.computeGroupCirclePositions === 'function') {
                minis = window.computeGroupCirclePositions(gNode);
              } else {
                // fallback mini generator from spec-like defaults
                const specMini = (typeof window.getLevel1MiniSpec === 'function') ? window.getLevel1MiniSpec() : { rdot: 4.6, gap: 14, belowOffset: 12, offsetMultipliers: [-1.5, -0.5, 0.5, 1.5], outerLift: 0.5 };
                const rdot = specMini.rdot || 4.6;
                const gap = specMini.gap || 14;
                const below = RADII[gNode.kind] + (specMini.belowOffset || 12);
                const baseY = gNode.y + below, baseX = gNode.x;
                const mult = specMini.offsetMultipliers || [-1.5, -0.5, 0.5, 1.5];
                const lift = (typeof specMini.outerLift === 'number') ? specMini.outerLift : 0.5;
                minis = mult.map((m, i) => {
                  const isOuter = (i === 0 || i === mult.length - 1);
                  return { x: baseX + m * gap, y: baseY - (isOuter ? rdot * lift : 0), r: rdot };
                });
              }
              const miniIdx = (aff.scale && typeof aff.scale.miniIdx === 'number') ? aff.scale.miniIdx : 2;
              const mr = minis && minis[miniIdx] ? minis[miniIdx] : (minis && minis[0]);
              d1 = mr ? Math.hypot(mr.x - gNode.x, mr.y - gNode.y) : 1;
            }
            return d0 / Math.max(1e-3, d1);
          }
          function computeDoorGapRatio() {
            // Prefer shared helper when available
            if (window.TransitionsCommon && typeof TransitionsCommon.computeDoorGapRatio === 'function') {
              let half = 10;
              try {
                half = (pairSpec && pairSpec.l1l2 && typeof pairSpec.l1l2.doorGapHalf === 'number') ? pairSpec.l1l2.doorGapHalf : (MapHitTest.getL2DoorGapHalf ? MapHitTest.getL2DoorGapHalf() : 10);
              } catch (_) {}
              return TransitionsCommon.computeDoorGapRatio({ snapFrom, snapTo, w, h, doorGapHalf: half });
            }
            // Local fallback (parity with legacy inline computation)
            const snapL1 = (snapFrom.level === 1) ? snapFrom : (snapTo.level === 1 ? snapTo : null);
            let w1 = 50;
            try {
              const rc1 = MapHitTest.computeL1DoorwayRect(snapL1.nodes, { w, h });
              w1 = rc1 ? Math.max(1, (rc1.w - 16)) : 50; // subtract margin in computeL1DoorwayRect
            } catch (_) {}
            let half = 10;
            try {
              half = (pairSpec && pairSpec.l1l2 && typeof pairSpec.l1l2.doorGapHalf === 'number') ? pairSpec.l1l2.doorGapHalf : (MapHitTest.getL2DoorGapHalf ? MapHitTest.getL2DoorGapHalf() : 10);
            } catch (_) {}
            const w2 = Math.max(1, 2 * half);
            return w1 / w2;
          }
          let ratio = 1;
          if (aff.scale && aff.scale.mode === 'pairToMini') ratio = computePairToMiniRatio();
          else if (aff.scale && aff.scale.mode === 'doorGapRatio') ratio = computeDoorGapRatio();
  
          // Direction-aware symmetric scaling:
          // Always map "low" level by S and "high" by S*ratio,
          // where S interpolates from the source identity to the destination identity.
          const safeRatio = Math.max(1e-3, ratio);
          const invR = 1 / safeRatio;
          // Roles for scenes based on lo/hi
          const fromRole = (fromL === loPair) ? 'low' : 'high';
          const toRole   = (toL   === loPair) ? 'low' : 'high';
          // Determine which scene supplies the ratio numerator
          const ratioSourceRole = (aff.scale && aff.scale.source === 'high') ? 'high' : 'low';
          // Choose S endpoints so: sFrom(0) == 1 and sTo(1) == 1
          const S_start = (fromRole === ratioSourceRole) ? 1 : invR;
          const S_end   = (toRole   === ratioSourceRole) ? 1 : invR;
          const S = lerp(S_start, S_end, eMotion);
          const sLow = S;
          const sHigh = S * safeRatio;
          let sFrom, sTo;
          sFrom = (fromRole === ratioSourceRole) ? sLow : sHigh;
          sTo   = (toRole   === ratioSourceRole) ? sLow : sHigh;
          /* diagnostics moved below (after worldPos/pivot) so transforms are available */
 
          const angNow = lerp(0, alphaSpin, eMotion);
          const d = { x: (anchorFrom.x - anchorTo.x), y: (anchorFrom.y - anchorTo.y) };
          // Data-driven pan reverse strategy
          const reverseStrategy = (aff.pan && aff.pan.reverseStrategy) || null;
          let pan;
          if (window.TransitionsCommon && typeof TransitionsCommon.panFromStrategy === 'function') {
            pan = TransitionsCommon.panFromStrategy(
              reverseStrategy, reverse, d, toRole, ratioSourceRole, S_start, S_end, safeRatio, eMotion
            );
          } else {
            // Fallback to local strategy (parity with pre-refactor behavior)
            if (reverseStrategy === 'forwardInverse') {
              const sToStart = (toRole === ratioSourceRole) ? S_start : (S_start * safeRatio);
              const sToEnd   = (toRole === ratioSourceRole) ? S_end   : (S_end   * safeRatio);
              const panStartVec = reverse ? { x: -sToStart * d.x, y: -sToStart * d.y }
                                          : { x: d.x,             y: d.y };
              const panEndVec   = { x: (1 - sToEnd) * d.x, y: (1 - sToEnd) * d.y };
              pan = { x: lerp(panStartVec.x, panEndVec.x, eMotion), y: lerp(panStartVec.y, panEndVec.y, eMotion) };
            } else if (reverseStrategy === 'identityStart') {
              pan = { x: lerp(d.x, 0, eMotion), y: lerp(d.y, 0, eMotion) };
            } else if (reverseStrategy === 'zero') {
              pan = { x: 0, y: 0 };
            } else {
              pan = !reverse ? { x: lerp(d.x, 0, eMotion), y: lerp(d.y, 0, eMotion) }
                             : { x: lerp(0, d.x, eMotion), y: lerp(0, d.y, eMotion) };
            }
          }
          // Data-driven pivot selection
          const pivotMode = (aff.pivot || 'to');
          const pivot = (pivotMode === 'from') ? { x: anchorFrom.x, y: anchorFrom.y } : { x: anchorTo.x, y: anchorTo.y };

          function worldPos(local, s, preRot, anchor, angRot, panV) {
            if (window.TransitionsCommon && typeof TransitionsCommon.worldPos === 'function') {
              return TransitionsCommon.worldPos(local, s, preRot, anchor, angRot, panV, pivot);
            }
            // Fallback inline
            const lx = local.x - anchor.x, ly = local.y - anchor.y;
            const cpre = Math.cos(preRot), spre = Math.sin(preRot);
            const rx = cpre * lx - spre * ly;
            const ry = spre * lx + cpre * ly;
            const sx = s * rx, sy = s * ry;
            const px = panV.x + sx, py = panV.y + sy;
            const ca = Math.cos(angRot), sa = Math.sin(angRot);
            const wx = ca * px - sa * py;
            const wy = sa * px + ca * py;
            return { x: pivot.x + wx, y: pivot.y + wy };
          }
// Diagnostics: affine start/end summary (scales/rotations/pan/anchors); logged once per transition
try {
  if (!this._affineLoggedStart && eMotion < 0.001) {
    const __affStart = {
      fromL, toL, reverse,
      anchors: {
        from: { x: Math.round(anchorFrom.x), y: Math.round(anchorFrom.y) },
        to:   { x: Math.round(anchorTo.x), y: Math.round(anchorTo.y) }
      },
      pivot: { x: Math.round(pivot.x), y: Math.round(pivot.y) },
      scales: {
        S_start: (Number.isFinite(S_start) ? S_start.toFixed(4) : S_start),
        S_end:   (Number.isFinite(S_end)   ? S_end.toFixed(4)   : S_end),
        sFrom:   (Number.isFinite(sFrom)   ? sFrom.toFixed(4)   : sFrom),
        sTo:     (Number.isFinite(sTo)     ? sTo.toFixed(4)     : sTo),
        ratio:   (Number.isFinite(safeRatio) ? safeRatio.toFixed(4) : safeRatio)
      },
      rotation: {
        alphaGoal: (Number.isFinite(alphaGoal) ? alphaGoal.toFixed(4) : alphaGoal),
        preRotTo:  (Number.isFinite(preRotTo)  ? preRotTo.toFixed(4)  : preRotTo),
        angNow:    (Number.isFinite(angNow)    ? angNow.toFixed(4)    : angNow)
      },
      pan: { x: Math.round(pan.x), y: Math.round(pan.y) },
      pose: {
        expectedFromIdentity: (reverseStrategy === 'identityStart'),
        fromIdentity: ((Math.abs(angNow) < 1e-3) && (Math.abs((sFrom) - 1) < 1e-3) && (Math.abs(pan.x - d.x) < 1) && (Math.abs(pan.y - d.y) < 1))
      }
    };
    if (window.DEBUG_AFFINE) console.debug('[AffineStartSummary]', __affStart);
    try { if (window.DEBUG_AFFINE) console.debug('[AffineStartSummaryJSON] ' + JSON.stringify(__affStart)); } catch (_) {}
    this._affineLoggedStart = true;
  }
  if (!this._affineLoggedEnd && eMotion > 0.999) {
    const __affEnd = {
      fromL, toL, reverse,
      anchors: {
        from: { x: Math.round(anchorFrom.x), y: Math.round(anchorFrom.y) },
        to:   { x: Math.round(anchorTo.x), y: Math.round(anchorTo.y) }
      },
      pivot: { x: Math.round(pivot.x), y: Math.round(pivot.y) },
      scales: {
        S_start: (Number.isFinite(S_start) ? S_start.toFixed(4) : S_start),
        S_end:   (Number.isFinite(S_end)   ? S_end.toFixed(4)   : S_end),
        sFrom:   (Number.isFinite(sFrom)   ? sFrom.toFixed(4)   : sFrom),
        sTo:     (Number.isFinite(sTo)     ? sTo.toFixed(4)     : sTo),
        ratio:   (Number.isFinite(safeRatio) ? safeRatio.toFixed(4) : safeRatio)
      },
      rotation: {
        alphaGoal: (Number.isFinite(alphaGoal) ? alphaGoal.toFixed(4) : alphaGoal),
        preRotTo:  (Number.isFinite(preRotTo)  ? preRotTo.toFixed(4)  : preRotTo),
        angNow:    (Number.isFinite(angNow)    ? angNow.toFixed(4)    : angNow)
      },
      pan: { x: Math.round(pan.x), y: Math.round(pan.y) },
      pose: {
        expectedToIdentity: true,
        toIdentity: ((Math.abs(preRotTo + angNow) < 1e-3) && (Math.abs((sTo) - 1) < 1e-3) && (Math.abs(pan.x) < 1) && (Math.abs(pan.y) < 1))
      }
    };
    if (window.DEBUG_AFFINE) console.debug('[AffineEndSummary]', __affEnd);
    try { if (window.DEBUG_AFFINE) console.debug('[AffineEndSummaryJSON] ' + JSON.stringify(__affEnd)); } catch (_) {}
    this._affineLoggedEnd = true;
  }
} catch (_) {}

          // Fades
          const fades = aff.fades || {};
          let alphaFromVal = 1;
          if (fades.from && typeof fades.from.outStart === 'number' && typeof fades.from.outEnd === 'number') {
            const p = (eMotion - fades.from.outStart) / Math.max(1e-3, (fades.from.outEnd - fades.from.outStart));
            const k = easeInOutQuad(clamp01(p));
            alphaFromVal = clamp01(1 - k);
          }
          let alphaToVal = 1;
          if (fades.to && typeof fades.to.inEnd === 'number') {
            const k = easeInOutQuad(clamp01(eMotion / Math.max(1e-3, fades.to.inEnd)));
            alphaToVal = clamp01(k);
          }

          // Hide node indices that will be animated to avoid duplicates (delegated to common when available)
          const mapping = aff.mapping || {};
          let hideFrom = new Set();
          let hideTo = new Set();
          let __mappingInfo = null;
          if (window.TransitionsCommon && typeof TransitionsCommon.computeHideSets === 'function') {
            const r = TransitionsCommon.computeHideSets(mapping, snapFrom, snapTo, fromL, toL, fromIdx, toIdx);
            hideFrom = r.hideFrom || hideFrom;
            hideTo = r.hideTo || hideTo;
            __mappingInfo = r;
          } else {
            const hf = new Set();
            const ht = new Set();
            if (mapping.mode === 'singleDoor') {
              // Dynamic source: L1 doorway (0) for 1->2, selected L2 door (fromIdx) for 2->1
              const srcIndex = (snapFrom.level === Math.min(fromL, toL)) ? 0 : fromIdx;
              hf.add(srcIndex);
              ht.add(toIdx);
            } else if (mapping.mode === 'ringToMini4') {
              // Determine ring/group sides via roles to avoid level-number checks
              const fromRoleH = (snapFrom.level === Math.min(fromL, toL)) ? 'low' : 'high';
              const ringSceneRole = (mapping.roles && mapping.roles.ringScene) ? mapping.roles.ringScene : 'low';
              const isRingFrom = (fromRoleH === ringSceneRole);
              const ringSnap = isRingFrom ? snapFrom : snapTo;
              const groupSnap = isRingFrom ? snapTo : snapFrom;
              const groupIdx = isRingFrom ? toIdx : fromIdx;
              // Hide ring nodes (0..4) in whichever scene has the ring role
              const maxRing = Math.min(4, Math.max(0, ringSnap.nodes.length - 1));
              for (let i = 0; i <= maxRing; i++) {
                if (ringSnap === snapFrom) hf.add(i); else ht.add(i);
              }
              // Hide the active group post in the opposite scene to avoid double-draw
              if (groupSnap === snapFrom) hf.add(groupIdx); else ht.add(groupIdx);
            }
            hideFrom = hf; hideTo = ht;
          }

 // Affine diagnostics placeholder (closed immediately to prevent syntax errors)
 try {} catch (_) {}
  if (!this._affineLoggedStart || !this._affineLoggedEnd) {
    const S0 = S_start, S1 = S_end;
    const sLow0 = S0, sHigh0 = S0 * safeRatio;
    const sLow1 = S1, sHigh1 = S1 * safeRatio;
    const sFrom0 = (fromRole === ratioSourceRole) ? sLow0 : sHigh0;
    const sTo0   = (toRole   === ratioSourceRole) ? sLow0 : sHigh0;
    const sFrom1 = (fromRole === ratioSourceRole) ? sLow1 : sHigh1;
    const sTo1   = (toRole   === ratioSourceRole) ? sLow1 : sHigh1;
    const dDiag = { x: (anchorFrom.x - anchorTo.x), y: (anchorFrom.y - anchorTo.y) };
    const ang0 = 0, ang1 = alphaSpin;
    const packPt = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });
    // Endpoint pan with strategy awareness for logs (must mirror the actual pan(t))
    let panStart, panEnd;
    if (reverseStrategy === 'identityStart') {
      // d -> 0 for both directions
      panStart = { x: dDiag.x, y: dDiag.y };
      panEnd   = { x: 0, y: 0 };
    } else {
      // default/forwardInverse behavior
      panStart = reverse ? { x: dDiag.x * (0 - sTo0), y: dDiag.y * (0 - sTo0) } : { x: dDiag.x, y: dDiag.y };
      panEnd   = { x: dDiag.x * (1 - sTo1), y: dDiag.y * (1 - sTo1) };
    }

    if ((mapping && mapping.mode) === 'singleDoor') {
      // Use anchors directly so endpoints align exactly at e=0 and e=1
      const s0w = worldPos({ x: anchorFrom.x, y: anchorFrom.y }, sFrom0, 0,        anchorFrom, ang0, panStart);
      const t0w = worldPos({ x: anchorTo.x,   y: anchorTo.y   }, sTo0,   preRotTo, anchorTo,   ang0, panStart);
      const s1w = worldPos({ x: anchorFrom.x, y: anchorFrom.y }, sFrom1, 0,        anchorFrom, ang1, panEnd);
      const t1w = worldPos({ x: anchorTo.x,   y: anchorTo.y   }, sTo1,   preRotTo, anchorTo,   ang1, panEnd);
      try {
        if (!this._affineOverlayLoggedStart && eMotion < 0.001) {
          const __aos = {
            mode: 'singleDoor',
            fromL, toL, reverse,
            endpoints: { src: packPt(s0w), dst: packPt(t0w) },
            doorLocal: { from: packPt(anchorFrom), to: packPt(anchorTo) },
            scales: { sFrom: Number.isFinite(sFrom0) ? sFrom0.toFixed(4) : sFrom0, sTo: Number.isFinite(sTo0) ? sTo0.toFixed(4) : sTo0 },
            rotation: { from: Number.isFinite(ang0) ? ang0.toFixed(4) : ang0, to: Number.isFinite(preRotTo + ang0) ? (preRotTo + ang0).toFixed(4) : (preRotTo + ang0) },
            pan: { x: Math.round(panStart.x), y: Math.round(panStart.y) }
          };
          if (window.DEBUG_AFFINE) console.debug('[AffineOverlayStart]', __aos);
          try { if (window.DEBUG_AFFINE) console.debug('[AffineOverlayStartJSON] ' + JSON.stringify(__aos)); } catch (_) {}
          this._affineOverlayLoggedStart = true;
        }
        if (!this._affineOverlayLoggedEnd && eMotion > 0.999) {
          const __aoe = {
            mode: 'singleDoor',
            fromL, toL, reverse,
            endpoints: { src: packPt(s1w), dst: packPt(t1w) },
            doorLocal: { from: packPt(anchorFrom), to: packPt(anchorTo) },
            scales: { sFrom: Number.isFinite(sFrom1) ? sFrom1.toFixed(4) : sFrom1, sTo: Number.isFinite(sTo1) ? sTo1.toFixed(4) : sTo1 },
            rotation: { from: Number.isFinite(ang1) ? ang1.toFixed(4) : ang1, to: Number.isFinite(preRotTo + ang1) ? (preRotTo + ang1).toFixed(4) : (preRotTo + ang1) },
            pan: { x: Math.round(panEnd.x), y: Math.round(panEnd.y) }
          };
          if (window.DEBUG_AFFINE) console.debug('[AffineOverlayEnd]', __aoe);
          try { if (window.DEBUG_AFFINE) console.debug('[AffineOverlayEndJSON] ' + JSON.stringify(__aoe)); } catch (_) {}
          this._affineOverlayLoggedEnd = true;
        }
      } catch (_) {}
    }
  }

          // Draw source (from) scene
          ctx.save();
          ctx.translate(pivot.x, pivot.y);
          ctx.rotate(angNow);
          ctx.translate(pan.x, pan.y);
          ctx.scale(sFrom, sFrom);
          ctx.translate(-anchorFrom.x, -anchorFrom.y);
          const prevA1 = ctx.globalAlpha; ctx.globalAlpha = alphaFromVal;
          drawSnapshotAff(ctx, fromL, snapFrom, hideFrom);
          ctx.globalAlpha = prevA1;
          ctx.restore();

          // Draw destination (to) scene; pre-rotate so it ends upright and starts aligned
          ctx.save();
          ctx.translate(pivot.x, pivot.y);
          ctx.rotate(angNow);
          ctx.translate(pan.x, pan.y);
          ctx.scale(sTo, sTo);
          ctx.rotate(preRotTo);
          ctx.translate(-anchorTo.x, -anchorTo.y);
          const prevA2 = ctx.globalAlpha; ctx.globalAlpha = alphaToVal;
          drawSnapshotAff(ctx, toL, snapTo, hideTo);
          ctx.globalAlpha = prevA2;
          ctx.restore();

          // Overlay trading-location motion as configured
          /* mapping precomputed above */
          if (mapping.mode === 'singleDoor') {
            // Dynamic source: L1 doorway (0) for 1->2, selected L2 door (fromIdx) for 2->1
            const srcIndex = (snapFrom.level === Math.min(fromL, toL)) ? 0 : fromIdx;
            const srcNode = snapFrom.nodes.find(n => n.i === srcIndex) || snapFrom.nodes[0];
            const dstNode = snapTo.nodes.find(n => n.i === toIdx) || snapTo.nodes[0];
            if (srcNode && dstNode) {
              // Use actual node/door circle positions so the moving circle travels along the path
              const srcWorld = worldPos({ x: srcNode.x, y: srcNode.y }, sFrom, 0,        anchorFrom, angNow, pan);
              const dstWorld = worldPos({ x: dstNode.x, y: dstNode.y }, sTo,   preRotTo, anchorTo,   angNow, pan);
              const mx = lerp(srcWorld.x, dstWorld.x, eMotion);
              const my = lerp(srcWorld.y, dstWorld.y, eMotion);
              const rStart = RADII[getNodeKind(snapFrom.level, srcIndex)] || 8;
              const rEnd = RADII[getNodeKind(snapTo.level, dstNode.i)] || 8;
              const rNow = lerp(rStart, rEnd, eMotion);
              ctx.save();
              ctx.fillStyle = FILL; ctx.strokeStyle = STROKE; ctx.lineWidth = 2;
              ctx.beginPath(); ctx.arc(mx, my, rNow, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
              ctx.restore();
              // Diagnostics for ringToMini4 overlay at start/end
  
              // Keep Level 1 location 0 label centered above the moving circle (doorway) during morph
              try {
                let labelText = '';
                if (window.locationName && window.locationName[1] && window.locationName[1][0]) {
                  labelText = window.locationName[1][0];
                } else if (window.levelData && window.levelData[1]) {
                  labelText = (window.levelData[1].locationLabel[0] || 'doorway');
                }
                if (labelText) {
                  ctx.save();
                  ctx.font = LABEL_FONT; ctx.fillStyle = STROKE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                  ctx.fillText(labelText, mx, my - (rNow + 6));
                  ctx.restore();
                }
              } catch (_) {}
            }
          } else if (mapping.mode === 'ringToMini4') {
            function angleOf(p, c) { return Math.atan2(p.y - c.y, p.x - c.x); }
            function centroidPts(arr) { if (!arr.length) return { x: 0, y: 0 }; let sx = 0, sy = 0; for (const p of arr) { sx += p.x; sy += p.y; } return { x: sx / arr.length, y: sy / arr.length }; }
            const fromRoleR2 = (snapFrom.level === Math.min(fromL, toL)) ? 'low' : 'high';
            const ringSceneRole = (mapping.roles && mapping.roles.ringScene) ? mapping.roles.ringScene : 'low';
            const isRingFrom = (fromRoleR2 === ringSceneRole);
            const ringSnap = isRingFrom ? snapFrom : snapTo;
            const groupSnap = isRingFrom ? snapTo : snapFrom;
            const groupIdx = isRingFrom ? toIdx : fromIdx;
            const gNode = groupSnap.nodes.find(n => n.i === groupIdx) || groupSnap.nodes[1] || groupSnap.nodes[0];
            const minis = (typeof window.computeGroupCirclePositions === 'function') ? window.computeGroupCirclePositions(gNode) : [{ x: gNode.x, y: gNode.y, r: 4.6 }];
            const ringNodes = [];
            for (let i = 0; i < Math.min(5, ringSnap.nodes.length); i++) {
              const n = ringSnap.nodes[i];
              ringNodes.push({ i: n.i, x: n.x, y: n.y, r: RADII[getNodeKind(ringSnap.level, n.i)] || 6 });
            }
            const bossRing = ringNodes.find(rn => rn.i === 0) || ringNodes[0];
            const bossPair = isRingFrom
              ? { fx: bossRing.x, fy: bossRing.y, fr: bossRing.r, tx: gNode.x, ty: gNode.y, tr: RADII[getNodeKind(groupSnap.level, gNode.i)] || 8 }
              : { fx: gNode.x, fy: gNode.y, fr: RADII[getNodeKind(groupSnap.level, gNode.i)] || 8, tx: bossRing.x, ty: bossRing.y, tr: bossRing.r };
            const fromSats = ringNodes.filter(rn => rn.i !== 0);
            const cFrom = centroidPts(fromSats);
            fromSats.sort((a, b) => angleOf(a, cFrom) - angleOf(b, cFrom));
            const miniSats = minis.slice();
            const cMini = centroidPts(miniSats);
            miniSats.sort((a, b) => angleOf(a, cMini) - angleOf(b, cMini));
            const pairs = [bossPair];
            for (let k = 0; k < Math.min(fromSats.length, miniSats.length); k++) {
              const f = fromSats[k], m = miniSats[k];
              if (isRingFrom) pairs.push({ fx: f.x, fy: f.y, fr: f.r, tx: m.x, ty: m.y, tr: m.r });
              else pairs.push({ fx: m.x, fy: m.y, fr: m.r, tx: f.x, ty: f.y, tr: f.r });
            }

            // Overlay endpoints diagnostics for ringToMini4 (logged once at start/end)
            try {
              const S0 = S_start, S1 = S_end;
              const sLow0 = S0, sHigh0 = S0 * safeRatio;
              const sLow1 = S1, sHigh1 = S1 * safeRatio;
              const sFrom0 = (fromRole === ratioSourceRole) ? sLow0 : sHigh0;
              const sTo0   = (toRole   === ratioSourceRole) ? sLow0 : sHigh0;
              const sFrom1 = (fromRole === ratioSourceRole) ? sLow1 : sHigh1;
              const sTo1   = (toRole   === ratioSourceRole) ? sLow1 : sHigh1;
              const d0 = { x: (anchorFrom.x - anchorTo.x), y: (anchorFrom.y - anchorTo.y) };
                            // Match the main transform pan(t) strategy
                            function __panAt(eNorm) {
                              if (reverseStrategy === 'forwardInverse') {
                                return { x: lerp(d0.x, 0, eNorm), y: lerp(d0.y, 0, eNorm) };
                              }
                              if (reverseStrategy === 'identityStart') {
                                return { x: lerp(d0.x, 0, eNorm), y: lerp(d0.y, 0, eNorm) };
                              }
                              if (reverseStrategy === 'zero') {
                                return { x: 0, y: 0 };
                              }
                              // default mirror behavior
                              return reverse
                                ? { x: lerp(0, d0.x, eNorm), y: lerp(0, d0.y, eNorm) }
                                : { x: lerp(d0.x, 0, eNorm), y: lerp(d0.y, 0, eNorm) };
                            }
              const pan0 = __panAt(0);
              const ang0 = 0, ang1 = alphaSpin;
              const pan1 = __panAt(1);
              const packPt = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });
              
              function toWorldAt(localX, localY, belongsToFromScene, useEndPhase) {
                const sF = useEndPhase ? sFrom1 : sFrom0;
                const sT = useEndPhase ? sTo1   : sTo0;
                const ang = useEndPhase ? ang1  : ang0;
                const panV = useEndPhase ? pan1 : pan0;
                if (belongsToFromScene) return worldPos({ x: localX, y: localY }, sF, 0,        anchorFrom, ang, panV);
                return worldPos({ x: localX, y: localY }, sT, preRotTo, anchorTo,   ang, panV);
              }
              // fx always belongs to the 'from' scene; tx always belongs to the 'to' scene
              // Normalize endpoints so src is ALWAYS the L0 ring side and dst is ALWAYS the L1 group side,
              // regardless of direction. This makes forward/end match reverse/start numerically.
              const useEndForStart = reverse; // reverse start should equal forward end
              const pairsStart = pairs.map(p => {
                const ringLocal  = isRingFrom ? { x: p.fx, y: p.fy } : { x: p.tx, y: p.ty };
                const groupLocal = isRingFrom ? { x: p.tx, y: p.ty } : { x: p.fx, y: p.fy };
                const ringWStart  = isRingFrom ? toWorldAt(ringLocal.x,  ringLocal.y,  true,  useEndForStart)  : toWorldAt(ringLocal.x,  ringLocal.y,  false, useEndForStart);
                const groupWStart = isRingFrom ? toWorldAt(groupLocal.x, groupLocal.y, false, useEndForStart) : toWorldAt(groupLocal.x, groupLocal.y, true,  useEndForStart);
                return { src: packPt(ringWStart), dst: packPt(groupWStart), fr: p.fr, tr: p.tr };
              });
              const useEndForEnd = !reverse; // reverse end should equal forward start
              const pairsEnd = pairs.map(p => {
                const ringLocal  = isRingFrom ? { x: p.fx, y: p.fy } : { x: p.tx, y: p.ty };
                const groupLocal = isRingFrom ? { x: p.tx, y: p.ty } : { x: p.fx, y: p.fy };
                const ringWEnd  = isRingFrom ? toWorldAt(ringLocal.x,  ringLocal.y,  true,  useEndForEnd)  : toWorldAt(ringLocal.x,  ringLocal.y,  false, useEndForEnd);
                const groupWEnd = isRingFrom ? toWorldAt(groupLocal.x, groupLocal.y, false, useEndForEnd) : toWorldAt(groupLocal.x, groupLocal.y, true,  useEndForEnd);
                return { src: packPt(ringWEnd), dst: packPt(groupWEnd), fr: p.fr, tr: p.tr };
              });
  
              // Deep-dive diagnostics for one item (boss) to compare forward/end vs reverse/start
              try {
                const p0 = pairs[0];
                if (p0) {
                  const ringLocal0  = isRingFrom ? { x: p0.fx, y: p0.fy } : { x: p0.tx, y: p0.ty };
                  const groupLocal0 = isRingFrom ? { x: p0.tx, y: p0.ty } : { x: p0.fx, y: p0.fy };
                  const ringWStart0  = isRingFrom ? toWorldAt(ringLocal0.x,  ringLocal0.y,  true,  useEndForStart)  : toWorldAt(ringLocal0.x,  ringLocal0.y,  false, useEndForStart);
                  const groupWStart0 = isRingFrom ? toWorldAt(groupLocal0.x, groupLocal0.y, false, useEndForStart) : toWorldAt(groupLocal0.x, groupLocal0.y, true,  useEndForStart);
                  const ringWEnd0    = isRingFrom ? toWorldAt(ringLocal0.x,  ringLocal0.y,  true,  useEndForEnd)    : toWorldAt(ringLocal0.x,  ringLocal0.y,  false, useEndForEnd);
                  const groupWEnd0   = isRingFrom ? toWorldAt(groupLocal0.x, groupLocal0.y, false, useEndForEnd)   : toWorldAt(groupLocal0.x, groupLocal0.y, true,  useEndForEnd);
                  if (!this._affineOverlayLoggedStart && eMotion < 0.001) {
                    const oneStart = {
                      mode: 'ringToMini4',
                      fromL, toL, reverse, item: 'boss',
                      anchors: {
                        from: { x: Math.round(anchorFrom.x), y: Math.round(anchorFrom.y) },
                        to:   { x: Math.round(anchorTo.x), y: Math.round(anchorTo.y) }
                      },
                      pivot: { x: Math.round(pivot.x), y: Math.round(pivot.y) },
                      d: { x: Math.round(pan0.x), y: Math.round(pan0.y) },
                      scales: {
                        sFrom0: Number.isFinite(sFrom0) ? sFrom0.toFixed(4) : sFrom0,
                        sTo0:   Number.isFinite(sTo0)   ? sTo0.toFixed(4)   : sTo0,
                        sFrom1: Number.isFinite(sFrom1) ? sFrom1.toFixed(4) : sFrom1,
                        sTo1:   Number.isFinite(sTo1)   ? sTo1.toFixed(4)   : sTo1
                      },
                      rotation: { preRotTo: Number.isFinite(preRotTo) ? preRotTo.toFixed(4) : preRotTo, ang0: Number.isFinite(ang0) ? ang0.toFixed(4) : ang0, ang1: Number.isFinite(ang1) ? ang1.toFixed(4) : ang1 },
                      start: {
                        ringLocal: packPt(ringLocal0),
                        groupLocal: packPt(groupLocal0),
                        ringWorld: packPt(ringWStart0),
                        groupWorld: packPt(groupWStart0)
                      }
                    };
                    try { if (window.DEBUG_AFFINE) console.debug('[AffineOneItemStartJSON] ' + JSON.stringify(oneStart)); } catch (_) {}
                  }
                  if (!this._affineOverlayLoggedEnd && eMotion > 0.999) {
                    const oneEnd = {
                      mode: 'ringToMini4',
                      fromL, toL, reverse, item: 'boss',
                      anchors: {
                        from: { x: Math.round(anchorFrom.x), y: Math.round(anchorFrom.y) },
                        to:   { x: Math.round(anchorTo.x), y: Math.round(anchorTo.y) }
                      },
                      pivot: { x: Math.round(pivot.x), y: Math.round(pivot.y) },
                      d: { x: Math.round(pan0.x), y: Math.round(pan0.y) },
                      scales: {
                        sFrom0: Number.isFinite(sFrom0) ? sFrom0.toFixed(4) : sFrom0,
                        sTo0:   Number.isFinite(sTo0)   ? sTo0.toFixed(4)   : sTo0,
                        sFrom1: Number.isFinite(sFrom1) ? sFrom1.toFixed(4) : sFrom1,
                        sTo1:   Number.isFinite(sTo1)   ? sTo1.toFixed(4)   : sTo1
                      },
                      rotation: { preRotTo: Number.isFinite(preRotTo) ? preRotTo.toFixed(4) : preRotTo, ang0: Number.isFinite(ang0) ? ang0.toFixed(4) : ang0, ang1: Number.isFinite(ang1) ? ang1.toFixed(4) : ang1 },
                      end: {
                        ringLocal: packPt(ringLocal0),
                        groupLocal: packPt(groupLocal0),
                        ringWorld: packPt(ringWEnd0),
                        groupWorld: packPt(groupWEnd0)
                      }
                    };
                    try { if (window.DEBUG_AFFINE) console.debug('[AffineOneItemEndJSON] ' + JSON.stringify(oneEnd)); } catch (_) {}
                  }
                }
              } catch (_) {}
  
              if (!this._affineOverlayLoggedStart && eMotion < 0.001) {
                const panStartLog = useEndForStart ? pan1 : pan0;
                const __ros = {
                  mode: 'ringToMini4',
                  fromL, toL, reverse,
                  pairs: pairsStart,
                  scales: { sFrom: Number.isFinite(sFrom0) ? sFrom0.toFixed(4) : sFrom0, sTo: Number.isFinite(sTo0) ? sTo0.toFixed(4) : sTo0 },
                  rotation: { from: Number.isFinite(ang0) ? ang0.toFixed(4) : ang0, to: Number.isFinite(preRotTo + ang0) ? (preRotTo + ang0).toFixed(4) : (preRotTo + ang0) },
                  pan: { x: Math.round(panStartLog.x), y: Math.round(panStartLog.y) }
                };
                if (window.DEBUG_AFFINE) console.debug('[AffineOverlayStart]', __ros);
                try { if (window.DEBUG_AFFINE) console.debug('[AffineOverlayStartJSON] ' + JSON.stringify(__ros)); } catch (_) {}
                this._affineOverlayLoggedStart = true;
              }
              if (!this._affineOverlayLoggedEnd && eMotion > 0.999) {
                const panEndLog = useEndForEnd ? pan1 : pan0;
                const __roe = {
                  mode: 'ringToMini4',
                  fromL, toL, reverse,
                  pairs: pairsEnd,
                  scales: { sFrom: Number.isFinite(sFrom1) ? sFrom1.toFixed(4) : sFrom1, sTo: Number.isFinite(sTo1) ? sTo1.toFixed(4) : sTo1 },
                  rotation: { from: Number.isFinite(ang1) ? ang1.toFixed(4) : ang1, to: Number.isFinite(preRotTo + ang1) ? (preRotTo + ang1).toFixed(4) : (preRotTo + ang1) },
                  pan: { x: Math.round(panEndLog.x), y: Math.round(panEndLog.y) }
                };
                if (window.DEBUG_AFFINE) console.debug('[AffineOverlayEnd]', __roe);
                try { if (window.DEBUG_AFFINE) console.debug('[AffineOverlayEndJSON] ' + JSON.stringify(__roe)); } catch (_) {}
                this._affineOverlayLoggedEnd = true;
              }
            } catch (_) {}

            ctx.save();
            ctx.fillStyle = FILL; ctx.strokeStyle = STROKE; ctx.lineWidth = 2;
            for (const p of pairs) {
              function toWorld(localX, localY, belongsToFromScene) {
                if (belongsToFromScene) return worldPos({ x: localX, y: localY }, sFrom, 0, anchorFrom, angNow, pan);
                return worldPos({ x: localX, y: localY }, sTo, preRotTo, anchorTo, angNow, pan);
              }
              // fx belongs to 'from' scene; tx belongs to 'to' scene
              const fxw = toWorld(p.fx, p.fy, true);
              const txw = toWorld(p.tx, p.ty, false);
              const x = lerp(fxw.x, txw.x, eMotion);
              const y = lerp(fxw.y, txw.y, eMotion);
              const r = lerp(p.fr, p.tr, eMotion);
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
            ctx.restore();
  
            // Keep Level 0 location 0 label centered above the moving boss circle during morph
            try {
              // Determine boss start and destination in local space
              const bossFromLocal = isRingFrom
                ? (ringSnap.nodes.find(n => n.i === 0) || ringSnap.nodes[0])
                : gNode; // moving toward ring boss when reverse
              const bossToLocal = isRingFrom
                ? gNode
                : (ringSnap.nodes.find(n => n.i === 0) || ringSnap.nodes[0]);
  
              function toWorld(local, belongsToFromScene) {
                if (belongsToFromScene) return worldPos({ x: local.x, y: local.y }, sFrom, 0, anchorFrom, angNow, pan);
                return worldPos({ x: local.x, y: local.y }, sTo, preRotTo, anchorTo, angNow, pan);
              }
              // Use correct scene transform for source/destination of the moving boss circle
              const bfWorld = toWorld(bossFromLocal, true);
              const btWorld = toWorld(bossToLocal, false);
              const mx = lerp(bfWorld.x, btWorld.x, eMotion);
              const my = lerp(bfWorld.y, btWorld.y, eMotion);
              // Match the moving boss circle radius exactly (use the boss pair radii)
              const bossPairIndex = 0;
              const bossFr = pairs[bossPairIndex] ? pairs[bossPairIndex].fr : (RADII[getNodeKind(isRingFrom ? ringSnap.level : groupSnap.level, isRingFrom ? 0 : gNode.i)] || 8);
              const bossTr = pairs[bossPairIndex] ? pairs[bossPairIndex].tr : (RADII[getNodeKind(isRingFrom ? groupSnap.level : ringSnap.level, isRingFrom ? gNode.i : 0)] || 8);
              const rNow = lerp(bossFr, bossTr, eMotion);
  
              let labelText = '';
              if (window.locationName && window.locationName[0] && window.locationName[0][0]) {
                labelText = window.locationName[0][0];
              } else if (window.levelData && window.levelData[0]) {
                labelText = (window.levelData[0].locationLabel[0] || 'spot');
              }
              if (labelText) {
                ctx.save();
                ctx.font = LABEL_FONT; ctx.fillStyle = STROKE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                ctx.fillText(labelText, mx, my - (rNow + 6));
                ctx.restore();
              }
            } catch (_) {}
          }
  
          // Unified path handled; specialized paths below remain as fallback
        // Legacy fallback: clusterMorph (gated by ENABLE_LEGACY_FALLBACKS)
        }

        // Custom rotation + pan + fade (data-driven by transitionType)
        // Legacy fallback: rotatePanDoorway (gated by ENABLE_LEGACY_FALLBACKS)
        // Finish
        if (t >= 1) {
          this._transitionActive = false;
          this._prevFrameCanvas = null;
          this._explicitFromSnapshot = null;
          this._preparedTransition = null;
          try {
            if (this._transitionContext) {
              const endInfo = Object.assign({}, this._transitionContext, { doneTs: Date.now() });
              if (window.DEBUG_AFFINE) console.debug('[MapTransitions] level transition end', endInfo);
            }
          } catch (_) {}
          const waiters = this._onTransitionDone.splice(0, this._onTransitionDone.length);
          for (const res of waiters) { try { res(); } catch (_) {} }
          this._transitionContext = null;
        }
      }
    },
    
    // Public helper: await current/next level transition end
    // Promise resolves when the current (or next-started) transition ends; used by orchestrators
    waitForTransition() {
      return new Promise((resolve) => {
        if (this._transitionActive) {
          this._onTransitionDone.push(resolve);
        } else {
          // Queue for the next transition that starts
          this._onNextTransitionWaiters.push(resolve);
        }
      });
    },
    
    // Public helper: prepare an explicit level transition BEFORE mutating window.currLevel
    // fromLevel/toLevel must match the levels you are transitioning between.
    // reverse (optional): pass true to force reverse of the forward spec; defaults to (fromLevel > toLevel)
    // Capture an explicit source snapshot and parameters before mutating currLevel; fixes flash/race conditions
    prepareLevelTransition(fromLevel, toLevel, fromLocIndex, toLocIndex, reverse) {
      try {
        const snap = computeSnapshotForLevel(fromLevel, this._renderer._w || (this._renderer._canvas ? this._renderer._canvas.width : 0), this._renderer._h || (this._renderer._canvas ? this._renderer._canvas.height : 0));
        this._preparedTransition = {
          fromLevel,
          toLevel,
          fromIdx: (typeof fromLocIndex === 'number' ? fromLocIndex : 0),
          toIdx: (typeof toLocIndex === 'number' ? toLocIndex : 0),
          fromSnap: snap,
          reverse: (typeof reverse === 'boolean' ? !!reverse : (fromLevel > toLevel)),
        };
        this._pendingTransitionHold = true;
        if (window.DEBUG_AFFINE) console.debug('[MapTransitions] prepared level transition', { fromLevel, toLevel, fromIdx: this._preparedTransition.fromIdx, toIdx: this._preparedTransition.toIdx, reverse: this._preparedTransition.reverse, centroidFrom: centroidOf(snap.nodes) });
      } catch (e) {
        try { console.warn('[MapTransitions] prepareLevelTransition failed', e); } catch (_) {}
        this._preparedTransition = null;
        this._pendingTransitionHold = false;
      }
    },
    
    // Update last level for transition detection
    // Mirror game state: used to infer direction for next transition
    updateLastLevel(level) {
      this._lastCurrLevel = level;
    },
    
    // Getters for transition state
    isActive() {
      return this._transitionActive;
    },
    
    isPendingHold() {
      return this._pendingTransitionHold;
    },
    
    setPendingHold(value) {
      this._pendingTransitionHold = value;
    },
    
    isPathSuppressedOnce() {
      return this._loggedPathSuppressedOnce;
    },
    
    setPathSuppressedOnce(value) {
      this._loggedPathSuppressedOnce = value;
    },
    
    hasExplicitSnapshot() {
      return !!this._explicitFromSnapshot;
    }
  };

  window.MapTransitions = MapTransitions;
})();

// Dev helper: one-click baseline runner for parity checks (optional; inert until called)
window.__dumpTransitionBaselines = async function __dumpTransitionBaselines() {
  try {
    const mt = window.MapTransitions;
    if (!mt || typeof mt.prepareLevelTransition !== 'function' || typeof mt.beginLevelTransition !== 'function' || typeof mt.waitForTransition !== 'function') {
      console.warn('[Baselines] MapTransitions not ready');
      return;
    }
    if (!mt._renderer) {
      console.warn('[Baselines] MapTransitions._renderer not set');
      return;
    }

    // Force delegation for testing without code edits
    const prevForceL0L1 = window.__FORCE_DELEGATE_L0L1;
    const prevForceL1L2 = window.__FORCE_DELEGATE_L1L2;
    window.__FORCE_DELEGATE_L0L1 = true;
    window.__FORCE_DELEGATE_L1L2 = true;

    async function run(from, to, fromIdx, toIdx, reverse) {
      mt.prepareLevelTransition(from, to, fromIdx, toIdx, reverse);
      window.currLevel = to;
      mt.beginLevelTransition(to);
      await mt.waitForTransition();
    }

    // 0→1, 1→0, 1→2, 2→1
    await run(0, 1, 0, 1, false);
    await run(1, 0, 1, 0, true);
    await run(1, 2, 1, 1, false);
    await run(2, 1, 1, 0, true);

    // Restore flags
    window.__FORCE_DELEGATE_L0L1 = prevForceL0L1;
    window.__FORCE_DELEGATE_L1L2 = prevForceL1L2;

    if (window.DEBUG_AFFINE) console.debug('[Baselines] Completed 0→1, 1→0, 1→2, 2→1 (see Affine*JSON logs above)');
  } catch (e) {
    console.warn('[Baselines] dump failed', e);
  }
};
