'use strict';

// Map renderer shared constants
const RADII = { baby: 6, leader: 8, doorway: 10 };
const LABEL_FONT = '10px monospace';
const STROKE = '#000';
const FILL = '#fff';
const TRANSITION_DEFAULT_MS = 700;
const TRANSITION_L0_L1_MS = 20000; // extreme slow (5x more) for debugging level 0<->1 zooms
const SCALE_BOOST_L0L1 = 4.0; // push room/walls further offscreen when fully zoomed in