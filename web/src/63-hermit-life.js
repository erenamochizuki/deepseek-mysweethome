(function (V3) {
  'use strict';
  const { clamp, lerp, smooth } = V3.util, pi = Math.PI;
  const notes = {
    peek: '两只眼睛先探了出来，一边看一眼。', leave: '它从石缝边迈出来了。',
    wander: '它背着壳，深一脚浅一脚地穿过沙地。', sift: '小钳子拨开细沙，挑一点送到嘴边。',
    groom: '它歇下脚，用大钳子轻轻蹭了蹭眼柄。', home: '它转过身，沿着沙地往石堆走。',
    back: '它把壳对准石缝，慢慢倒着挪进去。', rest: '洞口留着一枚安静的壳，钳子正护着脸。',
    notice: '它看见你了！先缩一下，又悄悄探出眼睛。', fit: '它扶稳新壳，左右掂了掂分量。',
  };

  function outing(den, random, leftFirst) {
    const { yard } = den;
    const left = { x: yard.x0 + .4 + random() * .28, z: yard.z1 - .4 - random() * .46 };
    const right = { x: yard.x1 - .4 - random() * .36, z: yard.z0 + .95 + random() * .7 };
    const doorstep = { x: den.x, z: den.frontZ + .56 };
    return [
      { kind: 'peek', seconds: .8 + random() * .5 }, { kind: 'leave', ...doorstep },
      { kind: 'wander', ...(leftFirst ? left : right) }, { kind: 'sift', seconds: 2.8 + random() * 1.4 },
      { kind: 'wander', ...(leftFirst ? right : left) }, { kind: 'groom', seconds: 1.8 + random() },
      { kind: 'home', ...doorstep }, { kind: 'back', x: den.x, z: den.frontZ + .12 },
      { kind: 'rest', seconds: 1.5 + random() * 1.2 },
    ];
  }

  function create(crab, den, random) {
    const bone = name => crab.getObjectByName(name), body = bone('body'), mount = bone('shell_mount');
    const bodyRest = body.position.clone(), mountRest = mount.position.clone();
    const limbs = ['left', 'right'].map((side, index) => {
      const claw = bone('claw_' + side);
      return { sign: index ? 1 : -1, eye: bone('eye_' + side), claw, clawRestZ: claw.position.z,
        legs: [bone('leg_' + side + '_1'), bone('leg_' + side + '_2')] };
    });
    let leftFirst = random() < .5, route = outing(den, random, leftFirst), index = 0, elapsed = 0;
    let activity = 'peek', clock = 0, noticeAge = Infinity, fitAge = 0, footfall = 0, gait = 0, tuck = .85, sift = 0, groom = 0;
    crab.rotation.y = pi;
    crab.position.set(den.x, V3.terrain.seabedY(den.x, den.frontZ + .12) + .012, den.frontZ + .12);
    function advance() {
      elapsed = 0;
      if (++index === route.length) { leftFirst = !leftFirst; route = outing(den, random, leftFirst); index = 0; }
    }
    function turn(target, delta) {
      const difference = target - crab.rotation.y, angle = Math.atan2(Math.sin(difference), Math.cos(difference));
      const step = clamp(angle, -3.4 * delta, 3.4 * delta);
      crab.rotation.y += step;
      return { step, remaining: angle - step };
    }
    function update(delta, fitting) {
      const stop = route[index];
      activity = fitting ? 'fit' : noticeAge < 1.1 ? 'notice' : stop.kind;
      if (delta <= 0) return;
      clock += delta;
      let traveled = 0, turned = 0;
      if (fitting) {
        fitAge += delta;
        turned = turn(pi - .72, delta).step;
      } else if (activity === 'notice') {
        noticeAge += delta;
        if (noticeAge > .45) turned = turn(pi - .48, delta).step;
      } else if (stop.seconds !== undefined) {
        elapsed += delta;
        if (elapsed >= stop.seconds) advance();
      } else {
        const across = stop.x - crab.position.x, along = stop.z - crab.position.z, distance = Math.hypot(across, along);
        const backwards = stop.kind === 'back', target = backwards ? pi : Math.atan2(-across, -along);
        const steering = turn(target, delta); turned = steering.step;
        const speed = backwards ? .26 : stop.kind === 'home' ? .52 : .43;
        traveled = Math.min(distance, delta * speed * (1 - smooth(.08, .85, Math.abs(steering.remaining))) * (.5 + .5 * smooth(0, .16, distance)));
        if (traveled > 0) {
          crab.position.x += across * traveled / distance; crab.position.z += along * traveled / distance;
          crab.position.y = V3.terrain.seabedY(crab.position.x, crab.position.z) + .012;
        }
        if (distance <= traveled + 1e-6) advance();
      }

      const blend = 1 - Math.exp(-9 * delta), steps = traveled + Math.abs(turned) * .075;
      footfall += (activity === 'back' ? -1 : 1) * steps * 24;
      gait = lerp(gait, Math.min(1, steps / (delta * .40)), blend);
      const withdraw = activity === 'rest' ? 1 : activity === 'notice' ? 1 - smooth(.25, .95, noticeAge)
        : fitting ? 1 - smooth(.22, .88, fitAge) : 0;
      tuck = lerp(tuck, withdraw, blend); sift = lerp(sift, +(activity === 'sift'), blend); groom = lerp(groom, +(activity === 'groom'), blend);
      const swing = Math.sin(footfall) * gait, lift = Math.abs(swing), breath = Math.sin(clock * 2.1);
      const scoop = Math.sin(clock * 5.4), brush = Math.sin(clock * 6.5), weigh = fitting && fitAge < 2 ? Math.sin(pi * fitAge / 2) * Math.sin(fitAge * 7) : 0;
      const retreat = 3.25 * tuck;
      body.position.set(bodyRest.x, bodyRest.y - .5 * tuck + .20 * lift + .045 * breath, bodyRest.z + retreat);
      body.rotation.x = -.08 * sift + .024 * lift; body.rotation.z = .038 * swing;
      mount.position.set(mountRest.x, mountRest.y + .5 * tuck, mountRest.z - retreat);
      mount.rotation.z = -.11 * swing + .16 * weigh; mount.rotation.x = .055 * lift + .045 * sift;
      for (const { sign, eye, claw, clawRestZ, legs } of limbs) {
        const gaze = Math.sin(clock * 2.6 + sign * .65);
        eye.rotation.z = (.16 + .11 * (activity === 'peek')) * gaze - sign * .20 * tuck;
        eye.rotation.x = .97 * tuck - .38 * sift - (sign < 0 ? .28 * groom : 0) + .10 * Math.sin(clock * 1.9 + sign);
        claw.position.z = clawRestZ + (sign > 0 ? sift * 1.36 * (1 + scoop) : .85 * groom);
        claw.rotation.x = .70 * tuck + .07 * breath + sign * .10 * swing + (sign > 0 ? sift * (-.07 + .25 * scoop) : groom * (.73 + .15 * brush));
        claw.rotation.y = sign * (.68 * tuck + (sign > 0 ? sift * (.27 + .32 * scoop) : .55 * groom));
        for (let legIndex = 0; legIndex < legs.length; legIndex++) {
          const leg = legs[legIndex];
          const diagonal = legIndex ? -sign : sign;
          leg.rotation.y = sign * (.40 * diagonal * swing - .72 * tuck);
          leg.rotation.z = sign * (.23 * Math.max(0, diagonal * Math.cos(footfall)) * gait + .47 * tuck);
        }
      }
    }
    return { update, notice() { noticeAge = 0; }, tryShell() { noticeAge = Infinity; fitAge = 0; },
      get activity() { return activity; }, get note() { return notes[activity]; } };
  }
  V3.hermitLife = { create };
})(window.V3);
