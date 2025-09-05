'use strict';

// Start RNG as truly random until we set a seed
Math.seedrandom();

var buttonAction = '';

// These are the variables to save between sessions
var gameVersion = '0.1.1';
var gameSeed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
var waitingTitleCards = 0;
var waitingTitleHeader = [];
var waitingTitleFooter = [];
var waitingTitleText = [];
var waitingTitleButton = [];
var waitingTitleImage = [];
// Typing state is defined in typing.js: lastChar, alreadyTyped, textBelow, textToType, textToTypeBolded,
// waitingMessagesToType, lastLineWasBold, typingText
var currLevel = 0;
var locIndex = 0;
var nextLocIndex = 1;
var transitMoves = 4;
var pickingEnabled = false;
var tradingEnabled = false;
var storeVisible = false;
var upgradesVisible = false;
var lastGameHTML = '';
var inv = [0, 0, 0, 0];
var oldInv = [];
var oldLocIndex = [];
var travelTime = [];
var visitedLocation = [];
var cargoRoom = 100;
var price = [];
var locationName = [];
var levelSeed = [];
var levelChildSeed = [];
var maxLevel = 0;
var inventoryChanged = false;
var showingGossipColors = false;
var gossipLocation = 0;
var uiMode = 'movement';
var isLevelTransitioning = false; // block inputs during level transition animation
// End variables to save between sessions
const varsToSave = [
  'gameVersion',
  'gameSeed',
  'waitingTitleCards',
  'waitingTitleHeader',
  'waitingTitleFooter',
  'waitingTitleText',
  'waitingTitleButton',
  'waitingTitleImage',
  'lastChar',
  'alreadyTyped',
  'textBelow',
  'textToType',
  'textToTypeBolded',
  'waitingMessagesToType',
  'lastLineWasBold',
  'currLevel',
  'locIndex',
  'nextLocIndex',
  'transitMoves',
  'pickingEnabled',
  'tradingEnabled',
  'storeVisible',
  'upgradesVisible',
  'lastGameHTML',
  'inv',
  'oldInv',
  'oldLocIndex',
  'travelTime',
  'visitedLocation',
  'cargoRoom',
  'price',
  'locationName',
  'levelSeed',
  'levelChildSeed',
  'maxLevel',
  'inventoryChanged',
  'showingGossipColors',
  'gossipLocation',
];
deepFreeze(varsToSave);

var PAUSE_MULT = 100; // Pause multiplier

// Load development configuration from config.js (included in HTML)
// If devMode is not defined globally, default to false
if (typeof devMode === 'undefined') {
  var devMode = false;
}

if (devMode) {
  gameSeed = 1;
  PAUSE_MULT = 1;
}

var needToSave = false;

function saveGameState() {
  lastGameHTML = document.getElementById('normalGameGoesHere').innerHTML;

  for (const key of varsToSave) {
    localStorage.setItem(key, JSON.stringify(window[key]));
  }
  needToSave = false;
}

function loadGameState() {
  for (const key of varsToSave) {
    if (key != 'gameVersion') {
      var value = localStorage.getItem(key);
      if (value != null && value != 'undefined') {
        window[key] = JSON.parse(value);
      }
    }
  }

  document.getElementById('normalGameGoesHere').innerHTML = lastGameHTML;
  // Guard against bad/missing indices from older saves
  normalizeLocationIndices();

  // Rebuild UI safely after restoring lastGameHTML
  // Ensure action buttons exist, then show appropriate mode
  if (storeVisible || upgradesVisible) {
    // Trading context persisted; enter trading mode (also hides map)
    setupInitialActions(); // ensure base buttons exist to avoid null refs inside enterTradingMode
    enterTradingMode();
  } else {
    // Movement mode
    setupInitialActions();
    showMovementUI();
    // Adjust pick button visibility/enabled for level 0
    var pkBtn = document.getElementById('buttonIDpick');
    if (pkBtn) {
      if (currLevel > 0) {
        pkBtn.style.display = 'none';
      } else {
        pkBtn.style.display = 'block';
        pkBtn.style.visibility = pickingEnabled ? 'visible' : 'hidden';
        pkBtn.disabled = !pickingEnabled;
      }
    }
  }

  // Re-mount the map into #mapGoesHere after restoring DOM from lastGameHTML
  // If a saved game predates the map container, insert it in the right spot.
  (function ensureMapContainer() {
    var mapEl = document.getElementById('mapGoesHere');
    if (!mapEl) {
      var newDiv = document.createElement('div');
      newDiv.id = 'mapGoesHere';
      newDiv.className = 'gameArea bordered mapWrapper';
      var parent = document.getElementById('normalGameGoesHere');
      var controls = document.getElementById('controlsGoHere');
      if (parent) {
        if (controls && controls.parentElement === parent) {
          if (controls.nextSibling) {
            parent.insertBefore(newDiv, controls.nextSibling);
          } else {
            parent.appendChild(newDiv);
          }
        } else {
          parent.appendChild(newDiv);
        }
      }
    }
  })();
  // Ensure map visibility matches UI mode now that container exists
  if (typeof setMapVisible === 'function') setMapVisible(uiMode === 'movement');
  // Initialize map renderer after ensuring container
  if (window.mapRenderer && typeof window.mapRenderer.init === 'function') window.mapRenderer.init();

  setTimeout('goBaby()', 100);
  if (typeof gtag === 'function') {
    gtag('event', 'loadGame', { event_category: 'gameState' });
  }
}

/**
 * Ensure locIndex and nextLocIndex are valid for the current level.
 * If undefined or out of range, set locIndex=0 and nextLocIndex to a sensible default.
 */
