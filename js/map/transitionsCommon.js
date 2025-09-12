(function () {
  'use strict';

  // Shared helpers for map transitions. This file defines window.TransitionsCommon.
  /*
   * Developer notes:
   * - This module must remain pair-agnostic. Do not include level-number checks or adjacency-specific geometry.
   * - Expose pure helpers used by pair modules and the router:
   *     worldPos(), panFromStrategy(), resolveIndex()/resolveAnchor(), drawSnapshotAff(), computeHideSets(),
   *     computePairToMiniRatio(), computeDoorGapRatio(), lerp(), clamp01()
   * - Keep helpers deterministic and side-effect free; all configuration flows through params and specs.
   * - The router and adjacency modules rely on these signatures to remain stable.
   */
  const TransitionsCommon = {
    // World-space transform: pivot + R(angRot) * ( pan + s * R(preRot) * (local - anchor) )
    worldPos(local, s, preRot, anchor, angRot, pan, pivot) {
      const lx = local.x - anchor.x, ly = local.y - anchor.y;
      const cpre = Math.cos(preRot), spre = Math.sin(preRot);
      const rx = cpre * lx - spre * ly;
      const ry = spre * lx + cpre * ly;
      const sx = s * rx, sy = s * ry;
      const px = pan.x + sx, py = pan.y + sy;
      const ca = Math.cos(angRot), sa = Math.sin(angRot);
      const wx = ca * px - sa * py;
      const wy = sa * px + ca * py;
      return { x: pivot.x + wx, y: pivot.y + wy };
    },

    // Pan strategy helper
    panFromStrategy(reverseStrategy, reverse, d, toRole, ratioSourceRole, S_start, S_end, safeRatio, e) {
      if (reverseStrategy === 'identityStart') {
        return { x: TransitionsCommon.lerp(d.x, 0, e), y: TransitionsCommon.lerp(d.y, 0, e) };
      }
      if (reverseStrategy === 'forwardInverse') {
        const sToStart = (toRole === ratioSourceRole) ? S_start : (S_start * safeRatio);
        const sToEnd   = (toRole === ratioSourceRole) ? S_end   : (S_end   * safeRatio);
        const panStart = reverse ? { x: -sToStart * d.x, y: -sToStart * d.y } : { x: d.x, y: d.y };
        const panEnd   = { x: (1 - sToEnd) * d.x, y: (1 - sToEnd) * d.y };
        return { x: TransitionsCommon.lerp(panStart.x, panEnd.x, e), y: TransitionsCommon.lerp(panStart.y, panEnd.y, e) };
      }
      if (reverseStrategy === 'zero') return { x: 0, y: 0 };
      return reverse ? { x: TransitionsCommon.lerp(0, d.x, e), y: TransitionsCommon.lerp(0, d.y, e) }
                     : { x: TransitionsCommon.lerp(d.x, 0, e), y: TransitionsCommon.lerp(d.y, 0, e) };
    },

    // Index resolver used by anchor resolvers (forward semantics lo->hi)
    resolveIndex(which, snap, fromL, toL, fromIdx, toIdx) {
      const lo = Math.min(fromL, toL), hi = Math.max(fromL, toL);
      const idxAtLo = (fromL === lo) ? fromIdx : toIdx;
      const idxAtHi = (fromL === hi) ? fromIdx : toIdx;
      if (which === 'fromIndex') return (snap && snap.level === lo) ? idxAtLo : idxAtHi;
      if (which === 'toIndex')   return (snap && snap.level === hi) ? idxAtHi : idxAtLo;
      return 0;
    },

    // Anchor resolver for common cases
    resolveAnchor(desc, snap, dims, fromL, toL, fromIdx, toIdx) {
      const w = (dims && dims.w) || 0, h = (dims && dims.h) || 0;
      if (!desc) return { x: w * 0.5, y: h * 0.5 };
      if (desc.type === 'node') {
        const i = (desc.which === 'fixed') ? (desc.index || 0) : TransitionsCommon.resolveIndex(desc.which, snap, fromL, toL, fromIdx, toIdx);
        const n = (snap.nodes.find(nn => nn.i === i) || snap.nodes[0] || { x: w * 0.5, y: h * 0.5 });
        return { x: n.x, y: n.y };
      }
      if (desc.type === 'doorCenterForNode') {
        const i = (desc.which === 'fixed') ? (desc.index || 0) : TransitionsCommon.resolveIndex(desc.which, snap, fromL, toL, fromIdx, toIdx);
        const n = (snap.nodes.find(nn => nn.i === i) || snap.nodes[0] || { x: w * 0.5, y: h * 0.5 });
        // Level 1: doorway rectangle center
        try {
          if (snap.level === 1 && i === 0 && window.MapHitTest && MapHitTest.computeL1DoorwayRect) {
            const rc = MapHitTest.computeL1DoorwayRect(snap.nodes, { w, h });
            if (rc) return { x: rc.x + rc.w * 0.5, y: rc.y + rc.h * 0.5 };
          }
        } catch (_) {}
        // Level 2: hallway wall center at node.y
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
    },

    // Snapshot draw wrapper used by both adjacencies
    drawSnapshotAff(ctx, level, snap, hideSet, dims, sceneDrawHints, fromL, toL) {
      if (!snap || !Array.isArray(snap.nodes)) return;
      try {
        if (window.MapBackgrounds && MapBackgrounds.drawLevelBackground) {
          MapBackgrounds.drawLevelBackground(ctx, snap.nodes, { w: (dims && dims.w) || 0, h: (dims && dims.h) || 0 }, snap.layoutMeta || {}, level);
        }
      } catch (_) {}
      for (const n of snap.nodes) {
        if (hideSet && hideSet.has(n.i)) continue;
        const showName = !!n.nameKnown;
        const labelText = n.label;
        const hasGossip = false;
        if (typeof window.drawNode === 'function') {
          window.drawNode(ctx, n, showName, hasGossip, labelText, undefined);
        }
        try {
          const lo = Math.min(fromL, toL);
          const role = (snap.level === lo) ? 'low' : 'high';
          const showSubs = !!(sceneDrawHints && sceneDrawHints[role] && sceneDrawHints[role].showSubLocations);
          if (showSubs && n.i > 0 && typeof window.drawGroupMiniCircles === 'function') {
            window.drawGroupMiniCircles(ctx, n);
          }
        } catch (_) {}
      }
    },

    // Compute hide sets for mapping modes to avoid duplicate drawing
    computeHideSets(mapping, snapFrom, snapTo, fromL, toL, fromIdx, toIdx) {
      const hideFrom = new Set();
      const hideTo = new Set();
      if (!mapping || !mapping.mode) return { hideFrom, hideTo };

      if (mapping.mode === 'singleDoor') {
        // Dynamic source: L1 doorway (0) for 1->2, selected L2 door (fromIdx) for 2->1
        const srcIndex = (snapFrom.level === Math.min(fromL, toL)) ? 0 : fromIdx;
        hideFrom.add(srcIndex);
        hideTo.add(toIdx);
        return { hideFrom, hideTo, singleDoor: { srcIndex } };
      }

      if (mapping.mode === 'ringToMini4') {
        // Determine ring/group sides via roles to avoid level-number checks
        const fromRoleH = (snapFrom.level === Math.min(fromL, toL)) ? 'low' : 'high';
        const ringSceneRole = (mapping.roles && mapping.roles.ringScene) ? mapping.roles.ringScene : 'low';
        const isRingFrom = (fromRoleH === ringSceneRole);
        const ringSnap = isRingFrom ? snapFrom : snapTo;
        const groupSnap = isRingFrom ? snapTo : snapFrom;
        const groupIdx = isRingFrom ? toIdx : fromIdx;

        // Hide ring nodes (0..4) in whichever scene has the ring role
        const maxRing = Math.min(4, Math.max(0, (ringSnap.nodes && ringSnap.nodes.length ? ringSnap.nodes.length - 1 : 0)));
        for (let i = 0; i <= maxRing; i++) {
          if (ringSnap === snapFrom) hideFrom.add(i);
          else hideTo.add(i);
        }
        // Hide the active group post in the opposite scene to avoid double-draw
        if (groupSnap === snapFrom) hideFrom.add(groupIdx);
        else hideTo.add(groupIdx);

        return { hideFrom, hideTo, ringToMini: { isRingFrom, ringSnapLevel: ringSnap.level, groupIdx } };
      }

      return { hideFrom, hideTo };
    },

    // Scale ratio helpers (pair-agnostic utilities used by adjacency modules)

    // Compute ratio between two L0 ring nodes distance and L1 group-to-mini distance
    // opts: { snapFrom, snapTo, fromL, toL, fromIdx, toIdx, pair:[i0,i1], miniIdx:number }
    computePairToMiniRatio(opts) {
      try {
        const o = opts || {};
        const snapFrom = o.snapFrom, snapTo = o.snapTo;
        const fromIdx = (typeof o.fromIdx === 'number') ? o.fromIdx : 0;
        const toIdx = (typeof o.toIdx === 'number') ? o.toIdx : 0;
        const pair = Array.isArray(o.pair) ? o.pair : [0, 2];
        const miniIdx = (typeof o.miniIdx === 'number') ? o.miniIdx : 2;

        // L0: ring side
        const snapL0 = (snapFrom && snapFrom.level === 0) ? snapFrom : ((snapTo && snapTo.level === 0) ? snapTo : null);
        let d0 = 1;
        if (snapL0 && Array.isArray(snapL0.nodes)) {
          const a = snapL0.nodes.find(n => n.i === pair[0]);
          const b = snapL0.nodes.find(n => n.i === pair[1]);
          d0 = (a && b) ? Math.hypot(b.x - a.x, b.y - a.y) : d0;
        }

        // L1: group side
        const snapL1 = (snapFrom && snapFrom.level === 1) ? snapFrom : ((snapTo && snapTo.level === 1) ? snapTo : null);
        let d1 = 1;
        if (snapL1 && Array.isArray(snapL1.nodes)) {
          const gIndex = (snapTo && snapTo.level === 1) ? toIdx : ((snapFrom && snapFrom.level === 1) ? fromIdx : 1);
          const gNode = snapL1.nodes.find(n => n.i === gIndex) || snapL1.nodes[1] || snapL1.nodes[0];
          let minis = null;
          if (typeof window.computeGroupCirclePositions === 'function') {
            minis = window.computeGroupCirclePositions(gNode);
          } else {
            // Fallback generator using spec-like defaults
            const specMini = (typeof window.getLevel1MiniSpec === 'function') ? window.getLevel1MiniSpec()
              : { rdot: 4.6, gap: 14, belowOffset: 12, offsetMultipliers: [-1.5, -0.5, 0.5, 1.5], outerLift: 0.5 };
            const rdot = specMini.rdot || 4.6;
            const gap = specMini.gap || 14;
            const below = (window.RADII ? (window.RADII[gNode.kind] || 8) : 8) + (specMini.belowOffset || 12);
            const baseY = gNode.y + below, baseX = gNode.x;
            const mult = specMini.offsetMultipliers || [-1.5, -0.5, 0.5, 1.5];
            const lift = (typeof specMini.outerLift === 'number') ? specMini.outerLift : 0.5;
            minis = mult.map((m, i) => {
              const isOuter = (i === 0 || i === mult.length - 1);
              return { x: baseX + m * gap, y: baseY - (isOuter ? rdot * lift : 0), r: rdot };
            });
          }
          const mr = minis && minis[miniIdx] ? minis[miniIdx] : (minis && minis[0]);
          d1 = mr ? Math.hypot(mr.x - gNode.x, mr.y - gNode.y) : d1;
        }

        return d0 / Math.max(1e-3, d1);
      } catch (_) {
        return 1;
      }
    },

    // Compute ratio between L1 doorway width and L2 door gap width
    // opts: { snapFrom, snapTo, w, h, doorGapHalf }
    computeDoorGapRatio(opts) {
      try {
        const o = opts || {};
        const snapFrom = o.snapFrom, snapTo = o.snapTo;
        const w = (typeof o.w === 'number') ? o.w : 0;
        const h = (typeof o.h === 'number') ? o.h : 0;
        const doorGapHalf = (typeof o.doorGapHalf === 'number')
          ? o.doorGapHalf
          : ((window.MapHitTest && typeof MapHitTest.getL2DoorGapHalf === 'function') ? MapHitTest.getL2DoorGapHalf() : 10);

        // L1 doorway rect width
        const snapL1 = (snapFrom && snapFrom.level === 1) ? snapFrom : ((snapTo && snapTo.level === 1) ? snapTo : null);
        let w1 = 50;
        try {
          if (snapL1 && window.MapHitTest && typeof MapHitTest.computeL1DoorwayRect === 'function') {
            const rc1 = MapHitTest.computeL1DoorwayRect(snapL1.nodes, { w, h });
            w1 = rc1 ? Math.max(1, (rc1.w - 16)) : w1; // parity with legacy subtract margin
          }
        } catch (_) {}

        const w2 = Math.max(1, 2 * doorGapHalf);
        return w1 / w2;
      } catch (_) {
        return 1;
      }
    },

    // Small numeric helpers
    lerp(a, b, t) { return a + (b - a) * t; },
    clamp01(x) { return Math.max(0, Math.min(1, x)); },
  };

  window.TransitionsCommon = window.TransitionsCommon || {};
  Object.assign(window.TransitionsCommon, TransitionsCommon);
})();