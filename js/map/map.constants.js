'use strict';

// Map renderer shared constants
const RADII = { baby: 6, leader: 8, doorway: 10 };
const LABEL_FONT = '10px monospace';
const STROKE = '#000';
const FILL = '#fff';
const TRANSITION_DEFAULT_MS = 700;
const TRANSITION_L0_L1_MS = 2000; // 2s total for level 0<->1 zooms
const SCALE_BOOST_L0L1 = 4.0; // push room/walls further offscreen when fully zoomed in
// Level 1 <-> 2 rotation/pan transitions are shorter and subtler
// Match L1<->L2 speed with L0<->L1
const TRANSITION_L1_L2_MS = TRANSITION_L0_L1_MS; // keep in sync
const SCALE_HINT_L1L2 = 1.25; // mild scale change during rotation/pan
