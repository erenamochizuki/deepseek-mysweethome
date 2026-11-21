// 望远镜的罗盘和海面。海面独用一小块画布，波纹起伏时无需重画星空。
(function (V3) {
  'use strict';
  const el=V3.util.el,D=Math.PI/180,tau=2*Math.PI;
  const directions=['北','东北','东','东南','南','西南','西','西北'];
  function compass(onNorth) {
    const face=el('canvas',{'aria-hidden':'true'}), reading=el('span');
    const button=el('button',{type:'button',class:'sv-compass',title:'转向正北','aria-label':'转向正北',onclick:onNorth},face,reading);
    const ctx=face.getContext('2d');let bearing=null, lastTime=0,previous='';
    function draw(az,alt,now,reduced) {
      const delta=bearing===null ? 0 : V3.starFraming.turn(bearing,az);
      bearing=bearing===null || reduced || Math.abs(delta)<.14 ? az : bearing+delta*(1-Math.exp(-Math.max(1,now-lastTime)/60));
      lastTime=now;
      const side=Math.round(face.clientWidth*(window.devicePixelRatio||1));
      const key=side+'/'+bearing.toFixed(2);
      const text=directions[Math.round(az/45)%8]+' · 仰角 '+Math.round(alt)+'°';
      if(reading.textContent!==text) reading.textContent=text;
      if(key!==previous && side) {
        previous=key;if(face.width!==side || face.height!==side) face.width=face.height=side;
        ctx.setTransform(side/96,0,0,side/96,0,0);ctx.clearRect(0,0,96,96);ctx.save();ctx.translate(48,48);
        const rim=(r,ink)=>{ctx.beginPath();ctx.arc(0,0,r,0,tau);ctx.strokeStyle=ink;ctx.lineWidth=.8;ctx.stroke();};
        rim(44,'#839da099');rim(38,'#65848a90');rim(19,'#5a777854');
        for(let deg=0;deg<360;deg+=15) {
          const a=(deg-bearing)*D, x=Math.sin(a),y=-Math.cos(a),major=deg%90===0;
          const inner=major ? 32 : deg%45===0 ? 34 : 36;
          ctx.strokeStyle=deg===0 ? '#efb786' : major ? '#c6d5d2' : '#799599';
          ctx.lineWidth=major ? 1.6 : 1;ctx.beginPath();ctx.moveTo(x*inner,y*inner);ctx.lineTo(x*39.5,y*39.5);ctx.stroke();
          if(major) {
            ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='12px serif';ctx.fillStyle=deg===0 ? '#f3c798' : '#c2d2d2';
            ctx.fillText(directions[deg/45],x*25.8,y*25.8);
          }
        }
        ctx.save();ctx.rotate(-bearing*D);
        for(const [tip,fill] of [[-17,'#efb585'],[14,'#76969b']]) {
          ctx.fillStyle=fill;ctx.beginPath();ctx.moveTo(0,tip);ctx.lineTo(3.3,0);ctx.lineTo(0,tip*.19);ctx.lineTo(-3.3,0);ctx.closePath();ctx.fill();
        }
        ctx.restore();ctx.fillStyle='#e4d7bb';ctx.beginPath();ctx.arc(0,0,2,0,tau);ctx.fill();
        ctx.fillStyle='#e6e6d5';ctx.beginPath();ctx.moveTo(-3.4,-45);ctx.lineTo(3.4,-45);ctx.lineTo(0,-40);ctx.fill();ctx.restore();
      }
      return Math.abs(V3.starFraming.turn(bearing,az))>.13;
    }
    return {button,draw};
  }
  function ocean() {
    const canvas=el('canvas',{class:'sv-sea','aria-hidden':'true'}),ctx=canvas.getContext('2d');
    const rng=V3.util.rng(8137), ripples=Array.from({length:300},()=>[rng(),rng(),rng(),rng()]);
    let w=0,h=0,water=0,sources=[],timer=0,reduced=false,phase=0;
    function draw(now) {
      if(!h || document.hidden || !canvas.isConnected) return;
      const t=reduced ? 0 : now*.00056;
      const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'#354955');grad.addColorStop(.075,'#213743');grad.addColorStop(.53,'#172d39');grad.addColorStop(1,'#10232e');
      ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);ctx.fillStyle='rgba(181,205,207,.28)';ctx.fillRect(0,0,w,.85);
      ctx.strokeStyle='rgba(142,174,182,.15)';ctx.lineWidth=.8;ctx.beginPath();
      for(const [u,v,seed,k] of ripples) {
        const depth=v*v, y=1+depth*h, len=(1+9*depth)*(1+k*2.8),a=t+seed*43;
        const x=((u*w+phase)%(w+24)+w+24)%(w+24)-12+Math.sin(a)*depth*2;
        ctx.moveTo(x,y);ctx.quadraticCurveTo(x+len*.48,y+Math.sin(a)*depth*1.7,x+len,y+.4*Math.sin(a+2));
      }
      ctx.stroke();
      for(const light of sources) {
        const depth=Math.min(h*(1+light.alpha*.6),light.depth),count=Math.max(20,Math.min(64,Math.ceil(depth/4)));
        ctx.save();ctx.translate(light.x,depth*.48);ctx.scale(light.moon ? 15 : 6,depth*.54);
        const gleam=ctx.createRadialGradient(0,0,0,0,0,1);gleam.addColorStop(0,light.color);gleam.addColorStop(1,light.color+'00');
        ctx.globalAlpha=light.alpha*.11;ctx.fillStyle=gleam;ctx.fillRect(-1,-1,2,2);ctx.restore();
        for(let i=0;i<count;i++) {
          const noise=ripples[(i+light.seed)%ripples.length],u=(i+.15+.7*noise[0])/count,y=1+depth*u*(.4+.6*u),a=light.seed+i*9.12;
          const envelope=Math.sin(Math.PI*u)**.55;
          const x=light.x+Math.sin(a+t*.8)*(1+u*5)+(noise[1]-.5)*(3+u*13);
          const span=(1+u*(light.moon ? 23 : 13))*(.35+noise[2])*(.8+.17*Math.sin(a+t))*envelope;
          ctx.globalAlpha=light.alpha*envelope*(.6+.4*Math.sin(a+t*.9));ctx.strokeStyle=light.color;ctx.lineWidth=.7+u*.7;
          ctx.beginPath();ctx.moveTo(x-span,y);ctx.quadraticCurveTo(x,y+.4,x+span,y);ctx.stroke();
        }
      }
      ctx.globalAlpha=1;
    }
    function pulse() {clearTimeout(timer);draw(performance.now());if(h && !reduced && !document.hidden)timer=setTimeout(pulse,125);}
    function update(width,height,horizon,az,lights,still) {
      w=width;water=Math.max(0,Math.ceil(horizon));h=Math.max(0,height-water);sources=lights;reduced=still;phase=-az*w/90;
      canvas.hidden=!h;clearTimeout(timer);if(!h)return;
      const ratio=Math.min(window.devicePixelRatio||1,1.5),pw=Math.round(w*ratio),ph=Math.round(h*ratio);
      if(canvas.width!==pw || canvas.height!==ph) {canvas.width=pw;canvas.height=ph;}
      canvas.style.top=water+'px';canvas.style.height=h+'px';ctx.setTransform(pw/w,0,0,ph/h,0,0);pulse();
    }
    document.addEventListener('visibilitychange',pulse);
    return {canvas,update,dispose(){clearTimeout(timer);document.removeEventListener('visibilitychange',pulse);}};
  }
  V3.starHorizon={compass,ocean};
})(window.V3);
