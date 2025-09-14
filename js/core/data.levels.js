'use strict';

// Base prices for items by index (currency is the most expensive, index 3)
const basePrice = [1, 10, 100, 1000];

// Level configuration data (immutable via deepFreeze)
const levelData = [
  {
    levelDownMessage: 'err',
    levelDownImg: 'leveldown0.jpeg',
    levelUpMessage: 'You decide you are ready to roll to other groups of babies',
    levelUpImg: 'levelup0.jpeg',
    levelUpAwesomeness: 'You can choose your next destination and revisit places with favorable prices.',
    levelDownLabel: 'err',
    levelUpLabel: 'Roll&nbsp;to another&nbsp;group',
    discoveryMsg1: 'You bump into another ',
    discoveryMsg2: ' whom you decide should be named ',
    discoveryMsg3: '.',
    BossDiscoveryMsg1: 'You found a ',
    BossDiscoveryMsg2: ', larger than the others, who babbles a name which might be "',
    BossDiscoveryMsg3: '". Here you can buy upgrades in exchange for ',
    BossDiscoveryMsg4: '. Perhaps you can trade with the other babies to get some.',
    BossBabyImg: 'bossBaby0.jpeg',
    ArrivalMsg1: 'You arrive at ',
    ArrivalMsg2: "'s ",
    MoveMsg: 'Random limb movements propel you.',
    MoveHdr: 'Thrashing toward the unknown . . . ',
    RevisitMsg: 'You thrash your limbs with purpose.',
    RevisitHdr1: 'Thrashing toward ',
    RevisitHdr2: "'s ",
    VisitHdr1: 'Trading at ',
    VisitHdr2: ' ',
    VisitHdr3: "'s&nbsp;",
    tradeableItems: [
      'crusty boogers&nbsp;(ƀ)',
      'slimy boogers',
      'bloody boogers',
      'shards of&nbsp;glass',
    ],
    tradeableItemsSingular: [
      'crusty booger&nbsp;(ƀ)',
      'slimy booger',
      'bloody booger',
      'shard of&nbsp;glass',
    ],
    characterType: 'helpless baby',
    locomotionType: 'thrash',
    locationLabel: ['spot', 'spot', 'spot', 'spot', 'spot'],
    travelFasterUpgradeMsg: [
      ' reaches into a nearby diaper and liberally applies grease to your back.',
      ' shows you how to thrash about more efficiently.',
    ],
    travelFasterUpgradeImg: ['backgrease.jpeg', 'teachingBaby0.jpeg'],
    travelFasterUpgradeDesc: ['Back Grease', 'Super Thrash'],
    cargoUpgradeMsg: ' teaches you how to grip 100 more boogers at once.',
    cargoUpgradeImg: 'cargograsp.jpeg',
    cargoUpgradeDesc: 'Tighter Grip',
    levelUpgradeMsg:
      ' teaches you how to roll over to travel further to reach other groups of babies.',
    levelUpgradeDesc: 'Roll Over',
    levelUpgradeHeaderMsg: 'You learned to roll over!',
    levelUpgradeHeaderImg: 'rollover.jpeg',
    loseMsg: 'As you thrashed your limbs, you accidentally flung away ',
    loseImg: 'BabyLossLevel0.jpeg',
    foundMsg: 'As you thrashed your limbs, you managed to find ',
    foundImg: 'BabyFoundLevel0.jpeg',
    exploreMsg:
      'You have visited every baby in this group and are starting to get better at thrashing about.',
    exploreImg: 'BabyCircuit0.jpeg',
    backgroundSpec: {
      ops: []
    },
    numLocations: 5,
  },
  {
    levelDownMessage: 'You lie on your back and prepare to move by thrashing about',
    levelDownImg: 'leveldown1.jpeg',
    levelUpMessage: 'You decide you are ready to crawl to other rooms of babies',
    levelUpImg: 'levelup1.jpeg',
    levelUpAwesomeness: 'Combat! (Coming soon)',
    levelDownLabel: 'Enter&nbsp;',
    levelUpLabel: 'Crawl&nbsp;to another&nbsp;baby&nbsp;room',
    discoveryMsg1: 'You roll to another ',
    discoveryMsg2: ' who babbles a name which might be "',
    discoveryMsg3: '".',
    BossDiscoveryMsg1: 'You roll up to a ',
    BossDiscoveryMsg2: ', larger than the others, who babbles a name which sounds like "',
    BossDiscoveryMsg3: '". Here you can buy upgrades in exchange for ',
    BossDiscoveryMsg4: '.',
    BossBabyImg: 'bossBaby1.jpeg',
    ArrivalMsg1: 'You arrive at ',
    ArrivalMsg2: "'s ",
    MoveMsg: 'You roll awkwardly toward a new group.',
    MoveHdr: 'Rolling somewhere new . . . ',
    RevisitMsg: 'You roll determinedly.',
    RevisitHdr1: 'Rolling toward ',
    RevisitHdr2: "'s ",
    VisitHdr1: 'Trading at ',
    VisitHdr2: ' ',
    VisitHdr3: "'s&nbsp;",
    tradeableItems: ['shards of&nbsp;glass', 'paperclips', 'shiny beads', 'pacifiers'],
    tradeableItemsSingular: ['shard of&nbsp;glass', 'paperclip', 'shiny bead', 'pacifier'],
    characterType: 'wee baby',
    locomotionType: 'roll',
    locationLabel: ['doorway', 'group', 'group', 'group', 'group'],
    travelFasterUpgradeMsg: [
      ' reaches into a nearby diaper and liberally applies grease to your tummy.',
      ' shows you how to roll more efficiently.',
    ],
    travelFasterUpgradeImg: ['tummygrease.jpeg', 'teachingBaby1.jpeg'],
    travelFasterUpgradeDesc: ['Tummy Grease', 'Mega Roll'],
    cargoUpgradeMsg: ' violently stretches your cheeks. They will now hold 100 more items.',
    cargoUpgradeImg: 'cargostretch.jpeg',
    cargoUpgradeDesc: 'Stretchier Cheeks',
    levelUpgradeMsg: ' teaches you how to crawl and thereby reach other rooms.',
    levelUpgradeDesc: 'Crawl',
    levelUpgradeHeaderMsg: 'You learned to crawl!',
    levelUpgradeHeaderImg: 'crawl.jpeg',
    loseMsg: 'While rolling, you choked and accidentally swallowed ',
    loseImg: 'BabyLossLevel1.jpeg',
    foundMsg: 'While rolling, you managed to find ',
    foundImg: 'BabyFoundLevel1.jpeg',
    exploreMsg:
      'You have visited every group in this room and you notice your rolling skills have improved.',
    exploreImg: 'BabyCircuit1.jpeg',
    backgroundSpec: {
      preComputes: [
        {
          type: 'computeRoomBounds',
          pad: 8,
          wallPad: 25,
          storeAs: 'bounds'
        },
        {
          type: 'computeDoorGapLeft',
          doorGapWidth: 50,
          storeAs: 'doorGapLeft'
        },
        {
          type: 'computeDoorGapRight',
          doorGapWidth: 50,
          storeAs: 'doorGapRight'
        }
      ],
      ops: [
        {
          type: 'line',
          params: {
            x1: 'bounds.roomLeft',
            y1: 'bounds.roomTop',
            x2: 'doorGapLeft',
            y2: 'bounds.roomTop'
          },
          style: { lineWidth: 2 }
        },
        {
          type: 'line',
          params: {
            x1: 'doorGapRight',
            y1: 'bounds.roomTop',
            x2: 'bounds.roomRight',
            y2: 'bounds.roomTop'
          },
          style: { lineWidth: 2 }
        },
        {
          type: 'line',
          params: {
            x1: 'bounds.roomLeft',
            y1: 'bounds.roomTop',
            x2: 'bounds.roomLeft',
            y2: 'bounds.roomBottom'
          },
          style: { lineWidth: 2 }
        },
        {
          type: 'line',
          params: {
            x1: 'bounds.roomRight',
            y1: 'bounds.roomTop',
            x2: 'bounds.roomRight',
            y2: 'bounds.roomBottom'
          },
          style: { lineWidth: 2 }
        },
        {
          type: 'line',
          params: {
            x1: 'bounds.roomLeft',
            y1: 'bounds.roomBottom',
            x2: 'bounds.roomRight',
            y2: 'bounds.roomBottom'
          },
          style: { lineWidth: 2 }
        },
        {
          type: 'line',
          params: {
            x1: 'doorGapLeft',
            y1: 'bounds.roomTop',
            x2: 'doorGapLeft - 12',
            y2: 'bounds.roomTop + 12'
          },
          style: { lineWidth: 3 }
        },
        {
          type: 'line',
          params: {
            x1: 'doorGapRight',
            y1: 'bounds.roomTop',
            x2: 'doorGapRight + 12',
            y2: 'bounds.roomTop + 12'
          },
          style: { lineWidth: 3 }
        }
      ]
    },
    transitionSpecs: {
      '0->1': {
        durationMs: 12000,
        scaleBoost: 4.0,
        l0l1: {
          mini: { rdot: 4.6, gap: 14, belowOffset: 12, offsetMultipliers: [-1.5, -0.5, 0.5, 1.5], outerLift: 0.5 },
          scaleFromIndices: { l0Pair: [0, 2], l1MiniIdx: 2 },
          mapping: { strategy: 'angleSort' }
        },
        // Unified affine spec (pan/zoom/rotate + anchor alignment + post mapping)
        affine: {
          anchors: {
            from: { type: 'node', which: 'fixed', index: 0 },     // L0 boss
            to:   { type: 'node', which: 'toIndex' }               // target L1 group post (dynamic)
          },
          rotation: { mode: 'constant', value: 0 },
          scale: { mode: 'pairToMini', pair: [0, 2], miniIdx: 2, source: 'low' }, // numerator comes from low scene
          pivot: 'to',
          pan: { reverseStrategy: 'identityStart' },
          sceneDrawHints: {
            low:  { showSubLocations: false },
            high: { showSubLocations: true }
          },
          fades: { from: { outStart: 0.75, outEnd: 1.0 }, to: { inEnd: 0.25 } },
          mapping: {
            mode: 'ringToMini4',
            roles: { ringScene: 'low', groupScene: 'high' }
          }
        }
      },
      '1->0': {
        durationMs: 12000,
        scaleBoost: 4.0,
        l0l1: {
          mini: { rdot: 4.6, gap: 14, belowOffset: 12, offsetMultipliers: [-1.5, -0.5, 0.5, 1.5], outerLift: 0.5 },
          scaleFromIndices: { l0Pair: [0, 2], l1MiniIdx: 2 },
          mapping: { strategy: 'angleSort' }
        },
        // Unified affine spec
        affine: {
          anchors: {
            from: { type: 'node', which: 'fromIndex' },            // active L1 group (dynamic)
            to:   { type: 'node', which: 'fixed', index: 0 }       // L0 boss
          },
          rotation: { mode: 'constant', value: 0 },
          scale: { mode: 'pairToMini', pair: [0, 2], miniIdx: 2, source: 'low' },
          pivot: 'to',
          pan: { reverseStrategy: 'identityStart' },
          sceneDrawHints: {
            low:  { showSubLocations: false },
            high: { showSubLocations: true }
          },
          fades: { from: { outStart: 0.75, outEnd: 1.0 }, to: { inEnd: 0.25 } },
          mapping: {
            mode: 'ringToMini4',
            roles: { ringScene: 'low', groupScene: 'high' }
          }
        }
      }
    },
    numLocations: 5,
  },
  {
    levelDownMessage: 'You lie down, and prepare to move by rolling over',
    levelDownImg: 'leveldown2.jpeg',
    levelUpMessage:
      'You decide you are ready to ride the elevator to visit other floors full of babies',
    levelUpImg: 'levelup2.jpeg',
    levelUpAwesomeness: '?????? (TBD, coming eventually)',
    levelDownLabel: 'Enter&nbsp;',
    levelUpLabel: 'Use Elevator',
    discoveryMsg1: 'You crawl to another ',
    discoveryMsg2: ' who babbles a name which sounds like "',
    discoveryMsg3: '".',
    BossDiscoveryMsg1: 'You crawl up to a ',
    BossDiscoveryMsg2: ', larger than the others, who babbles that their name is "',
    BossDiscoveryMsg3: '". Here you can buy upgrades in exchange for ',
    BossDiscoveryMsg4: '.',
    BossBabyImg: 'bossBaby2.jpeg',
    ArrivalMsg1: 'You arrive at ',
    ArrivalMsg2: "'s ",
    MoveMsg: 'You crawl aimlessly toward a new doorway.',
    MoveHdr: 'Crawling somwhere new . . . ',
    RevisitMsg: 'You crawl steadily.',
    RevisitHdr1: 'Crawling toward ',
    RevisitHdr2: "'s ",
    VisitHdr1: 'Trading at ',
    VisitHdr2: ' ',
    VisitHdr3: "'s&nbsp;",
    tradeableItems: ['pacifiers', 'building blocks', 'toy cars', 'candies'],
    tradeableItemsSingular: ['pacifier', 'building block', 'toy car', 'candy'],
    characterType: 'lil baby',
    locomotionType: 'crawl',
    locationLabel: ['elevator', 'doorway', 'doorway', 'doorway', 'doorway'],
    travelFasterUpgradeMsg: [
      ' reaches into a nearby diaper and liberally applies grease to your elbows.',
      ' shows you how to crawl more efficiently.',
    ],
    travelFasterUpgradeImg: ['elbowgrease.jpeg', 'teachingBaby2.jpeg'],
    travelFasterUpgradeDesc: ['Elbow Grease', 'Hyper Crawl'],
    cargoUpgradeMsg: ' provides you with a roomier diaper.',
    cargoUpgradeImg: 'cargodiaper.jpeg',
    cargoUpgradeDesc: 'Bigger Diaper',
    levelUpgradeMsg: ' teaches you how to push elevator buttons to access other floors.',
    levelUpgradeDesc: 'Use Elevator',
    levelUpgradeHeaderMsg: 'You learned to use the elevator!',
    levelUpgradeHeaderImg: 'elevator.jpeg',
    loseMsg: 'Your diaper loosened while crawling, and you lost ',
    loseImg: 'BabyLossLevel2.jpeg',
    foundMsg: 'You kept out a sharp eye while crawling and managed to find ',
    foundImg: 'BabyFoundLevel2.jpeg',
    exploreMsg:
      'You have visited every room on this floor and you notice your crawling skills have improved.',
    exploreImg: 'BabyCircuit2.jpeg',
    backgroundSpec: {
      preComputes: [
        { type: 'computeLeftGaps', storeAs: 'leftGaps' },
        { type: 'computeRightGaps', storeAs: 'rightGaps' },
        { type: 'computeBossNode', storeAs: 'bossNode' },
        { type: 'computeElevatorParams', elevWMax: 52, elevH: 28, storeAs: 'elevator' }
      ],
      ops: [
        {
          type: 'gappedVerticalLine',
          params: {
            x: 'layoutMeta.level2.xLeft',
            yTop: 'layoutMeta.level2.yTop',
            yBottom: 'layoutMeta.level2.yBottom',
            gaps: 'leftGaps'
          },
          style: { lineWidth: 2, gapHalf: 10 }
        },
        {
          type: 'gappedVerticalLine',
          params: {
            x: 'layoutMeta.level2.xRight',
            yTop: 'layoutMeta.level2.yTop',
            yBottom: 'layoutMeta.level2.yBottom',
            gaps: 'rightGaps'
          },
          style: { lineWidth: 2, gapHalf: 10 }
        },
        {
          type: 'line',
          params: {
            x1: 'layoutMeta.level2.xLeft',
            y1: 'layoutMeta.level2.yTop',
            x2: 'layoutMeta.level2.xRight',
            y2: 'layoutMeta.level2.yTop'
          },
          style: { lineWidth: 2 }
        },
        {
          type: 'rect',
          params: {
            x: 'elevator.x',
            y: 'elevator.y',
            w: 'elevator.w',
            h: 'elevator.h'
          },
          style: { lineWidth: 2 }
        },
        {
          type: 'line',
          params: {
            x1: 'layoutMeta.level2.xLeft',
            y1: 'layoutMeta.level2.yBottom',
            x2: 'layoutMeta.level2.xRight',
            y2: 'layoutMeta.level2.yBottom'
          },
          style: { lineWidth: 2 }
        },
        {
          type: 'forEach',
          over: 'leftGaps',
          forEachOp: [
            {
              type: 'line',
              params: {
                x1: 'layoutMeta.level2.xLeft',
                y1: 'current - 10',
                x2: 'layoutMeta.level2.xLeft - 12',
                y2: 'current - 20'
              },
              style: { lineWidth: 3 }
            },
            {
              type: 'line',
              params: {
                x1: 'layoutMeta.level2.xLeft',
                y1: 'current + 10',
                x2: 'layoutMeta.level2.xLeft - 12',
                y2: 'current + 20'
              },
              style: { lineWidth: 3 }
            }
          ]
        },
        {
          type: 'forEach',
          over: 'rightGaps',
          forEachOp: [
            {
              type: 'line',
              params: {
                x1: 'layoutMeta.level2.xRight',
                y1: 'current - 10',
                x2: 'layoutMeta.level2.xRight + 12',
                y2: 'current - 20'
              },
              style: { lineWidth: 3 }
            },
            {
              type: 'line',
              params: {
                x1: 'layoutMeta.level2.xRight',
                y1: 'current + 10',
                x2: 'layoutMeta.level2.xRight + 12',
                y2: 'current + 20'
              },
              style: { lineWidth: 3 }
            }
          ]
        }
      ]
    },
    transitionSpecs: {
      '1->2': {
        durationMs: 12000,
        l1l2: {
          rotationAngles: { left: -Math.PI / 2, right: Math.PI / 2, center: 0 },
          doorGapHalf: 10,
          pan: { screenFrac: 0.15, magMin: 60, magMax: 120 }
        },
        // Unified affine spec
        affine: {
          anchors: {
            from: { type: 'doorCenterForNode', which: 'fixed', index: 0 }, // L1 doorway center (index 0)
            to:   { type: 'doorCenterForNode', which: 'toIndex' }          // L2 wall center at selected door's y
          },
          rotation: {
            mode: 'sideAngles',
            left: -Math.PI / 2, right: Math.PI / 2, center: 0
          },
          scale: { mode: 'doorGapRatio', source: 'low' },            // numerator from 'low' scene (L1)
          pivot: 'to',
          pan: { reverseStrategy: 'identityStart' },
          sceneDrawHints: {
            low:  { showSubLocations: false },
            high: { showSubLocations: false }
          },
          fades: { from: { outStart: 0.75, outEnd: 1.0 }, to: { inEnd: 0.25 } },
          mapping: { mode: 'singleDoor', fromIndex: 0 }
        }
      },
      '2->1': {
        durationMs: 12000,
        l1l2: {
          rotationAngles: { left: -Math.PI / 2, right: Math.PI / 2, center: 0 },
          doorGapHalf: 10,
          pan: { screenFrac: 0.15, magMin: 60, magMax: 120 }
        },
        // Unified affine spec
        affine: {
          anchors: {
            from: { type: 'doorCenterForNode', which: 'fromIndex' }, // L2 wall center at source door's y
            to:   { type: 'doorCenterForNode', which: 'fixed', index: 0 }   // L1 doorway center (index 0)
          },
          rotation: {
            mode: 'sideAngles',
            left: -Math.PI / 2, right: Math.PI / 2, center: 0
          },
          scale: { mode: 'doorGapRatio', source: 'low' },
          pivot: 'to',
          pan: { reverseStrategy: 'identityStart' },
          sceneDrawHints: {
            low:  { showSubLocations: false },
            high: { showSubLocations: false }
          },
          fades: { from: { outStart: 0.75, outEnd: 1.0 }, to: { inEnd: 0.25 } },
          mapping: { mode: 'singleDoor', fromIndex: 0 }
        }
      }
    },
    numLocations: 5,
  },
];

deepFreeze(levelData);

// Expose to window for modules that read window.levelData/basePrice via the global object
try {
  if (typeof window !== 'undefined') {
    // Do not overwrite if already present
    if (!window.levelData) window.levelData = levelData;
    if (!window.basePrice) window.basePrice = basePrice;
  }
} catch (_) {}