function normalizeLocationIndices() {
  var num = (levelData && levelData[currLevel] ? levelData[currLevel].numLocations : 0);
  if (typeof locIndex !== 'number' || !isFinite(locIndex) || locIndex < 0 || locIndex >= num) {
    locIndex = 0;
  }
  if (typeof nextLocIndex !== 'number' || !isFinite(nextLocIndex) || nextLocIndex < 0 || nextLocIndex >= num) {
    nextLocIndex = (num > 1 ? (locIndex === 0 ? 1 : 0) : 0);
  }
}

// Seed RNG deterministically for the rest of the session
Math.seedrandom(gameSeed); // replaces Math.random with predictable pseudorandom generator

function setupLevel(index, seed, mainLocationName) {
  levelSeed[index] = seed;
  Math.seedrandom(seed);
  levelChildSeed[index] = [];
  for (var i = 1; i < levelData[index].numLocations; i++) {
    levelChildSeed[index][i] = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  }
  locationName[index] = [];
  locationName[index][0] = mainLocationName;
  for (var j = 1; j < levelData[index].numLocations; j++) {
    locationName[index][j] = getRandomName();
  }
}

function setupLocationRadioButtons() {
  // Map-only destination selection; hide legacy radio UI
  setDestinationsHTML('');
  (function(el){ if (el) el.style.display = 'none'; })(document.getElementById('destinationsAndLabel'));
  return;
  var rbHTML = '';
  for (var i = 0; i < levelData[currLevel].numLocations; i++) {
    rbHTML += '<div class="locChoice">';
    rbHTML +=
      '<input class="locRadioButton" type="radio" id="nextLoc' +
      i +
      '" name="nextLoc" value="' +
      i +
      '"';
    rbHTML += ' onclick="updateLocomoteButton()"';
    if (i == nextLocIndex) rbHTML += ' checked';
    rbHTML += '>';
    rbHTML += '<label for="nextLoc' + i + '" ';
    if (showingGossipColors) {
      if (i == gossipLocation) {
        rbHTML += "style='color:rgb(0,200,0);' ";
      }
    }
    if (i == locIndex) {
      rbHTML += 'class="locRadioLabelDisabled">';
    } else {
      rbHTML += 'class="locRadioLabel">';
    }

    if (visitedLocation[currLevel][i]) {
      rbHTML += locationName[currLevel][i];
    } else {
      rbHTML += levelData[currLevel].locationLabel[i];
      if (i > 0) {
        rbHTML += '&nbsp;#' + i;
      }
    }
    rbHTML += '</label></div>';
  }
  setDestinationsHTML(rbHTML);
}

/* moved to messages.js: positiveExclamation() */

/* moved to messages.js: negativeExclamation() */

function doButtonAction(actionName) {
  buttonAction = actionName;
}

function hasAnything() {
  for (var i = 0; i < inv.length; i++) {
    if (inv[i] > 0) return true;
  }
  return false;
}

function visitedAllLocations() {
  for (var i = 0; i < levelData[currLevel].numLocations; i++) {
    if (!visitedLocation[currLevel][i]) return false;
  }
  return true;
}

/* moved to bigNumbers.js: getDisplayNumber() */

function calculateFreeSpace() {
  var freeSpace = cargoRoom;
  for (var i = 0; i < inv.length; i++) {
    freeSpace -= inv[i];
  }
  return freeSpace;
}

function handleLostAndFound() {
  var whaHappen = Math.random();
  if (whaHappen < 0.07) {
    // Lost something, mebbe
    var whichInv = inv.length - 1;
    while (whichInv > 0 && Math.random() < 0.5) {
      whichInv--;
    }
    var amount = Math.floor(Math.random() * inv[whichInv] * 0.5);
    if (amount > 0) {
      inv[whichInv] -= amount;
      var suggestion = ' Perhaps if you learn to travel faster there will be fewer opportunities to lose your cargo.';
      if (travelTime[currLevel] == 1) {
        suggestion = '';
      }
      if (amount == 1) {
        typeText(
          levelData[currLevel].loseMsg + ' ' + amount + ' ' + levelData[currLevel].tradeableItemsSingular[whichInv] + '!' + suggestion,
          levelData[currLevel].tradeableItemsSingular[whichInv] + ' lost.',
          negativeExclamation(),
          'OK',
          levelData[currLevel].loseImg
        );
      } else {
        typeText(
          levelData[currLevel].loseMsg + ' ' + amount + ' ' + levelData[currLevel].tradeableItems[whichInv] + '!' + suggestion,
          levelData[currLevel].tradeableItems[whichInv] + ' lost.',
          negativeExclamation(),
          'OK',
          levelData[currLevel].loseImg
        );
      }
    }
  } else if (whaHappen > 0.975 && hasAnything()) {
    var whichInv2 = 0;
    while (whichInv2 < inv.length && Math.random() < 0.1) {
      whichInv2++;
    }
    var maxAmountFound = calculateFreeSpace() / 2;
    var amount2 = Math.floor(Math.random() * maxAmountFound * 0.5);
    if (amount2 > 0) {
      inv[whichInv2] += amount2;
      if (amount2 == 1) {
        typeText(
          levelData[currLevel].foundMsg + ' ' + amount2 + ' ' + levelData[currLevel].tradeableItemsSingular[whichInv2] + '!',
          levelData[currLevel].tradeableItemsSingular[whichInv2] + ' found.',
          positiveExclamation(),
          'OK',
          levelData[currLevel].foundImg
        );
      } else {
        typeText(
          levelData[currLevel].foundMsg + ' ' + amount2 + ' ' + levelData[currLevel].tradeableItems[whichInv2] + '!',
          levelData[currLevel].tradeableItems[whichInv2] + ' found.',
          positiveExclamation(),
          'OK',
          levelData[currLevel].foundImg
        );
      }
    }
  }
}

