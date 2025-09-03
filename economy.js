'use strict';

// Extracted from app.js: pricing/gossip/store logic

function getGossipText() {
  var gossipText = 'Prices look unfavorable everywhere!';
  var thisBuyRatio = 1;
  var bestBuyRatio = 1;
  var thisProfit = 0;
  var bestProfit = 0;
  var bestBuyIndex = 0;
  var bestSellIndex = 0;
  var bestBuyLoc = 0;
  var expensiveCount = 0;
  for (var i = 3; i >= 0; i--) {
    if (inv[i] > 0) {
      if (i > 0) {
        for (var j = 1; j < levelData[currLevel].numLocations; j++) {
          for (var k = 0; k < i; k++) {
            thisBuyRatio = price[currLevel][j][i] / (price[currLevel][j][k] * 10 ** (i - k));
            if (thisBuyRatio > 1) {
              thisProfit = inv[i] * (thisBuyRatio - 1) * 10 ** i;
              var actualSpace = cargoRoom - expensiveCount;
              for (var m = k; m < i; m++) {
                actualSpace -= inv[m];
              }
              var neededSpace = inv[i] * thisBuyRatio * 10 ** (i - k) + 1;
              neededSpace -= actualSpace;
              while (neededSpace > 0) {
                neededSpace = neededSpace - thisBuyRatio * 10 ** (i - k) + 1;
                thisProfit -= (thisBuyRatio - 1) * 10 ** i;
              }
              if (thisProfit > bestProfit) {
                bestProfit = thisProfit;
                bestBuyIndex = k;
                bestSellIndex = i;
                bestBuyLoc = j;
                bestBuyRatio = thisBuyRatio;
              }
            }
          }
        }
      }
      expensiveCount += inv[i];
      if (i < 3) {
        for (var j2 = 1; j2 < levelData[currLevel].numLocations; j2++) {
          for (var k2 = i + 1; k2 <= 3; k2++) {
            thisBuyRatio = (price[currLevel][j2][i] * 10 ** (k2 - i)) / price[currLevel][j2][k2];
            if (thisBuyRatio > 1) {
              var buyCount = Math.floor((inv[i] * thisBuyRatio) / 10 ** (k2 - i));
              thisProfit = buyCount * (thisBuyRatio - 1) * 10 ** k2;
              if (thisProfit > bestProfit) {
                bestProfit = thisProfit;
                bestBuyIndex = k2;
                bestSellIndex = i;
                bestBuyLoc = j2;
                bestBuyRatio = thisBuyRatio;
              }
            }
          }
        }
      }
    }
  }

  if (bestProfit > 0) {
    var gossipSize = '';
    if (bestBuyRatio < 1.1) {
      gossipSize = 'tolerable';
    } else if (bestBuyRatio < 1.2) {
      gossipSize = 'ok';
    } else if (bestBuyRatio < 1.3) {
      gossipSize = 'good';
    } else if (bestBuyRatio < 1.4) {
      gossipSize = 'very good';
    } else if (bestBuyRatio < 1.6) {
      gossipSize = 'great';
    } else {
      gossipSize = 'fabulous';
    }
    gossipText = locationName[currLevel][bestBuyLoc] + ' has ' + gossipSize + ' prices for those looking';
    if (bestSellIndex > 0) {
      gossipText += ' to sell ' + levelData[currLevel].tradeableItems[bestSellIndex];
    }
    if (bestBuyIndex > 0) {
      gossipText += ' to buy ' + levelData[currLevel].tradeableItems[bestBuyIndex];
    }
    gossipLocation = bestBuyLoc;
  }
  return gossipText;
}

function randomizeStore(initAll = false) {
  // local loop vars to keep strict-mode happy
  var i, j;
  for (i = 1; i < inv.length; i++) {
    for (j = 0; j < levelData[currLevel].numLocations; j++) {
      if (initAll) {
        price[currLevel][j][i] = basePrice[i];
      }
      var formerPrice = price[currLevel][j][i];
      var newPrice = (formerPrice * 2 + basePrice[i]) / 3; // Trend back toward the basePrice
      var variancepct = 0.3;
      if (Math.random() < 0.1) variancepct = 0.5 + Math.random() * 0.45; // Sometimes have wild price swings
      newPrice = Math.round(newPrice + Math.random() * newPrice * variancepct * 2 - newPrice * variancepct);
      if (newPrice > formerPrice * 1.2 && formerPrice <= basePrice) {
        // Prices can sometimes get very high
        while (Math.random() < 0.7 && newPrice < basePrice[i] * 10) newPrice = Math.round(newPrice * 1.2);
      }
      price[currLevel][j][i] = newPrice;
    }
  }
}