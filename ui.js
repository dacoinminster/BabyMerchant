'use strict';

// Title card helpers
function setupTitleCard(text, header, footer, button, imageSRC)  {
  document.getElementById('titleMainTextGoesHere').innerHTML = text.replace(/\n/g,'<br/>');
  document.getElementById('titleHeaderTextGoesHere').innerHTML = header;
  if (button === '' && footer === '') {
    document.getElementById('titleCardFooter').style.display = 'none';
  } else {
    document.getElementById('titleFooterTextGoesHere').innerHTML = footer;
    document.getElementById('continueButton').innerHTML = button;
    document.getElementById('titleCardFooter').style.display = 'flex';
  }
  if (imageSRC === '') {
    document.getElementById('titleCardImageGoesHere').style.display = 'none';
  } else {
    document.getElementById('titleCardImageGoesHere').style.backgroundImage = 'url(' + imageSRC + ')';
    document.getElementById('titleCardImageGoesHere').style.display = 'flex';
  }
  document.getElementById('normalGameGoesHere').style.display = 'none';
  document.getElementById('titleCard').style.display = 'flex';
}

function hideTitleCard() {
  if (waitingTitleCards > 0) {
    setupTitleCard(
      waitingTitleText[0],
      waitingTitleHeader[0],
      waitingTitleFooter[0],
      waitingTitleButton[0],
      waitingTitleImage[0]
    );
    for (i = 0; i < waitingTitleCards - 1; i++) {
      waitingTitleHeader[i] = waitingTitleHeader[i+1];
      waitingTitleFooter[i] = waitingTitleFooter[i+1];
      waitingTitleText[i] = waitingTitleText[i+1];
      waitingTitleButton[i] = waitingTitleButton[i+1];
      waitingTitleImage[i] = waitingTitleImage[i+1];
    }
    waitingTitleCards--;
  } else {
    document.getElementById('titleCard').style.display = 'none';
    document.getElementById('normalGameGoesHere').style.display = 'flex';
  }
}

function displayTitleCard(mainText, headerText, footerText, buttonText = 'OK', imageName = '') {
  var imageSRC = 'images/cardImages/' + imageName;

  if (document.getElementById('titleCard').style.display === 'flex') {
    // Already have a title card displayed, so queue this one up
    waitingTitleHeader[waitingTitleCards] = headerText;
    waitingTitleFooter[waitingTitleCards] = footerText;
    waitingTitleText[waitingTitleCards] = mainText;
    waitingTitleButton[waitingTitleCards] = buttonText;
    waitingTitleImage[waitingTitleCards] = imageSRC;
    waitingTitleCards++;
  } else {
    setupTitleCard(mainText, headerText, footerText, buttonText, imageSRC);
  }
}

// UI text helpers
function setHeaderText(newText) {
  document.getElementById('headerTextGoesHere').innerHTML = newText;
  document.getElementById('headerGoesHere').style.display = 'flex';
}

function setStatusText(newText) {
  document.getElementById('headerStatusGoesHere').innerHTML = newText;
  document.getElementById('headerGoesHere').style.display = 'flex';
}

function setInventoryHTML(newHTML) {
  document.getElementById('inventoryGoesHere').innerHTML = newHTML;
  if (newHTML === '') {
    document.getElementById('inventoryGoesHere').style.display = 'none';
  } else {
    document.getElementById('inventoryGoesHere').style.display = 'flex';
  }
}

function setActionsHTML(newHTML) {
  document.getElementById('actionsGoHere').innerHTML = newHTML;
  document.getElementById('actionsGoHere').style.display = 'flex';
  document.getElementById('controlsGoHere').style.display = 'flex';
}

function setDestinationsHTML(newHTML) {
  document.getElementById('destinationsGoHere').innerHTML = newHTML;
}

function setOutputHTML(newHTML) {
  document.getElementById('outputGoesHere').innerHTML = newHTML;
  document.getElementById('outputAndGradient').style.visibility = 'visible';
}

// UI formatting helpers
function getButtonHTML(actionName, buttonText) {
  return '<button class=babyButton id="buttonID' + actionName + '" onclick="doButtonAction(\'' + actionName +'\')">' + buttonText + '</button>';
}

function addLineBreaks(thingThatNeedsLineBreaks) {
  return thingThatNeedsLineBreaks.replace(' ', '<br>');
}