function getNetWorth() {
  var netWorth = 0;
  var lvlMultiplier = 1;
  for (i = 0; i < currLevel; i++) {
    netWorth += lvlMultiplier * oldInv[i][0];
    for (j = 1; j < 4; j++) {
      lvlMultiplier *= 10;
      netWorth += lvlMultiplier * oldInv[i][j];
    }
  }
  netWorth += lvlMultiplier * inv[0];
  for (j = 1; j < 4; j++) {
    lvlMultiplier *= 10;
    netWorth += lvlMultiplier * inv[j];
  }
  for (i = currLevel + 1; i < levelData.length; i++) {
    netWorth += lvlMultiplier * oldInv[i][0];
    for (j = 1; j < 4; j++) {
      lvlMultiplier *= 10;
      netWorth += lvlMultiplier * oldInv[i][j];
    }
  }
  return netWorth;
}

function sellInv(index, quantity) {
  if (inv[index] >= quantity) {
    var thisPrice = price[currLevel][locIndex][index];
    inv[index] -= quantity;
    inv[0] += quantity * thisPrice;
    var sellMsg = 'You sell ' + getDisplayNumber(quantity) + ' ';
    if (quantity == 1) {
      sellMsg += levelData[currLevel].tradeableItemsSingular[index];
    } else {
      sellMsg += levelData[currLevel].tradeableItems[index];
    }
    sellMsg += ' to get ' + getDisplayNumber(quantity * thisPrice) + ' ';
    if (quantity * thisPrice == 1) {
      sellMsg += levelData[currLevel].tradeableItemsSingular[0];
    } else {
      sellMsg += levelData[currLevel].tradeableItems[0];
    }
    typeText(sellMsg);
    inventoryChanged = true;
  } else {
    typeText('You do not have ' + levelData[currLevel].tradeableItems[index] + ' to sell');
  }
}

function buyInv(index, quantity) {
  var thisPrice = price[currLevel][locIndex][index];
  if (inv[0] >= quantity * thisPrice) {
    inv[index] += quantity;
    inv[0] -= quantity * thisPrice;
    var buyMsg = 'You buy ' + getDisplayNumber(quantity) + ' ';
    if (quantity == 1) {
      buyMsg += levelData[currLevel].tradeableItemsSingular[index];
    } else {
      buyMsg += levelData[currLevel].tradeableItems[index];
    }
    buyMsg += ' for ' + getDisplayNumber(quantity * thisPrice) + ' ';
    if (quantity * thisPrice == 1) {
      buyMsg += levelData[currLevel].tradeableItemsSingular[0];
    } else {
      buyMsg += levelData[currLevel].tradeableItems[0];
    }
    typeText(buyMsg);
    inventoryChanged = true;
  } else {
    var shortBy = quantity * thisPrice - inv[0];
    var errMsg = 'You need ' + shortBy + ' more ';
    if (shortBy == 1) {
      errMsg += levelData[currLevel].tradeableItemsSingular[0];
    } else {
      errMsg += levelData[currLevel].tradeableItems[0];
    }
    typeText(errMsg);
  }
}

/* moved to economy.js: getGossipText() */

