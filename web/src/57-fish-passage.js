(function (V3) {
  'use strict';
  // Terrain samples clamp at the last cell. Stop at the actual sea mesh.
  function course(start,radius=.65,side=1) {
    const {x0,x1,z1}=V3.layout.site;
    const routes=[
      {direction:new THREE.Vector3(side,0,0),distance:side>0 ? x1-start.x : start.x-x0},
      {direction:new THREE.Vector3(0,0,1),distance:z1-start.z},
      {direction:new THREE.Vector3(-side,0,0),distance:side>0 ? start.x-x0 : x1-start.x},
    ];
    routes.sort((a,b)=>a.distance-b.distance);
    let best=null;
    for (const route of routes) {
      const {direction,distance}=route;
      let wet=0;
      while (wet<distance) {
        const d=Math.min(distance,wet+.2);
        if (V3.terrain.depthAt(start.x+direction.x*d,start.z+direction.z*d)<.14) break;
        wet=d;
      }
      if (wet===distance) return {direction,distance:Math.max(0,distance-radius)};
      const safe=Math.max(0,wet-radius);
      if (!best || safe>best.distance) best={direction,distance:safe};
    }
    return best;
  }
  function begin(position,yaw,radius,entering) {
    const {direction,distance}=course(position,radius,entering ? -1 : 1);
    const edge=position.clone().addScaledVector(direction,distance);
    return {start:position.clone(),edge,yaw,heading:Math.atan2(direction.x,direction.z)+(entering ? Math.PI : 0),
      age:0,duration:Math.min(4,1.25+.10*distance),entering,complete:false};
  }
  function turn(from,to,t) { return from+Math.atan2(Math.sin(to-from),Math.cos(to-from))*t; }
  // During entry the destination follows the live patrol, so position and heading join it smoothly.
  function move(leg,fish,dt) {
    leg.age+=dt;
    const p=Math.min(1,leg.age/leg.duration), ease=p*p*(3-2*p);
    if (leg.entering) {
      fish.position.lerp(leg.edge,1-ease);
      fish.rotation.y=turn(leg.heading,fish.rotation.y,ease*ease);
    } else {
      fish.position.lerpVectors(leg.start,leg.edge,ease);
      fish.rotation.y=turn(leg.yaw,leg.heading,Math.min(1,p*4));
    }
    const {x,z}=fish.position, sea=V3.layout.sea.y;
    fish.position.y=Math.min(sea-.09,Math.max(fish.position.y,sea-V3.terrain.depthAt(x,z)+.07));
    leg.complete=p===1;
    // Instanced reef fish share a mesh. A zero-size matrix hides only this instance.
    const hidden=leg.entering ? p===0 && !leg.rejoining : leg.complete;
    fish.scale.setScalar(hidden ? 0 : 1);
  }
  V3.fishPassage={course,begin,move};
})(window.V3);
