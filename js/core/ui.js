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
    // Defensive: ensure action buttons are not left hidden after returning from dialogs
    try { if (typeof setActionButtonsTemporarilyHidden === 'function') setActionButtonsTemporarilyHidden(false); } catch (_) {}
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

// Map visibility helper (managed like other sections)
function setMapVisible(show) {
  var el = document.getElementById('mapGoesHere');
  if (!el) return;
  el.style.display = show ? 'flex' : 'none';
  // Notify the renderer so it can re-measure when the host becomes visible
  try {
    if (window.mapRenderer && typeof window.mapRenderer.onHostVisibilityChange === 'function') {
      window.mapRenderer.onHostVisibilityChange(show);
    }
  } catch (_) {}
}

// Lightweight toast for debug notifications; auto-dismisses
function showToast(msg, ms) {
  try {
    var dur = (typeof ms === 'number' && isFinite(ms) && ms > 0) ? ms : 1500;
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.position = 'fixed';
    t.style.left = '50%';
    t.style.bottom = '24px';
    t.style.transform = 'translateX(-50%)';
    t.style.background = 'rgba(0,0,0,0.85)';
    t.style.color = '#fff';
    t.style.padding = '8px 12px';
    t.style.borderRadius = '6px';
    t.style.fontSize = '14px';
    t.style.zIndex = '9999';
    t.style.pointerEvents = 'none';
    document.body.appendChild(t);
    setTimeout(function(){ try { if (t && t.parentNode) t.parentNode.removeChild(t); } catch(_){} }, dur);
  } catch (_) {}
}

// Temporarily hide all action buttons (by visibility) without collapsing layout.
// Stores/restores each button's previous inline visibility in a data attribute.
function setActionButtonsTemporarilyHidden(hide) {
  var container = document.getElementById('controlsGoHere');
  if (!container) return;
  var cls = container.className || '';
  if (hide) {
    if (!/\banimHide\b/.test(cls)) container.className = (cls + ' animHide').trim();
  } else {
    container.className = cls.replace(/\banimHide\b/g, '').replace(/\s{2,}/g, ' ').trim();
  }
}

// UI formatting helpers
function getButtonHTML(actionName, buttonText) {
  return '<button class=babyButton id="buttonID' + actionName + '" onclick="doButtonAction(\'' + actionName +'\')">' + buttonText + '</button>';
}

function addLineBreaks(thingThatNeedsLineBreaks) {
  return thingThatNeedsLineBreaks.replace(' ', '<br>');
}