function buyUpgrade(upgradeType, upgradeAmount, cost) {
  if (cost <= inv[3]) {
    switch (upgradeType) {
      case 'gossip':
        if (visitedAllLocations() && !showingGossipColors) {
          showingGossipColors = true;
          inv[3] -= cost;
          randomizeStore();
          typeText('"' + getGossipText() + '"', 'Price Rumors: ', 'Go Baby!', 'OK', 'gossip.jpeg');
          setupLocationRadioButtons();
          inventoryChanged = true;
          if (typeof gtag === 'function') {
            gtag('event', 'gossip', { event_category: 'upgradeBought', value: currLevel });
          }
        }
        break;
      case 'travel':
        if (travelTime[currLevel] > 1) {
          travelTime[currLevel]--;
          inv[3] -= cost;
          inventoryChanged = true;
          if (travelTime[currLevel] > 1 + (visitedAllLocations() ? 0 : 1)) {
            typeText(
              locationName[currLevel][locIndex] + levelData[currLevel].travelFasterUpgradeMsg[0],
              'Travel Speed Upgraded.',
              'Go Baby!',
              'OK',
              levelData[currLevel].travelFasterUpgradeImg[0]
            );
            if (typeof gtag === 'function') {
              gtag('event', 'travelSpeed', {
                event_category: 'upgradeBought',
                event_label: 'intermediate',
                value: currLevel,
              });
            }
          } else {
            typeText(
              locationName[currLevel][locIndex] + levelData[currLevel].travelFasterUpgradeMsg[1],
              'Travel Speed Upgraded.',
              'Go Baby!',
              'OK',
              levelData[currLevel].travelFasterUpgradeImg[1]
            );
            if (typeof gtag === 'function') {
              gtag('event', 'travelSpeed', {
                event_category: 'upgradeBought',
                event_label: 'final',
                value: currLevel,
              });
            }
          }
        }
        break;
      case 'cargo':
        cargoRoom += upgradeAmount;
        inv[3] -= cost;
        inventoryChanged = true;
        typeText(
          locationName[currLevel][locIndex] + levelData[currLevel].cargoUpgradeMsg,
          'Cargo space upgraded.',
          'More Room!',
          'OK',
          levelData[currLevel].cargoUpgradeImg
        );
        if (typeof gtag === 'function') {
          gtag('event', 'cargo', { event_category: 'upgradeBought', value: currLevel });
        }
        break;
      case 'level':
        if (maxLevel < levelData.length - 1) {
          maxLevel++;
          inv[3] -= cost;
          inventoryChanged = true;
          var lup = document.getElementById('buttonIDlevelUp');
          if (lup) lup.style.visibility = 'visible';
          // Also surface the level-up control in trading view at the boss so players can advance immediately
          if (uiMode === 'trading' && locIndex === 0) {
            var __top = getButtonHTML('doneTrading', addLineBreaks('done trading'));
            if (currLevel === 0 && pickingEnabled) {
              __top += getButtonHTML('pick', addLineBreaks('pick nose'));
            }
            __top += getButtonHTML('levelUp', addLineBreaks(levelData[currLevel].levelUpLabel));
            setActionsHTML(__top);
            // Ensure all top controls are visible/enabled (babyButton defaults to visibility:hidden)
            var dt2 = document.getElementById('buttonIDdoneTrading');
            if (dt2) { dt2.style.visibility = 'visible'; dt2.disabled = false; }
            if (currLevel === 0 && pickingEnabled) {
              var pk2 = document.getElementById('buttonIDpick');
              if (pk2) { pk2.style.visibility = 'visible'; pk2.disabled = false; }
            }
            var lu2 = document.getElementById('buttonIDlevelUp');
            if (lu2) { lu2.style.visibility = 'visible'; lu2.disabled = false; }
          }
          typeText(
            locationName[currLevel][locIndex] +
              levelData[currLevel].levelUpgradeMsg +
              ' You can now advance to level ' +
              (currLevel + 1) +
              ' ("' +
              levelData[currLevel].levelUpLabel +
              '").',
            levelData[currLevel].levelUpgradeHeaderMsg,
            'Level ' + maxLevel + ' Available!',
            'OK',
            levelData[currLevel].levelUpgradeHeaderImg
          );
          if (typeof gtag === 'function') {
            gtag('event', 'level', { event_category: 'upgradeBought', value: maxLevel });
          }
        } else {
          typeText(
            'You have completed Baby Merchant! Hopefully more will be written soon.',
            'You win!',
            'Thanks for playing',
            'OK',
            'won.jpeg'
          );
          if (typeof gtag === 'function') {
            gtag('event', 'win', { event_category: 'gameState', value: currLevel });
          }
        }
        break;
    }
  } else {
    typeText('You need more ' + levelData[currLevel].tradeableItems[3] + ' to purchase this');
  }
}

/* moved to economy.js: randomizeStore() */

function updateLocomoteButton() {
  var newLocomoteText = levelData[currLevel].locomotionType + '&nbsp;to ';
  if (visitedLocation[currLevel][nextLocIndex]) {
    newLocomoteText +=
      locationName[currLevel][nextLocIndex] +
      levelData[currLevel].VisitHdr3 +
      levelData[currLevel].locationLabel[nextLocIndex];
  } else {
    newLocomoteText += levelData[currLevel].locationLabel[nextLocIndex];
    if (nextLocIndex > 0) newLocomoteText += ' #' + nextLocIndex;
  }
  var btn = document.getElementById('buttonIDlocomote');
  if (btn) {
    btn.innerHTML = addLineBreaks(newLocomoteText);
  }
}

function updatePickButtonVisibility() {
  var pkBtn = document.getElementById('buttonIDpick');
  if (!pkBtn) return;
  if (uiMode !== 'movement') return; // trading handles its own button visibility
  if (currLevel === 0) {
    pkBtn.style.display = 'block';
    pkBtn.style.visibility = pickingEnabled ? 'visible' : 'hidden';
    pkBtn.disabled = !pickingEnabled;
  } else {
    pkBtn.style.display = 'none';
  }
}

function showMovementUI() {
  (function(el){ if (el) el.style.display = 'flex'; })(document.getElementById('controlsGoHere'));
  (function(el){ if (el) el.style.display = 'flex'; })(document.getElementById('actionsGoHere'));
  if (currLevel > 0) { var dn = document.getElementById('destinationsAndLabel'); if (dn) dn.style.display = 'none'; }
  if (currLevel < maxLevel) { var lu = document.getElementById('buttonIDlevelUp'); if (lu) lu.style.visibility = 'visible'; }
  if (currLevel > 0) { var ld = document.getElementById('buttonIDlevelDown'); if (ld) ld.style.visibility = (locIndex > 0 ? 'visible' : 'hidden'); }
  // Show map alongside movement UI
  if (typeof setMapVisible === 'function') setMapVisible(true);

  updatePickButtonVisibility();
}

function hideMovementUI() {
  (function(el){ if (el) el.style.display = 'none'; })(document.getElementById('controlsGoHere'));
  (function(el){ if (el) el.style.display = 'none'; })(document.getElementById('actionsGoHere'));
  (function(el){ if (el) el.style.display = 'none'; })(document.getElementById('destinationsAndLabel'));
  (function(el){ if (el) el.style.display = 'none'; })(document.getElementById('destinationsAndLabel'));
  (function(el){ if (el) el.style.visibility = 'hidden'; })(document.getElementById('buttonIDlevelUp'));
  (function(el){ if (el) el.style.visibility = 'hidden'; })(document.getElementById('buttonIDlevelDown'));
  (function(el){ if (el) el.style.visibility = 'hidden'; })(document.getElementById('buttonIDlevelUp'));
  (function(el){ if (el) el.style.visibility = 'hidden'; })(document.getElementById('buttonIDlevelDown'));
  // Hide map when movement UI is hidden
  if (typeof setMapVisible === 'function') setMapVisible(false);
}

