(function (V3) {
  'use strict';
  const views = {
    hermit:   { az: -.48, el: .30, dist: 1.38, width: .72, height: .50 },
    crab:     { az: Math.PI - .18, el: .26, dist: 1.85, width: .94, height: .52 },
    swimPost: { az: -2.38, el: .31, dist: 2.85, width: .90, height: 1.48 },
    homeTank: { az:.20, el:.13, dist:.85, width:.56, height:.31 },
    returnFish: {az:-1.03,el:.57,dist:2.1,width:1.15,height:.76},
  };
  const aim = new THREE.Vector3();
  let tracking = null;
  const busy = () => !V3.R?.ctl?.enabled || V3.arrange?.on || V3.fb?.enabled;
  const canWatchCrab = () => {
    const pose = V3.sealife?.crab?.now?.();
    return !busy() && !!pose && pose.k !== 'hide';
  };
  function anchor(kind, object) {
    if(kind==='returnFish')return object.visible?object.getWorldPosition(aim):null;
    if (kind === 'homeTank') return object.localToWorld(aim.set(0,.12*object.userData.tankHeight,0));
    if (kind !== 'crab') return object.localToWorld(aim.set(0, kind === 'hermit' ? 4.8 : .63, kind === 'hermit' ? 0 : .08));
    const crab = V3.sealife?.crab, pose = crab?.now();
    if (!pose) return null;
    const [mouthX, mouthZ] = crab.plan.M;
    if (pose.k === 'hide' || (pose.z > mouthZ && Math.abs(pose.x - mouthX) < .12)) {
      return aim.set(mouthX, V3.terrain.crabFloorY(mouthX, mouthZ) + .15, mouthZ);
    }
    return aim.set(pose.x, pose.y + .15, pose.z);
  }
  function focus(kind, object) {
    const view = views[kind];
    if (!view || busy() || !object?.isObject3D || (kind === 'crab' && !canWatchCrab())) return false;
    if (!anchor(kind, object)) return false;
    const { ctl, camera, canvas } = V3.R;
    const panel = V3.shore?.panel;
    let freeWidth = 1, freeHeight = 1;
    if (kind === 'crab') {
      if (panel?.classList.contains('shore-closeup')) V3.shore.close();
    } else if (panel) {
      panel.classList.add('shore-closeup');
      const screen = canvas.getBoundingClientRect(), box = panel.getBoundingClientRect();
      const left = (box.left - screen.left) / screen.width, above = (box.top - screen.top) / screen.height;
      if (left >= .40) freeWidth = V3.util.clamp(left, .4, 1);
      else freeHeight = V3.util.clamp(above, .25, 1);
    }
    const slope = Math.tan(camera.fov * Math.PI / 360), aspect = camera.aspect;
    const size = kind === 'homeTank' ? object.userData.tankWidth : 1;
    const dist = size * Math.max(view.dist, view.width / (2 * slope * aspect * freeWidth), view.height / (2 * slope * freeHeight));
    const across = dist * slope * aspect * (1 - freeWidth), down = dist * slope * (1 - freeHeight);
    const direction=view.az+(kind === 'homeTank' ? object.rotation.y : 0);
    const sin = Math.sin(direction), cos = Math.cos(direction), tilt = down * Math.sin(view.el);
    const offset = new THREE.Vector3(across * cos + tilt * sin, -down * Math.cos(view.el), -across * sin + tilt * cos);
    const delta = direction - ctl.az, az = ctl.az + Math.atan2(Math.sin(delta), Math.cos(delta));
    V3.follow?.set(false);
    ctl.set({ target: aim.add(offset), az, el: view.el, dist }, !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    tracking = kind === 'hermit' || kind === 'crab' || kind === 'returnFish' ? { kind, object, panel, offset, last: aim.clone() } : null;
    return true;
  }
  V3.on('frame', () => {
    if (!tracking) return;
    const { kind, object, panel, offset, last } = tracking, ctl = V3.R?.ctl;
    if (busy() || !object.parent || V3.follow?.on() || !ctl.g.target.equals(last) ||
        (kind !== 'crab' && !panel?.isConnected) || !anchor(kind, object)) { tracking = null; return; }
    ctl.g.target.copy(last.copy(aim).add(offset));
    if (kind === 'crab' && V3.sealife.crab.now().k === 'hide') tracking = null;
  });
  V3.on('model', () => { tracking = null; });
  V3.shoreView = { focus, canWatchCrab };
})(window.V3);
