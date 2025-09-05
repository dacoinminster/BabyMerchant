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
          off.width = this._renderer._canvas.width;
          off.height = this._renderer._canvas.height;
          const octx = off.getContext('2d');
          octx.drawImage(this._renderer._canvas, 0, 0);
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
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const t = clamp01((now - this._transitionStart) / this._transitionDurationMs);
        const e = easeInOutQuad(t);
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
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const t = clamp01((now - this._transitionStart) / this._transitionDurationMs);
        const e = easeInOutQuad(t);
        
        const fromL = this._preparedTransition ? this._preparedTransition.fromLevel : this._lastCurrLevel;
        const toL = (window.currLevel || 0);
        // Only morph for 0<->1
        if ((fromL === 0 && toL === 1) || (fromL === 1 && toL === 0)) {
          const snapFrom = this._explicitFromSnapshot; // {nodes}
          const snapTo = computeSnapshotForLevel(toL, this._renderer._w, this._renderer._h);
          
          // Determine L1 group node and its mini cluster positions
          function groupCirclePositions(node) {
            const rdot = 4.6;
            const gap = 14;
            const below = (RADII[node.kind] + 12);
            const baseY = node.y + below;
            const baseX = node.x;
            const offsets = [-1.5 * gap, -0.5 * gap, 0.5 * gap, 1.5 * gap];
            const pts = [];
            for (let idx = 0; idx < offsets.length; idx++) {
              const dx = offsets[idx];
              const isOuter = (idx === 0 || idx === offsets.length - 1);
              const cxDot = baseX + dx;
              const cyDot = baseY - (isOuter ? rdot * 0.5 : 0); // raise outer two to suggest a semicircle
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
              try { console.debug('[MapTransitions] computed exact scaleStart L0->L1', { d0: d0.toFixed(2), d1: d1.toFixed(2), ratio: ratio.toFixed(2), boost: (this._scaleBoost||1), sStart }); } catch (_) {}
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
              try { console.debug('[MapTransitions] computed exact scaleStart L1->L0', { d0: d0.toFixed(2), d1: d1.toFixed(2), ratio: ratio.toFixed(2), boost: (this._scaleBoost||1), sStart }); } catch (_) {}
            }
          } catch (_) {}
          const cx = this._renderer._w * 0.5, cy = this._renderer._h * 0.5;
          
          function drawL1WallsFromNodes(ctx2, nodes2, alpha) {
            if (!nodes2 || !nodes2.length) return;
            let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
            for (const n of nodes2) {
              const r = RADII[n.kind] || 8;
              const labelHeight = 16;
              minX = Math.min(minX, n.x - r);
              maxX = Math.max(maxX, n.x + r);
              minY = Math.min(minY, n.y - r - labelHeight);
              maxY = Math.max(maxY, n.y + r);
            }
            const pad = 8, wallPad = 25;
            const roomLeft = Math.max(pad, minX - wallPad);
            const roomRight = Math.min(this._renderer._w - pad, maxX + wallPad);
            const roomBottom = Math.min(this._renderer._h - pad, maxY + wallPad);
            const roomTop = Math.max(pad, minY - wallPad);
            const doorGapWidth = 50;
            const doorGapCenter = this._renderer._w * 0.5;
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
    prepareLevelTransition(fromLevel, toLevel, fromLocIndex, toLocIndex) {
      try {
        const snap = computeSnapshotForLevel(fromLevel, this._renderer._w || (this._renderer._canvas ? this._renderer._canvas.width : 0), this._renderer._h || (this._renderer._canvas ? this._renderer._canvas.height : 0));
        this._preparedTransition = {
          fromLevel,
          toLevel,
          fromIdx: (typeof fromLocIndex === 'number' ? fromLocIndex : 0),
          toIdx: (typeof toLocIndex === 'number' ? toLocIndex : 0),
          fromSnap: snap,
        };
        this._pendingTransitionHold = true;
        console.debug('[MapTransitions] prepared level transition', { fromLevel, toLevel, fromIdx: this._preparedTransition.fromIdx, toIdx: this._preparedTransition.toIdx, centroidFrom: centroidOf(snap.nodes) });
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
