'use strict';
(function () {

  function routeClick(hit, state, actions) {
    if (!hit) return;

    const transit = (typeof state.transit === 'number' ? state.transit : 0);
    const curr = (typeof state.curr === 'number' ? state.curr : 0);
    const loc = (typeof state.loc === 'number' ? state.loc : 0);
    const next = (typeof state.next === 'number' ? state.next : 0);
    const maxLevel = (typeof state.maxLevel === 'number' ? state.maxLevel : 0);

    const {
      locomote,
      enterTrading,
      levelUp,
      levelDown,
      setNextLocIndex,
      syncRadio,
      updateLocomoteButton,
      markInventoryChanged,
    } = actions;

    switch (hit.type) {
      case 'player':
        if (transit > 0) { try { console.debug('[interactions] locomote (player, in transit)'); } catch(_){}; locomote(); }
        else { try { console.debug('[interactions] enterTrading (player, idle)'); } catch(_){}; enterTrading(); }
        break;

      case 'path':
        if (transit > 0 || next !== loc) { try { console.debug('[interactions] locomote (path)'); } catch(_){}; locomote(); }
        break;

      case 'doorwayL1':
      case 'elevatorL2':
        if (transit > 0) {
          try { console.debug('[interactions] locomote (door/elevator, in transit)'); } catch(_){}
          locomote();
        } else if (maxLevel > curr) {
          try { console.debug('[interactions] levelUp (door/elevator)'); } catch(_){}
          levelUp();
        } else {
          try { console.debug('[interactions] levelUp locked; maxLevel<=curr'); } catch(_){}
        }
        break;

      case 'doorL2': {
        const i = (hit.index !== undefined ? hit.index : -1);
        if (i === -1) break;
        if (transit > 0) {
          try { console.debug('[interactions] locomote (L2 doorway, in transit)'); } catch(_){}
          locomote();
        } else if (i === loc) {
          try { console.debug('[interactions] levelDown (L2 doorway @ current)'); } catch(_){}
          levelDown();
        } else {
          try { console.debug('[interactions] set nextLocIndex (L2 doorway) ->', i); } catch(_){}
          setNextLocIndex(i);
          syncRadio(i);
          updateLocomoteButton();
          markInventoryChanged();
        }
        break;
      }

      case 'groupCircles':
      case 'node': {
        const i = (hit.index !== undefined ? hit.index : -1);
        if (i === -1) break;

        if (transit > 0) {
          try { console.debug('[interactions] locomote (node/group, in transit)'); } catch(_){}
          locomote();
        } else if (i === loc) {
          if (curr === 1 && hit.type === 'groupCircles') {
            try { console.debug('[interactions] levelDown (L1 group circles @ current)'); } catch(_){}
            levelDown();
          } else if (curr === 2 && i > 0 && hit.type === 'node') {
            try { console.debug('[interactions] levelDown (L2 door @ current)'); } catch(_){}
            levelDown();
          } else {
            try { console.debug('[interactions] enterTrading (current location)'); } catch(_){}
            enterTrading();
          }
        } else if (curr === 0) {
          if (typeof window.typeText === 'function') {
            try { console.debug('[interactions] message: level 0 chaotic movement'); } catch(_){}
            window.typeText("Can't choose destination when thrashing about.");
          }
        } else if (i === next) {
          try { console.debug('[interactions] locomote (clicked selected destination)'); } catch(_){}
          locomote();
        } else {
          try { console.debug('[interactions] set nextLocIndex ->', i); } catch(_){}
          setNextLocIndex(i);
          syncRadio(i);
          updateLocomoteButton();
          markInventoryChanged();
        }
        break;
      }

      default:
        break;
    }
  }

  window.MapInteractions = { routeClick };
})();