function enterTradingMode() {
  uiMode = 'trading';
  // Hide movement-only sections but keep the top controls area visible
  (function(el){ if (el) el.style.display = 'none'; })(document.getElementById('destinationsAndLabel'));
  (function(el){ if (el) el.style.visibility = 'hidden'; })(document.getElementById('buttonIDlevelUp'));
  (function(el){ if (el) el.style.visibility = 'hidden'; })(document.getElementById('buttonIDlevelDown'));
  // Hide the map while trading
  if (typeof setMapVisible === 'function') setMapVisible(false);

  // Put primary trading controls at the top in controlsGoHere
  var topHTML = getButtonHTML('doneTrading', addLineBreaks('done trading'));
  if (currLevel == 0 && pickingEnabled) {
    topHTML += getButtonHTML('pick', addLineBreaks('pick nose'));
  }
  setActionsHTML(topHTML);

  // Make these top controls visible (babyButton is hidden by default)
  var dt = document.getElementById('buttonIDdoneTrading');
  if (dt) { dt.style.visibility = 'visible'; dt.disabled = false; }
  if (currLevel == 0 && pickingEnabled) {
    var pk = document.getElementById('buttonIDpick');
    if (pk) { pk.style.visibility = 'visible'; pk.disabled = false; }
  }

  // Force inventory panel to refresh immediately for trading view
  inventoryChanged = true;
}

function exitTradingMode() {
  uiMode = 'movement';
  // Ensure trading flags are cleared so UI doesn't re-render store below the map
  storeVisible = false;
  upgradesVisible = false;
  showMovementUI();
  setInventoryHTML('');
  setupLocationRadioButtons();
  if (currLevel > 0 || visitedAllLocations()) {
    updateLocomoteButton();
  }
  // Restore the standard movement controls at the top
  // The visibility of storeVisible/upgradesVisible will be determined by setupInitialActions
  setupInitialActions();
}

