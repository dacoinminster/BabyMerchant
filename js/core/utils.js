'use strict';

// Recursively freezes an object and all nested objects/arrays.
// Note: This simple version does not handle cyclic references or Symbol keys.
function deepFreeze(object) {
  var propNames = Object.getOwnPropertyNames(object);
  for (let name of propNames) {
    let value = object[name];
    if (value && typeof value === 'object') {
      deepFreeze(value);
    }
  }
  return Object.freeze(object);
}
