// Game orchestrator: rendering, local physics, remote interpolation, camera,
// skill chains, checkpoints/laps, and the race state machine (client side).
import * as THREE from 'three';
import { buildTrack, TOTAL_LAPS, wrapAngle, ROAD_Y } from '/shared/track.js';
import { stepCar, CAR } from '/shared/physics.js';
import { buildWorld } from './world.js';
import { createCar, animateCar, setLights, setPaint, carTemplateConfig } from './car.js';
import { HUD, toast, fmtTime } from './hud.js';
import { readInput, updateHaptics } from './input.js';
import { updateEngine, sfx, setHorn, setNitro, setMusicScene } from './audio.js';
import { DriftFX } from './fx.js';
import { addXP, recordRace } from './progress.js';

// C cycles these. Cockpit sits at the driver's eye point; hood is on the bonnet.
const CAM_MODES = ['chase', 'cockpit', 'hood'];
const CAM_LABELS = { chase: 'CHASE CAM', cockpit: 'DRIVER VIEW', hood: 'HOOD CAM' };

const MPH = 2.23694;
const YD = 1.09361;

// Nitro tuning: the meter is 0..100, a pickup adds a chunk, holding SHIFT
// burns it. A full meter is ~3 s of boost.
const NITRO_MAX = 100;
const NITRO_PICKUP = 45;
const NITRO_BURN = 32;        // meter units per second while boosting
const NITRO_RESPAWN = 15;     // seconds before a collected canister returns
const NITRO_GRAB_R = 2.6;     // pickup collection radius, meters

export class Game {
  constructor(canvas, quality, treeModel = null, mapId = 'coastal') {
    this.quality = quality;
    this.treeModel = treeModel;   // kept for world rebuilds on map switch
    this.track = buildTrack(mapId);
    this.laps = TOTAL_LAPS;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const dpr = quality === 'high' ? Math.min(devicePixelRatio, 2) : quality === 'med' ? Math.min(devicePixelRatio, 1.5) : 1;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 6000);
    this._vw = innerWidth; this._vh = innerHeight;

    this.world = buildWorld(this.scene, this.renderer, this.track, quality, treeModel);
    this.hud = new HUD(this.track);
    this.fx = new DriftFX(this.scene);   // tire smoke + rubber marks

    // Local car state
    const g = this.track.gridSlot(11);
    this.car = { x: g.x, z: g.z, h: g.h, vx: 0, vz: 0, s: g.s };
    this.lap = 0; // grid is behind the start line; first crossing begins lap 1
    this.prevS = g.s;
    this.finished = false;

    this.visuals = new Map(); // id -> {car, name, human, x, z, h, sp}
    this.myId = null;
    this.myVisual = null;

    this.phase = 'lobby';
    // Lobby turntable: the menu panel sits to one side and the car is framed in
    // the clear space beside it, so paint changes are visible as you make them.
    this.previewMode = true;
    this.raceKind = 'bot';
    this.order = [];
    this.t0 = 0;
    this.lapStart = 0;
    this.bestLap = 0;

    // nitro
    this.nitro = 0;          // meter, 0..NITRO_MAX
    this.nitroOn = false;    // burning this frame
    this.pickups = [];
    this.buildPickups();

    // skills + progression
    this.chainPts = 0; this.chainMult = 1; this.lastSkill = 0;
    this.driftPts = 0; this.driftIdle = 0;
    this.draftPts = 0; this.drafting = false;
    this.missCooldown = new Map();
    this.cleanSinceGate = true;
    this.gateIdx = 0;
    this.raceXP = 0;         // banked skill chains + finish/medal bonuses
    this.finishStats = null; // PB/medal outcome, shown on the results screen

    // Time-trial ghost: your best recorded lap replayed as a translucent car.
    this.ghostData = null;   // { lapMs, samples: [[tRel, x, z, h], ...] }
    this.ghostBuf = [];      // pose samples for the lap in progress
    this.ghostVisual = null;
    this.ghostTimer = 0;
    this._lastPos = -1;      // for overtake callouts
    this._lastOvertakeAt = 0;
    this._lastLostAt = 0;

    this.camMode = localStorage.getItem('hr_cam') || 'chase';
    if (!CAM_MODES.includes(this.camMode)) this.camMode = 'chase';
    this.lightsOn = false;
    this.hornWasDown = false;

    this.shake = 0;
    this.wrongWayT = 0;
    this.sendTimer = 0;
    this.acc = 0;
    this.lastT = performance.now();

    this.net = null;
    this._camPos = new THREE.Vector3(g.x - Math.sin(g.h) * 8, 4, g.z - Math.cos(g.h) * 8);
    this._lookAt = new THREE.Vector3(g.x, 1.25, g.z);
    this._tmpV = new THREE.Vector3();

