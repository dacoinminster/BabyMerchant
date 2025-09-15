'use strict';

// Map renderer shared constants
const RADII = { baby: 6, leader: 8, doorway: 10 };
const LABEL_FONT = '10px monospace';
const STROKE = '#000';
const FILL = '#fff';
const TRANSITION_DEFAULT_MS = (typeof window !== 'undefined' && window.SLOW_TRANSITIONS) ? (window.TRANSITION_SLOW_MS || 12000) : (window.TRANSITION_NORMAL_MS || 2000);
const TRANSITION_L0_L1_MS = TRANSITION_DEFAULT_MS; // controlled by config.js flag
const SCALE_BOOST_L0L1 = 4.0; // push room/walls further offscreen when fully zoomed in
// Level 1 <-> 2 rotation/pan transitions are shorter and subtler
// Match L1<->L2 speed with current mode (debug slow vs normal)
const TRANSITION_L1_L2_MS = TRANSITION_DEFAULT_MS;
const SCALE_HINT_L1L2 = 1.25; // mild scale change during rotation/pan
