'use strict';

function positiveExclamation() {
  var exclamationChoice = [
    'Good Joss!',
    'Yay!',
    'Hooray!',
    'Incredible!',
    'Yes!',
    'Fantastic!',
    'Lucky you!',
    'Fabulous!',
    'Excellent!',
    'Splendid!',
  ];
  return exclamationChoice[Math.floor(Math.random() * exclamationChoice.length)];
}

function negativeExclamation() {
  var exclamationChoice = [
    'Bad Joss!',
    'Oh no!',
    'Boo!',
    'Terrible news!',
    'No!',
    'Bummer!',
    'Bad luck!',
    'Turnip farts!',
    'Dagnabbit!',
    'Poodoo!',
  ];
  return exclamationChoice[Math.floor(Math.random() * exclamationChoice.length)];
}