function goBaby() {
  // Guard against bad/missing indices when loop starts (e.g., right after level changes)
  normalizeLocationIndices();
  if (!typingText) {
    if (isLevelTransitioning) {
      // Swallow inputs while a level transition animation is running
      buttonAction = '';
    }
    var thisAction = buttonAction;
    if (buttonAction != '') {
      var locomoteButton = document.getElementById('buttonIDlocomote');
      var pickButton = document.getElementById('buttonIDpick');
      var levelUpButton = document.getElementById('buttonIDlevelUp');
      var levelDownButton = document.getElementById('buttonIDlevelDown');

      var freeSpace = calculateFreeSpace();
      var spaceUsed = cargoRoom - freeSpace;

      switch (thisAction) {
        case 'levelUp':
          if (
            inv[3] < 10 &&
            getNetWorth() < 1000 ** (currLevel + 2) &&
            oldInv[currLevel + 1][1] == 0 &&
            oldInv[currLevel + 1][2] == 0 &&
            oldInv[currLevel + 1][3] == 0
          ) {
            typeText(
              'You should really have at least 10 ' +
                levelData[currLevel].tradeableItems[3] +
                ' before proceeding to level ' +
                (currLevel + 1),
              'Get more ' + levelData[currLevel].tradeableItems[3],
              'Too poor!',
              'OK',
              'sadbaby.jpeg'
            );
          } else if (currLevel < maxLevel) {
            // If in trading view, exit so the map is visible for the zoom animation
            if (uiMode === 'trading') {
              try { exitTradingMode(); } catch (_) {}
            }
            // Prepare the renderer with an explicit transition BEFORE changing currLevel
            try {
              if (window.mapRenderer && typeof window.mapRenderer.prepareLevelTransition === 'function') {
                var targetGroupOnL1 = (oldLocIndex[currLevel + 1] != null ? oldLocIndex[currLevel + 1] : 1);
                window.mapRenderer.prepareLevelTransition(currLevel, currLevel + 1, locIndex, targetGroupOnL1);
              }
            } catch (_) {}
            // Prepare title card content but defer display until after zoom animation
            var _msgText = levelData[currLevel].levelUpMessage +
              ', taking only your ' + levelData[currLevel].tradeableItems[3] + ' with you.' +
              '\n\nNEW THIS LEVEL: ' + levelData[currLevel].levelUpAwesomeness;
            var _msgHeader = 'Advancing to level ' + (currLevel + 1) + ':';
            var _msgFooter = 'Go Baby!';
            var _msgImg = levelData[currLevel].levelUpImg;
            (function(el){ if (el) el.style.display = 'flex'; })(document.getElementById('destinationsAndLabel'));

            // Preserve inventory that can't go up to the next level
            oldInv[currLevel] = [0, 0, 0, 0];
            for (var i = 0; i < inv.length - 1; i++) {
              oldInv[currLevel][i] = inv[i];
            }
            oldLocIndex[currLevel] = locIndex;

            // This level's most expensive item is next level's currency
            inv[0] = inv[inv.length - 1];
            currLevel++;

            // Restore inventory from the last time we were on the higher level
            for (i = 1; i < inv.length; i++) {
              inv[i] = oldInv[currLevel][i];
            }
            oldInv[currLevel] = [0, 0, 0, 0];
            locIndex = oldLocIndex[currLevel];
            // Ensure indices are valid before computing the next default destination
            normalizeLocationIndices();
            nextLocIndex = locIndex + 1;
            if (nextLocIndex > levelData[currLevel].numLocations) {
              nextLocIndex = 0;
            }
            visitedLocation[currLevel][locIndex] = true;
            upgradesVisible = false;
            storeVisible = true;
            randomizeStore(locIndex, true);
            // Do not enter trading yet; keep map visible for zoom animation
            if (levelDownButton) levelDownButton.style.visibility = (locIndex > 0 ? 'visible' : 'hidden');
            if (levelDownButton) levelDownButton.innerHTML = addLineBreaks(
              levelData[currLevel].levelDownLabel +
                locationName[currLevel][locIndex] +
                levelData[currLevel].RevisitHdr2 +
                levelData[currLevel].locationLabel[locIndex]
            );
            if (levelUpButton) levelUpButton.innerHTML = addLineBreaks(levelData[currLevel].levelUpLabel);
            if (levelUpButton) levelUpButton.style.visibility = 'hidden';
            if (pickButton) pickButton.style.display = 'none';
            setupLocationRadioButtons();
            setHeaderText(
              levelData[currLevel].VisitHdr1 +
                levelData[currLevel].characterType +
                levelData[currLevel].VisitHdr2 +
                locationName[currLevel][locIndex] +
                levelData[currLevel].VisitHdr3 +
                levelData[currLevel].locationLabel[locIndex]
            );
            updateLocomoteButton();
            // Await map renderer transition (if present), then show title card and enter trading
            isLevelTransitioning = true;
            var _wait = (window.mapRenderer && typeof window.mapRenderer.waitForTransition === 'function')
              ? window.mapRenderer.waitForTransition()
              : Promise.resolve();
            _wait.finally(function () {
              try {
                // Add a small pause after animation completes before showing the confirmation/title card
                setTimeout(function () {
                  try {
                    typeText(_msgText, _msgHeader, _msgFooter, 'OK', _msgImg);
                    enterTradingMode();
                    if (typeof gtag === 'function') {
                      gtag('event', 'levelUp', { event_category: 'levelChange', value: currLevel });
                    }
                  } finally {
                    isLevelTransitioning = false;
                  }
                }, 1000);
              } catch (_) {
                isLevelTransitioning = false;
              }
            });
          }
          break;
        case 'levelDown':
          if (currLevel > 0) {
            // If in trading view, exit so the map is visible for the zoom animation
            if (uiMode === 'trading') {
              try { exitTradingMode(); } catch (_) {}
            }
            // Prepare the renderer with an explicit transition BEFORE changing currLevel
            try {
              if (window.mapRenderer && typeof window.mapRenderer.prepareLevelTransition === 'function') {
                window.mapRenderer.prepareLevelTransition(currLevel, currLevel - 1, locIndex, 0);
              }
            } catch (_) {}
            // Prepare title card content but defer display until after zoom animation
            var _downMsgText = levelData[currLevel].levelDownMessage + ', taking only your ' + levelData[currLevel].tradeableItems[0] + ' with you.';
            var _downHeader = 'Retreating to level ' + (currLevel - 1) + ':';
            var _downFooter = 'Humble thyself';
            var _downImg = levelData[currLevel].levelDownImg;
            // Preserve inventory that can't go down to the previous level
            oldInv[currLevel] = [0, 0, 0, 0];
            for (var i = 1; i < inv.length; i++) {
              oldInv[currLevel][i] = inv[i];
            }
            setupLevel(currLevel - 1, levelChildSeed[currLevel][locIndex], locationName[currLevel][locIndex]);
            oldLocIndex[currLevel] = locIndex;

            // This level's currency is next level's most expensive item
            inv[inv.length - 1] = inv[0];
            currLevel--;

            // Restore inventory from the last time we were on the lower level
            for (i = 0; i < inv.length - 1; i++) {
              inv[i] = oldInv[currLevel][i];
            }
            oldInv[currLevel] = [0, 0, 0, 0];
            locIndex = oldLocIndex[currLevel];
            // Ensure indices are valid before computing the next default destination
            normalizeLocationIndices();
            nextLocIndex = locIndex + 1; // Add this line for levelDown
            if (nextLocIndex > levelData[currLevel].numLocations) {
              nextLocIndex = 0;
            }
            storeVisible = false;
            randomizeStore(locIndex, true);
            upgradesVisible = true;
            // Do not enter trading yet; keep map visible for zoom animation
            levelDownButton.innerHTML = addLineBreaks(
              levelData[currLevel].levelDownLabel +
                locationName[currLevel][locIndex] +
                levelData[currLevel].RevisitHdr2 +
                levelData[currLevel].locationLabel[locIndex]
            );
            levelUpButton.innerHTML = addLineBreaks(levelData[currLevel].levelUpLabel);
            if (levelUpButton) levelUpButton.style.visibility = 'visible';
            if (currLevel == 0) {
              if (levelDownButton) levelDownButton.style.visibility = 'hidden';
              (function(el){ if (el) el.style.display = 'none'; })(document.getElementById('destinationsAndLabel'));
              if (pickButton) pickButton.style.display = 'block';
            }

            setupLocationRadioButtons();
            setHeaderText(
              levelData[currLevel].VisitHdr1 +
                levelData[currLevel + 1].characterType +
                levelData[currLevel].VisitHdr2 +
                locationName[currLevel][locIndex] +
                levelData[currLevel].VisitHdr3 +
                levelData[currLevel].locationLabel[locIndex]
            );
            updateLocomoteButton();
            // Await map renderer transition (if present), then show title card and enter trading
            isLevelTransitioning = true;
            var _waitDown = (window.mapRenderer && typeof window.mapRenderer.waitForTransition === 'function')
              ? window.mapRenderer.waitForTransition()
              : Promise.resolve();
            _waitDown.finally(function () {
              try {
                // Add a small pause after animation completes before showing the confirmation/title card
                setTimeout(function () {
                  try {
                    typeText(_downMsgText, _downHeader, _downFooter, 'OK', _downImg);
                    enterTradingMode();
                    if (typeof gtag === 'function') {
                      gtag('event', 'levelDown', { event_category: 'levelChange', value: currLevel });
                    }
                  } finally {
                    isLevelTransitioning = false;
                  }
                }, 1000);
              } catch (_) {
                isLevelTransitioning = false;
              }
            });
          }
          break;
        case 'pick':
          if (locIndex == 0 && transitMoves == 0) {
            typeText(locationName[currLevel][locIndex] + ' glares at you, and you decide to wait.');
          } else if (freeSpace == 0 && transitMoves > 0) {
            typeText('You would be overencumbered!');
          } else {
            pickButton.disabled = true;
            var pickResult = Math.random();
            if (pickResult < 0.9) {
              inv[0]++;
              typeText('You withdraw a ' + levelData[currLevel].tradeableItemsSingular[0]);
            } else if (pickResult < 0.99) {
              inv[1]++;
              typeText('You draw forth a ' + levelData[currLevel].tradeableItemsSingular[1] + '!');
            } else {
              inv[2]++;
              typeText(
                'To your incredible delight, you have drawn forth that rarest of boogers, the ' +
                  levelData[currLevel].tradeableItemsSingular[2] +
                  '!',
                'You found a ' + levelData[currLevel].tradeableItemsSingular[2] + '!!',
                positiveExclamation(),
                'OK',
                'bloodybooger.jpeg'
              );
            }
          }
          setTimeout(function () {
            var el = document.getElementById('buttonIDpick');
            if (el) el.disabled = false;
          }, 40 * PAUSE_MULT);
          break;
        case 'locomote':
          if (freeSpace < 0) {
            typeText('You are overencumbered!');
          } else if (nextLocIndex == locIndex) {
            typeText('You are already there!');
          } else {
            locomoteButton.disabled = true;
            setTimeout(function () {
              var el = document.getElementById('buttonIDlocomote');
              if (el) el.disabled = false;
            }, 8 * PAUSE_MULT);

            // Hide the "enterTrading" button as soon as movement starts
            var trBtn = document.getElementById('buttonIDenterTrading');
            if (trBtn) {
              trBtn.style.visibility = 'hidden';
              trBtn.disabled = true;
            }

            if (transitMoves == 0) {
              // Handle things related to departing a location
              (function(el){ if (el) el.style.display = 'none'; })(document.getElementById('destinationsAndLabel'));
              transitMoves = travelTime[currLevel];
              storeVisible = false;
              if (levelUpButton) levelUpButton.style.visibility = 'hidden';
              if (levelDownButton) levelDownButton.style.visibility = 'hidden';
              upgradesVisible = false;
              if (!showingGossipColors) {
                randomizeStore();
              }
            }
            transitMoves--;
            var ctype = levelData[currLevel].characterType;
            if (nextLocIndex == 0) {
              if (currLevel + 1 < levelData.length) {
                ctype = levelData[currLevel + 1].characterType;
              } else {
                ctype = 'evil baby';
              }
            }

            handleLostAndFound();

            if (transitMoves == 0) {
              // Handle things related to arriving at a location
              handleArrivalLogic(); // Call directly, animation happens during transit
            } else {
              if (visitedLocation[currLevel][nextLocIndex]) {
                typeText(levelData[currLevel].RevisitMsg);
                setHeaderText(
                  levelData[currLevel].RevisitHdr1 +
                    locationName[currLevel][nextLocIndex] +
                    levelData[currLevel].RevisitHdr2 +
                    levelData[currLevel].locationLabel[nextLocIndex]
                );
              } else {
                typeText(levelData[currLevel].MoveMsg);
                setHeaderText(levelData[currLevel].MoveHdr);
              }
            }
          }
          setupLocationRadioButtons();
          if (currLevel > 0 || visitedAllLocations()) {
            updateLocomoteButton();
          }

          break;
        case 'doneTrading':
          // Allow exiting trading even when overencumbered; movement will block travel if needed
          exitTradingMode();
          break;
        case 'enterTrading':
          // Re-enter trading at the current location
          if (locIndex === 0) {
            upgradesVisible = true;
            storeVisible = false;
          } else {
            storeVisible = true;
            upgradesVisible = false;
          }
          enterTradingMode();
          break;
        default:
          break;
      }
    }

    if (buttonAction != '' || inventoryChanged) {
      // Get updated freeSpace and spaceUsed numbers
      var freeSpace2 = calculateFreeSpace();
      var spaceUsed2 = cargoRoom - freeSpace2;

      setInventoryHTML(renderInventory());

      var netWorth = getNetWorth();
      var statusText = '&nbsp;&nbsp;&nbsp;';
      if (netWorth > 0) {
        statusText += getDisplayNumber(netWorth) + ' ƀ - lv ';
      } else {
        statusText += 'level ';
      }
      statusText += currLevel;
      setStatusText(statusText);
      needToSave = true;

      // Keep pick button state in sync during movement
      updatePickButtonVisibility();
    }

    buttonAction = '';
    inventoryChanged = false;
  }
  setTimeout('goBaby()', 100);
}

