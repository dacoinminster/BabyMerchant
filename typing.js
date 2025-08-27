'use strict';

// Typing state (these are saved via localStorage in app.js)
var lastChar = ' ';
var alreadyTyped = '';
var textBelow = '';
var textToType = [];
var textToTypeBolded = [];
var waitingMessagesToType = 0;
var lastLineWasBold = false;
var typingText = false;

function isPunctuation(charToCheck) {
  return (
    charToCheck == '.' ||
    charToCheck == ',' ||
    charToCheck == '?' ||
    charToCheck == '!' ||
    charToCheck == ':' ||
    charToCheck == ';'
  );
}

function typeCharacter(characterToType, bolded) {
  if (characterToType == '\n') {
    if (lastLineWasBold) {
      textBelow = '<br><strong class="outputSpan">' + alreadyTyped + '</strong>' + textBelow;
      lastLineWasBold = false;
    } else {
      textBelow = '<br><span class="outputSpan">' + alreadyTyped + '</span>' + textBelow;
    }
    alreadyTyped = '';
  } else {
    alreadyTyped += characterToType;
  }
  if (bolded) {
    lastLineWasBold = true;
    setOutputHTML('<strong class="outputSpan">' + alreadyTyped + '</strong>' + textBelow.substring(0, 4000));
  } else {
    setOutputHTML('<span class="outputSpan">' + alreadyTyped + '</span>' + textBelow.substring(0, 4000));
  }
}

function typeNextText() {
  var thisChar = textToType[0].substring(0, 1);
  typeCharacter(thisChar, textToTypeBolded[0]);
  textToType[0] = textToType[0].substring(1, textToType[0].length);
  var nextWait = 500;
  if (textToType[0].length > 0) {
    var nextChar = textToType[0].substring(0, 1);
    nextWait = 25 + Math.random() * 50;
    if (isPunctuation(lastChar) && !isPunctuation(thisChar)) {
      // Pause after punctuation
      nextWait += 200 + Math.random() * 200;
    } else if (thisChar != '\n' && nextChar == '\n') {
      // Pause before linebreak
      nextWait += 200 + Math.random() * 200;
    } else if (thisChar == ' ') {
      // Slight pause after space
      nextWait += 50 + Math.random() * 50;
    }
  } else {
    waitingMessagesToType--;
    if (waitingMessagesToType > 0) {
      for (i = 0; i < waitingMessagesToType; i++) {
        textToType[i] = textToType[i + 1];
        textToTypeBolded[i] = textToTypeBolded[i + 1];
      }
    } else {
      typingText = false;
      if (typeof needToSave !== 'undefined' && needToSave) {
        if (typeof saveGameState === 'function') {
          saveGameState();
        }
      }
    }
  }
  lastChar = thisChar;
  if (typingText) {
    // Original code always divided by 100 because of "|| true"
    nextWait = nextWait / 100;
    setTimeout('typeNextText()', nextWait);
  }
}

// If titleCardFooter and/or titleCardHeader is passed, then text will be
// displayed as a title card with a header and footer and text will be bolded
// when user returns from title card
function typeText(whatToType, titleCardHeader = '', titleCardFooter = '', titleCardButton = 'OK', titleCardImageName = '') {
  var showTitleCard = titleCardFooter.length > 0 || titleCardHeader.length > 0;
  if (showTitleCard) {
    titleCardHeader = titleCardHeader.charAt(0).toUpperCase() + titleCardHeader.slice(1);
    displayTitleCard(whatToType, titleCardHeader, titleCardFooter, titleCardButton, titleCardImageName);
    whatToType = titleCardHeader + ' ' + whatToType;
  }
  textToType[waitingMessagesToType] = '\n\n' + whatToType;
  textToTypeBolded[waitingMessagesToType] = showTitleCard;
  waitingMessagesToType++;
  if (!typingText) {
    typingText = true;
    typeNextText();
  }
}
