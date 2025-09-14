(function () {
  'use strict';
  /*
   * Developer notes (adjacency modules):
   * - Purpose: host only pair-specific logic for this adjacency (0↔1). Keep shared math/diagnostics in TransitionsCommon.
   * - Entry point: drawMorphTransition(ctx, env)
   *   - Read forward (lo→hi) spec from levelData[hi].transitionSpecs['lo->hi'].affine
   *   - Derive reverse via runtime direction (fromLevel > toLevel)
   *   - Use TransitionsCommon helpers:
   *       worldPos(), panFromStrategy(), resolveAnchor(), computeHideSets(),
   *       drawSnapshotAff(), computePairToMiniRatio()/computeDoorGapRatio()
   * - No level-number checks in TransitionsCommon; keep adjacency quirks local to this module.
   * - Keep console.debug diagnostics lightweight; optionally gate with window.DEBUG_AFFINE when needed.
   */
  // Transitions for adjacency 0 <-> 1 (ring <-> group minis)
  // Implementation mirrors the affine path in map.transitions.js for 0↔1 only, using TransitionsCommon helpers.
  // Not yet wired by the router; safe to load for incremental refactor.

  function clamp01(x){ return Math.max(0, Math.min(1, x)); }

  const L0L1 = {
    // Draw the 0↔1 affine morph. Returns true if handled, false if not applicable.
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
        if (!(lo === 0 && hi === 1)) return false; // only handle 0↔1

        // Resolve forward (lo->hi) spec; reverse is derived by actual direction.
        let pairSpec = null;
        try {
          const LD = (typeof window.levelData !== 'undefined' && window.levelData) ? window.levelData : null;
          const specs = (LD && LD[1] && LD[1].transitionSpecs) ? LD[1].transitionSpecs : null;
          pairSpec = specs ? specs['0->1'] : null;
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
        const anchorTo   = window.TransitionsCommon.resolveAnchor(anchorToSpec, snapTo,   { w, h }, fromL, toL, fromIdx, toIdx);

        // Rotation: 0 for 0↔1 (constant path)
        const alphaGoal = 0;
        const alphaSpin = alphaGoal;
        const preRotTo = -alphaSpin; // 0

        // Compute pairToMini ratio
        function computePairToMiniRatio() {
          // Prefer shared helper when available to centralize behavior and keep parity
          if (window.TransitionsCommon && typeof window.TransitionsCommon.computePairToMiniRatio === 'function') {
            const pair = (aff.scale && Array.isArray(aff.scale.pair)) ? aff.scale.pair : [0, 2];
            const miniIdx = (aff.scale && typeof aff.scale.miniIdx === 'number') ? aff.scale.miniIdx : 2;
            return window.TransitionsCommon.computePairToMiniRatio({
              snapFrom, snapTo, fromL, toL, fromIdx, toIdx, pair, miniIdx
            });
          }
          // Fallback local calc (legacy parity):
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
              const specMini = (typeof window.getLevel1MiniSpec === 'function') ? window.getLevel1MiniSpec()
                : { rdot: 4.6, gap: 14, belowOffset: 12, offsetMultipliers: [-1.5, -0.5, 0.5, 1.5], outerLift: 0.5 };
              const rdot = specMini.rdot || 4.6;
              const gap = specMini.gap || 14;
              const below = window.RADII[gNode.kind] + (specMini.belowOffset || 12);
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

        // Ratio & symmetric scaling
        const ratio = (aff.scale && aff.scale.mode === 'pairToMini') ? computePairToMiniRatio() : 1;
        const safeRatio = Math.max(1e-3, ratio);
        const invR = 1 / safeRatio;

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
            if (window.DEBUG_AFFINE) console.debug('[AffineStartSummary]', __affStart);
            try { if (window.DEBUG_AFFINE) console.debug('[AffineStartSummaryJSON] ' + JSON.stringify(__affStart)); } catch (_) {}
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
            if (window.DEBUG_AFFINE) console.debug('[AffineEndSummary]', __affEnd);
            try { if (window.DEBUG_AFFINE) console.debug('[AffineEndSummaryJSON] ' + JSON.stringify(__affEnd)); } catch (_) {}
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

        // Draw destination (to) scene
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

        // Overlay: ringToMini4
        if (mapping.mode === 'ringToMini4') {
          function angleOf(p, c) { return Math.atan2(p.y - c.y, p.x - c.x); }
          function centroidPts(arr) { if (!arr.length) return { x: 0, y: 0 }; let sx = 0, sy = 0; for (const p of arr) { sx += p.x; sy += p.y; } return { x: sx / arr.length, y: sy / arr.length }; }

          const fromRoleH = (snapFrom.level === lo) ? 'low' : 'high';
          const ringSceneRole = (mapping.roles && mapping.roles.ringScene) ? mapping.roles.ringScene : 'low';
          const isRingFrom = (fromRoleH === ringSceneRole);
          const ringSnap = isRingFrom ? snapFrom : snapTo;
          const groupSnap = isRingFrom ? snapTo : snapFrom;
          const groupIdx = isRingFrom ? toIdx : fromIdx;
          const gNode = groupSnap.nodes.find(n => n.i === groupIdx) || groupSnap.nodes[1] || groupSnap.nodes[0];

          const minis = (typeof window.computeGroupCirclePositions === 'function') ? window.computeGroupCirclePositions(gNode) : [{ x: gNode.x, y: gNode.y, r: 4.6 }];

          const ringNodes = [];
          for (let i = 0; i < Math.min(5, ringSnap.nodes.length); i++) {
            const n = ringSnap.nodes[i];
            ringNodes.push({ i: n.i, x: n.x, y: n.y, r: (window.RADII && window.getNodeKind) ? (window.RADII[window.getNodeKind(ringSnap.level, n.i)] || 6) : 6 });
          }
          const bossRing = ringNodes.find(rn => rn.i === 0) || ringNodes[0];
          const bossPair = isRingFrom
            ? { fx: bossRing.x, fy: bossRing.y, fr: bossRing.r, tx: gNode.x, ty: gNode.y, tr: (window.RADII && window.getNodeKind) ? (window.RADII[window.getNodeKind(groupSnap.level, gNode.i)] || 8) : 8 }
            : { fx: gNode.x, fy: gNode.y, fr: (window.RADII && window.getNodeKind) ? (window.RADII[window.getNodeKind(groupSnap.level, gNode.i)] || 8) : 8, tx: bossRing.x, ty: bossRing.y, tr: bossRing.r };

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
            function __panAt(eNorm) {
              if (reverseStrategy === 'forwardInverse') {
                return { x: (typeof window.lerp==='function'?window.lerp(d0.x,0,eNorm):(d0.x+(0-d0.x)*eNorm)), y: (typeof window.lerp==='function'?window.lerp(d0.y,0,eNorm):(d0.y+(0-d0.y)*eNorm)) };
              }
              if (reverseStrategy === 'identityStart') {
                return { x: (typeof window.lerp==='function'?window.lerp(d0.x,0,eNorm):(d0.x+(0-d0.x)*eNorm)), y: (typeof window.lerp==='function'?window.lerp(d0.y,0,eNorm):(d0.y+(0-d0.y)*eNorm)) };
              }
              if (reverseStrategy === 'zero') {
                return { x: 0, y: 0 };
              }
              return reverse
                ? { x: (typeof window.lerp==='function'?window.lerp(0,d0.x,eNorm):(0+(d0.x-0)*eNorm)), y: (typeof window.lerp==='function'?window.lerp(0,d0.y,eNorm):(0+(d0.y-0)*eNorm)) }
                : { x: (typeof window.lerp==='function'?window.lerp(d0.x,0,eNorm):(d0.x+(0-d0.x)*eNorm)), y: (typeof window.lerp==='function'?window.lerp(d0.y,0,eNorm):(d0.y+(0-d0.y)*eNorm)) };
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
              if (belongsToFromScene) return window.TransitionsCommon.worldPos({ x: localX, y: localY }, sF, 0,        anchorFrom, ang, panV, pivot);
              return window.TransitionsCommon.worldPos({ x: localX, y: localY }, sT, preRotTo, anchorTo,   ang, panV, pivot);
            }
            const useEndForStart = reverse;
            const pairsStart = pairs.map(p => {
              const ringLocal  = isRingFrom ? { x: p.fx, y: p.fy } : { x: p.tx, y: p.ty };
              const groupLocal = isRingFrom ? { x: p.tx, y: p.ty } : { x: p.fx, y: p.fy };
              const ringWStart  = isRingFrom ? toWorldAt(ringLocal.x,  ringLocal.y,  true,  useEndForStart)  : toWorldAt(ringLocal.x,  ringLocal.y,  false, useEndForStart);
              const groupWStart = isRingFrom ? toWorldAt(groupLocal.x, groupLocal.y, false, useEndForStart) : toWorldAt(groupLocal.x, groupLocal.y, true,  useEndForStart);
              return { src: packPt(ringWStart), dst: packPt(groupWStart), fr: p.fr, tr: p.tr };
            });
            const useEndForEnd = !reverse;
            const pairsEnd = pairs.map(p => {
              const ringLocal  = isRingFrom ? { x: p.fx, y: p.fy } : { x: p.tx, y: p.ty };
              const groupLocal = isRingFrom ? { x: p.tx, y: p.ty } : { x: p.fx, y: p.fy };
              const ringWEnd  = isRingFrom ? toWorldAt(ringLocal.x,  ringLocal.y,  true,  useEndForEnd)  : toWorldAt(ringLocal.x,  ringLocal.y,  false, useEndForEnd);
              const groupWEnd = isRingFrom ? toWorldAt(groupLocal.x, groupLocal.y, false, useEndForEnd) : toWorldAt(groupLocal.x, groupLocal.y, true,  useEndForEnd);
              return { src: packPt(ringWEnd), dst: packPt(groupWEnd), fr: p.fr, tr: p.tr };
            });
            if (!env._affineOverlayLoggedStart && eMotion < 0.001) {
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
              env._affineOverlayLoggedStart = true;
            }
            if (!env._affineOverlayLoggedEnd && eMotion > 0.999) {
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
              env._affineOverlayLoggedEnd = true;
            }
          } catch (_) {}
            try {
              const p0 = pairs[0];
              if (p0) {
                const ringLocal0  = isRingFrom ? { x: p0.fx, y: p0.fy } : { x: p0.tx, y: p0.ty };
                const groupLocal0 = isRingFrom ? { x: p0.tx, y: p0.ty } : { x: p0.fx, y: p0.fy };
                const ringWStart0  = isRingFrom ? toWorldAt(ringLocal0.x,  ringLocal0.y,  true,  useEndForStart)  : toWorldAt(ringLocal0.x,  ringLocal0.y,  false, useEndForStart);
                const groupWStart0 = isRingFrom ? toWorldAt(groupLocal0.x, groupLocal0.y, false, useEndForStart) : toWorldAt(groupLocal0.x, groupLocal0.y, true,  useEndForStart);
                const ringWEnd0    = isRingFrom ? toWorldAt(ringLocal0.x,  ringLocal0.y,  true,  useEndForEnd)    : toWorldAt(ringLocal0.x,  ringLocal0.y,  false, useEndForEnd);
                const groupWEnd0   = isRingFrom ? toWorldAt(groupLocal0.x, groupLocal0.y, false, useEndForEnd)   : toWorldAt(groupLocal0.x, groupLocal0.y, true,  useEndForEnd);
                if (!env._affineOverlayLoggedStart && eMotion < 0.001) {
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
                if (!env._affineOverlayLoggedEnd && eMotion > 0.999) {
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
            ctx.save();
ctx.strokeStyle = window.STROKE || '#000'; ctx.lineWidth = 2;
          for (const p of pairs) {
            // Moving circle center along world path (from-scene -> to-scene)
            const fxw = window.TransitionsCommon.worldPos({ x: p.fx, y: p.fy }, sFrom, 0,        anchorFrom, angNow, pan, pivot);
            const txw = window.TransitionsCommon.worldPos({ x: p.tx, y: p.ty }, sTo,   preRotTo, anchorTo,   angNow, pan, pivot);
            const x = (typeof window.lerp === 'function') ? window.lerp(fxw.x, txw.x, eMotion) : (fxw.x + (txw.x - fxw.x) * eMotion);
            const y = (typeof window.lerp === 'function') ? window.lerp(fxw.y, txw.y, eMotion) : (fxw.y + (txw.y - fxw.y) * eMotion);
            const r = (typeof window.lerp === 'function') ? window.lerp(p.fr, p.tr, eMotion) : (p.fr + (p.tr - p.fr) * eMotion);

            // Draw the moving marker (stroke-only to match style)
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.stroke();

            // Draw Level 0 labels (indices 1..4) above the moving circles so they track perfectly
            // Identify which ring node this pair corresponds to on the ring side, then map to L0 label text.
            try {
              // Ring-side local coordinate for this pair
              const ringLocal = isRingFrom ? { x: p.fx, y: p.fy } : { x: p.tx, y: p.ty };
              // Find matching ring node index (1..4)
              let ringIdx = -1;
              if (ringSnap && Array.isArray(ringSnap.nodes)) {
                // Use a small epsilon for float-safe matching
                const eps = 0.5;
                for (const rn of ringSnap.nodes) {
                  if (rn && rn.i > 0 && rn.i <= 4 &&
                      Math.abs(rn.x - ringLocal.x) < eps &&
                      Math.abs(rn.y - ringLocal.y) < eps) {
                    ringIdx = rn.i; break;
                  }
                }
              }
              if (ringIdx >= 1 && ringIdx <= 4) {
                // Compute label text for the L0 station
                let text = '';
                if (window.locationName && window.locationName[0] && window.locationName[0][ringIdx]) {
                  text = window.locationName[0][ringIdx];
                } else if (window.levelData && window.levelData[0]) {
                  text = (window.levelData[0].locationLabel[ringIdx] || 'spot') + (ringIdx > 0 ? (' #' + ringIdx) : '');
                }
                if (text) {
                  // Size/alpha timeline: 0->1 shrink out (reverse=false), 1->0 grow in (reverse=true)
                  const baseFontPx = (typeof window.LABEL_BASE_FONT_PX === 'number') ? window.LABEL_BASE_FONT_PX : 10;
                  const k = Math.max(0, Math.min(1, eMotion));
                  const appearing = reverse; // reverse (1->0) grows in; forward (0->1) fades out
                  const ls = Math.max(0.15, appearing ? k : (1 - k));
                  const alpha = appearing ? k : (1 - k);

                  // Keep label above the moving circle by its instantaneous radius
                  const lx = x;
                  const ly = y - (r + 6);

                  // Draw upright in screen space (preserve renderer's current transform, e.g., DPR scaling)
                  ctx.save();
                  ctx.font = Math.round(baseFontPx * ls) + 'px monospace';
                  ctx.fillStyle = (window.STROKE || '#000');
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'alphabetic';
                  const prevA = ctx.globalAlpha; ctx.globalAlpha = alpha;
                  ctx.fillText(text, lx, ly);
                  ctx.globalAlpha = prevA;
                  ctx.restore();
                }
              }
            } catch (_) {}
          }
          ctx.restore();

          // Keep Level 0 location 0 label centered above the moving boss circle during morph
          try {
            const bossFromLocal = isRingFrom ? (ringSnap.nodes.find(n => n.i === 0) || ringSnap.nodes[0]) : gNode;
            const bossToLocal   = isRingFrom ? gNode : (ringSnap.nodes.find(n => n.i === 0) || ringSnap.nodes[0]);
            const bfWorld = window.TransitionsCommon.worldPos({ x: bossFromLocal.x, y: bossFromLocal.y }, sFrom, 0, anchorFrom, angNow, pan, pivot);
            const btWorld = window.TransitionsCommon.worldPos({ x: bossToLocal.x,   y: bossToLocal.y   }, sTo,   preRotTo, anchorTo,   angNow, pan, pivot);
            const mx = (typeof window.lerp === 'function') ? window.lerp(bfWorld.x, btWorld.x, eMotion) : (bfWorld.x + (btWorld.x - bfWorld.x) * eMotion);
            const my = (typeof window.lerp === 'function') ? window.lerp(bfWorld.y, btWorld.y, eMotion) : (bfWorld.y + (btWorld.y - bfWorld.y) * eMotion);

            const bossFr = pairs[0] ? pairs[0].fr : ((window.RADII && window.getNodeKind) ? (window.RADII[window.getNodeKind(isRingFrom ? ringSnap.level : groupSnap.level, isRingFrom ? 0 : gNode.i)] || 8) : 8);
            const bossTr = pairs[0] ? pairs[0].tr : ((window.RADII && window.getNodeKind) ? (window.RADII[window.getNodeKind(isRingFrom ? groupSnap.level : ringSnap.level, isRingFrom ? gNode.i : 0)] || 8) : 8);
            const rNow = (typeof window.lerp === 'function') ? window.lerp(bossFr, bossTr, eMotion) : (bossFr + (bossTr - bossFr) * eMotion);

            let labelText = '';
            if (window.locationName && window.locationName[0] && window.locationName[0][0]) {
              labelText = window.locationName[0][0];
            } else if (window.levelData && window.levelData[0]) {
              labelText = (window.levelData[0].locationLabel[0] || 'spot');
            }
            if (labelText) {
              ctx.save();
              ctx.font = (window.LABEL_FONT || '10px monospace'); ctx.fillStyle = (window.STROKE || '#000'); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
              ctx.fillText(labelText, mx, my - (rNow + 6));
              ctx.restore();
            }
          } catch (_) {}

          // Legacy static L0 label overlay removed; labels now track moving circles directly above them.
        }
        return true;
      } catch (_) {
        return false;
      }
    }
  };

  window.MapTransitionsL0L1 = window.MapTransitionsL0L1 || L0L1;
})();