function setupInitialActions() {
  // Build an initial locomote label appropriate for the current level and selection,
  // so we don't briefly show "thrash about" after leaving trading on higher levels.
  var initialLocomoteText = '';
  if (currLevel === 0 && !visitedAllLocations()) {
    initialLocomoteText = 'thrash about';
  } else {
    initialLocomoteText = levelData[currLevel].locomotionType + '&nbsp;to ';
    if (visitedLocation[currLevel][nextLocIndex]) {
      initialLocomoteText +=
        locationName[currLevel][nextLocIndex] +
        levelData[currLevel].VisitHdr3 +
        levelData[currLevel].locationLabel[nextLocIndex];
    } else {
      initialLocomoteText += levelData[currLevel].locationLabel[nextLocIndex];
      if (nextLocIndex > 0) initialLocomoteText += ' #' + nextLocIndex;
    }
  }

  // Build a contextual Level Down label (e.g., "Enter Alice's group")
  var initialLevelDownText = levelData[currLevel].levelDownLabel;
  if (currLevel > 0) {
    initialLevelDownText =
      levelData[currLevel].levelDownLabel +
      locationName[currLevel][locIndex] +
      levelData[currLevel].RevisitHdr2 +
      levelData[currLevel].locationLabel[locIndex];
  }

  // Build an Enter Trading/Upgrades label
  var initialTradeText = (locIndex === 0) ? 'enter upgrades' : 'enter trade';

  setActionsHTML(
    getButtonHTML('locomote', addLineBreaks(initialLocomoteText)) +
      getButtonHTML('pick', addLineBreaks('pick nose')) +
      getButtonHTML('levelDown', addLineBreaks(initialLevelDownText)) +
      getButtonHTML('levelUp', addLineBreaks(levelData[currLevel].levelUpLabel))
  );

  // Make primary action buttons visible/hidden appropriately
  var lmBtn = document.getElementById('buttonIDlocomote');
  if (lmBtn) lmBtn.style.visibility = 'visible';

  var luBtn = document.getElementById('buttonIDlevelUp');
  if (luBtn) luBtn.style.visibility = (currLevel < maxLevel ? 'visible' : 'hidden');

  var ldBtn = document.getElementById('buttonIDlevelDown');
  if (ldBtn) ldBtn.style.visibility = (currLevel > 0 && locIndex > 0 ? 'visible' : 'hidden');

  // Enter Trading/Upgrades is now accessed via map (player click); no button needed

  updatePickButtonVisibility();

  setupLocationRadioButtons();
  // Ensure locomote button text matches current level/destination immediately after rebuilding controls
  if (currLevel > 0 || visitedAllLocations()) {
    updateLocomoteButton();
  }
  // Ensure map becomes visible when gameplay UI appears
  if (typeof setMapVisible === 'function') setMapVisible(true);
}

