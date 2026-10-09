// ==================== 3D ROUTE VIEW (three.js r128) ====================
// A stylised night road: the car drives FROM token -> ROUTER checkpoint ->
// TO token, collecting coins on the way. It is a visual preview only and
// reads token labels and the output amount from the swap box.
(function () {
  const $ = id => document.getElementById(id);
  const PAL = { orange: 0xff9500, red: 0xff4a1c, cyan: 0x35d6ff, magenta: 0xff4fd8, gold: 0xffd27a, paint: 0xff7a1a };
  const hex = h => '#' + h.toString(16).padStart(6, '0');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  let ST = null;

  // ---- helpers ----
  function label(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(8,8,12,.85)'; g.fillRect(4, 8, 248, 80);
    g.strokeStyle = hex(color); g.lineWidth = 4; g.strokeRect(4, 8, 248, 80);
    g.fillStyle = '#fff'; g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 50);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    sp.scale.set(4.2, 1.6, 1);
    return sp;
  }
  function roadTexture() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#17171e'; g.fillRect(0, 0, 64, 256);
    g.fillStyle = 'rgba(255,149,0,.85)';
    for (let y = 0; y < 256; y += 64) g.fillRect(30, y, 4, 34);           // dashed centre line
    g.fillStyle = 'rgba(255,149,0,.55)'; g.fillRect(3, 0, 2, 256); g.fillRect(59, 0, 2, 256); // edge glow
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // ---- scene ----
  function build(stage) {
    const W = stage.clientWidth || 600, H = stage.clientHeight || 300;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.domElement.className = 'r3d-canvas';
    stage.insertBefore(renderer.domElement, stage.firstChild);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x060609, 45, 170);
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 400);

    scene.add(new THREE.HemisphereLight(0x8fa2ff, 0x1a0d05, 0.55));
    const sun = new THREE.DirectionalLight(0xffc27a, 0.9);
    sun.position.set(-20, 30, 10);
    scene.add(sun);

    // ground + grid
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x07070b, roughness: 0.95 }));
    ground.position.y = -0.01;
    scene.add(ground);
    const grid = new THREE.GridHelper(160, 40, PAL.orange, 0x1c1c26);
    grid.material.transparent = true; grid.material.opacity = 0.16;
    scene.add(grid);

    // skyline: dark blocks with neon edges
    const neon = [PAL.orange, PAL.cyan, PAL.magenta];
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() - 0.5) * 150, z = -18 - Math.random() * 90;
      const h = 4 + Math.random() * 20, w = 2 + Math.random() * 4;
      const box = new THREE.BoxGeometry(w, h, w);
      const m = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.7 }));
      m.position.set(x, h / 2, z);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box),
        new THREE.LineBasicMaterial({ color: neon[i % neon.length], transparent: true, opacity: 0.55 }));
      edges.position.copy(m.position);
      scene.add(m, edges);
    }

    // stars + sun
    const sg = new THREE.BufferGeometry(), sp = [];
    for (let i = 0; i < 500; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.42;
      sp.push(Math.cos(th) * Math.cos(ph) * 180, Math.sin(ph) * 180 + 10, Math.sin(th) * Math.cos(ph) * 180);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, transparent: true, opacity: 0.7, depthWrite: false })));
    const moon = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 24), new THREE.MeshBasicMaterial({ color: PAL.orange, fog: false }));
    moon.position.set(0, 26, -150);
    scene.add(moon);

    // road along a gentle S-curve
    const curve = new THREE.CatmullRomCurve3([
      V(-34, 0, 6), V(-18, 0, 8), V(-7, 0, 2), V(0, 0, -1), V(7, 0, 2), V(18, 0, 8), V(34, 0, 6)
    ], false, 'centripetal');
    const roadTex = roadTexture();
    const road = buildRoad(curve, roadTex);
    scene.add(road);

    // side pillars with glowing caps
    for (let k = 0; k <= 22; k++) {
      const u = k / 22, p = curve.getPointAt(u), n = normalAt(curve, u);
      [-1, 1].forEach(side => {
        const q = p.clone().addScaledVector(n, side * 3.4);
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 8),
          new THREE.MeshStandardMaterial({ color: 0x202028, roughness: 0.5 }));
        pil.position.set(q.x, 0.8, q.z);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10),
          new THREE.MeshBasicMaterial({ color: (k + (side > 0 ? 1 : 0)) % 2 ? PAL.orange : PAL.cyan }));
        cap.position.set(q.x, 1.7, q.z);
        scene.add(pil, cap);
      });
    }

    // start / end pads
    const pads = [0, 1].map(u => {
      const p = curve.getPointAt(u);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.12, 8, 48).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: u === 0 ? PAL.orange : PAL.green }));
      ring.position.set(p.x, 0.15, p.z);
      scene.add(ring);
      const tag = label(u === 0 ? 'FROM' : 'TO', u === 0 ? PAL.orange : 0x22c55e);
      tag.position.set(p.x, 4.6, p.z);
      scene.add(tag);
      return { ring, tag };
    });

    // ROUTER tower beside the road
    const router = new THREE.Group();
    router.position.set(0, 0, -9);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.2, 2.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x14141c, metalness: 0.7, roughness: 0.3 }));
    base.position.y = 1.2;
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.1),
      new THREE.MeshStandardMaterial({ color: PAL.orange, emissive: PAL.orange, emissiveIntensity: 1.2 }));
    core.position.y = 3.2;
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.08, 8, 64), new THREE.MeshBasicMaterial({ color: PAL.cyan }));
    ringA.position.y = 3.2;
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.06, 8, 64), new THREE.MeshBasicMaterial({ color: PAL.orange }));
    ringB.position.y = 3.2; ringB.rotation.x = Math.PI / 2.4;
    const rlabel = label('ROUTER', PAL.orange);
    rlabel.position.set(0, 7.2, 0);
    const rlight = new THREE.PointLight(PAL.orange, 1.4, 16);
    rlight.position.set(0, 3.2, 0);
    router.add(base, core, ringA, ringB, rlabel, rlight);
    scene.add(router);

    // checkpoint gate over the road at the midpoint
    const gate = new THREE.Group();
    const gp = curve.getPointAt(0.5), gt = curve.getTangentAt(0.5);
    const gateMat = new THREE.MeshBasicMaterial({ color: PAL.cyan });
    [-1, 1].forEach(s => {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.5, 0.5), gateMat);
      pillar.position.set(0, 2.25, s * 3.4);
      gate.add(pillar);
    });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 7), gateMat);
    beam.position.y = 4.6;
    gate.add(beam);
    gate.position.set(gp.x, 0, gp.z);
    gate.rotation.y = Math.atan2(-gt.z, gt.x);
    scene.add(gate);

    // coins along the route (collected by the car)
    const coins = [];
    for (let i = 1; i < 15; i++) {
      const u = i / 15, p = curve.getPointAt(u), n = normalAt(curve, u);
      const side = i % 2 ? 1 : -1;
      const q = p.clone().addScaledVector(n, side * 1.1);
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.1, 10, 20),
        new THREE.MeshStandardMaterial({ color: PAL.gold, metalness: 1, roughness: 0.25, emissive: PAL.gold, emissiveIntensity: 0.35 }));
      m.position.set(q.x, 0.9, q.z);
      scene.add(m);
      coins.push({ u, mesh: m, got: false, collectT: 0 });
    }

    // car
    const car = buildCar();
    scene.add(car.group);
    const carLight = new THREE.PointLight(PAL.orange, 1.0, 9);
    scene.add(carLight);

    // trail + exhaust
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(60 * 3), 3));
    trailGeo.setDrawRange(0, 0);
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: PAL.orange, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(trail);
    const exGeo = new THREE.BufferGeometry();
    const exPos = new Float32Array(120 * 3);
    exGeo.setAttribute('position', new THREE.BufferAttribute(exPos, 3)); // keeps a live reference
    const exhaust = new THREE.Points(exGeo, new THREE.PointsMaterial({ color: PAL.gold, size: 0.35, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(exhaust);

    return {
      renderer, scene, camera, curve, road, roadTex, pads, router, core, ringA, ringB, gate,
      car, carLight, coins, trail, trailPts: [], exhaust, exPos, exAges: new Float32Array(120).fill(9), exHead: 0,
      u: 0, racing: false, start: 0, dur: 7600, coinCount: 0, speed: 0, fuel: 1,
      routerPulse: -1e9, visible: true, look: V(0, 0.8, 0), lastT: performance.now(), phase: 'Ready',
      finished: false
    };
  }

  function normalAt(curve, u) {
    const t = curve.getTangentAt(u);
    return V(-t.z, 0, t.x).normalize();
  }

  function buildRoad(curve, tex) {
    const N = 260, W = 3.2, pos = [], uv = [], idx = [];
    let acc = 0, prev = null;
    for (let i = 0; i <= N; i++) {
      const u = i / N, p = curve.getPointAt(u), n = normalAt(curve, u);
      if (prev) acc += p.distanceTo(prev);
      prev = p;
      const L = p.clone().addScaledVector(n, W / 2), R = p.clone().addScaledVector(n, -W / 2);
      pos.push(L.x, 0.02, L.z, R.x, 0.02, R.z);
      uv.push(0, acc / 6, 1, acc / 6);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }));
  }

  function buildCar() {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const paint = new THREE.MeshPhysicalMaterial({ color: PAL.paint, metalness: 0.55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, metalness: 0.9, roughness: 0.05, emissive: 0x0b2540, emissiveIntensity: 0.4 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.6 });

    // side profile extruded along Z: nose at +X, tail at -X
    const sh = new THREE.Shape();
    sh.moveTo(-2, 0.35); sh.lineTo(-2.05, 0.8); sh.quadraticCurveTo(-1.9, 1.0, -1.2, 1.02);
    sh.lineTo(-0.5, 1.42); sh.lineTo(0.7, 1.42); sh.quadraticCurveTo(1.25, 1.38, 1.5, 1.0);
    sh.lineTo(2.05, 0.86); sh.quadraticCurveTo(2.12, 0.6, 2.0, 0.35); sh.closePath();
    const bodyGeo = new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 3, steps: 1 });
    bodyGeo.translate(0, 0, -0.8);
    body.add(new THREE.Mesh(bodyGeo, paint));

    const cs = new THREE.Shape();
    cs.moveTo(-1.1, 1.0); cs.lineTo(-0.55, 1.36); cs.lineTo(0.6, 1.36); cs.lineTo(1.12, 1.0); cs.closePath();
    const cabGeo = new THREE.ExtrudeGeometry(cs, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, steps: 1 });
    cabGeo.translate(0, 0, -0.6);
    body.add(new THREE.Mesh(cabGeo, glass));

    // spoiler + side vents
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.7), trim);
    spoiler.position.set(-1.8, 1.12, 0);
    body.add(spoiler);
    [-1, 1].forEach(s => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), trim);
      post.position.set(-1.8, 0.95, s * 0.7);
      body.add(post);
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.04), trim);
      vent.position.set(0.1, 0.8, s * 0.82);
      body.add(vent);
      // HDX badge on each side
      const badgeC = document.createElement('canvas'); badgeC.width = 128; badgeC.height = 64;
      const g = badgeC.getContext('2d');
      g.fillStyle = '#0c0c10'; g.fillRect(0, 0, 128, 64);
      g.fillStyle = '#ff9500'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('HDX', 64, 34);
      const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(badgeC) }));
      badge.position.set(0.25, 0.85, s * 0.82);
      if (s < 0) badge.rotation.y = Math.PI;
      body.add(badge);
    });

    // headlights + taillights
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    [-0.55, 0.55].forEach(z => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.42), headMat);
      h.position.set(2.06, 0.78, z);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.42), tailMat);
      t.position.set(-2.06, 0.8, z);
      body.add(h, t);
    });

    // wheels: tyre + silver rim, axis along Z so they spin about Z
    const tyreGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 24).rotateX(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.36, 16).rotateX(Math.PI / 2);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, metalness: 1, roughness: 0.25 });
    const wheels = [];
    [[1.25, 0.95], [1.25, -0.95], [-1.25, 0.95], [-1.25, -0.95]].forEach(([x, z]) => {
      const w = new THREE.Group();
      w.add(new THREE.Mesh(tyreGeo, tyreMat), new THREE.Mesh(rimGeo, rimMat));
      w.position.set(x, 0.42, z);
      group.add(w);
      wheels.push(w);
    });

    // underglow
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: PAL.orange, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = 0.06;
    group.add(glow);

    group.add(body);
    return { group, body, wheels };
  }

  // ---- race control ----
  window.route3dRace = function () {
    if (!ST || ST.racing) return;
    ST.racing = true; ST.finished = false;
    ST.u = 0; ST.start = performance.now(); ST.coinCount = 0; ST.trailPts = [];
    ST.coins.forEach(c => { c.got = false; c.collectT = 0; c.mesh.visible = true; c.mesh.scale.set(1, 1, 1); });
    const btn = $('r3d-play'); if (btn) { btn.disabled = true; btn.textContent = 'Racing…'; }
    const f = labelText('from'), t = labelText('to');
    setPhase('Leaving ' + f);
  };
  function labelText(which) {
    const el = $(which === 'from' ? 'from-picker-label' : 'to-picker-label');
    return (el && el.textContent.trim()) || (which === 'from' ? 'FROM' : 'TO');
  }
  function setPhase(text) {
    ST.phase = text;
    const el = $('r3d-phase'); if (el) el.textContent = text;
  }
  function refreshLabels() {
    const f = labelText('from'), t = labelText('to');
    const r = $('r3d-route'); if (r) r.textContent = `${f} → WHERESY → ${t}`;
    if (ST && !ST.racing) {
      const b = $('r3d-play'); if (b && !b.disabled) b.textContent = ST.finished ? '↻ Replay' : '▶ Race route';
    }
  }
  function confetti(stage) {
    for (let k = 0; k < 40; k++) {
      const p = document.createElement('i');
      p.className = 'r3d-conf';
      p.style.left = (50 + (Math.random() - 0.5) * 40) + '%';
      p.style.background = [PAL.orange, PAL.red, 0x22c55e, PAL.gold].map(hex)[k % 4];
      p.style.setProperty('--dx', ((Math.random() - 0.5) * 240) + 'px');
      p.style.setProperty('--dy', (-80 - Math.random() * 140) + 'px');
      stage.appendChild(p);
      setTimeout(() => p.remove(), 1500);
    }
  }

  // ---- frame loop ----
  function tick(now) {
    requestAnimationFrame(tick);
    if (!ST || !ST.visible) { if (ST) ST.lastT = now; return; }
    const dt = Math.min(0.05, (now - ST.lastT) / 1000); ST.lastT = now;

    if (ST.racing) {
      const p = clamp((now - ST.start) / ST.dur, 0, 1);
      ST.u = easeIO(p);
      if (p >= 1) finish();
    }
    const u = ST.u;
    const P = ST.curve.getPointAt(u), T = ST.curve.getTangentAt(u);
    const car = ST.car;
    car.group.position.set(P.x, ST.racing ? 0 : Math.sin(now / 300) * 0.03, P.z);
    car.group.rotation.y = Math.atan2(-T.z, T.x);
    ST.speed = ST.racing ? (18 + 160 * Math.sin(Math.PI * u)) : 0;
    car.wheels.forEach(w => { w.rotation.z -= ST.speed * dt * 0.9; });

    // phase text + router checkpoint
    if (ST.racing) {
      const want = u < 0.08 ? 'Leaving ' + labelText('from')
        : u < 0.44 ? 'Routing via WHERESY'
        : u < 0.56 ? 'Checkpoint: ROUTER'
        : u < 0.92 ? 'Hopping to ' + labelText('to') : 'Arriving';
      if (want !== ST.phase) {
        setPhase(want);
        if (want === 'Checkpoint: ROUTER') ST.routerPulse = now;
      }
      ST.fuel = 1 - 0.55 * u;
    }

    // coins
    ST.coins.forEach(c => {
      if (ST.racing && !c.got && c.u <= u) { c.got = true; c.collectT = now; ST.coinCount++; }
      if (c.got && c.collectT) {
        const k = clamp((now - c.collectT) / 350, 0, 1);
        c.mesh.scale.setScalar(1 - k);
        if (k >= 1) { c.mesh.visible = false; c.collectT = 0; }
      }
      c.mesh.rotation.y += dt * 2.5;
    });

    // router + gate animation
    const pulse = clamp(1 - (now - ST.routerPulse) / 700, 0, 1);
    ST.core.rotation.y += dt * (ST.racing ? 3 : 0.8);
    ST.core.scale.setScalar(1 + pulse * 0.5);
    ST.ringA.rotation.z += dt * (ST.racing ? 2.6 : 0.6);
    ST.ringB.rotation.y += dt * (ST.racing ? -1.8 : -0.4);
    ST.road.material.map.offset.y -= dt * (ST.racing ? 0.9 + ST.speed * 0.01 : 0.12);

    // trail + exhaust
    if (ST.racing || ST.trailPts.length) {
      ST.trailPts.push(P.clone().setY(0.3));
      if (ST.trailPts.length > 60) ST.trailPts.shift();
      const arr = ST.trail.geometry.attributes.position.array;
      ST.trailPts.forEach((q, i) => { arr[i * 3] = q.x; arr[i * 3 + 1] = q.y; arr[i * 3 + 2] = q.z; });
      ST.trail.geometry.setDrawRange(0, ST.trailPts.length);
      ST.trail.geometry.attributes.position.needsUpdate = true;
    }
    if (ST.racing && ST.speed > 10) {
      const rear = P.clone().addScaledVector(T, -2.1).setY(0.6);
      const i = ST.exHead; ST.exHead = (ST.exHead + 1) % 120;
      ST.exPos[i * 3] = rear.x; ST.exPos[i * 3 + 1] = rear.y; ST.exPos[i * 3 + 2] = rear.z;
      ST.exAges[i] = 0;
    }
    for (let i = 0; i < 120; i++) {
      ST.exAges[i] += dt;
      if (ST.exAges[i] < 0.9) {
        ST.exPos[i * 3 + 1] += dt * 0.6;
      } else { ST.exPos[i * 3 + 1] = -50; }
    }
    ST.exhaust.geometry.attributes.position.needsUpdate = true;
    ST.carLight.position.copy(P).addScaledVector(T, 2.5).setY(0.8);

    // camera: chase while racing, slow orbit when idle
    let camT, look;
    if (ST.racing || ST.finished) {
      camT = P.clone().addScaledVector(T, -9).add(V(0, 4.2, 0));
      look = P.clone().addScaledVector(T, 6).add(V(0, 0.8, 0));
    } else {
      const a = now * 0.00012;
      camT = V(Math.sin(a) * 17, 6.5, Math.cos(a) * 17 - 4);
      look = V(0, 0.8, -2);
    }
    ST.camera.position.lerp(camT, ST.racing ? 0.12 : 0.04);
    ST.look.lerp(look, 0.1);
    ST.camera.lookAt(ST.look);

    ST.renderer.render(ST.scene, ST.camera);

    // HUD
    const sp = $('r3d-speed'), co = $('r3d-coins'), fb = $('r3d-fuelbar');
    if (sp) sp.textContent = Math.round(ST.speed);
    if (co) co.textContent = ST.coinCount + '/14';
    if (fb) fb.style.width = (ST.fuel * 100).toFixed(0) + '%';
  }

  function finish() {
    ST.racing = false; ST.finished = true; ST.u = 1;
    const out = $('out-amount') ? $('out-amount').value : '';
    setPhase('Arrived ✓');
    const foot = $('r3d-foot');
    if (foot) foot.textContent = `Route complete: ${ST.coinCount}/14 fees collected${out ? ' · received ≈ ' + out + ' ' + labelText('to') : ''}.`;
    const stage = $('r3d-stage'); if (stage) confetti(stage);
    const b = $('r3d-play'); if (b) { b.disabled = false; b.textContent = '↻ Replay'; }
  }

  function init() {
    const stage = $('r3d-stage');
    if (!stage) return;
    if (typeof THREE === 'undefined') {
      const fb = $('r3d-fallback'); if (fb) fb.textContent = '3D view could not load. The swap itself still works.';
      return;
    }
    ST = build(stage);
    const fb = $('r3d-fallback'); if (fb) fb.remove();
    new IntersectionObserver(es => { ST.visible = es[0].isIntersecting; }).observe(stage);
    new ResizeObserver(() => {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      ST.renderer.setSize(w, h, false);
      ST.camera.aspect = w / h; ST.camera.updateProjectionMatrix();
    }).observe(stage);
    refreshLabels();
    setInterval(refreshLabels, 800);
    requestAnimationFrame(tick);
  }

  // race the route when the user presses Swap with a real amount and a connected wallet
  const prevDoSwap = window.doSwap;
  if (typeof prevDoSwap === 'function') {
    window.doSwap = function () {
      try {
        const amt = parseFloat(($('in-amount') || {}).value) || 0;
        if (amt > 0 && typeof userAddress !== 'undefined' && userAddress) window.route3dRace();
      } catch (e) { /* visual only */ }
      return prevDoSwap.apply(this, arguments);
    };
  }

  init();
})();
