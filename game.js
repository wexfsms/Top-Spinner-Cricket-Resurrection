(()=>{'use strict';
  // EDIT HERE: positions are measured on the 800 × 520 canvas.
  // The silhouette, bat motion, and collision shapes use these same values.
  const TUNING={
    shoulderX:284, shoulderY:208, hipX:260, hipY:281,
    headOffsetX:5, headOffsetY:-29,
    backFootX:132, frontFootX:330,
    batLength:92, armReach:74, bladeHalfWidth:5,
    restTipX:286, restTipY:345, batGroundClearance:8,
    wicketX:70, stumpTop:220, stumpBottom:353, stumpGap:6
  };
  // EDIT HERE: target ranges. The "Any" option covers the full 1–1000 range.
  const TARGET_TIERS=[
    {id:'easy',label:'Easy',min:1,max:50},
    {id:'medium',label:'Medium',min:51,max:200},
    {id:'hard',label:'Hard',min:201,max:500},
    {id:'expert',label:'Expert',min:501,max:1000}
  ];
  const TARGET_MODES=[
    {id:'any',label:'Any target',min:TARGET_TIERS[0].min,max:TARGET_TIERS.at(-1).max},
    ...TARGET_TIERS
  ];
  const W=800,H=520,GROUND=355;
  const BL=TUNING.batLength,ARM_REACH=TUNING.armReach;
  const BLADE_HALF_WIDTH=TUNING.bladeHalfWidth,WICKET_X=TUNING.wicketX;
  const STUMP_TOP=TUNING.stumpTop,STUMP_BOTTOM=TUNING.stumpBottom,BAIL_Y=STUMP_TOP-1.5;
  const GRAVITY=330,AIR_DRAG=.00018,MAGNUS=.012;
  // EDIT HERE: weights add to 100 and set relative chances; every [min,max] is randomized.
  // Balls travel left: negative spin is topspin (dips), positive is backspin (floats).
  const DELIVERIES=[
    {name:'SLOW TOPSPIN',  weight:16,speed:[255,290],startY:[140,165],launchVy:[-78,-54],spin:[-28,-21],bounce:[.60,.70]},
    {name:'SLOW BACKSPIN', weight:14,speed:[235,280],startY:[145,175],launchVy:[-82,-58],spin:[21,30],bounce:[.72,.82]},
    {name:'TOPSPIN',       weight:16,speed:[300,345],startY:[143,172],launchVy:[-93,-68],spin:[-21,-14],bounce:[.66,.74]},
    {name:'BACKSPIN',      weight:12,speed:[295,340],startY:[140,175],launchVy:[-85,-60],spin:[14,20],bounce:[.74,.82]},
    {name:'FAST BALL',     weight:12,speed:[505,565],startY:[165,195],launchVy:[-68,-42],spin:[-3,3],bounce:[.60,.70]},
    {name:'FAST TOPSPIN',  weight:8, speed:[465,520],startY:[135,175],launchVy:[-74,-45],spin:[-28,-19],bounce:[.61,.69]},
    {name:'FAST BACKSPIN', weight:8, speed:[460,515],startY:[150,185],launchVy:[-74,-50],spin:[17,25],bounce:[.72,.80]},
    {name:'HIGH FULL TOSS',weight:14,speed:[390,460],startY:[65,85],  launchVy:[-90,-65],spin:[-4,4],bounce:[.62,.72]}
  ];
  const REST={x:TUNING.restTipX,y:TUNING.restTipY};
  const canvas=document.querySelector('#field'),ctx=canvas.getContext('2d');
  const stage=document.querySelector('#stage'),ready=document.querySelector('#ready'),over=document.querySelector('#over'),won=document.querySelector('#won');
  const pauseBtn=document.querySelector('#pause'),soundBtn=document.querySelector('#sound');
  const difficultySelect=document.querySelector('#difficulty');
  for(const mode of TARGET_MODES){
    const option=document.createElement('option');
    option.value=mode.id;
    option.textContent=`${mode.label} (${mode.min}–${mode.max})`;
    difficultySelect.add(option);
  }
  difficultySelect.value='any';
  const pointer={x:REST.x,y:REST.y};
  let state='ready',balls=[],particles=[],floating=[],runs=0,target=0,targetTier='',delivered=0,best=0,spawnIn=1.05,lastDelivery='';
  const body={leanX:0,leanY:0,vx:0,vy:0,hipX:TUNING.hipX,hipY:TUNING.hipY,
    sx:TUNING.shoulderX,sy:TUNING.shoulderY,
    headX:TUNING.shoulderX+TUNING.headOffsetX,
    headY:TUNING.shoulderY+TUNING.headOffsetY,headVX:0,headVY:0};
  const bat={tx:REST.x,ty:REST.y,hx:0,hy:0,prevTX:REST.x,prevTY:REST.y,
    prevHX:0,prevHY:0,angle:0,radius:0,omega:0,radialSpeed:0,
    angular:0,vhx:0,vhy:0};
  const wicket={fallen:false,angle:0,omega:0,direction:-1,timer:0,bails:[]};
  let acc=0,last=performance.now(),muted=false,audio;
  try{best=Number(localStorage.getItem('top-spinner-best-v1'))||0}catch{}
  const rand=(a,b)=>a+Math.random()*(b-a),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function randomTarget(min,max,previous){
    // Draw uniformly from the inclusive integer range, excluding the last target if possible.
    const skipPrevious=max>min&&previous>=min&&previous<=max;
    const count=max-min+1-(skipPrevious?1:0);
    let value=min+Math.floor(Math.random()*count);
    if(skipPrevious&&value>=previous)value++;
    return value;
  }
  const sfx=(frequency=440,duration=.1,type='sine',volume=.05)=>{
    if(muted)return;
    try{audio||=new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();
      const osc=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;
      osc.type=type;osc.frequency.setValueAtTime(frequency,now);osc.frequency.exponentialRampToValueAtTime(Math.max(90,frequency*.68),now+duration);
      gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.001,now+duration);
      osc.connect(gain).connect(audio.destination);osc.start(now);osc.stop(now+duration+.01);
    }catch{}
  };
  // Each joint follows a damped spring: x'' = stiffness * (target - x) - damping * x'.
  function spring(obj,key,velocityKey,target,stiffness,damping,dt){
    obj[velocityKey]+=(stiffness*(target-obj[key])-damping*obj[velocityKey])*dt;
    obj[key]+=obj[velocityKey]*dt;
  }
  function moveBody(dt){
    const targetX=clamp((pointer.x-TUNING.shoulderX)*.25,-57,35);
    const targetY=clamp((pointer.y-230)*.09,-12,15);
    spring(body,'leanX','vx',targetX,105,19,dt);
    spring(body,'leanY','vy',targetY,95,18,dt);
    body.hipX=TUNING.hipX+body.leanX*.28;
    body.hipY=TUNING.hipY+Math.max(0,body.leanY)*.2;
    body.sx=TUNING.shoulderX+body.leanX;
    body.sy=TUNING.shoulderY+body.leanY;
    spring(body,'headX','headVX',body.sx+TUNING.headOffsetX,75,17,dt);
    spring(body,'headY','headVY',body.sy+TUNING.headOffsetY,75,17,dt);
  }
  function poseBat(dt=0){
    const oldX=bat.hx,oldY=bat.hy;
    bat.tx=body.sx+Math.cos(bat.angle)*bat.radius;
    bat.ty=body.sy+Math.sin(bat.angle)*bat.radius;
    bat.hx=body.sx+Math.cos(bat.angle)*(bat.radius-BL);
    bat.hy=body.sy+Math.sin(bat.angle)*(bat.radius-BL);
    if(dt){
      bat.vhx=(bat.hx-oldX)/dt;bat.vhy=(bat.hy-oldY)/dt;
      bat.angular=bat.omega;
    }else{
      bat.vhx=bat.vhy=bat.angular=0;
      bat.prevHX=bat.hx;bat.prevHY=bat.hy;bat.prevTX=bat.tx;bat.prevTY=bat.ty;
    }
  }
  function resetPose(){
    body.leanX=body.leanY=body.vx=body.vy=body.headVX=body.headVY=0;
    body.hipX=TUNING.hipX;body.hipY=TUNING.hipY;
    body.sx=TUNING.shoulderX;body.sy=TUNING.shoulderY;
    body.headX=body.sx+TUNING.headOffsetX;
    body.headY=body.sy+TUNING.headOffsetY;
    bat.angle=Math.atan2(REST.y-body.sy,REST.x-body.sx);
    bat.radius=Math.hypot(REST.x-body.sx,REST.y-body.sy);
    bat.omega=bat.radialSpeed=0;
    poseBat();
  }
  resetPose();
  function moveBat(dt){
    bat.prevHX=bat.hx;bat.prevHY=bat.hy;bat.prevTX=bat.tx;bat.prevTY=bat.ty;
    const dx=pointer.x-body.sx,dy=pointer.y-body.sy;
    const targetAngle=Math.hypot(dx,dy)<1?bat.angle:Math.atan2(dy,dx);
    const angleError=Math.atan2(Math.sin(targetAngle-bat.angle),Math.cos(targetAngle-bat.angle));
    const targetRadius=clamp(Math.hypot(dx,dy),BL-ARM_REACH,BL+ARM_REACH);
    // A spring lets the bat continue through a swing; damping settles it near the mouse.
    bat.omega+=((290*angleError)-(32*bat.omega))*dt;
    bat.omega=clamp(bat.omega,-21,21);
    bat.angle+=bat.omega*dt;
    bat.radialSpeed+=((260*(targetRadius-bat.radius))-(30*bat.radialSpeed))*dt;
    bat.radius=clamp(bat.radius+bat.radialSpeed*dt,BL-ARM_REACH,BL+ARM_REACH);
    if(bat.radius===BL-ARM_REACH||bat.radius===BL+ARM_REACH)bat.radialSpeed=0;
    // Keep the whole blade above the grass even during a fast downward swing.
    if(Math.sin(bat.angle)>.01){
      const floorRadius=(GROUND-TUNING.batGroundClearance-body.sy)/Math.sin(bat.angle);
      if(bat.radius>floorRadius){bat.radius=Math.max(BL-ARM_REACH,floorRadius);bat.radialSpeed=0}
    }
    poseBat(dt);
  }
  function reset(){
    balls=[];particles=[];floating=[];
    const mode=TARGET_MODES.find(item=>item.id===difficultySelect.value)||TARGET_MODES[0];
    target=randomTarget(mode.min,mode.max,target);
    targetTier=TARGET_TIERS.find(tier=>target>=tier.min&&target<=tier.max)?.label||mode.label;
    runs=0;delivered=0;spawnIn=.85;lastDelivery='';
    pointer.x=REST.x;pointer.y=REST.y;
    resetPose();
    wicket.fallen=false;wicket.angle=0;wicket.omega=0;
    wicket.timer=0;wicket.bails=[];
    state='playing';ready.hidden=true;over.hidden=true;won.hidden=true;
    pauseBtn.textContent='Pause';sfx(470,.08);
  }
  function rate(){return delivered ? runs/delivered : 0}
  function saveBest(){
    const score=Math.floor(runs*rate());
    best=Math.max(score,best);
    try{localStorage.setItem('top-spinner-best-v1',best)}catch{}
    return score;
  }
  function end(){
    if(state!=='playing')return;
    state='over';
    const score=saveBest();
    document.querySelector('#endRuns').textContent=runs;
    document.querySelector('#endRate').textContent=rate().toFixed(2);
    document.querySelector('#endScore').textContent=score;
    document.querySelector('#endTarget').textContent=target;
    document.querySelector('#endTier').textContent=targetTier;
    over.hidden=false;
    sfx(210,.28,'sawtooth',.035);
  }
  function win(){
    if(state!=='playing')return;
    state='won';
    const score=saveBest();
    document.querySelector('#winRuns').textContent=runs;
    document.querySelector('#winTarget').textContent=target;
    document.querySelector('#winTier').textContent=targetTier;
    document.querySelector('#winRate').textContent=rate().toFixed(2);
    document.querySelector('#winScore').textContent=score;
    won.hidden=false;
    sfx(720,.22,'triangle',.055);
  }
  function pickDelivery(){
    // Prevent two identical labels in a row while keeping the preset weights.
    const choices=DELIVERIES.filter(p=>p.name!==lastDelivery);
    let roll=Math.random()*choices.reduce((sum,p)=>sum+p.weight,0);
    for(const p of choices){roll-=p.weight;if(roll<0)return p}
    return choices[choices.length-1];
  }
  function spawn(){
    const p=pickDelivery();
    lastDelivery=p.name;
    const b={x:770,y:rand(...p.startY),vx:-rand(...p.speed),
      vy:rand(...p.launchVy),r:8.5,
      bounce:rand(...p.bounce),spin:rand(...p.spin),
      rotation:rand(0,6.28),hit:false,cooldown:0,scored:false};
    balls.push(b);
    delivered++;
    floating.push({x:635,y:245,text:p.name,life:1.3,color:p.name==='HIGH FULL TOSS'?'#fff1b4':'#48331b',size:15});
  }
  function burst(x,y,color,count=9){
    for(let i=0;i<count;i++){
      particles.push({x,y,vx:rand(-115,115),vy:rand(-135,-25),life:rand(.3,.65),max:.65,color,r:rand(2,4)});
    }
  }
  function award(b,points){
    if(state!=='playing')return;
    runs+=points;
    b.scored=true;
    floating.push({x:clamp(b.x,38,735),y:clamp(b.y,45,317),text:'+'+points,life:1.1,color:'#fff7c4',size:30});
    burst(clamp(b.x,20,780),clamp(b.y,20,345),points===6?'#ff3128':points===4?'#ffb028':'#a5df12',14);
    sfx(550+points*54,.17,'triangle',.045);
    if(runs>=target)win();
  }
  function boundary(b){
    if(b.y-b.r<16){
      if(b.x>634)award(b,6);else end();
      return true;
    }
    if(b.x+b.r>784){
      award(b,b.y<100?6:b.y<225?4:2);
      return true;
    }
    if(b.x-b.r<16){
      if(b.y<78)award(b,6);
      else if(b.y<129)award(b,4);
      else end();
      return true;
    }
    return false;
  }
  function fallWicket(cause,impactX){
    if(wicket.fallen||state!=='playing')return;
    wicket.fallen=true;
    wicket.timer=0;
    wicket.direction=impactX<0?-1:1;
    wicket.omega=wicket.direction*5.4;
    wicket.bails=[WICKET_X-TUNING.stumpGap/2,WICKET_X+TUNING.stumpGap/2].map((x,i)=>({x,y:BAIL_Y,vx:wicket.direction*(85+i*25),vy:-145-i*24,
      angle:0,omega:wicket.direction*(7+i*2)}));
    floating.push({x:WICKET_X+48,y:STUMP_TOP-20,text:cause==='bat'?'HIT WICKET!':'BOWLED!',life:1.3,color:'#ffdf78',size:22});
    burst(WICKET_X,STUMP_TOP,'#ffc568',16);
    sfx(170,.22,'sawtooth',.05);
  }
  function advanceWicket(dt){
    wicket.timer+=dt;
    if(Math.abs(wicket.angle)<1.38){
      wicket.omega+=(wicket.direction*4+7*Math.sin(wicket.angle)-wicket.omega*1.1)*dt;
      wicket.angle+=wicket.omega*dt;
      if(Math.abs(wicket.angle)>=1.38){wicket.angle=wicket.direction*1.38;wicket.omega=0}
    }
    for(const bail of wicket.bails){
      bail.vy+=GRAVITY*dt;
      bail.x+=bail.vx*dt;bail.y+=bail.vy*dt;bail.angle+=bail.omega*dt;
      if(bail.y>GROUND-3){bail.y=GROUND-3;bail.vy=Math.abs(bail.vy)>35?-bail.vy*.24:0;bail.vx*=.96}
    }
    // Let the stumps visibly fall before the score panel covers the field.
    if(wicket.timer>1.05)end();
  }
  function pointToSegmentSquared(px,py,ax,ay,bx,by){
    const dx=bx-ax,dy=by-ay;
    const t=clamp(((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1),0,1);
    return (px-ax-dx*t)**2+(py-ay-dy*t)**2;
  }
  function segmentsDistanceSquared(ax,ay,bx,by,cx,cy,dx,dy){
    const abx=bx-ax,aby=by-ay,cdx=dx-cx,cdy=dy-cy;
    const cross=abx*cdy-aby*cdx;
    if(Math.abs(cross)>.0001){
      const acx=cx-ax,acy=cy-ay;
      const t=(acx*cdy-acy*cdx)/cross;
      const u=(acx*aby-acy*abx)/cross;
      if(t>=0&&t<=1&&u>=0&&u<=1)return 0;
    }
    return Math.min(
      pointToSegmentSquared(ax,ay,cx,cy,dx,dy),
      pointToSegmentSquared(bx,by,cx,cy,dx,dy),
      pointToSegmentSquared(cx,cy,ax,ay,bx,by),
      pointToSegmentSquared(dx,dy,ax,ay,bx,by)
    );
  }
  function batSegmentTouchesWicket(ax,ay,bx,by){
    for(const offset of [-TUNING.stumpGap,0,TUNING.stumpGap]){
      const x=WICKET_X+offset;
      const distance=segmentsDistanceSquared(ax,ay,bx,by,x,STUMP_TOP,x,STUMP_BOTTOM);
      if(distance<(BLADE_HALF_WIDTH+1.75)**2)return true;
    }
    // The two bails form a thin horizontal contact line above the stumps.
    return segmentsDistanceSquared(ax,ay,bx,by,WICKET_X-TUNING.stumpGap-1,BAIL_Y,WICKET_X+TUNING.stumpGap+1,BAIL_Y)
      <(BLADE_HALF_WIDTH+1.5)**2;
  }
  function ballTouchesWicket(b){
    for(const offset of [-TUNING.stumpGap,0,TUNING.stumpGap]){
      const x=WICKET_X+offset;
      if(pointToSegmentSquared(b.x,b.y,x,STUMP_TOP,x,STUMP_BOTTOM)<(b.r+1.75)**2)return true;
    }
    return pointToSegmentSquared(b.x,b.y,WICKET_X-TUNING.stumpGap-1,BAIL_Y,WICKET_X+TUNING.stumpGap+1,BAIL_Y)
      <(b.r+1.5)**2;
  }
  function batHitsWicket(){
    // Check the swept bat, not just its final position, so a quick swing counts.
    for(const f of [0,.25,.5,.75,1]){
      const hx=bat.prevHX+(bat.hx-bat.prevHX)*f;
      const hy=bat.prevHY+(bat.hy-bat.prevHY)*f;
      const tx=bat.prevTX+(bat.tx-bat.prevTX)*f;
      const ty=bat.prevTY+(bat.ty-bat.prevTY)*f;
      if(batSegmentTouchesWicket(hx,hy,tx,ty))return true;
    }
    return false;
  }
  function advanceBall(b,dt){
    const speed=Math.hypot(b.vx,b.vy);
    // Quadratic air resistance and a small Magnus force perpendicular to flight.
    const ax=-AIR_DRAG*speed*b.vx-MAGNUS*b.spin*b.vy;
    const ay=GRAVITY-AIR_DRAG*speed*b.vy+MAGNUS*b.spin*b.vx;
    b.vx+=ax*dt;
    b.vy+=ay*dt;
    b.x+=b.vx*dt;
    b.y+=b.vy*dt;
    b.rotation+=b.spin*dt;
    b.spin*=Math.exp(-.1*dt);

    if(b.y+b.r<GROUND || b.vy<0)return;
    b.y=GROUND-b.r;
    const incoming=b.vy;
    b.vy=incoming<55?0:-incoming*b.bounce;
    // The contact patch slides or grips: friction trades sideways speed for spin.
    const slip=b.vx-b.spin*b.r;
    const maxFriction=.10*(1+b.bounce)*incoming;
    const frictionImpulse=clamp(-slip*.08,-maxFriction,maxFriction);
    b.vx+=frictionImpulse;
    b.spin=clamp(b.spin-2*frictionImpulse/b.r,-28,28);
    if(b.vy===0)b.vx*=Math.exp(-1.4*dt);
  }
  function hitBat(b){
    let nearest={dist:Infinity};
    // Three blade positions cover the space crossed during a quick mouse swipe.
    for(const fraction of [0,.5,1]){
      const hx=bat.prevHX+(bat.hx-bat.prevHX)*fraction;
      const hy=bat.prevHY+(bat.hy-bat.prevHY)*fraction;
      const tx=bat.prevTX+(bat.tx-bat.prevTX)*fraction;
      const ty=bat.prevTY+(bat.ty-bat.prevTY)*fraction;
      const ax=hx+(tx-hx)*22/BL,ay=hy+(ty-hy)*22/BL;
      const sx=tx-ax,sy=ty-ay;
      const t=clamp(((b.x-ax)*sx+(b.y-ay)*sy)/(sx*sx+sy*sy),0,1);
      const px=ax+sx*t,py=ay+sy*t,dx=b.x-px,dy=b.y-py,dist=Math.hypot(dx,dy);
      if(dist<nearest.dist)nearest={px,py,dx,dy,dist,t};
    }
    const {px,py,dx,dy,dist,t}=nearest;
    if(dist>b.r+BLADE_HALF_WIDTH || b.cooldown>0)return;
    const nx=dist>0?dx/dist:1,ny=dist>0?dy/dist:0;
    const arm=22+t*(BL-22);
    const bladeVx=bat.vhx-Math.sin(bat.angle)*bat.angular*arm;
    const bladeVy=bat.vhy+Math.cos(bat.angle)*bat.angular*arm;
    const relativeX=b.vx-bladeVx,relativeY=b.vy-bladeVy;
    const approach=relativeX*nx+relativeY*ny;
    if(approach>=-8)return;
    const power=clamp(Math.hypot(bladeVx,bladeVy)*.26,0,225);
    b.x=px+nx*(b.r+BLADE_HALF_WIDTH+.5);
    b.y=py+ny*(b.r+BLADE_HALF_WIDTH+.5);
    // First resolve the impact relative to the moving blade. The bat angle
    // and swing speed set the contact impulse before the arcade scoring assist.
    const normalImpulse=clamp(-(1+.86)*approach,0,850);
    const tangentX=-ny,tangentY=nx;
    const slip=relativeX*tangentX+relativeY*tangentY-b.spin*b.r;
    const tangentImpulse=clamp(-slip*.15,-normalImpulse*.23,normalImpulse*.23);
    b.vx=clamp(b.vx+normalImpulse*nx+tangentImpulse*tangentX,-650,650);
    b.vy=clamp(b.vy+normalImpulse*ny+tangentImpulse*tangentY,-580,500);
    b.spin=clamp(b.spin-2*tangentImpulse/b.r,-30,30);
    // A clean front-face shot gets a modest batting assist. The spin, bounce,
    // contact direction, and swing speed still decide its later flight.
    if(b.x>body.sx+8&&bat.tx>body.sx+18&&nx>.12){
      b.vx=Math.max(b.vx,260+clamp(Math.max(0,bladeVx)*.25,0,150));
      b.vy=Math.min(b.vy,-145-clamp(Math.max(0,-bladeVy)*.32,0,195));
    }
    b.hit=true;b.cooldown=.11;
    // The same impact nudges the arms and upper body for a visible follow-through.
    bat.omega-=clamp(normalImpulse*(Math.cos(bat.angle)*ny-Math.sin(bat.angle)*nx)*.002,-2.5,2.5);
    body.vx-=nx*normalImpulse*.08;
    body.vy-=ny*normalImpulse*.035;
    burst(b.x,b.y,'#fff7d1',9);floating.push({x:b.x+24,y:b.y-12,text:'THWACK!',life:.65,color:'#fff8c0',size:15});sfx(140+power*.7,.09,'square',.04);
  }
  function step(dt){
    moveBody(dt);
    moveBat(dt);
    if(!wicket.fallen&&batHitsWicket()){
      const tipVelocityX=(bat.tx-bat.prevTX)/dt;
      fallWicket('bat',tipVelocityX);
    }
    if(wicket.fallen){
      for(const b of balls)if(!b.scored)advanceBall(b,dt);
      advanceWicket(dt);
    }else{
      spawnIn-=dt;
      if(spawnIn<=0){spawn();spawnIn=rand(2.25,2.85)}
      for(const b of balls){
        if(b.scored)continue;
        b.cooldown=Math.max(0,b.cooldown-dt);
        advanceBall(b,dt);
        hitBat(b);
        if(ballTouchesWicket(b)){fallWicket('ball',b.vx);break}
        if(boundary(b))break;
      }
    }
    balls=balls.filter(b=>!b.scored&&b.x>-40&&b.x<W+40);
    for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=280*dt;p.life-=dt}
    particles=particles.filter(p=>p.life>0);
    for(const f of floating){f.y-=25*dt;f.life-=dt}
    floating=floating.filter(f=>f.life>0);
  }
  function stripes(x,y,w,h,c1,c2,slant=1){
    ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillStyle=c1;ctx.fillRect(x,y,w,h);
    ctx.fillStyle=c2;for(let i=-h-30;i<w+h+30;i+=24){ctx.beginPath();ctx.moveTo(x+i,y);ctx.lineTo(x+i+11,y);ctx.lineTo(x+i+11+slant*h,y+h);ctx.lineTo(x+i+slant*h,y+h);ctx.closePath();ctx.fill()}ctx.restore();
  }
  function drawBackdrop(){
    let sky=ctx.createLinearGradient(0,0,0,GROUND);sky.addColorStop(0,'#efdcf5');sky.addColorStop(.55,'#afaff1');sky.addColorStop(1,'#89a9f1');ctx.fillStyle=sky;ctx.fillRect(0,0,W,GROUND);
    ctx.fillStyle='#526a1d';ctx.fillRect(0,GROUND-5,W,12);ctx.fillStyle='#172710';ctx.fillRect(0,GROUND+5,W,7);
    for(let x=0;x<800;x+=3){const n=((x*29+41)%17);ctx.strokeStyle=n<5?'#14260e':n<12?'#344b16':'#617522';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,GROUND+1);ctx.lineTo(x+((x*7)%5)-2,GROUND-3-n%5);ctx.stroke()}
    const dirt=ctx.createLinearGradient(0,GROUND+12,0,H);dirt.addColorStop(0,'#1b1105');dirt.addColorStop(1,'#2b1907');ctx.fillStyle=dirt;ctx.fillRect(0,GROUND+12,W,H-GROUND-12);
    // The original's striped boundaries are part of the playing field.
    stripes(15,0,620,15,'#ffe728','#0b0906');stripes(635,0,150,15,'white','#f12119');
    stripes(0,15,15,63,'#ef1f1d','white');stripes(0,78,15,51,'#f9ad24','white');stripes(0,129,15,226,'#ffe728','#080707');
    stripes(785,15,15,85,'#e92320','white');stripes(785,100,15,125,'#f6a925','white');stripes(785,225,15,130,'#8dd323','white');
    ctx.font='bold 14px Arial';ctx.textAlign='center';ctx.fillStyle='#211909';ctx.fillText('0',9,12);ctx.fillText('0',629,12);ctx.fillStyle='#e01811';ctx.fillText('6',646,12);
    ctx.fillStyle='#fdf8ba';for(const [y,s] of [[42,'6'],[99,'4'],[175,'4'],[270,'2'],[326,'2']])ctx.fillText(s,793,y);
    for(const [y,s] of [[36,'6'],[103,'4'],[181,'0']]){ctx.fillStyle=y===181?'#16130a':'#fff8c9';ctx.fillText(s,8,y)}
  }
  function ellipse(x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill()}
  function limb(x1,y1,x2,y2,width,color){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()}
  function drawBat(){
    ctx.save();ctx.translate(bat.hx,bat.hy);ctx.rotate(bat.angle);
    // The handle and tapered wooden blade share the collision segment (hand → tip).
    ctx.fillStyle='#ad814a';ctx.fillRect(0,-2.8,31,5.6);
    ctx.fillStyle='#193047';ctx.fillRect(0,-3.2,25,6.4);
    ctx.fillStyle='#36566a';for(let x=5;x<23;x+=6)ctx.fillRect(x,-3.2,1.3,6.4);
    ctx.fillStyle='#d8b671';ctx.beginPath();ctx.moveTo(27,-3.1);
    ctx.lineTo(36,-BLADE_HALF_WIDTH*.83);ctx.lineTo(BL-9,-BLADE_HALF_WIDTH);
    ctx.quadraticCurveTo(BL+2,-BLADE_HALF_WIDTH,BL,0);
    ctx.quadraticCurveTo(BL+2,BLADE_HALF_WIDTH,BL-9,BLADE_HALF_WIDTH);
    ctx.lineTo(36,BLADE_HALF_WIDTH*.83);ctx.lineTo(27,3.1);ctx.closePath();
    const wood=ctx.createLinearGradient(0,-BLADE_HALF_WIDTH,0,BLADE_HALF_WIDTH);
    wood.addColorStop(0,'#f7dc98');wood.addColorStop(.35,'#e8ba6a');wood.addColorStop(.8,'#cd914b');wood.addColorStop(1,'#9d622e');
    ctx.fillStyle=wood;ctx.fill();ctx.strokeStyle='#9c6b37';ctx.lineWidth=.9;ctx.stroke();
    ctx.strokeStyle='#fff0b4';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(34,-2.5);ctx.lineTo(BL-10,-BLADE_HALF_WIDTH+1.2);ctx.stroke();
    ctx.strokeStyle='#bd8440';ctx.lineWidth=.75;ctx.beginPath();ctx.moveTo(39,1.8);ctx.lineTo(BL-11,2.1);ctx.stroke();ctx.restore();
  }
  function drawBatTrail(){
    if(Math.abs(bat.angular)<2&&Math.hypot(bat.vhx,bat.vhy)<125)return;
    const dx=bat.prevTX-bat.prevHX,dy=bat.prevTY-bat.prevHY;
    ctx.save();ctx.globalAlpha=.17;ctx.lineCap='round';ctx.lineWidth=8;
    ctx.strokeStyle='#fff3c4';ctx.beginPath();
    ctx.moveTo(bat.prevHX+dx*.35,bat.prevHY+dy*.35);
    ctx.lineTo(bat.prevTX,bat.prevTY);ctx.stroke();ctx.restore();
  }
  function armElbow(sx,sy,hx,hy,bend){
    const dx=hx-sx,dy=hy-sy,d=Math.max(1,Math.hypot(dx,dy));
    const upper=43,lower=45;
    const along=clamp((upper*upper-lower*lower+d*d)/(2*d),0,upper);
    const side=Math.sqrt(Math.max(0,upper*upper-along*along))*bend;
    return {x:sx+dx/d*along-dy/d*side,y:sy+dy/d*along+dx/d*side};
  }
  function drawPad(knee,ankle,width){
    const angle=Math.atan2(ankle.y-knee.y,ankle.x-knee.x),length=Math.hypot(ankle.x-knee.x,ankle.y-knee.y);
    ctx.save();ctx.translate(knee.x,knee.y);ctx.rotate(angle);
    const g=ctx.createLinearGradient(0,-width/2,0,width/2);
    g.addColorStop(0,'#cbd2d7');g.addColorStop(.3,'#fff');g.addColorStop(.7,'#f7f8f4');g.addColorStop(1,'#b8c3ce');
    ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(2,-width*.55);ctx.lineTo(length-4,-width*.48);
    ctx.quadraticCurveTo(length+3,0,length-4,width*.48);ctx.lineTo(2,width*.55);
    ctx.quadraticCurveTo(-5,0,2,-width*.55);ctx.fill();
    for(const x of [5,14,length-12]){
      if(x>length-5)continue;
      ctx.strokeStyle=x===14?'#d0d6d8':'#e9ece8';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(x,-width*.46);ctx.lineTo(x,width*.46);ctx.stroke();
    }
    ctx.restore();
  }
  function drawShoe(x,y,front){
    ctx.save();ctx.translate(x,y);
    ctx.fillStyle='#aab8c4';ctx.beginPath();ctx.ellipse(front?6:-5,2,19,6,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fbfcf8';ctx.beginPath();ctx.ellipse(front?6:-5,-1,18,6,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#d4dce0';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-8,-2);ctx.lineTo(8,-2);ctx.stroke();ctx.restore();
  }
  function drawGlove(x,y,angle,far=false){
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);
    ctx.fillStyle=far?'#c6d7e5':'#d9e9ec';ctx.fillRect(-6,-7,10,14);
    ctx.fillStyle='#14769c';ctx.fillRect(-6,-7,4,14);
    ctx.fillStyle='#fafbf6';ctx.beginPath();ctx.ellipse(6,0,10,8,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#bdcbd4';ctx.lineWidth=1;
    for(const y of [-3,1,5]){ctx.beginPath();ctx.moveTo(5,y);ctx.lineTo(13,y);ctx.stroke()}
    ctx.restore();
  }
  function drawPlayer(){
    const hipX=body.hipX,hipY=body.hipY,sx=body.sx,sy=body.sy;
    const backFoot={x:TUNING.backFootX+body.leanX*.08,y:GROUND-9};
    const frontFoot={x:TUNING.frontFootX+body.leanX*.06,y:GROUND-9};
    const backKnee={x:(hipX-14+backFoot.x)/2+5,y:GROUND-56+body.leanY*.13};
    const frontKnee={x:(hipX+12+frontFoot.x)/2+8,y:GROUND-69+body.leanY*.12};
    drawWicket();
    ellipse((backFoot.x+frontFoot.x)/2,GROUND-2,(frontFoot.x-backFoot.x)/2+22,5,'#16220d88');
    // Planted shoes and articulated, padded legs give the batter a proper stance.
    limb(hipX-15,hipY+3,backKnee.x,backKnee.y,23,'#f7f8f2');
    limb(backKnee.x,backKnee.y,backFoot.x,backFoot.y,19,'#e3e9ec');
    drawPad(backKnee,backFoot,22);drawShoe(backFoot.x,GROUND-6,false);
    limb(hipX+13,hipY+2,frontKnee.x,frontKnee.y,24,'#f5f5ee');
    limb(frontKnee.x,frontKnee.y,frontFoot.x,frontFoot.y,22,'#dfe5e7');
    drawPad(frontKnee,frontFoot,25);drawShoe(frontFoot.x,GROUND-6,true);

    const hand2={x:bat.hx+Math.cos(bat.angle)*15,y:bat.hy+Math.sin(bat.angle)*15};
    const farShoulder={x:sx-15,y:sy+9},nearShoulder={x:sx+14,y:sy+7};
    const farElbow=armElbow(farShoulder.x,farShoulder.y,hand2.x,hand2.y,-1);
    limb(farShoulder.x,farShoulder.y,farElbow.x,farElbow.y,21,'#f5f6f0');
    limb(farElbow.x,farElbow.y,hand2.x,hand2.y,11,'#b97849');
    const behind=bat.tx<sx-12;
    if(behind)drawBat();
    // Shaded shirt follows the spring-driven shoulder and hips.
    const shirt=ctx.createLinearGradient(sx-23,0,sx+22,0);
    shirt.addColorStop(0,'#fdfdf9');shirt.addColorStop(.42,'#f9faf4');shirt.addColorStop(1,'#cdd4cc');
    ctx.fillStyle=shirt;ctx.beginPath();ctx.moveTo(sx-20,sy-5);
    ctx.quadraticCurveTo(sx,sy-13,sx+19,sy-4);
    ctx.lineTo(hipX+19,hipY+4);ctx.quadraticCurveTo(hipX,hipY+15,hipX-18,hipY+5);
    ctx.closePath();ctx.fill();
    ctx.strokeStyle='#d0d6cf';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(sx-7,sy+1);ctx.lineTo(hipX+2,hipY+4);ctx.stroke();
    ctx.fillStyle='#e4bd3d';ctx.beginPath();ctx.arc(sx+7,sy+17,2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#315e47';ctx.fillRect(sx+6,sy+15,2,3);
    limb(sx+1,sy-8,body.headX-1,body.headY+14,12,'#b7774b');
    const hx=body.headX,hy=body.headY;
    ctx.save();ctx.translate(hx,hy);ctx.rotate(clamp(-body.leanX*.002,-.12,.12));
    const face=ctx.createLinearGradient(-10,-8,15,16);
    face.addColorStop(0,'#dfaa72');face.addColorStop(1,'#aa683c');
    ellipse(2,1,15,19,face);
    ellipse(14,3,2.3,2,'#965931');
    ctx.fillStyle='#795033';ctx.beginPath();ctx.moveTo(-2,12);ctx.quadraticCurveTo(5,17,11,10);ctx.lineTo(8,16);ctx.lineTo(-1,16);ctx.fill();
    // Helmet dome, peak, and neck guard replace the old hair oval.
    const helmet=ctx.createLinearGradient(-15,-31,20,-4);
    helmet.addColorStop(0,'#3f6682');helmet.addColorStop(.44,'#1f3d59');helmet.addColorStop(1,'#0a223d');
    ctx.fillStyle=helmet;ctx.beginPath();ctx.moveTo(-22,-8);
    ctx.quadraticCurveTo(-22,-35,-1,-36);
    ctx.quadraticCurveTo(21,-37,22,-13);ctx.lineTo(16,-7);ctx.closePath();ctx.fill();
    ctx.fillStyle='#102941';ctx.beginPath();ctx.moveTo(-2,-9);ctx.quadraticCurveTo(18,-14,28,-7);
    ctx.quadraticCurveTo(25,0,12,-1);ctx.lineTo(-2,-3);ctx.fill();
    ctx.fillStyle='#56695b';ctx.beginPath();ctx.moveTo(-18,-9);ctx.lineTo(-7,-6);ctx.lineTo(-9,12);ctx.lineTo(-21,9);ctx.closePath();ctx.fill();
    ctx.fillStyle='#f3d884';ctx.fillRect(17,-22,2.3,8);
    ctx.restore();

    const nearElbow=armElbow(nearShoulder.x,nearShoulder.y,bat.hx,bat.hy,1);
    limb(nearShoulder.x,nearShoulder.y,nearElbow.x,nearElbow.y,22,'#f9faf5');
    limb(nearElbow.x,nearElbow.y,bat.hx,bat.hy,11,'#c28b58');
    if(!behind)drawBat();
    drawGlove(hand2.x,hand2.y,bat.angle,true);
    drawGlove(bat.hx,bat.hy,bat.angle);
  }
  function drawWicket(){
    for(let i=0;i<3;i++){
      ctx.save();ctx.translate(WICKET_X+(i-1)*TUNING.stumpGap,STUMP_BOTTOM);
      ctx.rotate(wicket.angle+(wicket.fallen?(i-1)*.035:0));
      ctx.fillStyle='#ce8540';ctx.fillRect(-1.75,STUMP_TOP-STUMP_BOTTOM,3.5,STUMP_BOTTOM-STUMP_TOP);
      ctx.fillStyle='#ffce7c';ctx.fillRect(-1.75,STUMP_TOP-STUMP_BOTTOM,1.35,STUMP_BOTTOM-STUMP_TOP-1);
      ctx.fillStyle='#e9af61';ctx.beginPath();ctx.ellipse(0,STUMP_TOP-STUMP_BOTTOM,1.75,2,0,0,Math.PI*2);ctx.fill();
      ctx.restore();
    }
    if(!wicket.fallen){
      ctx.fillStyle='#f4c57b';ctx.fillRect(WICKET_X-TUNING.stumpGap-1,BAIL_Y-1.5,TUNING.stumpGap+1,3);
      ctx.fillRect(WICKET_X,BAIL_Y-1.5,TUNING.stumpGap+1,3);
    }else{
      for(const bail of wicket.bails){
        ctx.save();ctx.translate(bail.x,bail.y);ctx.rotate(bail.angle);
        ctx.fillStyle='#eeb765';ctx.fillRect(-5,-1.5,10,3);ctx.restore();
      }
    }
  }
  function drawBall(b){
    ctx.save();ctx.translate(b.x,b.y);ctx.rotate(b.rotation);ctx.shadowColor='#1119';ctx.shadowBlur=5;ctx.shadowOffsetY=2;
    let g=ctx.createRadialGradient(-3,-4,1,0,0,b.r);g.addColorStop(0,'#fff');g.addColorStop(.65,'#f4f4ec');g.addColorStop(1,'#8eaaa5');ctx.fillStyle=g;
    ctx.beginPath();ctx.arc(0,0,b.r,0,Math.PI*2);ctx.fill();ctx.shadowColor='transparent';
    ctx.strokeStyle='#bf4a44';ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(-2,0,5,-1.2,1.2);ctx.stroke();ctx.beginPath();ctx.arc(2,0,5,1.94,4.34);ctx.stroke();ctx.restore();
  }
  function drawHud(){
    ctx.textAlign='left';ctx.save();ctx.translate(13,411);ctx.rotate(-.12);ctx.font='1000 50px Arial';ctx.fillStyle='#f60d0a';ctx.fillText('TOP',0,0);ctx.restore();
    ctx.font='1000 23px Arial';ctx.fillStyle='#fff419';ctx.fillText('SPINNER',11,460);
    ctx.font='bold 11px Arial';ctx.fillStyle='#7c5a20';ctx.fillText('© foddy.net 2008 · recreation',11,482);
    ctx.textAlign='center';ctx.fillStyle='#faf8ed';ctx.font='bold 33px Arial';ctx.fillText(runs+' runs',405,406);
    ctx.font='bold 30px Arial';ctx.fillText('Strike Rate: '+rate().toFixed(2),405,445);
    ctx.font='bold 15px Arial';ctx.fillStyle='#abaaa3';ctx.textAlign='right';ctx.fillText('Best: '+best,744,412);
    if(target){
      ctx.fillStyle='#f5da7f';ctx.font='bold 18px Arial';ctx.fillText('Target: '+target,744,439);
      ctx.fillStyle='#d3be89';ctx.font='bold 13px Arial';
      ctx.fillText(targetTier+' · '+(state==='won'?'Chased!':'Need '+Math.max(0,target-runs)),744,458);
      ctx.fillStyle='#614a24';ctx.fillRect(612,468,132,7);
      ctx.fillStyle='#e5c352';ctx.fillRect(612,468,132*clamp(runs/target,0,1),7);
    }
    ctx.textAlign='center';ctx.font='13px Arial';ctx.fillStyle='#a27d3e';ctx.fillText('Use the mouse to swing. A ball or your bat touching the stumps is OUT.',490,500);
    if(state==='paused'){ctx.fillStyle='#140e08b8';ctx.fillRect(15,15,770,340);ctx.fillStyle='#f7e4a1';ctx.font='bold 53px Arial';ctx.fillText('PAUSED',400,172);ctx.font='bold 18px Arial';ctx.fillText('Press P or click Resume',400,208)}
  }
  function render(){ctx.clearRect(0,0,W,H);drawBackdrop();drawBatTrail();drawPlayer();for(const b of balls)if(!b.scored)drawBall(b);
    for(const p of particles){ctx.globalAlpha=clamp(p.life/p.max,0,1);ellipse(p.x,p.y,p.r,p.r,p.color)}ctx.globalAlpha=1;
    ctx.textAlign='center';for(const f of floating){ctx.globalAlpha=clamp(f.life,0,1);ctx.fillStyle='#21170c99';ctx.font='bold '+f.size+'px Arial';ctx.fillText(f.text,f.x+2,f.y+2);ctx.fillStyle=f.color;ctx.fillText(f.text,f.x,f.y)}ctx.globalAlpha=1;
    drawHud();
  }
  function tick(now){
    const dt=Math.min((now-last)/1000,.05);
    last=now;
    if(state==='playing'){
      acc+=dt;
      let steps=0;
      while(acc>=1/120&&steps++<7){
        step(1/120);
        acc-=1/120;
        if(state!=='playing')break;
      }
    }else acc=0;
    render();
    requestAnimationFrame(tick);
  }
  function aim(e){
    const rect=canvas.getBoundingClientRect();
    pointer.x=clamp((e.clientX-rect.left)*W/rect.width,10,W-10);
    pointer.y=clamp((e.clientY-rect.top)*H/rect.height,15,GROUND-18);
  }
  stage.addEventListener('pointermove',aim);
  stage.addEventListener('pointerdown',e=>{if(e.target!==stage&&e.target!==canvas)return;aim(e);if(state==='ready'||state==='over'||state==='won')reset();stage.setPointerCapture?.(e.pointerId)});
  document.querySelector('#start').addEventListener('click',e=>{e.stopPropagation();reset()});
  document.querySelector('#again').addEventListener('click',e=>{e.stopPropagation();reset()});
  document.querySelector('#next').addEventListener('click',e=>{e.stopPropagation();reset()});
  document.querySelector('#reset').addEventListener('click',reset);
  function togglePause(){if(state==='playing'){state='paused';pauseBtn.textContent='Resume'}else if(state==='paused'){state='playing';pauseBtn.textContent='Pause'}}
  pauseBtn.addEventListener('click',togglePause);
  soundBtn.addEventListener('click',()=>{muted=!muted;soundBtn.textContent=muted?'Sound off':'Sound on';soundBtn.setAttribute('aria-pressed',String(!muted));if(!muted)sfx(550,.06)});
  document.addEventListener('keydown',e=>{if(e.code==='KeyP')togglePause();if(e.code==='KeyR')reset();if((e.code==='Space'||e.code==='Enter')&&(state==='ready'||state==='over'||state==='won')){e.preventDefault();reset()}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='playing')togglePause()});
  render();requestAnimationFrame(tick);
})();