function clearGameVariables() {
  // Make sure all game variables are set to initial values
  // (not including values which persist between games)

  waitingTitleCards = 0;
  waitingTitleHeader = [];
  waitingTitleFooter = [];
  waitingTitleText = [];
  waitingTitleButton = [];
  waitingTitleImage = [];
  lastChar = ' ';
  alreadyTyped = '';
  textBelow = '';
  textToType = [];
  textToTypeBolded = [];
  waitingMessagesToType = 0;
  lastLineWasBold = false;
  currLevel = 0;
  locIndex = 0;
  nextLocIndex = 1;
  transitMoves = 4;
  pickingEnabled = false;
  tradingEnabled = false;
  storeVisible = false;
  upgradesVisible = false;
  lastGameHTML = '';
  inv = [0, 0, 0, 0];
  oldInv = [];
  oldLocIndex = [];
  travelTime = [];
  visitedLocation = [];
  cargoRoom = 100;
  price = [];
  locationName = [];
  levelSeed = [];
  levelChildSeed = [];
  for (i = 0; i < levelData.length; i++) {
    oldInv[i] = [0, 0, 0, 0];
    oldLocIndex[i] = 1;
    travelTime[i] = 4;
    visitedLocation[i] = [];
    price[i] = [];
    locationName[i] = [];
    levelSeed[i] = 0;
    levelChildSeed[i] = [];
    for (j = 0; j < levelData[i].numLocations; j++) {
      visitedLocation[i][j] = false;
      price[i][j] = [1, 10, 100, 1000];
      locationName[i][j] = '';
    }
  }
  maxLevel = 0;
  inventoryChanged = false;
  showingGossipColors = false;
  gossipLocation = 0;
}

function startNewGame() {
  clearGameVariables();

  i = levelData.length - 1;
  setupLevel(i, Math.floor(Math.random() * Number.MAX_SAFE_INTEGER), 'final boss');
  i--;
  while (i >= 0) {
    setupLevel(i, levelChildSeed[i + 1][1], locationName[i + 1][1]);
    i--;
  }

  randomizeStore(true);
  setTimeout('setHeaderText("You are a " + levelData[0].characterType) ', 10 * PAUSE_MULT);
  setTimeout('setupInitialActions()', 50 * PAUSE_MULT);
  setTimeout('goBaby()', 51 * PAUSE_MULT);

  if (typeof gtag === 'function') {
    gtag('event', 'newGame', { event_category: 'gameState' });
  }
}

function askToContinue(saveAvailable) {
  var picVariant = Math.random() * 5;
  var picName = 'BabyMerchant';
  if (picVariant < 1) picName += 'B';
  else if (picVariant < 2) picName += 'C';
  else if (picVariant < 3) picName += 'D';
  else if (picVariant < 4) picName += 'E';
  picName += '.jpeg';

  displayTitleCard(
    "<button onclick='startNewGame(); hideTitleCard();' class='continueButton'>Start New Game</button><br><br>" +
      (saveAvailable
        ? "<button onclick='loadGameState(); hideTitleCard();'  class='continueButton'>Continue Previous Game</button>"
        : ''),
    '👶 Baby Merchant 👶',
    '',
    '',
    picName
  );
}

// Kick off title card
var oldGameVersion = JSON.parse(localStorage.getItem('gameVersion'));
var saveAvailable = oldGameVersion != null && oldGameVersion == gameVersion;
setTimeout('askToContinue(' + saveAvailable + ')', 1);

/* moved to movement.arrival.js: handleArrivalLogic() */
