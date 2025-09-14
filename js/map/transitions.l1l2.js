(function () {
  'use strict';
  // Transitions for adjacency 1 <-> 2 (room <-> hallway)
  // Developer notes (adjacency modules):
  // - Purpose: keep only 1↔2-specific logic here; share math/diagnostics in TransitionsCommon.
  // - Entry: L1L2.drawMorphTransition(ctx, env). Read forward lo→hi spec (1->2), reverse at runtime.
  // - Anchors: use { type: 'doorCenterForNode' } with forward semantics; hook below resolves centers.
  // - What belongs where:
  //   * transitionsCommon.js: worldPos, panFromStrategy, resolveAnchor (via hook), hide sets, ratios, draws.
  //   * this file: side-angle rotation semantics, mapping.singleDoor quirks, and door-center hook.
  // - Adding a new adjacency file transitions.lNlNplus1.js:
  //   * Create a module exposing window.MapTransitionsL{N}{N+1}.drawMorphTransition()
  //   * Implement pair rules using TransitionsCommon helpers; avoid level-number checks in common.
  //   * If needed, install a TransitionsCommonHooks.* function here for adjacency-specific anchor logic.
  // Router delegation behind ENABLE_DELEGATE_L1L2 (currently true).

  function clamp01(x){ return Math.max(0, Math.min(1, x)); }
  
  // Hook: door center resolution for 1↔2 (pair-specific; avoids level-number checks in common)
  (function initHooks(){
    try {
      if (!window.TransitionsCommonHooks) window.TransitionsCommonHooks = {};
      if (typeof window.TransitionsCommonHooks.doorCenterForNode !== 'function') {
        window.TransitionsCommonHooks.doorCenterForNode = function(snap, dims, i, n) {
          // L1 doorway center from computed doorway rect
          try {
            if (snap && snap.level === 1 && window.MapHitTest && typeof MapHitTest.computeL1DoorwayRect === 'function') {
              const rc = MapHitTest.computeL1DoorwayRect(snap.nodes, dims);
              if (rc) return { x: rc.x + rc.w * 0.5, y: rc.y + rc.h * 0.5 };
            }
          } catch (_) {}
          // L2 wall center at selected door's y
          try {
            if (snap && snap.level === 2 && snap.layoutMeta && snap.layoutMeta.level2) {
              const meta2 = snap.layoutMeta.level2;
              const wallX = (n.x < meta2.centerX) ? meta2.xLeft : meta2.xRight;
              return { x: wallX, y: n.y };
            }
          } catch (_) {}
          // Fallback to node position
          return { x: n.x, y: n.y };
        };
      }
    } catch (_) {}
  })();
  
  const L1L2 = {
    // Draw the 1↔2 affine morph. Returns true if handled, false if not applicable.
    // env is expected to be MapTransitions (router facade) for access to runtime state.
    drawMorphTransition(ctx, env) {
      try {
        if (!env || !env._transitionActive || !env._explicitFromSnapshot) return false;

        const now = env._usePerfNow ? performance.now() : Date.now();
        const t = clamp01((now - env._transitionStart) / env._transitionDurationMs);
        const e = (typeof window.easeInOutQuad === 'function') ? window.easeInOutQuad(t) : t;
        const eMotion = (typeof window.easeInOutCubic === 'function') ? window.easeInOutCubic(t) : e;

        const fromL = env._preparedTransition ? env._preparedTransition.fromLevel : env._lastCurrLevel;
        const toL = (window.currLevel || 0);
        const lo = Math.min(fromL, toL), hi = Math.max(fromL, toL);
        if (!(lo === 1 && hi === 2)) return false; // only handle 1↔2

        // Resolve forward (lo->hi) spec; reverse is derived by actual direction.
        let pairSpec = null;
        try {
          const LD = (typeof window.levelData !== 'undefined' && window.levelData) ? window.levelData : null;
          const specs = (LD && LD[2] && LD[2].transitionSpecs) ? LD[2].transitionSpecs : null;
          pairSpec = specs ? specs['1->2'] : null;
        } catch (_) {}
        const aff = pairSpec && pairSpec.affine ? pairSpec.affine : null;
        if (!aff) return false;

        const reverse = (env._preparedTransition && typeof env._preparedTransition.reverse === 'boolean')
          ? env._preparedTransition.reverse : (fromL > toL);

        const w = env._renderer._w, h = env._renderer._h;
        const snapFrom = env._explicitFromSnapshot;
        const snapTo = (typeof window.computeSnapshotForLevel === 'function')
          ? window.computeSnapshotForLevel(toL, w, h) : null;

        if (!snapFrom || !snapTo) return false;

        const fromIdx = (env._preparedTransition ? env._preparedTransition.fromIdx
          : ((typeof env._renderer._lastLocIndex === 'number') ? env._renderer._lastLocIndex : 0));
        const toIdx = (env._preparedTransition ? env._preparedTransition.toIdx
          : ((typeof window.locIndex === 'number') ? window.locIndex : 0));

        // Anchors (forward semantics with reverse swap)
        const anchorFromSpec = (aff.anchors && (reverse ? aff.anchors.to : aff.anchors.from));
        const anchorToSpec   = (aff.anchors && (reverse ? aff.anchors.from : aff.anchors.to));
        const anchorFrom = window.TransitionsCommon.resolveAnchor(anchorFromSpec, snapFrom, { w, h }, fromL, toL, fromIdx, toIdx);
        const anchorTo   = window.TransitionsCommon.resolveAnchor(anchorToSpec,   snapTo,   { w, h }, fromL, toL, fromIdx, toIdx);

        // Rotation: sideAngles with alphaSpin to end upright; pre-rotate destination by -alphaSpin
        let rotAlpha = 0;
        if (aff.rotation && aff.rotation.mode === 'sideAngles') {
          // If targeting L1 doorway (toIdx==0), base side on the source L2 door (fromIdx)
          const useFrom = (typeof toIdx === 'number' && toIdx === 0);
          const refSnap = useFrom ? snapFrom : snapTo;
          const refIdx = useFrom ? fromIdx : toIdx;
          const refNode = refSnap.nodes.find(n => n.i === refIdx) || { x: w * 0.5, y: h * 0.5 };
          const centerX = (refSnap.layoutMeta && refSnap.layoutMeta.level2) ? refSnap.layoutMeta.level2.centerX : (w * 0.5);
          const isLeft = refNode.x < centerX;
          const isCenter = (!useFrom && typeof toIdx === 'number' && toIdx === 0);
          const rot = aff.rotation;
          rotAlpha = isCenter ? (rot.center || 0) : (isLeft ? (rot.left || -Math.PI / 2) : (rot.right || Math.PI / 2));
        } else if (aff.rotation && aff.rotation.mode === 'constant') {
          rotAlpha = aff.rotation.value || 0;
        }
        const alphaGoal = reverse ? -rotAlpha : rotAlpha;
        let alphaSpin = alphaGoal;
        if (aff.rotation && aff.rotation.mode === 'sideAngles') {
          const sgn = (alphaGoal >= 0 ? 1 : -1);
          alphaSpin = alphaGoal - sgn * Math.PI;
        }
        const preRotTo = -alphaSpin;

        // Scale ratio
        let ratio = 1;
        if (aff.scale && aff.scale.mode === 'doorGapRatio') {
          let half = 10;
          try {
            half = (pairSpec && pairSpec.l1l2 && typeof pairSpec.l1l2.doorGapHalf === 'number') ? pairSpec.l1l2.doorGapHalf : half;
          } catch (_) {}
          ratio = window.TransitionsCommon.computeDoorGapRatio({ snapFrom, snapTo, w, h, doorGapHalf: half });
        }
        const safeRatio = Math.max(1e-3, ratio);
        const invR = 1 / safeRatio;

        // Roles and symmetric scaling
        const fromRole = (fromL === lo) ? 'low' : 'high';
        const toRole   = (toL   === lo) ? 'low' : 'high';
        const ratioSourceRole = (aff.scale && aff.scale.source === 'high') ? 'high' : 'low';
        const S_start = (fromRole === ratioSourceRole) ? 1 : invR;
        const S_end   = (toRole   === ratioSourceRole) ? 1 : invR;
        const S = (typeof window.lerp === 'function') ? window.lerp(S_start, S_end, eMotion) : (S_start + (S_end - S_start) * eMotion);
        const sLow = S;
        const sHigh = S * safeRatio;
        const sFrom = (fromRole === ratioSourceRole) ? sLow : sHigh;
        const sTo   = (toRole   === ratioSourceRole) ? sLow : sHigh;

        const angNow = (typeof window.lerp === 'function') ? window.lerp(0, alphaSpin, eMotion) : (alphaSpin * eMotion);
        const d = { x: (anchorFrom.x - anchorTo.x), y: (anchorFrom.y - anchorTo.y) };
        const reverseStrategy = (aff.pan && aff.pan.reverseStrategy) || null;
        const pan = window.TransitionsCommon.panFromStrategy(reverseStrategy, reverse, d, toRole, ratioSourceRole, S_start, S_end, safeRatio, eMotion);

        const pivotMode = (aff.pivot || 'to');
        const pivot = (pivotMode === 'from') ? { x: anchorFrom.x, y: anchorFrom.y } : { x: anchorTo.x, y: anchorTo.y };

        // Diagnostics: affine start/end summary (logged once per transition)
        try {
          if (!env._affineLoggedStart && eMotion < 0.001) {
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
            env._affineLoggedStart = true;
          }
          if (!env._affineLoggedEnd && eMotion > 0.999) {
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
            env._affineLoggedEnd = true;
          }
        } catch (_) {}

        // Fades
        const fades = aff.fades || {};
        let alphaFromVal = 1;
        if (fades.from && typeof fades.from.outStart === 'number' && typeof fades.from.outEnd === 'number') {
          const p = (eMotion - fades.from.outStart) / Math.max(1e-3, (fades.from.outEnd - fades.from.outStart));
          const k = (typeof window.easeInOutQuad === 'function') ? window.easeInOutQuad(clamp01(p)) : clamp01(p);
          alphaFromVal = clamp01(1 - k);
        }
        let alphaToVal = 1;
        if (fades.to && typeof fades.to.inEnd === 'number') {
          const k = (typeof window.easeInOutQuad === 'function') ? window.easeInOutQuad(clamp01(eMotion / Math.max(1e-3, fades.to.inEnd))) : clamp01(eMotion / Math.max(1e-3, fades.to.inEnd));
          alphaToVal = clamp01(k);
        }

        // Hide sets
        const mapping = aff.mapping || {};
        const hs = window.TransitionsCommon.computeHideSets(mapping, snapFrom, snapTo, fromL, toL, fromIdx, toIdx);
        const hideFrom = hs.hideFrom || new Set();
        const hideTo   = hs.hideTo   || new Set();

        // Draw source (from) scene
        ctx.save();
        ctx.translate(pivot.x, pivot.y);
        ctx.rotate(angNow);
        ctx.translate(pan.x, pan.y);
        ctx.scale(sFrom, sFrom);
        ctx.translate(-anchorFrom.x, -anchorFrom.y);
        const prevA1 = ctx.globalAlpha; ctx.globalAlpha = alphaFromVal;
        window.TransitionsCommon.drawSnapshotAff(ctx, fromL, snapFrom, hideFrom, { w, h }, aff.sceneDrawHints || {}, fromL, toL);
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
        window.TransitionsCommon.drawSnapshotAff(ctx, toL, snapTo, hideTo, { w, h }, aff.sceneDrawHints || {}, fromL, toL);
        ctx.globalAlpha = prevA2;
        ctx.restore();

        // Overlay: singleDoor
        if (mapping.mode === 'singleDoor') {
          // Overlay endpoints diagnostics for singleDoor (logged once at start/end)
          try {
            const S0 = S_start, S1 = S_end;
            const sLow0 = S0, sHigh0 = S0 * safeRatio;
            const sLow1 = S1, sHigh1 = S1 * safeRatio;
            const sFrom0 = (fromRole === ratioSourceRole) ? sLow0 : sHigh0;
            const sTo0   = (toRole   === ratioSourceRole) ? sLow0 : sHigh0;
            const sFrom1 = (fromRole === ratioSourceRole) ? sLow1 : sHigh1;
            const sTo1   = (toRole   === ratioSourceRole) ? sLow1 : sHigh1;
            const dDiag = { x: (anchorFrom.x - anchorTo.x), y: (anchorFrom.y - anchorTo.y) };
            let panStart, panEnd;
            if (reverseStrategy === 'identityStart') {
              panStart = { x: dDiag.x, y: dDiag.y }; panEnd = { x: 0, y: 0 };
            } else if (reverseStrategy === 'forwardInverse') {
              const sToStart = (toRole === ratioSourceRole) ? S_start : (S_start * safeRatio);
              const sToEnd   = (toRole === ratioSourceRole) ? S_end   : (S_end   * safeRatio);
              panStart = reverse ? { x: -sToStart * dDiag.x, y: -sToStart * dDiag.y } : { x: dDiag.x, y: dDiag.y };
              panEnd   = { x: (1 - sToEnd) * dDiag.x, y: (1 - sToEnd) * dDiag.y };
            } else if (reverseStrategy === 'zero') {
              panStart = { x: 0, y: 0 }; panEnd = { x: 0, y: 0 };
            } else {
              panStart = reverse ? { x: 0, y: 0 } : { x: dDiag.x, y: dDiag.y };
              panEnd   = reverse ? { x: dDiag.x, y: dDiag.y } : { x: 0, y: 0 };
            }
            const ang0 = 0, ang1 = alphaSpin;
            const s0w = window.TransitionsCommon.worldPos({ x: anchorFrom.x, y: anchorFrom.y }, sFrom0, 0,        anchorFrom, ang0, panStart, pivot);
            const t0w = window.TransitionsCommon.worldPos({ x: anchorTo.x,   y: anchorTo.y   }, sTo0,   preRotTo, anchorTo,   ang0, panStart, pivot);
            const s1w = window.TransitionsCommon.worldPos({ x: anchorFrom.x, y: anchorFrom.y }, sFrom1, 0,        anchorFrom, ang1, panEnd,   pivot);
            const t1w = window.TransitionsCommon.worldPos({ x: anchorTo.x,   y: anchorTo.y   }, sTo1,   preRotTo, anchorTo,   ang1, panEnd,   pivot);
            if (!env._affineOverlayLoggedStart && eMotion < 0.001) {
              const __aos = {
                mode: 'singleDoor',
                fromL, toL, reverse,
                endpoints: { src: { x: Math.round(s0w.x), y: Math.round(s0w.y) }, dst: { x: Math.round(t0w.x), y: Math.round(t0w.y) } },
                doorLocal: { from: { x: Math.round(anchorFrom.x), y: Math.round(anchorFrom.y) }, to: { x: Math.round(anchorTo.x), y: Math.round(anchorTo.y) } },
                scales: { sFrom: Number.isFinite(sFrom0) ? sFrom0.toFixed(4) : sFrom0, sTo: Number.isFinite(sTo0) ? sTo0.toFixed(4) : sTo0 },
                rotation: { from: Number.isFinite(ang0) ? ang0.toFixed(4) : ang0, to: Number.isFinite(preRotTo + ang0) ? (preRotTo + ang0).toFixed(4) : (preRotTo + ang0) },
                pan: { x: Math.round(panStart.x), y: Math.round(panStart.y) }
              };
              console.debug('[AffineOverlayStart]', __aos);
              try { console.debug('[AffineOverlayStartJSON] ' + JSON.stringify(__aos)); } catch (_) {}
              env._affineOverlayLoggedStart = true;
            }
            if (!env._affineOverlayLoggedEnd && eMotion > 0.999) {
              const __aoe = {
                mode: 'singleDoor',
                fromL, toL, reverse,
                endpoints: { src: { x: Math.round(s1w.x), y: Math.round(s1w.y) }, dst: { x: Math.round(t1w.x), y: Math.round(t1w.y) } },
                doorLocal: { from: { x: Math.round(anchorFrom.x), y: Math.round(anchorFrom.y) }, to: { x: Math.round(anchorTo.x), y: Math.round(anchorTo.y) } },
                scales: { sFrom: Number.isFinite(sFrom1) ? sFrom1.toFixed(4) : sFrom1, sTo: Number.isFinite(sTo1) ? sTo1.toFixed(4) : sTo1 },
                rotation: { from: Number.isFinite(ang1) ? ang1.toFixed(4) : ang1, to: Number.isFinite(preRotTo + ang1) ? (preRotTo + ang1).toFixed(4) : (preRotTo + ang1) },
                pan: { x: Math.round(panEnd.x), y: Math.round(panEnd.y) }
              };
              console.debug('[AffineOverlayEnd]', __aoe);
              try { console.debug('[AffineOverlayEndJSON] ' + JSON.stringify(__aoe)); } catch (_) {}
              env._affineOverlayLoggedEnd = true;
            }
          } catch (_) {}

          // Single moving circle along the door path
          try {
            const srcIndex = (hs && hs.singleDoor && typeof hs.singleDoor.srcIndex === 'number')
              ? hs.singleDoor.srcIndex : ((snapFrom.level === lo) ? 0 : fromIdx);
            const srcNode = snapFrom.nodes.find(n => n.i === srcIndex) || snapFrom.nodes[0];
            const dstNode = snapTo.nodes.find(n => n.i === toIdx) || snapTo.nodes[0];
            const srcWorld = window.TransitionsCommon.worldPos({ x: srcNode.x, y: srcNode.y }, sFrom, 0,        anchorFrom, angNow, pan, pivot);
            const dstWorld = window.TransitionsCommon.worldPos({ x: dstNode.x, y: dstNode.y }, sTo,   preRotTo, anchorTo,   angNow, pan, pivot);
            const mx = (typeof window.lerp === 'function') ? window.lerp(srcWorld.x, dstWorld.x, eMotion) : (srcWorld.x + (dstWorld.x - srcWorld.x) * eMotion);
            const my = (typeof window.lerp === 'function') ? window.lerp(srcWorld.y, dstWorld.y, eMotion) : (srcWorld.y + (dstWorld.y - srcWorld.y) * eMotion);
            const rStart = (window.RADII && window.getNodeKind) ? (window.RADII[window.getNodeKind(snapFrom.level, srcIndex)] || 8) : 8;
            const rEnd = (window.RADII && window.getNodeKind) ? (window.RADII[window.getNodeKind(snapTo.level, dstNode.i)] || 8) : 8;
            const rNow = (typeof window.lerp === 'function') ? window.lerp(rStart, rEnd, eMotion) : (rStart + (rEnd - rStart) * eMotion);
            ctx.save();
            ctx.strokeStyle = (window.STROKE || '#000'); ctx.lineWidth = 2;
// Stroke-only moving marker to match L1 doorway (index 0) circle style across the entire morph.
            ctx.beginPath(); ctx.arc(mx, my, rNow, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
          } catch (_) {}
        }

        return true;
      } catch (_) {
        return false;
      }
    }
  };

  window.MapTransitionsL1L2 = window.MapTransitionsL1L2 || L1L2;
})();