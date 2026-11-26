/* Live WebGL desert shared by every page. Desert.create(canvas, {reduce}) returns render(time, t, travelZ) or null. */
window.Desert = (() => {
  /* ---------------- light over the day ---------------- */
  const K = [
    [0.00,  3, "#4A6596","#F2B98A","#FFB27A","#7A7690"],
    [0.14, 20, "#4C7DBE","#E9D8C4","#FFE6C8","#9AA6BC"],
    [0.36, 58, "#3F78C6","#D3E2EC","#FFF8EE","#A9BDD3"],
    [0.56, 32, "#4479BE","#DCE4E8","#FFF0DC","#A3B2C6"],
    [0.70, 11, "#5B82B5","#F3C79A","#FFB463","#998A96"],
    [0.80, -1, "#3A4A7A","#F08A52","#FF6A2A","#6A5A78"],
    [0.88,-10, "#151F45","#3E3D60","#3A1A0A","#2C3256"],
    [1.00,-28, "#040818","#131C3A","#000000","#1C2444"]
  ];
  const hex = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);
  const KK = K.map(k => [k[0],k[1],hex(k[2]),hex(k[3]),hex(k[4]),hex(k[5])]);
  const lerp = (a,b,x) => a+(b-a)*x;
  const sample = t => {
    let i = 0; while (i < KK.length-2 && t > KK[i+1][0]) i++;
    const a = KK[i], b = KK[i+1], x = Math.min(1, Math.max(0,(t-a[0])/(b[0]-a[0]))), s = x*x*(3-2*x);
    const mix = (u,v) => u.map((c,j) => lerp(c, v[j], s));
    return {el: lerp(a[1],b[1],s), zen: mix(a[2],b[2]), hor: mix(a[3],b[3]), sun: mix(a[4],b[4]), amb: mix(a[5],b[5])};
  };

  /* ---------------- terrain height (mirrored in GLSL) ---------------- */
  const fr = x => x - Math.floor(x);
  const ss = (a,b,x) => { x = Math.min(1, Math.max(0,(x-a)/(b-a))); return x*x*(3-2*x); };
  const hash = (x,y) => { let px = fr(x*123.34), py = fr(y*456.21); const d = px*(px+45.32) + py*(py+45.32); px += d; py += d; return fr(px*py); };
  const noise = (x,y) => { const ix = Math.floor(x), iy = Math.floor(y), a_ = x-ix, b_ = y-iy, ux = a_*a_*(3-2*a_), uy = b_*b_*(3-2*b_);
    const a = hash(ix,iy), b = hash(ix+1,iy), c = hash(ix,iy+1), d = hash(ix+1,iy+1), m1 = a+(b-a)*ux, m2 = c+(d-c)*ux; return m1+(m2-m1)*uy; };
  const ridge = t => { const f = fr(t); return f < .7 ? Math.pow(f/.7, 1.25) : 1 - ss(.7, 1, f); };
  const dunes = (x,z) => { const qx = x*.0035, qz = z*.0035, big = noise(qx*.7,qz*.7), w = noise(qx*1.6,qz*1.6)*3.2 + noise(qx*4,qz*4)*.8;
    const r1 = Math.pow(ridge((x*.010 + z*.0045 + w)/6.2832), 1.5), r2 = Math.pow(ridge((x*.026 - z*.014 + noise(qx*3,qz*3)*4)/6.2832), 1.8);
    return r1*36*(.55+big) + r2*7*(1-big*.5) + big*55 + noise(qx*9,qz*9)*3; };

  /* ---------------- WebGL desert ---------------- */
  function create(canvas, opts){
  const reduce = !!(opts && opts.reduce);
  let gl = null;
  try {
    if (!window.THREE) throw 0;
    const renderer = new THREE.WebGLRenderer({canvas: canvas, antialias: true, powerPreference: "high-performance"});
    renderer.setPixelRatio(Math.min(devicePixelRatio||1, 1.5));
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(52, innerWidth/innerHeight, 1, 9000);

    const COMMON = `
      float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
      float ridge(float t){ float f = fract(t); return f < 0.7 ? pow(f/0.7, 1.25) : 1.0 - smoothstep(0.7, 1.0, f); }
      float dunes(vec2 p){
        vec2 q = p*0.0035;
        float big = noise(q*0.7);
        float w = noise(q*1.6)*3.2 + noise(q*4.0)*0.8;
        float r1 = pow(ridge((p.x*0.010 + p.y*0.0045 + w)/6.2832), 1.5);
        float r2 = pow(ridge((p.x*0.026 - p.y*0.014 + noise(q*3.0)*4.0)/6.2832), 1.8);
        return r1*36.0*(0.55+big) + r2*7.0*(1.0-big*0.5) + big*55.0 + noise(q*9.0)*3.0;
      }
      vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
      vec3 display(vec3 c){ return pow(aces(c*1.12), vec3(1.0/2.2)); }`;

    const NE = 16, NC = 24;
    const U = {
      uSunDir:{value:new THREE.Vector3()}, uMoonDir:{value:new THREE.Vector3(-.35,.5,-.8).normalize()},
      uSun:{value:new THREE.Color()}, uAmb:{value:new THREE.Color()}, uHor:{value:new THREE.Color()}, uZen:{value:new THREE.Color()},
      uSunI:{value:1}, uMoonI:{value:0}, uStar:{value:0}, uTime:{value:0},
      uEC:{value:[...Array(NE)].map(() => new THREE.Vector3())}, uER:{value:[...Array(NE)].map(() => new THREE.Vector3(1,1,1))},
      uCA:{value:[...Array(NC)].map(() => new THREE.Vector3())}, uCB:{value:[...Array(NC)].map(() => new THREE.Vector4())},
      uNE:{value:0}, uNC:{value:0}
    };
    const LIGHT = `
      vec3 light(vec3 albedo, vec3 n, float lit){
        vec3 sky = mix(lin(uHor), lin(uZen), clamp(n.y*0.5+0.5, 0.0, 1.0));
        vec3 amb = sky*0.42 + lin(uAmb)*0.22;
        float d = max(dot(n, uSunDir), 0.0) * lit;
        float m = max(dot(n, uMoonDir), 0.0);
        vec3 bounce = lin(uSun) * max(-n.y*0.5+0.5,0.0) * 0.06 * uSunI;
        return albedo * (amb + lin(uSun)*d*2.4*uSunI + bounce + vec3(0.09,0.12,0.22)*m*uMoonI*1.6);
      }
      vec3 haze(vec3 c, vec3 p, float k){
        float dist = length(p - cameraPosition);
        float f = 1.0 - exp(-dist*k);
        vec3 h = lin(uHor) * (1.0 + 0.25*pow(max(dot(normalize(p-cameraPosition), uSunDir),0.0), 8.0)*uSunI);
        return mix(c, h, clamp(f,0.0,1.0));
      }`;

    // terrain with analytic shadows (tree, camels)
    const SEG = innerWidth < 700 ? 200 : 320;
    const geo = new THREE.PlaneGeometry(5200, 5200, SEG, SEG); geo.rotateX(-Math.PI/2);
    const terrain = new THREE.Mesh(geo, new THREE.ShaderMaterial({uniforms:U,
      vertexShader:`precision highp float; ${COMMON}
        varying vec3 vW; varying vec3 vN;
        void main(){
          vec4 w = modelMatrix*vec4(position,1.0);
          w.y = dunes(w.xz);
          float e = 2.5;
          vN = normalize(vec3(dunes(w.xz-vec2(e,0.))-dunes(w.xz+vec2(e,0.)), 2.0*e, dunes(w.xz-vec2(0.,e))-dunes(w.xz+vec2(0.,e))));
          vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader:`precision highp float; ${COMMON}
        uniform vec3 uSunDir, uMoonDir, uSun, uAmb, uHor, uZen; uniform float uSunI, uMoonI;
        uniform vec3 uEC[${NE}]; uniform vec3 uER[${NE}]; uniform vec3 uCA[${NC}]; uniform vec4 uCB[${NC}]; uniform int uNE, uNC;
        varying vec3 vW; varying vec3 vN;
        ${LIGHT}
        float shadowAt(vec3 P, vec3 L){
          float sh = 0.0;
          for (int i=0;i<${NE};i++){ if (i>=uNE) break;
            vec3 c = uEC[i]; if (distance(P.xz,c.xz) > 1400.0) continue;
            vec3 r = uER[i]; vec3 o = (P-c)/r; vec3 d = L/r;
            float s = max(0.0, -dot(o,d)/dot(d,d));
            sh = max(sh, smoothstep(1.15, 0.8, length(o+s*d))); }
          for (int i=0;i<${NC};i++){ if (i>=uNC) break;
            vec3 a = uCA[i]; vec3 b = uCB[i].xyz; float rad = uCB[i].w; if (distance(P.xz,a.xz) > 1400.0) continue;
            vec3 ba = b-a; vec3 w0 = P-a; float bb = dot(L,ba), cc = dot(ba,ba), dd = dot(L,w0), ee = dot(ba,w0);
            float den = cc - bb*bb;
            float u = den > 1e-3 ? clamp((ee - bb*dd)/den, 0.0, 1.0) : 0.0;
            float s = max(0.0, dot(a + u*ba - P, L));
            u = clamp(dot(P + s*L - a, ba)/cc, 0.0, 1.0);
            sh = max(sh, smoothstep(rad*1.6, rad*0.6, length(P + s*L - (a + u*ba)))); }
          return sh;
        }
        void main(){
          vec3 n = normalize(vN);
          float near = smoothstep(700.0, 60.0, length(vW-cameraPosition));
          float rip = sin(dot(vW.xz, vec2(0.9,0.42))*1.25 + noise(vW.xz*0.035)*7.0);
          float rip2 = sin(dot(vW.xz, vec2(0.5,-0.8))*2.3 + noise(vW.xz*0.07)*5.0);
          n = normalize(n + (vec3(rip*0.05, 0.0, rip*0.025) + vec3(rip2*0.02,0.0,-rip2*0.03)) * near * smoothstep(0.75, 0.95, n.y));
          vec3 a1 = lin(vec3(0.86,0.62,0.42)), a2 = lin(vec3(0.93,0.75,0.56)), a3 = lin(vec3(0.74,0.45,0.28));
          vec3 albedo = mix(a1, a2, noise(vW.xz*0.012));
          albedo = mix(albedo, a3, smoothstep(0.5,0.95,noise(vW.xz*0.0035+3.1))*0.55);
          albedo *= 0.92 + 0.16*noise(vW.xz*0.9);
          albedo *= mix(0.9, 1.05, smoothstep(30.0, 120.0, vW.y));
          float lit = 1.0;
          if (uSunI > 0.01 && uSunDir.y > 0.0) lit = 1.0 - shadowAt(vW, uSunDir)*0.9;
          vec3 col = light(albedo, n, lit);
          vec3 v = normalize(cameraPosition - vW);
          float spark = step(0.996, hash(floor(vW.xz*5.0))) * pow(max(dot(reflect(-uSunDir,n), v),0.0), 30.0);
          col += lin(uSun) * spark * uSunI * 1.5 * lit * near;
          col += lin(uSun) * pow(1.0 - max(dot(n, v),0.0), 4.0) * 0.08 * uSunI;
          gl_FragColor = vec4(display(haze(col, vW, 0.00042)), 1.0); }`
    }));
    scene.add(terrain);

    // rock / object material
    const solid = (color, rock=0, fogK=.00042) => new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, {uCol:{value:new THREE.Color(color)}, uRock:{value:rock}, uFogK:{value:fogK}}),
      vertexShader:`varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader:`precision highp float; ${COMMON}
        uniform vec3 uSunDir, uMoonDir, uSun, uAmb, uHor, uZen, uCol; uniform float uSunI, uMoonI, uRock, uFogK;
        varying vec3 vW; varying vec3 vN;
        ${LIGHT}
        float rn(vec3 p){ return noise(p.xz*0.06 + p.y*0.045) + 0.5*noise(p.xy*0.09) + 0.5*noise(p.zy*0.09) + 0.25*noise(p.xz*0.4 + p.y*0.3); }
        void main(){
          vec3 n = normalize(vN); vec3 albedo = lin(uCol);
          if (uRock > 0.5){
            float e = 0.9;
            vec3 g = vec3(rn(vW+vec3(e,0,0))-rn(vW-vec3(e,0,0)), rn(vW+vec3(0,e,0))-rn(vW-vec3(0,e,0)), rn(vW+vec3(0,0,e))-rn(vW-vec3(0,0,e)));
            n = normalize(n - g*0.9);
            float band = sin(vW.y*0.13 + noise(vW.xz*0.015)*3.0)*0.5+0.5;
            vec3 c = mix(vec3(0.50,0.24,0.14), vec3(0.74,0.42,0.26), band);
            c = mix(c, vec3(0.86,0.66,0.48), smoothstep(0.85,1.0,sin(vW.y*0.04+1.3))*0.55);
            float varnish = smoothstep(0.55, 0.85, noise(vec2((vW.x+vW.z)*0.06, vW.y*0.006)));
            c *= 1.0 - varnish*0.35;
            c *= 0.85 + 0.25*noise(vW.xz*0.2 + vW.y*0.17);
            albedo = lin(c);
          }
          vec3 col = light(albedo, n, 1.0);
          gl_FragColor = vec4(display(haze(col, vW, uFogK)), 1.0); }`
    });
    const rockMat = solid(0xA0522D, 1, .0003);

    const displaceRock = (g, amp, seed) => {
      const p = g.attributes.position, nrm = g.attributes.normal;
      for (let i=0;i<p.count;i++){
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const d = (noise(x*.02+seed, z*.02+y*.015)-.5)*amp + (noise(x*.07+y*.05, z*.07+seed)-.5)*amp*.4;
        p.setXYZ(i, x + nrm.getX(i)*d, y + nrm.getY(i)*d*.3, z + nrm.getZ(i)*d);
      }
      g.computeVertexNormals();
    };

    // sandstone buttes with shelves
    const butte = (x, z, h, r, seed) => {
      const base = dunes(x, z) - 70, H = h + 70;
      const g = new THREE.CylinderGeometry(r*.72, r*1.05, H, 96, 40); const p = g.attributes.position;
      for (let i=0;i<p.count;i++){
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), rad = Math.hypot(vx,vz); if (rad < 1) continue;
        const ang = Math.atan2(vz, vx), yn = (vy + H/2)/H;
        let k = 1 + .2*(noise(ang*1.6+seed, yn*2.5)-.5)*2 + .05*Math.sin(ang*11+seed) + .06*(noise(ang*7+seed, yn*18)-.5);
        k *= 1 - .09*Math.floor(yn*6)/6 - .03*ss(.92,1,yn);
        p.setX(i, vx*k); p.setZ(i, vz*k);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, rockMat); m.position.set(x, base + H/2, z); scene.add(m);
    };
    [[-430,-3300,250,140],[400,-3520,300,170],[-720,-3950,340,220],[680,-4150,280,200],[-560,-4650,380,250],[600,-5050,320,240],
     [-1500,-1500,280,260],[1700,-900,240,240],[-1900,-3100,360,320],[2100,-2600,300,300],[-2600,-500,260,300],[1300,-5600,420,380]]
      .forEach((b,i) => butte(b[0], b[1], b[2], b[3], i*3.7));

    // natural arches
    const arch = (x, z, span, height, thick, rotY, seed) => {
      const base = dunes(x, z) - 6, pts = [];
      pts.push(new THREE.Vector3(-span/2*1.05, -70, 0));
      for (let i=0;i<=24;i++){ const a = Math.PI*(1 - i/24); pts.push(new THREE.Vector3(Math.cos(a)*span/2, Math.sin(a)*height, (noise(i*.3+seed, seed)-.5)*thick*.6)); }
      pts.push(new THREE.Vector3(span/2*1.05, -70, 0));
      const curve = new THREE.CatmullRomCurve3(pts);
      const g = new THREE.TubeGeometry(curve, 160, thick, 22, false);
      const p = g.attributes.position, nrm = g.attributes.normal;
      for (let i=0;i<p.count;i++){
        const y = p.getY(i), legs = 1 + 1.1*(1 - ss(0, height*.75, y));
        const d = thick*(legs-1)*.9 + (noise(p.getX(i)*.04+seed, y*.04)-.5)*thick*.7;
        p.setXYZ(i, p.getX(i)+nrm.getX(i)*d, y+nrm.getY(i)*d*.5, p.getZ(i)+nrm.getZ(i)*d);
      }
      g.computeVertexNormals();
      displaceRock(g, thick*.35, seed);
      const m = new THREE.Mesh(g, rockMat); m.position.set(x, base, z); m.rotation.y = rotY; scene.add(m);
    };
    arch(330, -1350, 190, 150, 20, .35, 1.3);
    arch(-17, -2480, 270, 250, 30, 0, 4.1);
    arch(-950, -4300, 340, 260, 40, -.4, 7.7);

    // occluders for terrain shadows
    const occE = [], occC = [];
    const syncOcc = () => {
      occE.slice(0,NE).forEach((o,i) => { U.uEC.value[i].copy(o.c); U.uER.value[i].copy(o.r); });
      occC.slice(0,NC).forEach((o,i) => { U.uCA.value[i].copy(o.a); U.uCB.value[i].set(o.b.x, o.b.y, o.b.z, o.rad); });
      U.uNE.value = Math.min(NE, occE.length); U.uNC.value = Math.min(NC, occC.length);
    };
    const UP = new THREE.Vector3(0,1,0), V = (x,y,z) => new THREE.Vector3(x,y,z);
    const capsuleMesh = (mat, rad) => new THREE.Mesh(new THREE.CylinderGeometry(rad*.8, rad, 1, 10), mat);
    const placeCapsule = (m, a, b) => { const d = b.clone().sub(a), len = d.length(); m.position.copy(a).addScaledVector(d, .5); m.scale.set(1, len, 1); m.quaternion.setFromUnitVectors(UP, d.normalize()); };

    // acacias
    const barkMat = solid(0x3A2618), leafMat = solid(0x4E5130);
    const acacia = (x, z, s) => {
      const g0 = V(x, dunes(x,z) - 2, z), at = v => v.clone().multiplyScalar(s).add(g0);
      [[V(0,0,0),V(0,22,0),2.2],[V(0,16,0),V(14,34,4),1.4],[V(0,16,0),V(-12,33,-3),1.4],[V(0,20,0),V(3,36,-10),1.2]].forEach(([a,b,r]) => {
        const A = at(a), B = at(b), m = capsuleMesh(barkMat, r*s); placeCapsule(m, A, B); scene.add(m); occC.push({a:A, b:B, rad:r*s}); });
      [[V(2,37,0),V(30,5,26)],[V(-8,34,6),V(16,4,14)],[V(12,35,-6),V(15,3.5,13)]].forEach(([c,r]) => {
        const C = at(c), R = r.clone().multiplyScalar(s), geo2 = new THREE.SphereGeometry(1, 28, 16);
        const pp = geo2.attributes.position; for (let i=0;i<pp.count;i++){ const k = 1 + (noise(pp.getX(i)*3+c.x, pp.getZ(i)*3+c.z)-.5)*.35; pp.setXYZ(i, pp.getX(i)*k, pp.getY(i)*k, pp.getZ(i)*k); } geo2.computeVertexNormals();
        const m = new THREE.Mesh(geo2, leafMat); m.position.copy(C); m.scale.copy(R); scene.add(m); occE.push({c:C, r:R}); });
    };
    acacia(-300, -820, 1.1);
    acacia(-170, -2150, 1.35);

    // camels
    const camelMat = solid(0x7A4E2C);
    const camels = [0,1,2].map(k => {
      const g = new THREE.Group(); scene.add(g);
      const ell = (c,r) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), camelMat); m.position.copy(c); m.scale.copy(r); g.add(m); return {lc:c, r}; };
      const body = ell(V(0,13,0), V(9,4.2,3.9)), hump = ell(V(-.6,17.2,0), V(4.2,3.4,3.4)), head = ell(V(14,20.3,0), V(2.9,1.4,1.4));
      const neck = {m:capsuleMesh(camelMat,1.6), a:V(7.2,13.6,0), b:V(12.4,20.2,0), rad:1.6}; g.add(neck.m); placeCapsule(neck.m, neck.a, neck.b);
      const tail = capsuleMesh(camelMat,.45); g.add(tail); placeCapsule(tail, V(-8.8,13,0), V(-10,8,0));
      const legs = [[5.8,2.1,0],[5.8,-2.1,Math.PI],[-5.8,2.1,Math.PI],[-5.8,-2.1,0]].map(([x,z,ph]) => { const m = capsuleMesh(camelMat,.9); g.add(m); return {m, hip:V(x,11,z), ph}; });
      return {g, ells:[body,hump,head], neck, legs, k};
    });
    const updateCamels = time => {
      const sec = time/1000;
      occE.length = 6; occC.length = 8;
      camels.forEach(c => {
        const x = ((sec*4 + c.k*34 + 500) % 1000) - 500, z = -2980 + Math.sin(x*.01)*12;
        c.g.position.set(x, dunes(x, z) - 1 + Math.abs(Math.sin(sec*2.2 + c.k))*.6, z);
        c.g.rotation.y = Math.atan2(-Math.cos(x*.01)*.12, 1);
        c.legs.forEach(l => { const a = Math.sin(sec*2.2 + c.k + l.ph)*.38; l.foot = l.hip.clone().add(V(Math.sin(a)*11, -Math.cos(a)*11, 0)); placeCapsule(l.m, l.hip, l.foot); });
        c.g.updateMatrixWorld(true);
        const w = v => c.g.localToWorld(v.clone());
        c.ells.forEach(e => occE.push({c:w(e.lc), r:e.r}));
        occC.push({a:w(c.neck.a), b:w(c.neck.b), rad:c.neck.rad});
        c.legs.forEach(l => occC.push({a:w(l.hip), b:w(l.foot), rad:.9}));
      });
      syncOcc();
    };

    // sky
    const sky = new THREE.Mesh(new THREE.SphereGeometry(6500, 48, 24), new THREE.ShaderMaterial({uniforms:U, side:THREE.BackSide, depthWrite:false,
      vertexShader:`varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader:`precision highp float;
        uniform vec3 uSunDir, uMoonDir, uSun, uHor, uZen; uniform float uSunI, uMoonI, uStar, uTime; varying vec3 vD;
        vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
        vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
        float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
        void main(){
          vec3 d = normalize(vD); float h = d.y;
          vec3 col = mix(lin(uHor), lin(uZen), pow(clamp(h,0.0,1.0), 0.5));
          if (h < 0.0) col = lin(uHor);
          float s = max(dot(d, uSunDir), 0.0);
          float up = smoothstep(-0.12, 0.02, uSunDir.y);
          col += lin(uSun) * (pow(s, 2200.0)*18.0 + pow(s, 120.0)*0.5 + pow(s, 8.0)*0.25*(1.0-clamp(h*2.0,0.0,1.0))) * up;
          float mo = max(dot(d, uMoonDir), 0.0);
          col += vec3(0.85,0.88,1.0) * (smoothstep(0.99955,0.9997,mo)*1.2 + pow(mo,300.0)*0.08) * uMoonI;
          vec3 g = floor(d*420.0);
          float st = step(0.9966, h3(g)) * (0.55 + 0.45*sin(uTime*2.0 + h3(g+1.0)*40.0)) * (0.3 + 0.7*h3(g+2.0));
          vec3 axis = normalize(vec3(0.35, 0.55, 0.75));
          float band = exp(-pow(dot(d, axis), 2.0)*26.0);
          float dust = h3(floor(d*900.0));
          col += (vec3(st)*0.6 + band*vec3(0.05,0.05,0.08)*(0.6+0.4*dust) + step(0.986,dust)*band*0.15) * uStar * smoothstep(0.0, 0.18, h);
          gl_FragColor = vec4(pow(aces(col*1.12), vec3(1.0/2.2)), 1.0); }`
    }));
    scene.add(sky);

    // drifting sand
    const N = innerWidth < 700 ? 500 : 1100, pos = new Float32Array(N*3);
    for (let i=0;i<N;i++){ pos[i*3]=(Math.random()-.5)*260; pos[i*3+1]=Math.random()*50-35; pos[i*3+2]=-Math.random()*240; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute("position", new THREE.BufferAttribute(pos,3));
    const pm = new THREE.PointsMaterial({size:.35, color:0xF2D6B0, transparent:true, opacity:.4, depthWrite:false});
    const sandPts = new THREE.Points(pg, pm); scene.add(sandPts);

    let mx = 0, my = 0, wind = 1;
    addEventListener("pointermove", e => { const nx = e.clientX/innerWidth-.5; wind = 1 + Math.abs(nx - mx)*30; mx = nx; my = e.clientY/innerHeight-.5; }, {passive:true});
    const resize = () => { renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth/innerHeight; cam.updateProjectionMatrix(); };
    resize(); addEventListener("resize", resize);

    let camZ = 0, camY = 160, yaw = 0, pitch = 0;
    gl = (time, t, travel) => {
      const s = sample(t), el = s.el*Math.PI/180, az = -0.75 + t*1.6;
      U.uSunDir.value.set(Math.sin(az)*Math.cos(el), Math.sin(el), -Math.cos(az)*Math.cos(el)).normalize();
      U.uSun.value.setRGB(...s.sun); U.uAmb.value.setRGB(...s.amb); U.uHor.value.setRGB(...s.hor); U.uZen.value.setRGB(...s.zen);
      U.uSunI.value = Math.min(1, Math.max(0, (s.el+4)/14));
      U.uMoonI.value = Math.min(1, Math.max(0, (t-.84)/.12));
      U.uStar.value = U.uMoonI.value;
      U.uTime.value = time/1000;
      const tz = travel - Math.min(time*0.004, 500);
      camZ += (tz - camZ) * (reduce ? 1 : .06);
      const cx = Math.sin(camZ*0.0012)*120;
      const ground = Math.max(dunes(cx, camZ), dunes(cx, camZ-120), dunes(cx, camZ-240));
      camY += (ground + 82 - camY) * (reduce ? 1 : .05);
      yaw += (-mx*.3 - yaw)*.05; pitch += (-my*.1 - pitch)*.05;
      cam.position.set(cx, camY, camZ);
      cam.rotation.set(-0.08 + pitch, yaw + Math.sin(camZ*0.0009)*0.07, 0, "YXZ");
      const step = 5200/SEG;
      terrain.position.set(Math.round(cam.position.x/step)*step, 0, Math.round(cam.position.z/step)*step);
      sky.position.copy(cam.position);
      updateCamels(reduce ? 60000 : time);
      const a = pg.attributes.position.array;
      for (let i=0;i<N;i++){ a[i*3] += .3*wind + Math.sin(time*.001+i)*.04; a[i*3+1] += Math.sin(time*.002+i*1.7)*.02; if (a[i*3] > 130) a[i*3] -= 260; }
      pg.attributes.position.needsUpdate = true;
      sandPts.position.copy(cam.position); sandPts.rotation.copy(cam.rotation);
      pm.opacity = .35 * U.uSunI.value;
      wind += (1 - wind)*.04;
      renderer.render(scene, cam);
    };
    syncOcc();
  } catch(e) { console.error(e); document.body.classList.add("nogl"); gl = null; }
  return gl;
  }
  return {create, dunes, sample};
})();
