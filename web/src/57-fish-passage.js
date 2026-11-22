(function (V3) {
  'use strict';
  function frustum() {
    const camera=V3.R?.camera;
    if (!camera) return null;
    camera.updateWorldMatrix(true,false);
    return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  }
  function outside(position,radius) {
    const frame=frustum();
    return !frame || frame.planes.some(plane=>plane.distanceToPoint(position)<-radius);
  }
  // Select a route through water that clears the entire fish, including its fins.
  function course(start,radius=.65,side=1) {
    const frame=frustum(), across=new THREE.Vector3(1,0,0), offshore=new THREE.Vector3(0,0,1);
    if (frame) across.setFromMatrixColumn(V3.R.camera.matrixWorld,0).setY(0).normalize();
    if (across.z<0) across.negate();
    across.multiplyScalar(side);
    for (const direction of [across,across.clone().negate(),across.clone().addScaledVector(offshore,.8).normalize(),offshore]) {
      let distance=frame ? Infinity : 3.5;
      for (const plane of frame?.planes || []) {
        const rate=-plane.normal.dot(direction);
        if (rate>.001) distance=Math.min(distance,(plane.distanceToPoint(start)+radius+.25)/rate);
      }
      distance=Math.max(1,Math.min(distance,160));
      let clear=true;
      for (let d=.35;d<=distance;d+=.35) {
        if (V3.terrain.depthAt(start.x+direction.x*d,start.z+direction.z*d)<.14) {clear=false;break;}
      }
      if (clear || direction===offshore) return {direction,distance};
    }
  }
  function begin(position,yaw,radius,entering) {
    const {direction,distance}=course(position,radius,entering ? -1 : 1);
    const edge=position.clone().addScaledVector(direction,distance);
    return {start:position.clone(),edge,yaw,heading:Math.atan2(direction.x,direction.z)+(entering ? Math.PI : 0),
      age:0,duration:Math.min(4,1.25+.10*distance),radius,entering,complete:false};
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
    leg.complete=p===1;
  }
  V3.fishPassage={course,begin,move,outside};
})(window.V3);