    // Rendered car pose. Physics advances in fixed 1/120 s steps while frames
    // land at arbitrary times, so drawing this.car raw aliases the car's motion
    // against the display rate — a frame gets 0, 1 or 2 steps of movement, and
    // at speed that reads as the whole scene vibrating (worst on 120 Hz
    // panels). Each frame we blend the last two physics states by the
    // accumulator remainder and draw THAT; the camera follows it too.
    this._prevPose = { x: g.x, z: g.z, h: g.h };
    this._viewPose = { x: g.x, z: g.z, h: g.h };
  }

  // Collapse the interpolation history onto the car's current state. Needed
  // whenever the car teleports (grid placement, map switch, track reset) so a
  // frame never blends across the jump.
  syncPose() {
    this._prevPose.x = this._viewPose.x = this.car.x;
    this._prevPose.z = this._viewPose.z = this.car.z;
    this._prevPose.h = this._viewPose.h = this.car.h;
    this.acc = 0;
  }

  attachNet(net) {
    this.net = net;
    net.on('welcome', (m) => {
      this.myId = m.id;
      this.laps = m.laps;
    });
    // Race-scoped messages are gated on actually being in a race. A message
    // can cross our exit on the wire (we click BACK TO LOBBY while the server
    // is broadcasting to the race we were still a member of), and a
    // backgrounded tab processes its queued messages long after the fact —
    // without the gate a late 'results' pops the results screen over the
    // lobby and it looks permanently stuck.
    const inRace = () => this.phase !== 'lobby';

    // Cars come from the race roster, never the lobby list — drivers in the
    // lobby (or in someone else's race) must not appear on your track.
    net.on('roster', (m) => { if (inRace()) this.syncRoster(m.roster); });
    net.on('grid', (m) => this.onGrid(m));
    net.on('count', (m) => {
      if (!inRace()) return;
      document.getElementById('countdown').classList.remove('hidden');
      document.getElementById('countNum').textContent = m.n;
      sfx.count();
    });
    net.on('go', () => {
      if (this.phase !== 'countdown') return;
      document.getElementById('countdown').classList.add('hidden');
      // Belt and braces: 'grid' always lands first and shows the HUD, but a race
      // must never start with the HUD still hidden.
      this.previewMode = false;
      this.hud.show();
      this.phase = 'race';
      this.t0 = performance.now();
      this.lapStart = this.t0;
      this.hud.banner('GO!', 1200);
      sfx.go();
    });
    net.on('snap', (m) => {
      if (!inRace()) return;
      this.order = m.order;
      this.checkOvertakes();
    });
    net.on('results', (m) => {
      if (!inRace()) return;
      this.phase = 'results';
      // Bank this race's XP exactly once, when the results land.
      let gain = null;
      if (this.raceXP > 0) {
        gain = addXP(this.raceXP);
        this.hud.results(m.rows, this.myId, {
          xp: this.raceXP, level: gain.level, leveled: gain.leveled,
          stats: this.finishStats, bestLap: this.bestLap,
        });
        this.raceXP = 0;
      } else {
        this.hud.results(m.rows, this.myId, this.finishStats
          ? { xp: 0, stats: this.finishStats, bestLap: this.bestLap } : null);
      }
      if (this.onProgress) this.onProgress();   // lobby refreshes level/unlocks
      setMusicScene('lobby');   // radio back up over the podium
      sfx.panel();
    });
    net.on('finished', (m) => { if (m.id !== this.myId) toast(`${m.name} finished — ${this.posOf(m.id)}`); });
    net.on('horn', (m) => { if (m.id !== this.myId) sfx.remoteHorn(); });
    net.on('close', () => toast('Connection lost — is the server still running?', 8000));
  }

  addVisual(id, name, color, human) {
    if (this.visuals.has(id)) return;
    const c = createCar(color, { spoiler: !human, kind: human ? 'human' : 'ai' });
    this.scene.add(c.group);
    this.visuals.set(id, { car: c, name, human, x: 0, z: 0, h: 0, sp: 0, shown: false });
  }

  // Make the cars in the scene exactly the roster of my race — no more, no less.
  syncRoster(roster = []) {
    const keep = new Set();
    for (const r of roster) {
      if (r.id === this.myId) continue;
      keep.add(r.id);
      this.addVisual(r.id, r.name, r.color, r.human);
    }
    for (const id of [...this.visuals.keys()]) if (!keep.has(id)) this.removeVisual(id);
  }

  removeVisual(id) {
    const v = this.visuals.get(id);
    if (v) { this.scene.remove(v.car.group); this.visuals.delete(id); this.hud.removePlate(id); }
  }

  setIdentity(name, color) {
    this.myName = name;
    if (!this.myVisual) {
      this.myVisual = createCar(color, { spoiler: true, kind: 'player' });
      this.scene.add(this.myVisual.group);
      this.measureCockpit();
      this.buildHeadlightBeams();
      this.setCamMode(this.camMode, true);
    } else {
      setPaint(this.myVisual, color);
    }
    if (this.previewMode) this.showFullBody(true);
    document.getElementById('chipName').textContent = name.toUpperCase();
  }

  // The showroom turntable looks at the car from outside, so a saved cockpit
  // camera must not leave its roof and cabin glass hidden.
  showFullBody(on) {
    if (!this.myVisual) return;
    if (!on) { this.setCamMode(this.camMode, true); return; }
    if (this.myVisual.cabin) this.myVisual.cabin.visible = true;
    for (const m of this.roofMeshes || []) m.visible = true;
  }

  // Derive the driver's eye point from the car's own bounding box, so a
  // swapped-in model does not need hand-tuned numbers.
  measureCockpit() {
    this.carTemplateCfg = carTemplateConfig();
    const box = new THREE.Box3().setFromObject(this.myVisual.group);
    const size = box.getSize(new THREE.Vector3());
    if (!isFinite(size.y) || size.y < 0.2) return;
    // A manifest can override this outright: "driverEye": [side, up, forward].
    const override = this.carTemplateCfg && this.carTemplateCfg.driverEye;
    if (Array.isArray(override) && override.length === 3) {
      this.modelCockpit = { side: override[0], up: override[1], fwd: override[2] };
      this.collectRoofMeshes();
      return;
    }
    // Sit forward at the windscreen and high in the cabin.
    this.modelCockpit = {
      fwd: size.z * 0.06,
      side: size.x * 0.15,
      up: Math.min(size.y * 0.66, 1.10),
    };
    this.collectRoofMeshes();
  }

  // Anything sitting entirely above the driver's eye — roof panel, upper roll
  // cage, rear wing — is hidden in cockpit view. A GT3 car's cage would
  // otherwise take up the top half of the screen and block the road.
  // Find whatever fills the space directly above the driver's head — headliner,
  // roll cage, windscreen sun strip — and hide it in cockpit view. Testing the
  // volume over the eye rather than matching node names means this works for
  // any model, not just this one.
  collectRoofMeshes() {
    this.roofMeshes = [];
    const c = this.modelCockpit;
    if (!c) return;
    const g = this.myVisual.group;
    const fx = Math.sin(g.rotation.y), fz = Math.cos(g.rotation.y);
    const eye = new THREE.Vector3(
      g.position.x + fx * c.fwd + fz * c.side,
      g.position.y + c.up,
      g.position.z + fz * c.fwd - fx * c.side
    );
    // Fan of rays from the eye into the upper hemisphere. Anything struck
    // within arm's reach is over the driver's head. Bounding boxes are too
    // coarse here — a door's box overlaps the space above you even though its
    // geometry does not.
    const meshes = [];
    g.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const rc = new THREE.Raycaster();
    const found = new Set();
    // Steep pitches only, so the windscreen straight ahead is left alone.
    for (const pitch of [22, 32, 45, 60, 75]) {
      for (const yaw of [-25, 0, 25]) {
        const p = pitch * Math.PI / 180, y = yaw * Math.PI / 180;
        const localF = Math.cos(p) * Math.cos(y);
        const localS = Math.cos(p) * Math.sin(y);
        const dir = new THREE.Vector3(
          fx * localF + fz * localS,
          Math.sin(p),
          fz * localF - fx * localS
        ).normalize();
        rc.set(eye, dir);
        rc.far = 0.85;
        for (const hit of rc.intersectObjects(meshes, false)) found.add(hit.object);
      }
    }
    // Keep the painted bodyshell: it carries the bonnet you see through the
    // screen, and its roof reads as inside-out (backface-culled) from in here.
    const paintNames = ((this.carTemplateCfg && this.carTemplateCfg.paintMaterials) || [])
      .map(s => s.toLowerCase());
    // Only hide meshes that actually live overhead. Some exports merge the
    // headliner with the door cards, console and footwell into one mesh —
    // hiding that guts half the cabin and leaves white inner shells behind.
    // A true roof panel / roll cage sits entirely above the driver's
    // shoulders; anything reaching lower stays visible (a headliner above the
    // eye doesn't block the camera anyway).
    const shoulderY = g.position.y + c.up - 0.35;
    const bb = new THREE.Box3();
    this.roofMeshes = [...found].filter((o) => {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some(m => {
        const n = (m && m.name || '').toLowerCase();
        return n && paintNames.some(p => n.includes(p));
      })) return false;
      bb.setFromObject(o);
      return bb.min.y > shoulderY;
    });
  }

  // Two dim spot lights so headlights actually throw light on the road.
  // No shadows — shadow-casting spots here would be far too expensive.
  buildHeadlightBeams() {
    this.headlightBeams = [];
    for (const side of [-1, 1]) {
      const spot = new THREE.SpotLight(0xfff4e0, 0, 55, 0.5, 0.55, 1.4);
      spot.castShadow = false;
      spot.visible = false;
      const target = new THREE.Object3D();
      this.scene.add(spot, target);
      spot.target = target;
      this.headlightBeams.push(spot);
      spot.userData.side = side;
    }
  }

  // ---------------------------------------------------------------- nitro pickups
  // Glowing canisters spaced around the lap, offset across the road in a
  // repeating left/center/right pattern so grabbing one costs a small line
  // change. Purely client-side: each driver collects their own — an arcade
  // pickup, not a contested resource — so the server needs no knowledge of it.
  buildPickups() {
    this.disposePickups();
    this.pickupRoot = new THREE.Group();
    this.scene.add(this.pickupRoot);
    this.pickups = [];

    const coreGeo = new THREE.IcosahedronGeometry(0.42, 0);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x2a2016, emissive: 0xffb400, emissiveIntensity: 2.2, roughness: 0.35,
    });
    const ringGeo = new THREE.TorusGeometry(0.78, 0.055, 8, 26);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x201408, emissive: 0xff6a13, emissiveIntensity: 1.6, roughness: 0.4,
    });
    // Kept so dispose can free them; the meshes all share these four objects.
    this._pickupAssets = [coreGeo, coreMat, ringGeo, ringMat];

    const L = this.track.L;
    const count = Math.max(6, Math.min(12, Math.round(L / 260)));
    for (let k = 0; k < count; k++) {
      // Offset from the checkpoint spacing so a canister never sits in a gate.
      const s = ((k + 0.5) / count) * L;
      const p = this.track.point(s);
      const lat = [(-3.1), 0, 3.1][k % 3];
      const x = p.x + p.nx * lat, z = p.z + p.nz * lat;
      const g = new THREE.Group();
      const core = new THREE.Mesh(coreGeo, coreMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2 - 0.35;
      g.add(core, ring);
      g.position.set(x, ROAD_Y + 1.05, z);
      this.pickupRoot.add(g);
      this.pickups.push({ x, z, mesh: g, ring, active: true, respawn: 0, phase: k * 1.7 });
    }
  }

  disposePickups() {
    if (this.pickupRoot) {
      this.scene.remove(this.pickupRoot);
      for (const a of this._pickupAssets || []) a.dispose();
      this._pickupAssets = null;
      this.pickupRoot = null;
    }
    this.pickups = [];
  }

  resetPickups() {
    for (const p of this.pickups) { p.active = true; p.respawn = 0; p.mesh.visible = true; }
  }

  // Spin/bob the canisters, tick respawns, and (while racing) collect any the
  // car passed over this frame. Movement is checked against the segment the
  // car covered, not just its end point, so a top-speed pass on a slow frame
  // cannot tunnel through the collection radius.
  updatePickups(dt, now, racing, px, pz) {
    const t = now * 0.001;
    for (const p of this.pickups) {
      if (!p.active) {
        p.respawn -= dt;
        if (p.respawn <= 0) { p.active = true; p.mesh.visible = true; }
        continue;
      }
      p.mesh.position.y = ROAD_Y + 1.05 + Math.sin(t * 2.2 + p.phase) * 0.16;
      p.mesh.rotation.y = t * 1.8 + p.phase;
      p.ring.rotation.z = t * 2.6;

      if (!racing) continue;
      // Distance from the pickup to the segment (px,pz) -> car.
      const dx = this.car.x - px, dz = this.car.z - pz;
      const wx = p.x - px, wz = p.z - pz;
      const len2 = dx * dx + dz * dz;
      const u = len2 > 1e-9 ? Math.max(0, Math.min(1, (wx * dx + wz * dz) / len2)) : 0;
      const ex = wx - dx * u, ez = wz - dz * u;
      if (ex * ex + ez * ez < NITRO_GRAB_R * NITRO_GRAB_R) {
        p.active = false;
        p.respawn = NITRO_RESPAWN;
        p.mesh.visible = false;
        this.nitro = Math.min(NITRO_MAX, this.nitro + NITRO_PICKUP);
        this.addSkill('Nitro Grab', 25);
        sfx.nitro();
      }
    }
  }

  // Swap the whole circuit: track math, world scenery, minimap, parked car.
  // Cheap no-op when the id already matches (the common case on 'grid').
  setTrack(id) {
    if (!id || this.track.id === id) return;
    this.track = buildTrack(id);
    this.fx.clearMarks();   // old circuit's rubber makes no sense here
    this.world.dispose();
    this.world = buildWorld(this.scene, this.renderer, this.track, this.quality, this.treeModel);
    this.buildPickups();
    this.hud.setTrack(this.track);
    const g = this.track.gridSlot(11);
    this.car = { x: g.x, z: g.z, h: g.h, vx: 0, vz: 0, s: g.s };
    this.prevS = g.s;
    this.gateIdx = 0;
    this.syncPose();
    // Snap the camera to the new circuit rather than flying it across the map.
    this._camPos.set(g.x - Math.sin(g.h) * 8, 4, g.z - Math.cos(g.h) * 8);
    this._lookAt.set(g.x, 1.25, g.z);
  }

  onGrid(m) {
    this.hud.hideResults();
    this.setTrack(m.map);   // the race's circuit may differ from the lobby pick
    this.previewMode = false;
    this.showFullBody(false);
    this.phase = 'countdown';
    this.raceKind = m.kind || 'bot';
    this.syncRoster(m.roster);
    this.laps = m.laps;
    this.finished = false;
    this.lap = 0;
    this.bestLap = 0;
    this.chainPts = 0; this.chainMult = 1;
    this.driftPts = 0; this.draftPts = 0;
    this.gateIdx = 0; this.cleanSinceGate = true;
    this.raceXP = 0; this.finishStats = null;
    this.nitro = 0; this.nitroOn = false;
    this.resetPickups();
    // Time trial: load this circuit's ghost and spawn its translucent car.
    this._lastPos = -1;
    this.ghostBuf = [];
    this.ghostTimer = 0;
    if (this.raceKind === 'trial') {
      this.ghostData = null;
      try { this.ghostData = JSON.parse(localStorage.getItem('hr_ghost_' + this.track.id)); } catch {}
      if (this.ghostData && !(this.ghostData.lapMs > 5000 && Array.isArray(this.ghostData.samples))) this.ghostData = null;
      this.removeGhostVisual();
      this.ensureGhostVisual();
    } else {
      this.removeGhostVisual();
    }
    this.net.resetBuffers();
    for (const slot of m.slots) {
      if (slot.id === this.myId) {
        this.car = { x: slot.x, z: slot.z, h: slot.h, vx: 0, vz: 0, s: slot.s };
        this.prevS = slot.s;
        this.syncPose();
      } else {
        const v = this.visuals.get(slot.id);
        if (v) { v.x = slot.x; v.z = slot.z; v.h = slot.h; v.sp = 0; }
      }
    }
    this.hud.show();
    const trackName = this.track.def.name.toUpperCase() + (this.track.def.reversed ? ' ⟲ REVERSED' : '');
    this.hud.banner(`${trackName} — ${this.laps} LAPS`, 1800);
    setMusicScene('race');   // duck the radio under the engines
    sfx.gridUp();
  }

  // Back to the menu after a race: park on the grid, clear the field, and hand
  // the camera back to the turntable so paint can be changed again.
  toLobby() {
    this.hud.hideResults();
    this.hud.hide();
    setMusicScene('lobby');
    this.phase = 'lobby';
    this.previewMode = true;
    this.showFullBody(true);
    this.finished = false;
    this.order = [];
    this.syncRoster([]);
    if (this.net) this.net.resetBuffers();
    const g = this.track.gridSlot(11);
    this.car = { x: g.x, z: g.z, h: g.h, vx: 0, vz: 0, s: g.s };
    this.prevS = g.s;
    this.syncPose();
    this.chainPts = 0; this.chainMult = 1;
    this.hud.chain(0, 1);
    this.nitro = 0; this.nitroOn = false;
    setNitro(false);
    this.resetPickups();
    this.removeGhostVisual();
    this.ghostBuf = [];
  }

  posOf(id) {
    const i = this.order.indexOf(id);
    return i < 0 ? '' : 'P' + (i + 1);
  }

  // ---------------------------------------------------------------- ghost
  // The time-trial ghost is your fastest recorded lap replayed in world space,
  // clocked off lapStart so it relaunches with you on every crossing.
  ensureGhostVisual() {
    if (this.ghostVisual || !this.ghostData) return;
    const c = createCar(0x9fd8ff, { spoiler: true, kind: 'ghost' });
    const fade = (m) => {
      const f = m.clone();
      f.transparent = true;
      f.opacity = Math.min(f.opacity ?? 1, 0.26);
      f.depthWrite = false;
      return f;
    };
    c.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.material = Array.isArray(o.material) ? o.material.map(fade) : fade(o.material);
      }
    });
    c.group.visible = false;
    this.scene.add(c.group);
    this.ghostVisual = c;
  }

  removeGhostVisual() {
    if (!this.ghostVisual) return;
    this.scene.remove(this.ghostVisual.group);
    this.ghostVisual = null;
  }

  updateGhost(now, dt) {
    const g = this.ghostVisual;
    if (!g) return;
    const d = this.ghostData;
    const live = this.raceKind === 'trial' && this.phase === 'race' && !this.finished && d;
    const t = now - this.lapStart;
    if (!live || t < 0 || t > d.lapMs || d.samples.length < 2) {
      g.group.visible = false;   // ghost already "finished" its lap — let it rest
      return;
    }
    const s = d.samples;
    let lo = 0, hi = s.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid][0] <= t) lo = mid; else hi = mid;
    }
    const a = s[lo], b = s[hi];
    const k = Math.max(0, Math.min(1, (t - a[0]) / Math.max(1, b[0] - a[0])));
    g.group.visible = true;
    g.group.position.set(a[1] + (b[1] - a[1]) * k, ROAD_Y, a[2] + (b[2] - a[2]) * k);
    g.group.rotation.y = a[3] + wrapAngle(b[3] - a[3]) * k;
    const sp = Math.hypot(b[1] - a[1], b[2] - a[2]) / Math.max(0.001, (b[0] - a[0]) / 1000);
    animateCar(g, sp, 0, 0, dt);
  }

  // ---------------------------------------------------------------- rivals
  // Position-change callouts, driven from server standings. Overtakes feed the
  // skill chain (they're XP); losing a place gets a subdued feed line.
  checkOvertakes() {
    if (this.phase !== 'race' || this.finished || this.raceKind === 'trial') return;
    const pos = this.order.indexOf(this.myId);
    if (pos < 0) return;
    const now = performance.now();
    if (this._lastPos < 0 || now - this.t0 < 5000) { this._lastPos = pos; return; }
    if (pos < this._lastPos && now - this._lastOvertakeAt > 2500) {
      this._lastOvertakeAt = now;
      const v = this.visuals.get(this.order[pos + 1]);
      this.addSkill(v ? `Passed ${v.name}` : 'Overtake', 60);
    } else if (pos > this._lastPos && now - this._lastLostAt > 4000) {
      this._lastLostAt = now;
      const v = this.visuals.get(this.order[pos - 1]);
      if (v) this.hud.skill(`${v.name} took P${pos}`, 0, 'bad');
    }
    this._lastPos = pos;
  }

  // ---------------------------------------------------------------- skills
  addSkill(label, pts, cls = '') {
    this.chainPts += pts;
    this.chainMult = Math.min(3, this.chainMult + 0.1);
    this.lastSkill = performance.now();
    this.hud.skill(label, pts, cls);
    sfx.skill();
  }

  skillTick(now, ev, otherCars) {
    // drift — threshold sits just under the slip a full power drift settles at,
    // so committed big-turn slides score, small grip-corner slip does not
    const speed = Math.hypot(this.car.vx, this.car.vz);
    if (Math.abs(ev.slip) > 0.19 && speed > 13) {
      this.driftPts += 90 * (1 / 60);
      this.driftIdle = 0;
    } else if (this.driftPts > 0) {
      this.driftIdle += 1 / 60;
      if (this.driftIdle > 0.6) {
        if (this.driftPts > 110) this.addSkill('Drift', this.driftPts);
        this.driftPts = 0;
      }
    }
    // drafting + near miss
    const [fx, fz] = [Math.sin(this.car.h), Math.cos(this.car.h)];
    let draftNow = false;
    for (const o of otherCars) {
      const dx = o.x - this.car.x, dz = o.z - this.car.z;
      const ahead = dx * fx + dz * fz;
      const side = dx * fz - dz * fx;
      if (ahead > 5 && ahead < 26 && Math.abs(side) < 2.4 && speed > 26) draftNow = true;
      const dist = Math.hypot(dx, dz);
      if (dist < 3.4 && Math.abs(speed - o.sp) > 7) {
        const last = this.missCooldown.get(o.id) || 0;
        if (now - last > 4000) {
          this.missCooldown.set(o.id, now);
          this.addSkill('Near Miss', 75);
        }
      }
    }
    if (draftNow) this.draftPts += 55 / 60;
    else if (this.draftPts > 0) {
      if (this.draftPts > 55) this.addSkill('Drafting', this.draftPts);
      this.draftPts = 0;
    }
    this.drafting = draftNow;

    // wall impacts
    if (ev.impact > 9) {
      if (this.chainPts > 0) {
        this.hud.skill('Skill Chain Lost', 0, 'bad');
        sfx.lost();
      }
      this.chainPts = 0; this.chainMult = 1;
      this.cleanSinceGate = false;
      sfx.impact(Math.min(1, ev.impact / 16));
      this.shake = Math.min(1, ev.impact / 16);
    } else if (ev.impact > 3) {
      this.cleanSinceGate = false;
      sfx.impact(ev.impact / 16);
      this.shake = Math.max(this.shake, 0.2);
    } else if (ev.scrape && speed > 6) {
      sfx.scrape();
    }

    // bank chain — banked points are this race's XP
    if (this.chainPts > 0 && now - this.lastSkill > 4000) {
      const xp = Math.round(this.chainPts * this.chainMult);
      this.raceXP += xp;
      this.hud.skill(xp > 600 ? 'ULTIMATE SKILL CHAIN!' : 'Skill Chain', xp, 'big');
      sfx.bank();
      this.chainPts = 0; this.chainMult = 1;
    }
    this.hud.chain(this.chainPts, this.chainMult);
  }

  // ---------------------------------------------------------------- laps & gates
  lapTick(now) {
    const L = this.track.L;
    if (this.prevS > L * 0.9 && this.car.s < L * 0.1 && this.phase === 'race') {
      const lapTime = now - this.lapStart;
      this.lapStart = now;
      // Physical floor for a valid lap: you cannot lap faster than track
      // length over the car's maximum possible speed (nitro included). This
      // keeps teleports/resets from ever minting an impossible PB or ghost.
      const minLap = Math.max(5000, (L / (CAR.topSpeed * (CAR.nitroTop || 1))) * 1000);
      if (this.lap > 0 && lapTime > minLap) {
        if (!this.bestLap || lapTime < this.bestLap) this.bestLap = lapTime;
      }
      // Time trial: a completed lap that beats the stored ghost BECOMES the
      // ghost, and every crossing restarts both the recording buffer and the
      // ghost's replay clock (it runs on lapStart).
      if (this.raceKind === 'trial') {
        if (this.lap > 0 && lapTime > minLap) {
          const beat = !this.ghostData || Math.round(lapTime) < this.ghostData.lapMs;
          if (beat && this.ghostBuf.length > 10) {
            this.ghostData = { lapMs: Math.round(lapTime), samples: this.ghostBuf };
            try { localStorage.setItem('hr_ghost_' + this.track.id, JSON.stringify(this.ghostData)); } catch {}
            this.ensureGhostVisual();
          }
          this.hud.banner(`${beat ? '👻 NEW GHOST — ' : ''}LAP ${fmtTime(lapTime)}`, 1800);
        }
        this.ghostBuf = [];
        this.ghostTimer = 0;
      }
      this.lap++;
      if (this.lap > this.laps && !this.finished) {
        this.finished = true;
        sfx.finish();
        const p = this.order.indexOf(this.myId);
        this.hud.banner(`FINISHED ${p >= 0 ? 'P' + (p + 1) : ''}`, 5000);
        // Progression: finish bonus by position, then PBs and medals. Any
        // still-open skill chain banks too — crossing the line shouldn't eat it.
        if (this.chainPts > 0) {
          this.raceXP += Math.round(this.chainPts * this.chainMult);
          this.chainPts = 0; this.chainMult = 1;
        }
        const pos = p >= 0 ? p + 1 : this.order.length || 12;
        this.raceXP += Math.max(40, (13 - pos) * 60);
        this.finishStats = recordRace(
          this.track.id, Math.round(this.bestLap), Math.round(now - this.t0), this.track.def.medals);
        this.raceXP += this.finishStats.medalXP;
        this.net.send({ t: 'finish', bestLap: Math.round(this.bestLap) });
      } else if (this.lap === this.laps) {
        this.hud.banner('FINAL LAP', 2200);
        sfx.checkpoint();
      }
    }
    this.prevS = this.car.s;

    // checkpoint gates
    const NCP = this.world.checkpoints.length;
    const gateSize = L / NCP;
    const idx = Math.floor(this.car.s / gateSize) % NCP;
    if (idx !== this.gateIdx) {
      this.gateIdx = idx;
      sfx.checkpoint();
      if (this.cleanSinceGate && this.phase === 'race' && !this.finished) this.addSkill('Clean Racing', 50);
      this.cleanSinceGate = true;
    }
  }

  // ---------------------------------------------------------------- collisions vs others
  // Car-to-car contact. Two things matter for this to feel like racing rather
  // than hitting a wall:
  //   1. The footprint is an ellipse in our own frame, not a circle. A circle
  //      big enough to cover a 4.4 m car also covers the lane beside it, so
  //      running side by side would register phantom hits.
  //   2. Only the closing speed RELATIVE to the other car is scrubbed. Using
  //      absolute speed means rear-ending a car that is nearly as fast as you
  //      cancels your entire momentum instead of the few m/s you actually
  //      closed on it.
  collideOthers(otherCars, dt) {
    const fx = Math.sin(this.car.h), fz = Math.cos(this.car.h);
    const A = CAR.length * 0.98;   // combined end-to-end reach of two cars
    const B = CAR.width * 1.02;    // combined side-to-side reach

    for (const o of otherCars) {
      const dx = this.car.x - o.x, dz = this.car.z - o.z;
      const along = dx * fx + dz * fz;
      const side = dx * fz - dz * fx;
      const na = along / A, ns = side / B;
      const r2 = na * na + ns * ns;
      if (r2 >= 1 || r2 < 1e-9) continue;

      // Contact normal = ellipse gradient, taken back into world space.
      let ga = na / A, gs = ns / B;
      const gm = Math.hypot(ga, gs) || 1;
      ga /= gm; gs /= gm;
      const nx = ga * fx + gs * fz;
      const nz = ga * fz - gs * fx;

      // Ease apart at a bounded rate so contact never teleports the car.
      const pen = (1 - Math.sqrt(r2)) * Math.hypot(ga * A, gs * B);
      const push = Math.min(pen, 14 * dt);
      this.car.x += nx * push;
      this.car.z += nz * push;

      const vn = (this.car.vx - (o.vx || 0)) * nx + (this.car.vz - (o.vz || 0)) * nz;
      if (vn < 0) {
        // Door-to-door contact deflects sideways; end-on contact mostly just
        // slows the closing. Never reverse — absorb stays below 1.
        const sideOn = Math.abs(gs);
        const absorb = 0.45 + sideOn * 0.35;
        const dv = Math.min(-vn * absorb, 9);
        this.car.vx += nx * dv;
        this.car.vz += nz * dv;

        const closing = -vn;
        if (closing > 7) {
          sfx.impact(Math.min(1, closing / 16));
          this.shake = Math.max(this.shake, Math.min(0.5, closing / 26));
          this.cleanSinceGate = false;
        } else if (closing > 1.5) {
          sfx.scrape();   // light rub while running wheel to wheel
        }
      }
    }
  }

  // ---------------------------------------------------------------- frame
  frame() {
    const now = performance.now();
    let dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;

    // Track viewport changes every frame (resize events can be missed in
    // embedded panes / when the window is moved between displays).
    if (this._vw !== innerWidth || this._vh !== innerHeight) {
      this._vw = innerWidth; this._vh = innerHeight;
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    }

    const racing = this.phase === 'race' && !this.finished;
    const curSpeed = Math.hypot(this.car.vx, this.car.vz);
    // Camera, lights and horn stay live even when not racing, so the view can be
    // changed on the grid or after finishing.
    const input = readInput(dt, curSpeed);
    if (!racing) {
      input.steer = 0;
      input.throttle = 0;
      input.brake = this.finished ? 0.4 : 0;
      input.hand = false;
      input.reset = false;
    }
    input.draft = this.drafting;

    // Nitro only burns while racing and with fuel in the meter; the raw key
    // state is replaced by the gated result before physics sees it.
    this.nitroOn = racing && !!input.nitro && this.nitro > 0;
    input.nitro = this.nitroOn ? 1 : 0;
    if (this.nitroOn) this.nitro = Math.max(0, this.nitro - NITRO_BURN * dt);
    setNitro(this.nitroOn);

    if (input.camCycle) {
      this.setCamMode(CAM_MODES[(CAM_MODES.indexOf(this.camMode) + 1) % CAM_MODES.length]);
    }
    if (input.lightsToggle) {
      this.lightsOn = !this.lightsOn;
      if (this.myVisual) setLights(this.myVisual, this.lightsOn);
      if (this.headlightBeams) for (const b of this.headlightBeams) b.visible = this.lightsOn;
      toast(this.lightsOn ? 'LIGHTS ON' : 'LIGHTS OFF', 1100);
    }
    setHorn(!!input.horn);
    if (input.horn && !this.hornWasDown && this.net) this.net.send({ t: 'horn' });
    this.hornWasDown = !!input.horn;

    if (input.reset) {
      const c = this.track.closestS(this.car.x, this.car.z, this.car.s);
      this.car.x = c.x; this.car.z = c.z; this.car.h = c.h;
      this.car.vx = 0; this.car.vz = 0;
      this.car.yawRate = 0;
      this.syncPose();
      sfx.reset();
    }

    // fixed-step local physics
    let ev = { impact: 0, slip: 0 };
    const prePhysX = this.car.x, prePhysZ = this.car.z;   // for pickup sweep
    if (this.phase === 'race' || this.phase === 'results') {
      this.acc += dt;
      const step = 1 / 120;
      while (this.acc >= step) {
        this._prevPose.x = this.car.x;
        this._prevPose.z = this.car.z;
        this._prevPose.h = this.car.h;
        ev = stepCar(this.car, input, step, this.track);
        this.acc -= step;
      }
      // Blend the two most recent physics states by the un-simulated remainder
      // (see constructor note) — this pose is what the car and camera draw from.
      const a = Math.min(1, this.acc * 120);
      const vp = this._viewPose, pp = this._prevPose;
      vp.x = pp.x + (this.car.x - pp.x) * a;
      vp.z = pp.z + (this.car.z - pp.z) * a;
      vp.h = pp.h + wrapAngle(this.car.h - pp.h) * a;
    } else {
      this._viewPose.x = this.car.x;
      this._viewPose.z = this.car.z;
      this._viewPose.h = this.car.h;
    }

    // nitro canisters: animate always (they're visible from the lobby
    // turntable too), collect only while racing
    this.updatePickups(dt, now, racing, prePhysX, prePhysZ);

    // interpolate remote cars
    const others = [];
    for (const [id, v] of this.visuals) {
      const s = this.net ? this.net.sample(id) : null;
      if (s) {
        // Light easing on top of the snapshot interpolation: residual velocity
        // steps between snapshot pairs are invisible at distance but read as
        // vibration when the car is large on screen, right beside you in an
        // overtake. First sample after a gap snaps so cars don't glide in.
        const k = v.shown ? 1 - Math.exp(-dt * 24) : 1;
        v.x += (s.x - v.x) * k;
        v.z += (s.z - v.z) * k;
        v.h += wrapAngle(s.h - v.h) * Math.min(1, dt * 14);
        v.sp = s.sp;
        v.shown = true;
        if (s.lg !== undefined && v.lightsOn !== !!s.lg) {
          v.lightsOn = !!s.lg;
          setLights(v.car, v.lightsOn);
        }
        v.braking = !!s.bk;
        v.boosting = !!s.nt;
      }
      v.car.group.position.set(v.x, ROAD_Y, v.z);
      v.car.group.rotation.y = v.h;
      animateCar(v.car, v.sp, 0, v.braking ? 1 : 0, dt);
      v.car.group.visible = v.shown;
      // A rival mid-burn trails the same exhaust plume you make (see below).
      if (v.shown && v.boosting && Math.random() < 0.7) {
        const bfx = Math.sin(v.h), bfz = Math.cos(v.h);
        this.fx.emitSmoke(v.x - bfx * 2.2, ROAD_Y + 0.35, v.z - bfz * 2.2,
          -bfx * v.sp * 0.22, 0.5, -bfz * v.sp * 0.22, 0.7, false);
      }
      if (v.shown) {
        // Velocity vector too, so contact can trade relative rather than
        // absolute speed (see collideOthers).
        others.push({
          id, x: v.x, z: v.z, sp: v.sp, human: v.human, name: v.name,
          vx: Math.sin(v.h) * v.sp, vz: Math.cos(v.h) * v.sp,
        });
      }
    }

    // Time-trial ghost: record my lap (sim pose, ~15 Hz), replay the best one.
    if (this.raceKind === 'trial') {
      if (racing) {
        this.ghostTimer += dt;
        if (this.ghostTimer >= 0.066 && this.ghostBuf.length < 2600) {
          this.ghostTimer = 0;
          this.ghostBuf.push([
            Math.round(now - this.lapStart),
            +this.car.x.toFixed(2), +this.car.z.toFixed(2), +this.car.h.toFixed(3),
          ]);
        }
      }
      this.updateGhost(now, dt);
    }

    if (racing) {
      this.collideOthers(others, dt);
      this.skillTick(now, ev, others);
      this.lapTick(now);

      // wrong way
      const c = this.track.closestS(this.car.x, this.car.z, this.car.s);
      const vdot = this.car.vx * c.tx + this.car.vz * c.tz;
      if (vdot < -4) {
        this.wrongWayT += dt;
        if (this.wrongWayT > 1.2) this.hud.banner('WRONG WAY', 700);
      } else this.wrongWayT = 0;
    } else if (this.finished && this.phase === 'race') {
      this.lapTick(now); // keep s updated
    }

    // my visual — drawn at the interpolated pose, not the raw physics state
    const speed = Math.hypot(this.car.vx, this.car.vz);
    const vp = this._viewPose;
    if (this.myVisual) {
      this.myVisual.group.position.set(vp.x, ROAD_Y, vp.z);
      this.myVisual.group.rotation.y = vp.h;
      animateCar(this.myVisual, speed, input.steer, input.brake, dt);
      // In an interior view, hide our own bodywork's shadow-caster only if it
      // would sit on top of the lens; the model itself stays visible.
      if (this.headlightBeams) {
        const fx = Math.sin(vp.h), fz = Math.cos(vp.h);
        for (const spot of this.headlightBeams) {
          spot.intensity = this.lightsOn ? 70 : 0;
          const lat = spot.userData.side * 0.62;
          spot.position.set(vp.x + fx * 1.9 + fz * lat, ROAD_Y + 0.62, vp.z + fz * 1.9 - fx * lat);
          spot.target.position.set(vp.x + fx * 26 + fz * lat, ROAD_Y - 0.2, vp.z + fz * 26 - fx * lat);
          spot.target.updateMatrixWorld();
        }
      }
    }

    // drift effects: rubber on the road while sliding, smoke off the rears,
    // sandy dust when running wide. Anchored to the rendered pose.
    if (this.phase === 'race' || this.phase === 'results') {
      const hfx = Math.sin(vp.h), hfz = Math.cos(vp.h);
      const rx = hfz, rz = -hfx;
      const slipAbs = Math.abs(ev.slip || 0);
      const sliding = speed > 6 &&
        (slipAbs > 0.16 || (input.hand && speed > 8) || (this.car.drift || 0) > 0.6);
      const dusty = !!ev.offroad && speed > 9;
      for (const side of [-1, 1]) {
        const wx = vp.x - hfx * 1.45 + rx * side * 0.85;
        const wz = vp.z - hfz * 1.45 + rz * side * 0.85;
        this.fx.skid('r' + side, wx, wz, sliding && !ev.offroad, 0.45 + Math.min(0.3, slipAbs));
        if ((sliding || dusty) && Math.random() < (dusty ? 0.55 : 0.8)) {
          this.fx.emitSmoke(wx, ROAD_Y + 0.12, wz,
            -this.car.vx * 0.12, 0, -this.car.vz * 0.12,
            0.8 + Math.min(1, slipAbs * 2), dusty);
        }
      }
      // nitro burn: a dense plume kicked out of the exhaust
      if (this.nitroOn && Math.random() < 0.9) {
        this.fx.emitSmoke(vp.x - hfx * 2.2, ROAD_Y + 0.35, vp.z - hfz * 2.2,
          -this.car.vx * 0.22, 0.5, -this.car.vz * 0.22, 0.7, false);
      }
    } else {
      this.fx.skid('r-1', 0, 0, false);
      this.fx.skid('r1', 0, 0, false);
    }
    this.fx.update(dt);

    // gamepad haptics: brake judder, offroad rumble, impact thumps
    updateHaptics(dt, {
      brake: input.brake, speed,
      impact: ev.impact, offroad: !!ev.offroad, slip: ev.slip || 0,
    });

    // network send
    this.sendTimer += dt;
    if (this.net && this.net.connected && this.sendTimer > 0.04 && this.myId) {
      this.sendTimer = 0;
      this.net.send({
        t: 'state',
        x: +this.car.x.toFixed(2), z: +this.car.z.toFixed(2), h: +this.car.h.toFixed(3),
        sp: +speed.toFixed(1), s: +this.car.s.toFixed(1), lap: this.lap,
        lg: this.lightsOn ? 1 : 0,
        bk: input.brake > 0.12 ? 1 : 0,
        nt: this.nitroOn ? 1 : 0,
      });
    }

    this.updateCamera(dt, speed, now);
    this.world.update(dt, this._tmpV.set(this.car.x, 0, this.car.z));

    if (this.phase === 'race' || this.phase === 'results') this.updateHUD(now, speed, others);

    // audio
    const mph = speed * MPH;
    const gearSpan = 32;
    const rpm = (mph % gearSpan) / gearSpan;
    updateEngine(rpm, speed, input.throttle, ev.slip || 0, dt);

    this.renderer.render(this.scene, this.camera);
  }

  updateCamera(dt, speed, now) {
    const cam = this.camera;
    // Everything here anchors to the interpolated pose the car is DRAWN at —
    // following the raw physics state instead re-introduces the stepped-motion
    // shake the view pose exists to remove.
    const car = this._viewPose;
    if (this.phase === 'lobby' || this.phase === 'countdown' || this.phase === 'results') {
      // Lobby = a tight showroom turntable around your own car; countdown and
      // results keep the wider cinematic orbit.
      const preview = this.previewMode && this.phase === 'lobby';
      // Wide: the menu is a column down one side. Narrow: it is a sheet along the
      // bottom, leaving only a strip, so the camera backs off to fit the car in.
      const wide = innerWidth >= 900;
      const a = now * (preview ? 0.00030 : 0.00022);
      // Far enough back that the whole car stays inside the frame once it is
      // pushed off-centre by the aim offset below.
      const r = preview ? (wide ? 9.6 : 12.6) : (this.phase === 'countdown' ? 9 : 14);
      const camY = preview ? 2.15 : 3.2;
      const tx = car.x + Math.sin(a) * r;
      const tz = car.z + Math.cos(a) * r;
      this._camPos.lerp(this._tmpV.set(tx, camY, tz), Math.min(1, dt * 2.2));
      cam.position.copy(this._camPos);

      let lx = car.x, lz = car.z, ly = 1;
      if (preview) {
        // Aiming to one side of the car slides it into the screen space the menu
        // panel is not covering: sideways on a wide window, upward on a narrow
        // one where the panel sits along the bottom instead.
        const dx = car.x - cam.position.x, dz = car.z - cam.position.z;
        const m = Math.hypot(dx, dz) || 1;
        const shift = wide ? 2.5 : 0;      // world metres, screen-left of the car
        lx += (dz / m) * shift;
        lz += (-dx / m) * shift;
        // Portrait leaves only a strip above the panel, so aim well below the car
        // to tilt it up into that strip.
        ly = wide ? 0.85 : -3.9;
      }
      cam.lookAt(lx, ly, lz);
      cam.fov += ((preview ? 40 : 58) - cam.fov) * dt * 3;
      cam.updateProjectionMatrix();
      return;
    }
    const fx = Math.sin(car.h), fz = Math.cos(car.h);
    // Right of the car, for seating the driver off-centre (+X is the car's left).
    const rx = fz, rz = -fx;
    const cockpit = this.cockpitOffset();

    if (this.camMode === 'chase') {
      // Close enough that the car fills the frame the way a Horizon chase cam
      // does; it eases back a little at speed for a sense of pace.
      const dist = 5.9 + Math.min(speed / CAR.topSpeed, 1) * 0.9;
      const height = 2.45;
      const want = this._tmpV.set(car.x - fx * dist, height, car.z - fz * dist);
      // Ease position, and ease the look-ahead point too, so the view sweeps
      // through a curve instead of snapping to the new heading each frame.
      this._camPos.lerp(want, 1 - Math.exp(-dt * 5.2));
      // That easing trails its target by ~speed/5.2 m, so at pace the car ends
      // up a dozen metres ahead of the lens, shrinking into the distance. Keep
      // the smoothed direction (that's the pleasant sweep through corners) but
      // clamp the actual gap so the car always stays close and filling the frame.
      let ox = this._camPos.x - car.x, oz = this._camPos.z - car.z;
      const gap = Math.hypot(ox, oz);
      const gapMax = dist + 1.0, gapMin = dist * 0.55;
      if (gap > 1e-6 && (gap > gapMax || gap < gapMin)) {
        const k = Math.max(gapMin, Math.min(gapMax, gap)) / gap;
        this._camPos.x = car.x + ox * k;
        this._camPos.z = car.z + oz * k;
      }
      cam.position.copy(this._camPos);
      this._lookAt.lerp(
        this._tmpV.set(car.x + fx * 4.5, 1.15, car.z + fz * 4.5),
        1 - Math.exp(-dt * 7.5)
      );
    } else {
      // Cockpit and hood are rigidly attached — any lag inside the car reads as
      // the whole cabin sliding around, which feels worse than no smoothing.
      const eye = this._tmpV.set(
        car.x + fx * cockpit.fwd + rx * cockpit.side,
        ROAD_Y + cockpit.up,
        car.z + fz * cockpit.fwd + rz * cockpit.side
      );
      cam.position.copy(eye);
      this._camPos.copy(eye);
      // Aim just below eye level down the road, the way a driver actually looks.
      this._lookAt.lerp(
        this._tmpV.set(car.x + fx * 40, ROAD_Y + cockpit.up - 0.55, car.z + fz * 40),
        1 - Math.exp(-dt * 14)
      );
    }

    if (this.shake > 0.01) {
      const s = this.camMode === 'chase' ? 1 : 0.45;   // less violent from inside
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.5 * s;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.35 * s;
      this.shake *= Math.exp(-dt * 6);
    }
    cam.lookAt(this._lookAt);

    // Wide from inside: a narrow FOV in a cockpit makes the dash dominate and
    // hides the road. 82 keeps the car framing but shows the track ahead.
    const baseFov = this.camMode === 'cockpit' ? 82 : this.camMode === 'hood' ? 72 : 62;
    // The nitro FOV kick is most of what makes the boost FEEL fast — the fov
    // lerp below eases it in and out.
    const wantFov = baseFov + Math.min(1, speed / CAR.topSpeed) * (this.camMode === 'chase' ? 12 : 8)
      + (this.nitroOn ? 9 : 0);
    cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 4);
    // Near plane must come in for interior views or the dash clips away.
    const wantNear = this.camMode === 'chase' ? 0.5 : 0.12;
    if (cam.near !== wantNear) cam.near = wantNear;
    cam.updateProjectionMatrix();
  }

  // Eye point in car-local terms: forward of centre, lateral, and height.
  cockpitOffset() {
    if (this.camMode === 'hood') return { fwd: 1.5, side: 0, up: 1.15 };
    const c = this.modelCockpit || { fwd: 0.15, side: 0.36, up: 1.02 };
    return c;
  }

  setCamMode(mode, quiet = false) {
    this.camMode = mode;
    localStorage.setItem('hr_cam', mode);
    // The procedural car's tinted cabin, and a model's roof/cage, would block
    // an interior view — drop them for cockpit only.
    if (this.myVisual) {
      if (this.myVisual.cabin) this.myVisual.cabin.visible = (mode !== 'cockpit');
      for (const m of this.roofMeshes || []) m.visible = (mode !== 'cockpit');
      this.myVisual.group.visible = true;
    }
    // Cycling to the cockpit while still in the lobby must not strip the roof off
    // the car on the turntable.
    if (this.previewMode) this.showFullBody(true);
    if (!quiet) toast(CAM_LABELS[mode], 1400);
  }

  updateHUD(now, speed, others) {
    const mph = speed * MPH;
    const total = Math.max(1, this.order.length);
    const myPos = Math.max(1, this.order.indexOf(this.myId) + 1);

    // next checkpoint
    const L = this.track.L;
    const NCP = this.world.checkpoints.length;
    const gateSize = L / NCP;
    const nextIdx = (Math.floor(this.car.s / gateSize) + 1) % NCP;
    const gate = this.world.checkpoints[nextIdx];
    const distM = ((gate.s - this.car.s) + L) % L;
    let cpYd = null, cpScreenX = 0;
    if (distM < 500 && !this.finished) {
      cpYd = distM * YD;
      this._tmpV.set(gate.x, 2, gate.z).project(this.camera);
      cpScreenX = this._tmpV.z < 1 ? Math.max(-1, Math.min(1, this._tmpV.x)) : 0;
    }

    this.hud.update({
      mph,
      gear: Math.min(6, 1 + Math.floor(mph / 32)),
      pos: myPos, total,
      progress: Math.min(1, Math.max(0, ((this.lap - 1) + this.car.s / L) / this.laps)),
      time: this.phase === 'race' || this.phase === 'results' ? now - this.t0 : 0,
      lap: Math.max(1, this.lap), laps: this.laps,
      cpYd, cpScreenX,
    });
    this.hud.nitro(this.nitro / NITRO_MAX, this.nitroOn);

    // minimap + plates (the minimap rotates with the car — feed it the same
    // interpolated pose the camera uses so it doesn't tick at physics rate)
    this.hud.minimap(this._viewPose, others, this.pickups);
    for (const o of others) {
      const i = this.order.indexOf(o.id);
      this.hud.ensurePlate(o.id, o.name, i >= 0 ? i + 1 : '·', o.human);
      this._tmpV.set(o.x, 2.15, o.z).project(this.camera);
      const dx = o.x - this.car.x, dz = o.z - this.car.z;
      const d = Math.hypot(dx, dz);
      const visible = this._tmpV.z < 1 && d < 95 && Math.abs(this._tmpV.x) < 1.05 && Math.abs(this._tmpV.y) < 1.05;
      this.hud.placePlate(o.id,
        (this._tmpV.x * 0.5 + 0.5) * innerWidth,
        (-this._tmpV.y * 0.5 + 0.5) * innerHeight,
        visible);
    }
  }

  start() {
    const loop = () => { this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
