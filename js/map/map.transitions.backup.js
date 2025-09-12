/* Level transition system for Baby Merchant map
   - Handles level transitions with animations
   - Manages transition state and callbacks
   - Provides prepare/wait APIs for smooth transitions
*/
(function () {
  'use strict';

  // Dependencies loaded before this file:
  // - map.constants.js, map.math.js, map.layout.js, map.drawing.js

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
    _scaleBoost: SCALE_BOOST_L0L1,
    _loggedPathSuppressedOnce: false,
    _lastMorphLogStage: '',
    _lastMorphBucket: -1,
    _affineLoggedStart: false,
    _affineLoggedEnd: false,
    _affineOverlayLoggedStart: false,
    _affineOverlayLoggedEnd: false,
    
    // Game-state mirrors to detect transitions without invasive hooks
    _lastCurrLevel: 0,
    
    // Reference to mapRenderer for callbacks
    _renderer: null,
    
    init(renderer) {
      this._renderer = renderer;
      this._lastCurrLevel = (window.currLevel || 0);
    },
    
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
      // Apply scaleBoost hint (used for 0<->1); fall back to constant
      this._scaleBoost = (spec && typeof spec.scaleBoost === 'number') ? spec.scaleBoost : SCALE_BOOST_L0L1;
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
      this._lastMorphLogStage = '';
      this._lastMorphBucket = -1;
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
        console.debug('[MapTransitions] level transition start', this._transitionContext);
      } catch (_) { /* ignore logging errors */ }
    },
    
    // Draw level transition effects
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
                console.debug('[MapTransitions] level transition end', endInfo);
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

        // Unified affine morph path (pan/zoom/rotate) driven entirely by params in levelData.transitionSpecs[].affine
        if (hasAffine) {
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
            // Interpret 'fromIndex' as the forward low-level index and 'toIndex' as the forward high-level index,
            // independent of actual direction. Choose the appropriate index for the given snapshot's level.
            const lo = Math.min(fromL, toL);
            const hi = Math.max(fromL, toL);
            const idxAtLo = (fromL === lo) ? fromIdx : toIdx;
            const idxAtHi = (fromL === hi) ? fromIdx : toIdx;
            if (which === 'fromIndex') {
              return (snap && snap.level === lo) ? idxAtLo : idxAtHi;
            }
            if (which === 'toIndex') {
              return (snap && snap.level === hi) ? idxAtHi : idxAtLo;
            }
            return 0;
          }
          function resolveAnchor(desc, snap) {
            if (!desc) return { x: w * 0.5, y: h * 0.5 };
            if (desc.type === 'node') {
              const i = (desc.which === 'fixed') ? (desc.index || 0) : resolveIndex(desc.which, snap);
              const n = snap.nodes.find(nn => nn.i === i) || snap.nodes[0] || { x: w * 0.5, y: h * 0.5 };
              // No special-casing: 'node' means the node's own position.
              // Use 'doorCenterForNode' anchor type when the doorway rectangle center is required.
              return { x: n.x, y: n.y };
            }
            if (desc.type === 'doorCenterForNode') {
              const i = (desc.which === 'fixed') ? (desc.index || 0) : resolveIndex(desc.which, snap);
              const n = snap.nodes.find(nn => nn.i === i) || snap.nodes[0] || { x: w * 0.5, y: h * 0.5 };
              // Level 1: doorway rectangle center (index 0)
              try {
                if (snap.level === 1 && i === 0) {
                  const rc = MapHitTest.computeL1DoorwayRect(snap.nodes, { w, h });
                  if (rc) {
                    return { x: rc.x + rc.w * 0.5, y: rc.y + rc.h * 0.5 };
                  }
                }
              } catch (_) {}
              // Level 2: hallway wall center at node.y (left or right wall)
              try {
                const meta2 = snap.layoutMeta && snap.layoutMeta.level2;
                if (meta2) {
                  const wallX = (n.x < meta2.centerX) ? meta2.xLeft : meta2.xRight;
                  return { x: wallX, y: n.y };
                }
              } catch (_) {}
              // Fallback to node position
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
          if (reverseStrategy === 'forwardInverse') {
            // Scale-correct endpoints for exact symmetry:
            // forward:  pan(0) = d,              pan(1) = (1 - sTo(1)) * d == 0
            // reverse:  pan(0) = -sTo(0) * d,    pan(1) = (1 - sTo(1)) * d == 0
            const sToStart = (toRole === ratioSourceRole) ? S_start : (S_start * safeRatio);
            const sToEnd   = (toRole === ratioSourceRole) ? S_end   : (S_end   * safeRatio);
            const panStartVec = reverse ? { x: -sToStart * d.x, y: -sToStart * d.y }
                                        : { x: d.x,             y: d.y };
            const panEndVec   = { x: (1 - sToEnd) * d.x, y: (1 - sToEnd) * d.y };
            pan = {
              x: lerp(panStartVec.x, panEndVec.x, eMotion),
              y: lerp(panStartVec.y, panEndVec.y, eMotion)
            };
          } else if (reverseStrategy === 'identityStart') {
            // d -> 0 for both directions (source starts identity; destination ends identity)
            pan = { x: lerp(d.x, 0, eMotion), y: lerp(d.y, 0, eMotion) };
          } else if (reverseStrategy === 'zero') {
            pan = { x: 0, y: 0 };
          } else {
            // Legacy/mirror
            pan = !reverse
              ? { x: lerp(d.x, 0, eMotion), y: lerp(d.y, 0, eMotion) }
              : { x: lerp(0, d.x, eMotion), y: lerp(0, d.y, eMotion) };
          }
          // Data-driven pivot selection
          const pivotMode = (aff.pivot || 'to');
          const pivot = (pivotMode === 'from') ? { x: anchorFrom.x, y: anchorFrom.y } : { x: anchorTo.x, y: anchorTo.y };

          function worldPos(local, s, preRot, anchor, angRot, panV) {
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
    console.debug('[AffineStartSummary]', __affStart);
    try { console.debug('[AffineStartSummaryJSON] ' + JSON.stringify(__affStart)); } catch (_) {}
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
    console.debug('[AffineEndSummary]', __affEnd);
    try { console.debug('[AffineEndSummaryJSON] ' + JSON.stringify(__affEnd)); } catch (_) {}
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

          // Hide node indices that will be animated to avoid duplicates
          const mapping = aff.mapping || {};
          const hideFrom = new Set();
          const hideTo = new Set();
          if (mapping.mode === 'singleDoor') {
            // Dynamic source: L1 doorway (0) for 1->2, selected L2 door (fromIdx) for 2->1
            const srcIndex = (snapFrom.level === Math.min(fromL, toL)) ? 0 : fromIdx;
            hideFrom.add(srcIndex);
            hideTo.add(toIdx);
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
              if (ringSnap === snapFrom) hideFrom.add(i); else hideTo.add(i);
            }
            // Hide the active group post in the opposite scene to avoid double-draw
            if (groupSnap === snapFrom) hideFrom.add(groupIdx); else hideTo.add(groupIdx);
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
    const rotFrom0 = ang0, rotFrom1 = ang1;
    const rotTo0 = preRotTo + ang0, rotTo1 = preRotTo + ang1; // should end ~0
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
          console.debug('[AffineOverlayStart]', __aos);
          try { console.debug('[AffineOverlayStartJSON] ' + JSON.stringify(__aos)); } catch (_) {}
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
          console.debug('[AffineOverlayEnd]', __aoe);
          try { console.debug('[AffineOverlayEndJSON] ' + JSON.stringify(__aoe)); } catch (_) {}
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
                    try { console.debug('[AffineOneItemStartJSON] ' + JSON.stringify(oneStart)); } catch (_) {}
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
                    try { console.debug('[AffineOneItemEndJSON] ' + JSON.stringify(oneEnd)); } catch (_) {}
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
                console.debug('[AffineOverlayStart]', __ros);
                try { console.debug('[AffineOverlayStartJSON] ' + JSON.stringify(__ros)); } catch (_) {}
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
                console.debug('[AffineOverlayEnd]', __roe);
                try { console.debug('[AffineOverlayEndJSON] ' + JSON.stringify(__roe)); } catch (_) {}
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
        } else if (pairSpec && pairSpec.transitionType === 'clusterMorph') {
          const snapFrom = this._explicitFromSnapshot; // {nodes}
          const snapTo = computeSnapshotForLevel(toL, this._renderer._w, this._renderer._h);
          
          // Determine L1 group node and its mini cluster positions
          function groupCirclePositions(node) {
            const mini = (pairSpec && pairSpec.l0l1 && pairSpec.l0l1.mini) || {};
            const rdot = (typeof mini.rdot === 'number') ? mini.rdot : 4.6;
            const gap = (typeof mini.gap === 'number') ? mini.gap : 14;
            const below = (RADII[node.kind] + (typeof mini.belowOffset === 'number' ? mini.belowOffset : 12));
            const baseY = node.y + below;
            const baseX = node.x;
            const multipliers = Array.isArray(mini.offsetMultipliers) ? mini.offsetMultipliers : [-1.5, -0.5, 0.5, 1.5];
            const outerLift = (typeof mini.outerLift === 'number') ? mini.outerLift : 0.5;
            const pts = [];
            for (let idx = 0; idx < multipliers.length; idx++) {
              const dx = multipliers[idx] * gap;
              const isOuter = (idx === 0 || idx === multipliers.length - 1);
              const cxDot = baseX + dx;
              const cyDot = baseY - (isOuter ? rdot * outerLift : 0); // raise outer two to suggest a semicircle
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
              console.debug('[MapTransitions] morph pairs', { step: (t===0?'start':'end'), pairs: pairs.map(p => ({ fx: Math.round(p.fx), fy: Math.round(p.fy), tx: Math.round(p.tx), ty: Math.round(p.ty), fr: p.fr, tr: p.tr }))});
            } catch (_) {}
          }
          
          // Draw transformed background for L1 (walls + other groups) or L1 fading away
          // First, determine the destination/source group node for pivoting transforms
          const toIdxBG = (this._preparedTransition ? (fromL===0? this._preparedTransition.toIdx : this._preparedTransition.fromIdx) : 1);
          let gNodeBG = null;
          if (fromL === 0 && toL === 1) gNodeBG = snapTo.nodes.find(n => n.i === toIdxBG) || snapTo.nodes[1];
          if (fromL === 1 && toL === 0) gNodeBG = this._explicitFromSnapshot.nodes.find(n => n.i === toIdxBG) || this._explicitFromSnapshot.nodes[1];
          
          // Compute an exact scale based on d0/d1 using levelData parameters:
          // d0: distance between two low-level nodes (indices provided in spec)
          // d1: distance from selected high-level group post to one of its mini-circles (index in spec)
          let sStart = 2.6; // default fallback
          try {
            const scaleSpec = (pairSpec && pairSpec.l0l1 && pairSpec.l0l1.scaleFromIndices) || null;
            const lowLevel = Math.min(fromL, toL);
            const lowSnap = (fromL === lowLevel) ? snapFrom : snapTo;
            const pair = (scaleSpec && Array.isArray(scaleSpec.l0Pair) && scaleSpec.l0Pair.length >= 2) ? scaleSpec.l0Pair : [0, 2];
            const miniIdx = (scaleSpec && typeof scaleSpec.l1MiniIdx === 'number') ? scaleSpec.l1MiniIdx : 2;

            const a = lowSnap.nodes.find(n => n.i === pair[0]);
            const b = lowSnap.nodes.find(n => n.i === pair[1]);
            const d0 = (a && b) ? Math.hypot(b.x - a.x, b.y - a.y) : 0;

            const minis = groupCirclePositions(gNodeBG);
            const mr = minis && minis[miniIdx] ? minis[miniIdx] : null;
            const d1 = mr ? Math.hypot(mr.x - gNodeBG.x, mr.y - gNodeBG.y) : 0.0001;

            const ratio = d0 / Math.max(1e-3, d1);
            sStart = ratio * (this._scaleBoost || 1.0);
            try { console.debug('[MapTransitions] computed exact scaleStart clusterMorph', { pair, miniIdx, d0: d0.toFixed(2), d1: d1.toFixed(2), ratio: ratio.toFixed(2), boost: (this._scaleBoost||1), sStart }); } catch (_) {}
          } catch (_) {}
          const cx = this._renderer._w * 0.5, cy = this._renderer._h * 0.5;
          
          function drawL1WallsFromNodes(ctx2, nodes2, alpha) {
            if (!nodes2 || !nodes2.length) return null;
            ctx2.save();
            try {
              ctx2.globalAlpha = (typeof alpha === 'number') ? alpha : 1;
              // Use vectorized background renderer driven by levelData spec
              const dims = { w: this._renderer._w, h: this._renderer._h };
              MapBackgrounds.drawLevelBackground(ctx2, nodes2, dims, {}, 1);
            } catch (_) {}
            ctx2.restore();
            return null;
          }
          
          // Apply pivoted scale to background around the group node so it moves into view
          if (gNodeBG) {
            if (fromL === 0 && toL === 1) {
              const s = lerp(sStart, 1, e);
              ctx.save();
              ctx.translate(gNodeBG.x, gNodeBG.y); ctx.scale(s, s); ctx.translate(-gNodeBG.x, -gNodeBG.y);
              // Draw walls first
              const rcWalls = drawL1WallsFromNodes.call(this, ctx, snapTo.nodes, e);
              try { if (e < 0.02 || Math.abs(e-0.25)<0.01 || Math.abs(e-0.5)<0.01 || Math.abs(e-0.75)<0.01 || e>0.98) console.debug('[MapTransitions] L0->L1 walls bbox@e', e.toFixed(2), rcWalls); } catch(_){}
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
                  // Label above the group post (only if already visited on level 1)
                  try {
                    const lvl = 1; const idx = n.i;
                    let labelText = '';
                    const visited = (window.visitedLocation && window.visitedLocation[lvl] && window.visitedLocation[lvl][idx]);
                    if (visited && window.locationName && window.locationName[lvl] && window.locationName[lvl][idx]) {
                      labelText = window.locationName[lvl][idx];
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
              // Also draw the doorway (index 0) label fading in
              try {
                const dn = snapTo.nodes.find(n => n.i === 0);
                if (dn) {
                  let labelText = '';
                  const lvl = 1, idx = 0;
                  const visited = (window.visitedLocation && window.visitedLocation[lvl] && window.visitedLocation[lvl][idx]);
                  if (visited && window.locationName && window.locationName[lvl] && window.locationName[lvl][idx]) {
                    labelText = window.locationName[lvl][idx];
                  } else if (window.levelData && window.levelData[lvl]) {
                    labelText = (window.levelData[lvl].locationLabel[idx] || 'doorway');
                  }
                  if (labelText) {
                    const r = RADII[getNodeKind(1, 0)] || 8;
                    ctx.save();
                    ctx.globalAlpha = e;
                    ctx.font = LABEL_FONT; ctx.fillStyle = STROKE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                    ctx.fillText(labelText, dn.x, dn.y - r - 6);
                    ctx.restore();
                  }
                }
              } catch (_) {}
              ctx.restore();
            } else if (fromL === 1 && toL === 0) {
              const s = lerp(1, sStart, e);
              ctx.save();
              ctx.translate(gNodeBG.x, gNodeBG.y); ctx.scale(s, s); ctx.translate(-gNodeBG.x, -gNodeBG.y);
              // Draw walls fading out
              const rcWalls2 = drawL1WallsFromNodes.call(this, ctx, this._explicitFromSnapshot.nodes, 1 - e);
              try { if (e < 0.02 || Math.abs(e-0.25)<0.01 || Math.abs(e-0.5)<0.01 || Math.abs(e-0.75)<0.01 || e>0.98) console.debug('[MapTransitions] L1->L0 walls bbox@e', e.toFixed(2), rcWalls2); } catch(_){}
              // Draw other groups fading out (exclude the active group node) as full groups; labels only if visited
              ctx.globalAlpha = 1 - e;
              for (const n of this._explicitFromSnapshot.nodes) {
                if (n.i === toIdxBG) continue;
                drawNode(ctx, n, false, false, '', undefined);
                if (n.i > 0) {
                  const circ = groupCirclePositions(n);
                  for (const c of circ) {
                    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                  }
                  // Label above the group post (only if already visited on level 1)
                  try {
                    const lvl = 1; const idx = n.i;
                    let labelText = '';
                    const visited = (window.visitedLocation && window.visitedLocation[lvl] && window.visitedLocation[lvl][idx]);
                    if (visited && window.locationName && window.locationName[lvl] && window.locationName[lvl][idx]) {
                      labelText = window.locationName[lvl][idx];
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
              // Also draw the doorway (index 0) label fading out
              try {
                const dn = this._explicitFromSnapshot.nodes.find(n => n.i === 0);
                if (dn) {
                  let labelText = '';
                  const lvl = 1, idx = 0;
                  const visited = (window.visitedLocation && window.visitedLocation[lvl] && window.visitedLocation[lvl][idx]);
                  if (visited && window.locationName && window.locationName[lvl] && window.locationName[lvl][idx]) {
                    labelText = window.locationName[lvl][idx];
                  } else if (window.levelData && window.levelData[lvl]) {
                    labelText = (window.levelData[lvl].locationLabel[idx] || 'doorway');
                  }
                  if (labelText) {
                    const r = RADII[getNodeKind(1, 0)] || 8;
                    ctx.save();
                    ctx.globalAlpha = 1 - e;
                    ctx.font = LABEL_FONT; ctx.fillStyle = STROKE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                    ctx.fillText(labelText, dn.x, dn.y - r - 6);
                    ctx.restore();
                  }
                }
              } catch (_) {}
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
                if (idx !== 0) { // skip boss label here; handled by constant-path morph below
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
              }
              if (fromL === 1 && toL === 0 && typeof p.ti === 'number') {
                const lvl = 0, idx = p.ti;
                if (idx !== 0) { // skip boss label here; handled by constant-path morph below
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
              console.debug('[MapTransitions] morph stage', stage, {
                fromL, toL,
                pivot: gNodeBG ? { x: Math.round(gNodeBG.x), y: Math.round(gNodeBG.y) } : null,
                sStart: Number.isFinite(sStart) ? sStart.toFixed(2) : sStart,
                sNow: Number.isFinite(sNow) ? sNow.toFixed(2) : sNow,
                e: e.toFixed(2)
              });
              this._lastMorphLogStage = stage;
            }
          } catch (_) {}
          
          // Active group label scaling is suppressed for L0<->L1 transitions, to avoid duplicates; handled by constant-path morph above
          try {
            /* no-op: intentionally disabled while fromL/toL is 0<->1 */
          } catch (_) {}
        }
        
        // Custom rotation + pan + fade (data-driven by transitionType)
        if (!hasAffine && pairSpec && pairSpec.transitionType === 'rotatePanDoorway') {
          const w = this._renderer._w, h = this._renderer._h;
          const snapFrom = this._explicitFromSnapshot; // current source snapshot
          const snapTo = computeSnapshotForLevel(toL, w, h);

          // Resolve indices
          const fromIdx = (this._preparedTransition ? this._preparedTransition.fromIdx : ((typeof this._renderer._lastLocIndex === 'number') ? this._renderer._lastLocIndex : 0));
          const toIdx = (this._preparedTransition ? this._preparedTransition.toIdx : ((typeof window.locIndex === 'number') ? window.locIndex : 0));

          // Helper: draw a snapshot for a level (background + nodes)
          function drawSnapshot(ctx2, level, snap) {
            if (!snap || !Array.isArray(snap.nodes)) return;
            // Backgrounds
            try {
              MapBackgrounds.drawLevelBackground(ctx2, snap.nodes, { w, h }, snap.layoutMeta || {}, level);
            } catch (_) {}
            // Nodes + small L1 group circles
            for (const n of snap.nodes) {
              // Omit the moving source/destination node during level 1<->2 morph
              if ((fromL === 1 && toL === 2)) {
                if (level === 1 && n.i === 0) continue; // hide L1 doorway node; replaced by moving circle
                if (level === 2 && n.i === toIdx) continue; // hide target L2 doorway node
              } else if ((fromL === 2 && toL === 1)) {
                if (level === 2 && n.i === fromIdx) continue; // hide source L2 doorway node
                if (level === 1 && n.i === 0) continue; // hide L1 doorway node; replaced by moving circle
              }
              const showName = !!n.nameKnown;
              const labelText = n.label;
              const hasGossip = false;
              drawNode(ctx2, n, showName, hasGossip, labelText, undefined);
              if (level === 1 && n.i > 0) {
                if (typeof window.drawGroupMiniCircles === 'function') {
                  window.drawGroupMiniCircles(ctx2, n);
                } else {
                  const rdot = 4.6;
                  const gap = 14;
                  const below = RADII[n.kind] + 12;
                  const baseY = n.y + below;
                  const baseX = n.x;
                  const offsets = [-1.5 * gap, -0.5 * gap, 0.5 * gap, 1.5 * gap];
                  ctx2.save();
                  ctx2.fillStyle = FILL;
                  ctx2.strokeStyle = STROKE;
                  ctx2.lineWidth = 2;
                  for (let idx = 0; idx < offsets.length; idx++) {
                    const dx = offsets[idx];
                    const isOuter = (idx === 0 || idx === offsets.length - 1);
                    const cxDot = baseX + dx;
                    const cyDot = baseY - (isOuter ? rdot * 0.5 : 0);
                    ctx2.beginPath();
                    ctx2.arc(cxDot, cyDot, rdot, 0, Math.PI * 2);
                    ctx2.fill();
                    ctx2.stroke();
                  }
                  ctx2.restore();
                }
              }
            }
          }

          // Compute rotation direction and translation based on target/door side
          const cx = w * 0.5, cy = h * 0.5;
          const l2Meta = snapTo.layoutMeta || (snapTo.layoutMeta = {});
          let centerX = (l2Meta.level2 && l2Meta.level2.centerX) ? l2Meta.level2.centerX : cx;
          let doorNodeL2 = null;
          if (toL === 2) {
            doorNodeL2 = snapTo.nodes.find(n => n.i === toIdx) || snapTo.nodes[1] || snapTo.nodes[0];
          } else if (fromL === 2) {
            doorNodeL2 = snapFrom.nodes.find(n => n.i === fromIdx) || snapFrom.nodes[1] || snapFrom.nodes[0];
          }
          const isLeft = doorNodeL2 ? (doorNodeL2.x < centerX) : false;
          let alphaGoal;
          const rotAngles = (pairSpec && pairSpec.l1l2 && pairSpec.l1l2.rotationAngles) || {};
          const angLeft = (typeof rotAngles.left === 'number') ? rotAngles.left : -Math.PI / 2;
          const angRight = (typeof rotAngles.right === 'number') ? rotAngles.right : Math.PI / 2;
          const angCenter = (typeof rotAngles.center === 'number') ? rotAngles.center : 0;
          alphaGoal = (doorNodeL2 && doorNodeL2.i === 0) ? angCenter : (isLeft ? angLeft : angRight);

          // Find L1 doorway node (index 0)
          const snapL1 = (fromL === 1) ? snapFrom : computeSnapshotForLevel(1, w, h);
          const doorL1 = snapL1.nodes.find(n => n.i === 0) || { x: cx, y: cy };
          let doorCenterL1 = { x: cx, y: cy };
          try {
            const rc = MapHitTest.computeL1DoorwayRect(snapL1.nodes, { w, h });
            if (rc) doorCenterL1 = { x: rc.x + rc.w * 0.5, y: rc.y + rc.h * 0.5 };
          } catch (_) {}

          // Compute translation to align the rotated L1 doorway with the L2 doorway target
          const rotatePoint = (px, py, ang, ox, oy) => {
            const dx = px - ox, dy = py - oy;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            return { x: ox + ca * dx - sa * dy, y: oy + sa * dx + ca * dy };
          };

          // Define easing segments for fade timings (data-driven with sensible defaults)
          const fadeCfg = (pairSpec && pairSpec.l1l2 && pairSpec.l1l2.fade) || {};
          const fadeOutStart = (typeof fadeCfg.roomFadeOutStart === 'number') ? fadeCfg.roomFadeOutStart : 0.75; // for 1->2
          const fadeOutEnd = (typeof fadeCfg.roomFadeOutEnd === 'number') ? fadeCfg.roomFadeOutEnd : 1.0;       // for 1->2
          const fadeInEnd = (typeof fadeCfg.roomFadeInEnd === 'number') ? fadeCfg.roomFadeInEnd : 0.25;          // for 2->1

          // Compute door-size ratio so doorways overlap while L2 starts larger then shrinks to normal
          let ratioL1L2 = 1.0; // R = width(L1 door gap) / height(L2 door gap)
          try {
            const rc1 = MapHitTest.computeL1DoorwayRect(snapL1.nodes, { w, h });
            const w1 = rc1 ? Math.max(1, (rc1.w - 16)) : 50; // subtract margin added in computeL1DoorwayRect
            const half = ((pairSpec && pairSpec.l1l2 && typeof pairSpec.l1l2.doorGapHalf === 'number') ? pairSpec.l1l2.doorGapHalf : (MapHitTest.getL2DoorGapHalf ? MapHitTest.getL2DoorGapHalf() : 10));
            const w2 = Math.max(1, 2 * half);
            ratioL1L2 = w1 / w2;
          } catch (_) {}
          // S(t) drives both scales; L1: S(t), L2: S(t)*R. End at L2 scale=1 => S(1)=1/R
          const S = (r => lerp(1, (1 / Math.max(1e-3, r)), eMotion))(ratioL1L2);
          const sRoom = S;                // L1 scale over time (shrinks)
          const sHall = S * ratioL1L2;    // L2 scale over time (shrinks from big to 1)

          // Helper: door centers for L2 scene
          // L2 doorway center (wall x at the selected door's y)
          let doorCenterL2 = { x: cx, y: cy };
          try {
            const meta2 = (toL === 2 ? (snapTo.layoutMeta && snapTo.layoutMeta.level2) : (snapFrom.layoutMeta && snapFrom.layoutMeta.level2));
            if (meta2 && doorNodeL2) {
              const wallX = (doorNodeL2.x < meta2.centerX) ? meta2.xLeft : meta2.xRight;
              doorCenterL2 = { x: wallX, y: doorNodeL2.y };
            }
          } catch (_) {}

          // Choose destination-appropriate pivot: ensures end pose is identity for the destination
          const pivot = (fromL === 1 && toL === 2) ? doorCenterL2 : doorCenterL1;

          // Common transform pieces
          const panCfg = (pairSpec && pairSpec.l1l2 && pairSpec.l1l2.pan) || {};
          const panMag = Math.min((typeof panCfg.magMax === 'number' ? panCfg.magMax : 120), Math.max((typeof panCfg.magMin === 'number' ? panCfg.magMin : 60), Math.min(w, h) * (typeof panCfg.screenFrac === 'number' ? panCfg.screenFrac : 0.15)));
          const panSign = (isLeft ? -1 : 1);
          const panFull = panSign * panMag;

          if (fromL === 1 && toL === 2) {
            // 1 -> 2: rotate/pan both together, fade out L1 late
            const sgn = (alphaGoal >= 0 ? 1 : -1);
            const ang = (alphaGoal - sgn * Math.PI) * eMotion; // rigid rotation path
            // Move door centers from L1 position to L2 position: pan goes from dL -> 0
            const dL = { x: (doorCenterL1.x - doorCenterL2.x), y: (doorCenterL1.y - doorCenterL2.y) };
            const panX = lerp(dL.x, 0, eMotion), panY = lerp(dL.y, 0, eMotion);
            const preRotRoom = 0;
            // Keep hallway pre-rotation constant so both rotate together, but 180° flipped at start
            const preRotHall = -alphaGoal + sgn * Math.PI;

            

            // Draw L1 first (room), using identical shared transform (R(ang) -> T(pan) -> S -> R(preRot) -> align)
            ctx.save();
            ctx.translate(pivot.x, pivot.y);
            ctx.rotate(ang);
            ctx.translate(panX, panY);
            ctx.scale(sRoom, sRoom);
            ctx.rotate(preRotRoom);
            ctx.translate(-doorCenterL1.x, -doorCenterL1.y);
            let alpha = 1;
            if (eMotion >= fadeOutStart) {
              const p = (eMotion - fadeOutStart) / Math.max(1e-3, (fadeOutEnd - fadeOutStart));
              const k = easeInOutQuad(clamp01(p));
              alpha = clamp01(1 - k);
            }
            const prevA = ctx.globalAlpha; ctx.globalAlpha = alpha;
            drawSnapshot(ctx, 1, snapL1);
            ctx.globalAlpha = prevA;
            ctx.restore();

            // Draw L2 second (hallway) with identical shared transform; pre-rotated locally so it ends unrotated
            ctx.save();
            ctx.translate(pivot.x, pivot.y);
            ctx.rotate(ang);
            ctx.translate(panX, panY);
            ctx.scale(sHall, sHall);
            ctx.rotate(preRotHall);
            ctx.translate(-doorCenterL2.x, -doorCenterL2.y);
            drawSnapshot(ctx, 2, snapTo);
            ctx.restore();

            // Draw a single moving circle interpolating between the two world-space positions
            try {
              const node0L1 = snapL1.nodes.find(n => n.i === 0) || doorL1;
              const srcLocal = { x: node0L1.x, y: node0L1.y };
              const dstLocal = doorNodeL2 ? { x: doorNodeL2.x, y: doorNodeL2.y } : { x: doorCenterL2.x, y: doorCenterL2.y };
              // World transform helper: world = pivot + R(ang) * ( [pan] + S * R(pre) * (p - doorCenter) )
              function worldPos(local, s, preRot, doorCtr, angRot, pan) {
                const lx = local.x - doorCtr.x, ly = local.y - doorCtr.y;
                const cpre = Math.cos(preRot), spre = Math.sin(preRot);
                const rx = cpre * lx - spre * ly;
                const ry = spre * lx + cpre * ly;
                const sx = s * rx, sy = s * ry;
                const px = pan.x + sx, py = pan.y + sy;
                const ca = Math.cos(angRot), sa = Math.sin(angRot);
                const wx = ca * px - sa * py;
                const wy = sa * px + ca * py;
                return { x: pivot.x + wx, y: pivot.y + wy };
              }
              const pan = { x: panX, y: panY };
              const srcWorld = worldPos(srcLocal, sRoom, preRotRoom, doorCenterL1, ang, pan);
              const dstWorld = worldPos(dstLocal, sHall, preRotHall, doorCenterL2, ang, pan);
              const mx = lerp(srcWorld.x, dstWorld.x, eMotion);
              const my = lerp(srcWorld.y, dstWorld.y, eMotion);
              const rStart = RADII[getNodeKind(1, 0)] || 10;
              const rEnd = RADII[getNodeKind(2, doorNodeL2 ? doorNodeL2.i : 1)] || 8;
              const rNow = lerp(rStart, rEnd, eMotion);
              ctx.save();
              ctx.fillStyle = FILL; ctx.strokeStyle = STROKE; ctx.lineWidth = 2;
              ctx.beginPath(); ctx.arc(mx, my, rNow, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
              ctx.restore();

              // Draw moving label; keep upright; ensure exact endpoints, fixed offset mid-path
              try {
                // Resolve destination label text
                let labelText = '';
                const lvl = 2, idx = (typeof toIdx === 'number' ? toIdx : 1);
                const visited = (window.visitedLocation && window.visitedLocation[lvl] && window.visitedLocation[lvl][idx]);
                if (visited && window.locationName && window.locationName[lvl] && window.locationName[lvl][idx]) {
                  labelText = window.locationName[lvl][idx];
                } else if (window.levelData && window.levelData[lvl]) {
                  labelText = (window.levelData[lvl].locationLabel[idx] || 'door');
                  if (idx > 0 && !visited) labelText += ' #' + idx;
                }
                if (labelText) {
                  // Compute exact source/destination label anchors in world space
                  const rSrc = rStart, rDst = rEnd;
                  const srcLabelLocal = { x: srcLocal.x, y: srcLocal.y - (rSrc + 6) }; // L1 node0 centered above
                  const centerX = (snapTo.layoutMeta && snapTo.layoutMeta.level2) ? snapTo.layoutMeta.level2.centerX : cx;
                  const isLeftDoor = dstLocal.x < centerX;
                  const endAlign = isLeftDoor ? 'left' : 'right';
                  const dxEnd = isLeftDoor ? -rDst : rDst;
                  const dstLabelLocal = { x: dstLocal.x + dxEnd, y: dstLocal.y - (rDst + 6) };
                  const srcLabelWorld = worldPos(srcLabelLocal, sRoom, preRotRoom, doorCenterL1, ang, pan);
                  const dstLabelWorld = worldPos(dstLabelLocal, sHall, preRotHall, doorCenterL2, ang, pan);
                  const offSrcExact = { x: srcLabelWorld.x - srcWorld.x, y: srcLabelWorld.y - srcWorld.y };
                  const offDstExact = { x: dstLabelWorld.x - dstWorld.x, y: dstLabelWorld.y - dstWorld.y };
                  const offAbove = { x: 0, y: -(rNow + 10) };
                  // Piecewise offset: snap to exact at ends; fixed above in the middle
                  let offNow = offAbove;
                  let alignNow = 'center';
                  if (eMotion <= 0.15) {
                    const k = eMotion / 0.15; offNow = { x: lerp(offSrcExact.x, offAbove.x, k), y: lerp(offSrcExact.y, offAbove.y, k) }; alignNow = 'center';
                  } else if (eMotion >= 0.85) {
                    const k = (eMotion - 0.85) / 0.15; offNow = { x: lerp(offAbove.x, offDstExact.x, k), y: lerp(offAbove.y, offDstExact.y, k) }; alignNow = endAlign;
                  }
                  const lx = mx + offNow.x;
                  const ly = my + offNow.y;
                  ctx.save();
                  ctx.font = LABEL_FONT; ctx.fillStyle = STROKE; ctx.textBaseline = 'alphabetic';
                  ctx.textAlign = alignNow;
                  ctx.fillText(labelText, lx, ly);
                  ctx.restore();
                  // Bucketed debug log (10 samples max)
                  try {
                    const bucket = Math.min(9, Math.floor(eMotion * 10));
                    if (bucket !== this._lastMorphBucket) {
                      this._lastMorphBucket = bucket;
                      console.debug('[L1->L2 pos]', { bucket, circle: { x: Math.round(mx), y: Math.round(my) }, label: { x: Math.round(lx), y: Math.round(ly) } });
                    }
                  } catch (_) {}
                }
              } catch (_) {}
            } catch (__) {}
          } else if (fromL === 2 && toL === 1) {
            // 2 -> 1: move as one rigid piece; ensure L1 ends identity by using pivot=doorCenterL1
            // For 2->1, pan toward the room by the rotated door-center delta so L1 ends identity
            const sgn2 = (alphaGoal >= 0 ? 1 : -1);
            // Pan from L2 gameplay pose to L1 gameplay pose: -dL -> 0 (to end identity at L1)
            const dL = { x: (doorCenterL1.x - doorCenterL2.x), y: (doorCenterL1.y - doorCenterL2.y) };
            const panX = lerp(-dL.x, 0, eMotion), panY = lerp(-dL.y, 0, eMotion);
            // Flip L1 180° at start while keeping end upright (angNow(1) + preRotRoomRev == 0)
            const preRotRoomRev = -alphaGoal + sgn2 * Math.PI + Math.PI;
            const preRotHallRev = 0; // hallway starts upright

            // Choose the SHORTEST rotation arc to cancel preRotRoomRev by the end
            // targetRot = -preRotRoomRev, wrapped into [-PI, PI]
            let targetRot = -preRotRoomRev;
            if (targetRot > Math.PI) targetRot -= Math.PI * 2;
            if (targetRot < -Math.PI) targetRot += Math.PI * 2;
            const angNow = targetRot * eMotion;

            // Scales symmetric with forward mapping
            const Srev = lerp(1 / Math.max(1e-3, ratioL1L2), 1, eMotion);
            const sRoomRev = Srev;
            const sHallRev = Srev * ratioL1L2;
            const alpha = clamp01((eMotion) / Math.max(1e-3, fadeInEnd)); // fade-in window for L1

            

            // Draw L1 first (room)
            ctx.save();
            ctx.translate(pivot.x, pivot.y);
            ctx.rotate(angNow);
            ctx.translate(panX, panY);
            ctx.scale(sRoomRev, sRoomRev);
            ctx.rotate(preRotRoomRev);
            ctx.translate(-doorCenterL1.x, -doorCenterL1.y);
            const prevA = ctx.globalAlpha; ctx.globalAlpha = Math.min(1, alpha);
            drawSnapshot(ctx, 1, snapTo);
            ctx.globalAlpha = prevA;
            ctx.restore();

            // Draw L2 second (hallway)
            ctx.save();
            ctx.translate(pivot.x, pivot.y);
            ctx.rotate(angNow);
            ctx.translate(panX, panY);
            ctx.scale(sHallRev, sHallRev);
            ctx.rotate(preRotHallRev);
            ctx.translate(-doorCenterL2.x, -doorCenterL2.y);
            drawSnapshot(ctx, 2, snapFrom);
            ctx.restore();

            // Single moving circle from L2 doorway to L1 node0 in world-space
            try {
              const node0L1 = snapTo.nodes.find(n => n.i === 0) || doorL1;
              const dstLocal = { x: node0L1.x, y: node0L1.y };
              const srcLocal = doorNodeL2 ? { x: doorNodeL2.x, y: doorNodeL2.y } : { x: doorCenterL2.x, y: doorCenterL2.y };
              function worldPos(local, s, preRot, doorCtr, angRot, pan) {
                const lx = local.x - doorCtr.x, ly = local.y - doorCtr.y;
                const cpre = Math.cos(preRot), spre = Math.sin(preRot);
                const rx = cpre * lx - spre * ly;
                const ry = spre * lx + cpre * ly;
                const sx = s * rx, sy = s * ry;
                const px = pan.x + sx, py = pan.y + sy;
                const ca = Math.cos(angRot), sa = Math.sin(angRot);
                const wx = ca * px - sa * py;
                const wy = sa * px + ca * py;
                return { x: pivot.x + wx, y: pivot.y + wy };
              }
              const pan = { x: panX, y: panY };
              const srcWorld = worldPos(srcLocal, sHallRev, preRotHallRev, doorCenterL2, angNow, pan);
              const dstWorld = worldPos(dstLocal, sRoomRev, preRotRoomRev, doorCenterL1, angNow, pan);
              const mx = lerp(srcWorld.x, dstWorld.x, eMotion);
              const my = lerp(srcWorld.y, dstWorld.y, eMotion);
              const rStart = RADII[getNodeKind(2, doorNodeL2 ? doorNodeL2.i : 1)] || 8;
              const rEnd = RADII[getNodeKind(1, 0)] || 10;
              const rNow = lerp(rStart, rEnd, eMotion);
              ctx.save();
              ctx.fillStyle = FILL; ctx.strokeStyle = STROKE; ctx.lineWidth = 2;
              ctx.beginPath(); ctx.arc(mx, my, rNow, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
              ctx.restore();

              // Draw moving label; keep upright; ensure exact endpoints, fixed offset mid-path
              try {
                let labelText = '';
                const lvl = 1, idx = 0;
                const visited = (window.visitedLocation && window.visitedLocation[lvl] && window.visitedLocation[lvl][idx]);
                if (visited && window.locationName && window.locationName[lvl] && window.locationName[lvl][idx]) {
                  labelText = window.locationName[lvl][idx];
                } else if (window.levelData && window.levelData[lvl]) {
                  labelText = (window.levelData[lvl].locationLabel[idx] || 'door');
                }
                if (labelText) {
                  // Exact source/destination label anchors in world space
                  const rSrc = rStart, rDst = rEnd;
                  const centerX = (snapFrom.layoutMeta && snapFrom.layoutMeta.level2) ? snapFrom.layoutMeta.level2.centerX : cx;
                  const isLeftDoor = srcLocal.x < centerX;
                  const dxSrc = isLeftDoor ? -rSrc : rSrc; // L2 door label alignment
                  const srcLabelLocal = { x: srcLocal.x + dxSrc, y: srcLocal.y - (rSrc + 6) };
                  const dstLabelLocal = { x: dstLocal.x, y: dstLocal.y - (rDst + 6) }; // L1 node0 centered above
                  function worldPos(local, s, preRot, doorCtr, angRot, pan) {
                    const lx0 = local.x - doorCtr.x, ly0 = local.y - doorCtr.y;
                    const cpre = Math.cos(preRot), spre = Math.sin(preRot);
                    const rx = cpre * lx0 - spre * ly0;
                    const ry = spre * lx0 + cpre * ly0;
                    const sx = s * rx, sy = s * ry;
                    const px0 = pan.x + sx, py0 = pan.y + sy;
                    const ca0 = Math.cos(angRot), sa0 = Math.sin(angRot);
                    const wx0 = ca0 * px0 - sa0 * py0;
                    const wy0 = sa0 * px0 + ca0 * py0;
                    return { x: pivot.x + wx0, y: pivot.y + wy0 };
                  }
                  const pan = { x: panX, y: panY };
                  const srcLabelWorld = worldPos(srcLabelLocal, sHallRev, preRotHallRev, doorCenterL2, angNow, pan);
                  const dstLabelWorld = worldPos(dstLabelLocal, sRoomRev, preRotRoomRev, doorCenterL1, angNow, pan);
                  const offSrcExact = { x: srcLabelWorld.x - srcWorld.x, y: srcLabelWorld.y - srcWorld.y };
                  const offDstExact = { x: dstLabelWorld.x - dstWorld.x, y: dstLabelWorld.y - dstWorld.y };
                  const offAbove = { x: 0, y: -(rNow + 10) };
                  let offNow = offAbove;
                  let alignNow = isLeftDoor ? 'left' : 'right';
                  if (eMotion <= 0.15) {
                    const k = eMotion / 0.15; offNow = { x: lerp(offSrcExact.x, offAbove.x, k), y: lerp(offSrcExact.y, offAbove.y, k) }; alignNow = isLeftDoor ? 'left' : 'right';
                  } else if (eMotion >= 0.85) {
                    const k = (eMotion - 0.85) / 0.15; offNow = { x: lerp(offAbove.x, offDstExact.x, k), y: lerp(offAbove.y, offDstExact.y, k) }; alignNow = 'center';
                  } else {
                    alignNow = 'center';
                  }
                  const lx = mx + offNow.x;
                  const ly = my + offNow.y;
                  ctx.save();
                  ctx.font = LABEL_FONT; ctx.fillStyle = STROKE; ctx.textBaseline = 'alphabetic';
                  ctx.textAlign = alignNow;
                  ctx.fillText(labelText, lx, ly);
                  ctx.restore();
                  // Bucketed debug log (10 samples max)
                  try {
                    const bucket = Math.min(9, Math.floor(eMotion * 10));
                    if (bucket !== this._lastMorphBucket) {
                      this._lastMorphBucket = bucket;
                      console.debug('[L2->L1 pos]', { bucket, circle: { x: Math.round(mx), y: Math.round(my) }, label: { x: Math.round(lx), y: Math.round(ly) } });
                    }
                  } catch (_) {}
                }
              } catch (_) {}
            } catch (__) {}
          }
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
              console.debug('[MapTransitions] level transition end', endInfo);
            }
          } catch (_) {}
          const waiters = this._onTransitionDone.splice(0, this._onTransitionDone.length);
          for (const res of waiters) { try { res(); } catch (_) {} }
          this._transitionContext = null;
        }
      }
    },
    
    // Public helper: await current/next level transition end
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
        console.debug('[MapTransitions] prepared level transition', { fromLevel, toLevel, fromIdx: this._preparedTransition.fromIdx, toIdx: this._preparedTransition.toIdx, reverse: this._preparedTransition.reverse, centroidFrom: centroidOf(snap.nodes) });
      } catch (e) {
        try { console.warn('[MapTransitions] prepareLevelTransition failed', e); } catch (_) {}
        this._preparedTransition = null;
        this._pendingTransitionHold = false;
      }
    },
    
    // Update last level for transition detection
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
