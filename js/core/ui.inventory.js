'use strict';

// Returns the full HTML string for the inventory panel, based on current globals.
// Mirrors the original inline builder from app.js.
function renderInventory() {
  var freeSpace2 = calculateFreeSpace();
  var spaceUsed2 = cargoRoom - freeSpace2;

  var invHTML = '';
  var allUpgradesBought = true;

  if (hasAnything()) {
    if (upgradesVisible && !isLevelTransitioning) {
      invHTML += "<table class='collapseborder'>";
      invHTML +=
        "<tr><td class='singleborder invCell invHeaderCell'>Upgrade</td>" +
        "<td class='singleborder invCell invHeaderCell'>Description</td>" +
        "<td class='singleborder invCell invHeaderCell'>Price</td>" +
        "<td class='invCell invHeaderCell'></td></tr>";

      if (currLevel > 0 && visitedAllLocations() && !showingGossipColors) {
        var gossipPrice = 1 * currLevel;
        invHTML +=
          "<tr><td class='singleborder invCell'>Gossip</td>" +
          "<td class='singleborder invCell'>Price rumors</td>" +
          "<td class='singleborder invCell'>" +
          getDisplayNumber(gossipPrice, 'yes') +
          '</td>' +
          "<td class='buyButtonsCell'>";
        invHTML += '<button class="upgradeButton';
        if (inv[3] < gossipPrice) invHTML += ' greyButton';
        invHTML += '" onclick="buyUpgrade(\'gossip\',1,' + gossipPrice + ')">buy</button>';
        invHTML += '</td></tr>';
        allUpgradesBought = false;
      }

      var travelPrice = 2 * (currLevel + 1);
      if (travelTime[currLevel] == 3 + (visitedAllLocations() ? 0 : 1)) {
        invHTML +=
          "<tr><td class='singleborder invCell'>" +
          levelData[currLevel].travelFasterUpgradeDesc[0] +
          '</td>' +
          "<td class='singleborder invCell'>Travel faster</td>" +
          "<td class='singleborder invCell'>" +
          getDisplayNumber(travelPrice, 'yes') +
          '</td>' +
          "<td class='buyButtonsCell'>";
        invHTML += '<button class="upgradeButton';
        if (inv[3] < travelPrice) invHTML += ' greyButton';
        invHTML += '" onclick="buyUpgrade(\'travel\',1,' + travelPrice + ')">buy</button>';
        invHTML += '</td></tr>';
        allUpgradesBought = false;
      } else if (travelTime[currLevel] == 2 + (visitedAllLocations() ? 0 : 1)) {
        travelPrice = 5 * (currLevel + 1);
        invHTML +=
          "<tr><td class='singleborder invCell'>" +
          levelData[currLevel].travelFasterUpgradeDesc[1] +
          '</td>' +
          "<td class='singleborder invCell'>Travel faster</td>" +
          "<td class='singleborder invCell'>" +
          getDisplayNumber(travelPrice, 'yes') +
          '</td>' +
          "<td class='buyButtonsCell'>";
        invHTML += '<button class="upgradeButton';
        if (inv[3] < travelPrice) invHTML += ' greyButton';
        invHTML += '" onclick="buyUpgrade(\'travel\',1,' + travelPrice + ')">buy</button>';
        invHTML += '</td></tr>';
        allUpgradesBought = false;
      }

      if (cargoRoom < 100 * (currLevel + 2)) {
        var cargoPrice = 10 * (currLevel + 1);
        invHTML +=
          "<tr><td class='singleborder invCell'>" +
          levelData[currLevel].cargoUpgradeDesc +
          '</td>' +
          "<td class='singleborder invCell'>Hold 100 more</td>" +
          "<td class='singleborder invCell'>" +
          getDisplayNumber(cargoPrice, 'yes') +
          '</td>' +
          "<td class='buyButtonsCell'>";
        invHTML += '<button class="upgradeButton';
        if (inv[3] < cargoPrice) invHTML += ' greyButton';
        invHTML += '" onclick="buyUpgrade(\'cargo\',100,' + cargoPrice + ')">buy</button>';
        invHTML += '</td></tr>';
        allUpgradesBought = false;
      }

      if (cargoRoom >= 100 * (currLevel + 2) && maxLevel == currLevel) {
        var levelPrice = 20 * (currLevel + 1);
        invHTML +=
          "<tr><td class='singleborder invCell'>" +
          levelData[currLevel].levelUpgradeDesc +
          '</td>' +
          "<td class='singleborder invCell'>Travel further</td>" +
          "<td class='singleborder invCell'>" +
          getDisplayNumber(levelPrice, 'yes') +
          '</td>' +
          "<td class='buyButtonsCell'>";
        invHTML += '<button class="upgradeButton';
        if (inv[3] < levelPrice) invHTML += ' greyButton';
        invHTML += '" onclick="buyUpgrade(\'level\',1,' + levelPrice + ')">buy</button>';
        invHTML += '</td></tr>';
        allUpgradesBought = false;
      }

      if (allUpgradesBought) {
        invHTML +=
          "<tr><td colspan=3 class='singleborder invCell'>" +
          '<br>All upgrades on this level have been purchased!<br>&nbsp;</td><td></td></tr>';
      }
      invHTML += '</table>';
      invHTML += 'Currency: ' + getDisplayNumber(inv[3]) + ' ';
      if (inv[3] == 1) {
        invHTML += levelData[currLevel].tradeableItemsSingular[3];
      } else {
        invHTML += levelData[currLevel].tradeableItems[3];
      }
    } else if (storeVisible && !isLevelTransitioning) {
      invHTML += "<table class='collapseborder'>";
      invHTML +=
        "<tr><td class='invCell invHeaderCell'>Sell</td>" +
        "<td class='invCell invHeaderCell singleborder'>Item</td>" +
        "<td class='invCell invHeaderCell singleborder'>Price</td>" +
        "<td class='invCell invHeaderCell singleborder'>Held</td>" +
        "<td class='invCell invHeaderCell'>Buy</td></tr>";

      for (var i = inv.length - 1; i >= 1; i--) {
        var alertRed = 0;
        var alertGreen = 0;
        var displayPrice = price[currLevel][locIndex][i];
        if (displayPrice > basePrice[i]) {
          alertRed = Math.floor(255 * 2 * (displayPrice / basePrice[i] - 1));
          if (alertRed > 255) alertRed = 255;
        } else if (displayPrice < basePrice[i]) {
          alertGreen = Math.floor(255 * (basePrice[i] / displayPrice - 1));
          if (alertGreen > 255) alertGreen = 255;
        }
        var alertStyle = "style='color:rgb(" + alertRed + ',' + alertGreen + ",0);'";
        invHTML += "<tr><td class='sellButtonsCell'>";
        // Sell buttons
        var sellButtons = '<button class="tradeButton';
        if (inv[i] == 0) {
          sellButtons += ' greyButton';
        }
        sellButtons += '" onclick="sellInv(' + i + ',1)">';
        if (inv[i] <= 10) {
          sellButtons += 'sell ';
        }
        sellButtons += '1</button>';
        var btnAmount = 10;
        while (btnAmount < inv[i] && btnAmount <= 100) {
          sellButtons =
            '<button class="tradeButton" onclick="sellInv(' +
            i +
            ',' +
            btnAmount +
            ')">' +
            getDisplayNumber(btnAmount, 'super') +
            '</button>' +
            sellButtons;
          btnAmount *= 10;
        }
        if (inv[i] > 1) {
          sellButtons =
            '<button class="tradeButton" onclick="sellInv(' + i + ',' + inv[i] + ')">all</button>' + sellButtons;
        }
        invHTML += sellButtons;
        invHTML +=
          "</td><td class='singleborder invCell' " +
          alertStyle +
          '>' +
          addLineBreaks(levelData[currLevel].tradeableItems[i]);
        invHTML += '</td><td class=\'singleborder invCell\' ' + alertStyle + '>' + displayPrice;
        invHTML += "</td><td class='singleborder invCell'>" + getDisplayNumber(inv[i], 'yes');
        invHTML += "</td><td class='buyButtonsCell'>";
        // Buy buttons
        var canBuy = Math.floor(inv[0] / displayPrice);
        var buyButtons = '<button class="tradeButton';
        if (canBuy == 0) {
          buyButtons += ' greyButton';
        }
        buyButtons += '" onclick="buyInv(' + i + ',1)">';
        if (canBuy <= 10) {
          buyButtons += 'buy ';
        }
        buyButtons += '1</button>';
        btnAmount = 10;
        while (btnAmount < canBuy && btnAmount <= 100) {
          buyButtons =
            buyButtons +
            '<button class=tradeButton onclick="buyInv(' +
            i +
            ',' +
            btnAmount +
            ')">' +
            getDisplayNumber(btnAmount, 'super') +
            '</button>';
          btnAmount *= 10;
        }
        if (canBuy > 1) {
          buyButtons = buyButtons + '<button class=tradeButton onclick="buyInv(' + i + ',' + canBuy + ')">all</button>';
        }
        invHTML += buyButtons;
        invHTML += '</td></tr>';
      }
      // Put a dummy row to force horizontal spacing to be what I want
      const buttonsForSpacing =
        '<button class="squashed tradeButton">1</button>' +
        '<button class="squashed tradeButton">10</button>' +
        '<button class="squashed tradeButton">100</button>' +
        '<button class="squashed tradeButton">all</button>';
      invHTML +=
        "<tr class='spacingRow squashed'>" +
        "<td class='sellButtonsCell squashed'>" +
        buttonsForSpacing +
        '</td>' +
        "<td class='singleborder expandyCell squashed' colspan=3>&nbsp;</td>" +
        "<td class='buyButtonsCell squashed'>" +
        buttonsForSpacing +
        '</td>' +
        '</td>';
      invHTML += '</table><table>';
      invHTML += '<tr><td style="text-align:right">' + getDisplayNumber(inv[0]) + '</td><td>';
      if (inv[0] == 1) {
        invHTML += levelData[currLevel].tradeableItemsSingular[0];
      } else {
        invHTML += levelData[currLevel].tradeableItems[0];
      }
      invHTML += ' to spend</td></tr><tr>';
      if (freeSpace2 < 0) {
        if (inv[0] > 0) {
          var discardNum = -freeSpace2;
          if (discardNum > inv[0]) discardNum = inv[0];
          invHTML +=
            "<td colspan=2><button class=discardButton onclick='inv[0] -= " +
            discardNum +
            "; inventoryChanged=true;'>Discard " +
            discardNum +
            ' ';
          if (inv[0] == 1) {
            invHTML += levelData[currLevel].tradeableItemsSingular[0];
          } else {
            invHTML += levelData[currLevel].tradeableItems[0];
          }
          invHTML += '</button></td></tr><tr>';
        }
        invHTML += '<td style="text-align:right; color:red;">';
        invHTML += 'You have ' + (-freeSpace2) + '</td><td style="color:red;">';
        invHTML += 'too many items';
      } else {
        invHTML += '<td style="text-align:right">';
        invHTML += 'Room for ' + freeSpace2 + '</td><td>';
        invHTML += 'more items ';
      }
      invHTML += '(' + spaceUsed2 + '/' + cargoRoom + ')</td></tr></table>';
    } else {
      invHTML += '<table>';
      for (var i2 = inv.length - 1; i2 >= 0; i2--) {
        if (inv[i2] > 0) {
          invHTML += '<tr><td style="text-align:right">' + getDisplayNumber(inv[i2]) + '</td><td>';
          if (inv[i2] == 1) {
            invHTML += levelData[currLevel].tradeableItemsSingular[i2];
          } else {
            invHTML += levelData[currLevel].tradeableItems[i2];
          }
          invHTML += '</td></tr>';
        }
      }
      invHTML += '<tr>';
      if (freeSpace2 < 0) {
        // Offer discard while moving to prevent soft-lock (mirrors store UI behavior)
        if (inv[0] > 0) {
          var discardNum2 = -freeSpace2;
          if (discardNum2 > inv[0]) discardNum2 = inv[0];
          invHTML +=
            "</td></tr><tr><td colspan=2><button class=discardButton onclick='inv[0] -= " +
            discardNum2 +
            "; inventoryChanged=true;'>Discard " +
            discardNum2 +
            ' ';
          if (inv[0] == 1) {
            invHTML += levelData[currLevel].tradeableItemsSingular[0];
          } else {
            invHTML += levelData[currLevel].tradeableItems[0];
          }
          invHTML += '</button></td></tr><tr>';
        }
        invHTML += '<td style="text-align:right; color:red;">';
        invHTML += 'You have ' + (-freeSpace2) + '</td><td style="color:red;">';
        invHTML += 'too many items';
      } else {
        invHTML += '<td style="text-align:right">';
        invHTML += 'Room for ' + freeSpace2 + '</td><td>';
        invHTML += 'more items ';
      }
      invHTML += '(' + spaceUsed2 + '/' + cargoRoom + ')</td></tr></table>';
    }
  }

  return invHTML;
}