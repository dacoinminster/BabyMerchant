'use strict';

function handleArrivalLogic() {
  showingGossipColors = false;
  locIndex = nextLocIndex;
  nextLocIndex++;
  if (nextLocIndex >= levelData[currLevel].numLocations) {
    nextLocIndex = 0;
  }
  var coolLocationFooter = '';
  var coolLocationHeader = '';
  var coolLocationImage = '';
  var locationMessage = '';
  var ctype = levelData[currLevel].characterType;
  if (nextLocIndex == 0) {
    if (currLevel + 1 < levelData.length) {
      ctype = levelData[currLevel + 1].characterType;
    } else {
      ctype = 'evil baby';
    }
  }

  var levelDownButton = document.getElementById('buttonIDlevelDown');
  var levelUpButton = document.getElementById('buttonIDlevelUp');
  var pickButton = document.getElementById('buttonIDpick');

  if (currLevel > 0) {
    var dn2 = document.getElementById('destinationsAndLabel'); if (dn2) dn2.style.display = 'none';
    if (locIndex > 0) {
      if (levelDownButton) levelDownButton.innerHTML = addLineBreaks(
        levelData[currLevel].levelDownLabel +
          locationName[currLevel][locIndex] +
          levelData[currLevel].RevisitHdr2 +
          levelData[currLevel].locationLabel[locIndex]
      );
      if (levelDownButton) levelDownButton.style.visibility = 'visible';
    }
  }
  if (!visitedLocation[currLevel][locIndex]) {
    visitedLocation[currLevel][locIndex] = true;
    if (visitedAllLocations()) {
      travelTime[currLevel]--;
      var exploreMsg = levelData[currLevel].exploreMsg;
      if (currLevel == 0) {
        var nextCtype = levelData[currLevel].characterType;
        if (nextLocIndex == 0) {
          nextCtype = levelData[currLevel + 1].characterType;
        }
        exploreMsg +=
          ' Looking around, you see that continued thrashing will bring you full circle to revisit ' +
          nextCtype +
          ' ' +
          locationName[currLevel][nextLocIndex] +
          '.';
      }
      typeText(exploreMsg, 'Exploration complete!', 'Go Baby!', 'OK', levelData[currLevel].exploreImg);
      if (typeof gtag === 'function') {
        gtag('event', 'exploration', { event_category: 'milestone', value: currLevel });
      }
    }
    if (locIndex > 0) {
      locationMessage +=
        levelData[currLevel].discoveryMsg1 +
        ctype +
        levelData[currLevel].discoveryMsg2 +
        locationName[currLevel][locIndex] +
        levelData[currLevel].discoveryMsg3;

      if (!pickingEnabled) {
        pickButton.style.visibility = 'visible';
        pickingEnabled = true;
        locationMessage +=
          ' You notice ' +
          locationName[currLevel][locIndex] +
          ' has a finger in each nostril. Hmmmm.';
        coolLocationHeader = 'Meeting ' + ctype + ' ' + locationName[currLevel][locIndex] + ':';
        coolLocationImage = 'nosepicker.jpeg';
        coolLocationFooter = 'Nose picking is cool';
        if (typeof gtag === 'function') {
          gtag('event', 'picking', { event_category: 'milestone', value: currLevel });
        }
      }
    } else {
      locationMessage +=
        levelData[currLevel].BossDiscoveryMsg1 +
        ctype +
        levelData[currLevel].BossDiscoveryMsg2 +
        locationName[currLevel][locIndex] +
        levelData[currLevel].BossDiscoveryMsg3 +
        levelData[currLevel].tradeableItems[3] +
        levelData[currLevel].BossDiscoveryMsg4;
      coolLocationHeader = 'Meeting ' + ctype + ' ' + locationName[currLevel][locIndex] + ':';
      coolLocationImage = levelData[currLevel].BossBabyImg;
      coolLocationFooter = 'Upgrades for sale';
    }
  } else {
    locationMessage +=
      levelData[currLevel].ArrivalMsg1 +
      locationName[currLevel][locIndex] +
      levelData[currLevel].ArrivalMsg2 +
      levelData[currLevel].locationLabel[locIndex] +
      '.';
  }
  if (locIndex == 0) {
    if (currLevel < maxLevel) {
      if (levelUpButton) levelUpButton.style.visibility = 'visible';
    }
  } else {
    if (!tradingEnabled && hasAnything()) {
      tradingEnabled = true;
      locationMessage +=
        ' ' +
        locationName[currLevel][locIndex] +
        ' seems to want to trade with you, but these wares look so expensive!' +
        ' A voice resonates in your deepest being . . .  "Buy low. Sell high."';
      coolLocationHeader = 'Meeting ' + ctype + ' ' + locationName[currLevel][locIndex] + ':';
      coolLocationImage = 'buysellbaby.jpeg';
      coolLocationFooter = 'Time to Trade!';
      if (typeof gtag === 'function') {
        gtag('event', 'trading', { event_category: 'milestone', value: currLevel });
      }
    }
  }
  typeText(locationMessage, coolLocationHeader, coolLocationFooter, 'OK', coolLocationImage);
  setHeaderText(
    levelData[currLevel].VisitHdr1 +
      ctype +
      levelData[currLevel].VisitHdr2 +
      locationName[currLevel][locIndex] +
      levelData[currLevel].VisitHdr3 +
      levelData[currLevel].locationLabel[locIndex]
  );

  if (tradingEnabled) {
    if (locIndex == 0) {
      upgradesVisible = true;
    } else {
      storeVisible = true;
    }
    enterTradingMode();
  }
  // Explicitly set the visibility of the "enterTrading" button after arrival
  var trBtn = document.getElementById('buttonIDenterTrading');
  if (trBtn) {
    var canEnterTrading = (uiMode === 'movement') && (transitMoves === 0) && ((locIndex === 0 && upgradesVisible) || (tradingEnabled && locIndex > 0));
    trBtn.style.visibility = canEnterTrading ? 'visible' : 'hidden';
    trBtn.disabled = !canEnterTrading;
  }
}