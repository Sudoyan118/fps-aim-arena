import './styles.css';
import * as THREE from 'three';

type TargetKind = 'static' | 'moving' | 'popup';
type TargetMode = 'static' | 'moving' | 'popup' | 'mix';
type SessionMode = 'Practice' | 'Challenge';
type DifficultyName = 'Easy' | 'Normal' | 'Hard' | 'Expert';

interface Difficulty {
  name: DifficultyName;
  targetSize: number;
  spawnInterval: number;
  targetLifetime: number;
  targetSpeed: number;
  simultaneousTargets: number;
}

interface Target {
  id: number;
  type: TargetKind;
  group: THREE.Group;
  mesh: THREE.Mesh;
  basePosition: THREE.Vector3;
  spawnTime: number;
  lifetime: number;
  size: number;
  moveAxis: 'x' | 'y';
  movePhase: number;
  isHit: boolean;
}

interface SessionStats {
  hits: number;
  misses: number;
  shots: number;
  score: number;
  combo: number;
  maxCombo: number;
  reactionTimes: number[];
  lastReactionTime: number;
  bestReactionTime: number;
  targetsExpired: number;
  startedAt: number;
}

interface PlayerState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  isGrounded: boolean;
  isSprinting: boolean;
}

const difficulties: Difficulty[] = [
  { name: 'Easy', targetSize: 1.18, spawnInterval: 1.2, targetLifetime: 3.8, targetSpeed: 1.1, simultaneousTargets: 1 },
  { name: 'Normal', targetSize: 0.95, spawnInterval: 0.9, targetLifetime: 2.8, targetSpeed: 1.8, simultaneousTargets: 2 },
  { name: 'Hard', targetSize: 0.72, spawnInterval: 0.68, targetLifetime: 2.0, targetSpeed: 2.6, simultaneousTargets: 3 },
  { name: 'Expert', targetSize: 0.55, spawnInterval: 0.5, targetLifetime: 1.35, targetSpeed: 3.5, simultaneousTargets: 4 }
];

const spawnPoints = [
  new THREE.Vector3(-8, 2.1, -13), new THREE.Vector3(-4, 3.2, -14), new THREE.Vector3(0, 2.4, -15),
  new THREE.Vector3(4, 3.4, -14), new THREE.Vector3(8, 2.1, -13), new THREE.Vector3(-9, 2.7, -6),
  new THREE.Vector3(9, 2.7, -6), new THREE.Vector3(-5, 1.8, 4), new THREE.Vector3(5, 1.8, 4)
];

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="hud" data-testid="hud">
    <div class="top-left panel">
      <div class="stats-row"><span>Mode</span><strong data-testid="mode">Practice / Static</strong></div>
      <div class="stats-row"><span>Difficulty</span><strong data-testid="difficulty">Normal</strong></div>
      <div class="stats-row"><span>Time</span><strong data-testid="time">--</strong></div>
    </div>
    <div class="fps panel" data-testid="fps">FPS 0</div>
    <div class="crosshair" data-testid="crosshair"></div>
    <div class="toast panel" data-testid="toast"></div>
    <div class="stats-panel panel" data-testid="stats-panel"></div>
    <div class="bottom-bar panel">
      <div class="stat"><span class="label">Score</span><span class="value" data-testid="score">0</span></div>
      <div class="stat"><span class="label">Accuracy</span><span class="value" data-testid="accuracy">100%</span></div>
      <div class="stat"><span class="label">Combo</span><span class="value" data-testid="combo">0</span></div>
      <div class="stat"><span class="label">Avg RT</span><span class="value" data-testid="avg-rt">0ms</span></div>
    </div>
  </div>
  <div class="overlay" data-testid="start-overlay">
    <div class="modal panel">
      <h1>FPS Aim Arena</h1>
      <p>Sports-style pointing and reaction trainer with clean hologram targets.</p>
      <div class="hint-grid">
        <span>WASD Move</span><span>Mouse Look</span><span>Click Hit Target</span><span>Space Jump</span>
        <span>Shift Dash</span><span>F Challenge</span><span>1-4 Target Modes</span><span>Q/E Difficulty</span>
        <span>R Reset</span><span>Tab Stats</span><span>C Crosshair</span><span>Esc Unlock</span>
      </div>
      <button data-testid="timer-toggle">Challenge Timer: 30s</button>
      <button data-testid="start-button">Click to Start</button>
    </div>
  </div>
  <div class="results" data-testid="results" hidden>
    <div class="modal panel">
      <h2>Challenge Results</h2>
      <div data-testid="result-summary"></div>
      <button data-testid="retry-button">Retry Challenge</button>
      <button data-testid="result-timer-toggle">Challenge Timer: 30s</button>
      <button data-testid="practice-button">Practice Mode</button>
    </div>
  </div>
`;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
app.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x091019);
scene.fog = new THREE.Fog(0x091019, 18, 58);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 120);
const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();
const player: PlayerState = {
  position: new THREE.Vector3(0, 1.7, 8),
  velocity: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  isGrounded: true,
  isSprinting: false
};

let difficultyIndex = 1;
let targetMode: TargetMode = 'static';
let sessionMode: SessionMode = 'Practice';
let challengeLength = 30;
let challengeRemaining = challengeLength;
let challengeEnded = false;
let sessionStarted = false;
let nextTargetId = 1;
let lastSpawnAt = 0;
let fpsAccumulator = 0;
let fpsFrames = 0;
let fpsValue = 0;
let crosshairIndex = 0;
let statsVisible = true;
let toastTimeout = 0;
let activePointer = false;
const keys = new Set<string>();
const pointerNdc = new THREE.Vector2(0, 0);
const targets: Target[] = [];
const targetMeshes: THREE.Object3D[] = [];
const effects: { mesh: THREE.Mesh; age: number; lifetime: number }[] = [];
const obstacles: THREE.Box3[] = [];
const arenaBounds = { minX: -12.6, maxX: 12.6, minZ: -17.5, maxZ: 10.5 };

let stats: SessionStats = freshStats();

const els = {
  overlay: document.querySelector<HTMLElement>('[data-testid="start-overlay"]')!,
  start: document.querySelector<HTMLButtonElement>('[data-testid="start-button"]')!,
  timerToggle: document.querySelector<HTMLButtonElement>('[data-testid="timer-toggle"]')!,
  results: document.querySelector<HTMLElement>('[data-testid="results"]')!,
  retry: document.querySelector<HTMLButtonElement>('[data-testid="retry-button"]')!,
  resultTimerToggle: document.querySelector<HTMLButtonElement>('[data-testid="result-timer-toggle"]')!,
  practice: document.querySelector<HTMLButtonElement>('[data-testid="practice-button"]')!,
  resultSummary: document.querySelector<HTMLElement>('[data-testid="result-summary"]')!,
  mode: document.querySelector<HTMLElement>('[data-testid="mode"]')!,
  difficulty: document.querySelector<HTMLElement>('[data-testid="difficulty"]')!,
  time: document.querySelector<HTMLElement>('[data-testid="time"]')!,
  fps: document.querySelector<HTMLElement>('[data-testid="fps"]')!,
  score: document.querySelector<HTMLElement>('[data-testid="score"]')!,
  accuracy: document.querySelector<HTMLElement>('[data-testid="accuracy"]')!,
  combo: document.querySelector<HTMLElement>('[data-testid="combo"]')!,
  avgRt: document.querySelector<HTMLElement>('[data-testid="avg-rt"]')!,
  statsPanel: document.querySelector<HTMLElement>('[data-testid="stats-panel"]')!,
  crosshair: document.querySelector<HTMLElement>('[data-testid="crosshair"]')!,
  toast: document.querySelector<HTMLElement>('[data-testid="toast"]')!
};

function freshStats(): SessionStats {
  return {
    hits: 0, misses: 0, shots: 0, score: 0, combo: 0, maxCombo: 0,
    reactionTimes: [], lastReactionTime: 0, bestReactionTime: 0, targetsExpired: 0,
    startedAt: performance.now()
  };
}

function buildArena() {
  scene.add(new THREE.HemisphereLight(0xdff8ff, 0x142538, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(5, 12, 8);
  key.castShadow = true;
  scene.add(key);

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x172832, roughness: 0.62, metalness: 0.12 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(28, 0.22, 31), floorMat);
  floor.position.set(0, -0.12, -3.5);
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(28, 28, 0x43e6ff, 0x26535e);
  grid.position.y = 0.01;
  scene.add(grid);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x223847, roughness: 0.45, metalness: 0.1 });
  addBox(0, 2.4, -19, 28, 4.8, 0.45, wallMat);
  addBox(-14, 2.4, -3.5, 0.45, 4.8, 31, wallMat);
  addBox(14, 2.4, -3.5, 0.45, 4.8, 31, wallMat);
  addBox(0, 0.9, 12, 28, 1.8, 0.5, wallMat);

  const obstacleMat = new THREE.MeshStandardMaterial({ color: 0x31475c, roughness: 0.38, metalness: 0.16 });
  [[-6, 1, -2, 2.4, 2, 2], [6, 1, -2, 2.4, 2, 2], [0, 0.7, 2, 5, 1.4, 1.2], [-9, 1.5, -10, 1.2, 3, 1.2], [9, 1.5, -10, 1.2, 3, 1.2]].forEach(([x, y, z, w, h, d]) => addBox(x, y, z, w, h, d, obstacleMat, true));

  const padMat = new THREE.MeshStandardMaterial({ color: 0x13525d, emissive: 0x0d5963, emissiveIntensity: 0.35 });
  spawnPoints.forEach((p) => {
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.96, 32), padMat);
    pad.position.copy(p);
    pad.position.y = 0.025;
    pad.rotation.x = -Math.PI / 2;
    scene.add(pad);
  });
}

function addBox(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, collides = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (collides) obstacles.push(new THREE.Box3().setFromObject(mesh).expandByScalar(0.4));
}

function spawnTarget() {
  const difficulty = difficulties[difficultyIndex];
  if (targets.length >= difficulty.simultaneousTargets) return;
  const mode = targetMode === 'mix' ? (['static', 'moving', 'popup'] as TargetKind[])[Math.floor(Math.random() * 3)] : targetMode;
  const point = spawnPoints[Math.floor(Math.random() * spawnPoints.length)].clone();
  point.x += (Math.random() - 0.5) * 1.2;
  point.y += (Math.random() - 0.5) * 0.6;
  const size = difficulty.targetSize * (mode === 'popup' ? 0.9 : 1);
  const group = new THREE.Group();
  group.position.copy(point);

  const coreMat = new THREE.MeshStandardMaterial({
    color: mode === 'moving' ? 0xffc857 : mode === 'popup' ? 0xff5d9e : 0x4fffe0,
    emissive: mode === 'moving' ? 0xb66b00 : mode === 'popup' ? 0x962854 : 0x0f8c8a,
    emissiveIntensity: 1.2,
    roughness: 0.22,
    metalness: 0.1
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 32, 16), coreMat);
  mesh.userData.targetId = nextTargetId;
  group.add(mesh);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(size * 1.18, 0.035, 10, 42), coreMat);
  ring.userData.targetId = nextTargetId;
  group.add(ring);
  group.lookAt(camera.position);
  scene.add(group);

  const target: Target = {
    id: nextTargetId++,
    type: mode,
    group,
    mesh,
    basePosition: point.clone(),
    spawnTime: performance.now(),
    lifetime: mode === 'popup' ? difficulty.targetLifetime : difficulty.targetLifetime * 1.55,
    size,
    moveAxis: Math.random() > 0.5 ? 'x' : 'y',
    movePhase: Math.random() * Math.PI * 2,
    isHit: false
  };
  targets.push(target);
  targetMeshes.push(mesh, ring);
  writeDebugState();
}

function removeTarget(target: Target) {
  scene.remove(target.group);
  const i = targets.indexOf(target);
  if (i >= 0) targets.splice(i, 1);
  for (let j = targetMeshes.length - 1; j >= 0; j--) {
    if (targetMeshes[j].userData.targetId === target.id) targetMeshes.splice(j, 1);
  }
}

function updatePointerFromEvent(event: MouseEvent) {
  pointerNdc.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointerNdc.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onShoot(event?: MouseEvent) {
  if (challengeEnded) return;
  stats.shots += 1;
  const isLocked = document.pointerLockElement === renderer.domElement;
  if (!isLocked && event) updatePointerFromEvent(event);
  raycaster.setFromCamera(isLocked ? new THREE.Vector2(0, 0) : pointerNdc, camera);
  const hits = raycaster.intersectObjects(targetMeshes, false);
  if (hits.length > 0) {
    const id = hits[0].object.userData.targetId;
    const target = targets.find((t) => t.id === id);
    if (target) hitTarget(target);
  } else {
    registerMiss('MISS');
  }
}

function hitTarget(target: Target) {
  const reaction = performance.now() - target.spawnTime;
  stats.hits += 1;
  stats.combo += 1;
  stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
  stats.reactionTimes.push(reaction);
  stats.lastReactionTime = reaction;
  stats.bestReactionTime = stats.bestReactionTime ? Math.min(stats.bestReactionTime, reaction) : reaction;
  stats.score += 100 + Math.min(150, Math.round(900 / Math.max(120, reaction) * 35)) + stats.combo * 8;
  makeEffect(target.group.position, true);
  removeTarget(target);
  flashCrosshair('hit');
  showToast('+ HIT');
}

function registerMiss(label = 'MISS') {
  stats.misses += 1;
  stats.combo = 0;
  makeEffect(camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(6)), false);
  flashCrosshair('miss');
  showToast(label);
}

function makeEffect(position: THREE.Vector3, success: boolean) {
  const mat = new THREE.MeshBasicMaterial({ color: success ? 0x66ff9b : 0xff5d7c, transparent: true, opacity: 0.8 });
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(success ? 0.35 : 0.2, 0.025, 8, 36), mat);
  mesh.position.copy(position);
  mesh.lookAt(camera.position);
  scene.add(mesh);
  effects.push({ mesh, age: 0, lifetime: 0.35 });
}

function flashCrosshair(kind: 'hit' | 'miss') {
  els.crosshair.classList.remove('hit', 'miss');
  void els.crosshair.offsetWidth;
  els.crosshair.classList.add(kind);
  window.setTimeout(() => els.crosshair.classList.remove(kind), 110);
}

function showToast(text: string) {
  window.clearTimeout(toastTimeout);
  els.toast.textContent = text;
  els.toast.classList.add('show');
  toastTimeout = window.setTimeout(() => els.toast.classList.remove('show'), 170);
}

function resetSession() {
  targets.slice().forEach(removeTarget);
  stats = freshStats();
  lastSpawnAt = 0;
  challengeRemaining = challengeLength;
  challengeEnded = false;
  els.results.hidden = true;
  spawnTarget();
  updateHud();
}

function toggleChallengeLength() {
  challengeLength = challengeLength === 30 ? 60 : 30;
  challengeRemaining = challengeLength;
  els.timerToggle.textContent = `Challenge Timer: ${challengeLength}s`;
  els.resultTimerToggle.textContent = `Challenge Timer: ${challengeLength}s`;
  updateHud();
}

function setTargetMode(mode: TargetMode) {
  targetMode = mode;
  resetSession();
}

function toggleSessionMode() {
  sessionMode = sessionMode === 'Practice' ? 'Challenge' : 'Practice';
  resetSession();
}

function updateDifficulty(delta: number) {
  difficultyIndex = THREE.MathUtils.clamp(difficultyIndex + delta, 0, difficulties.length - 1);
  resetSession();
}

function updatePlayer(dt: number) {
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 9 : 5.2;
  player.isSprinting = speed > 6;
  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, Math.sin(player.yaw));
  const wish = new THREE.Vector3();
  if (keys.has('KeyW')) wish.add(forward);
  if (keys.has('KeyS')) wish.sub(forward);
  if (keys.has('KeyD')) wish.add(right);
  if (keys.has('KeyA')) wish.sub(right);
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

  player.velocity.x = THREE.MathUtils.lerp(player.velocity.x, wish.x, 12 * dt);
  player.velocity.z = THREE.MathUtils.lerp(player.velocity.z, wish.z, 12 * dt);
  player.velocity.y -= 18 * dt;
  if (keys.has('Space') && player.isGrounded) {
    player.velocity.y = 6.1;
    player.isGrounded = false;
  }

  const previous = player.position.clone();
  player.position.addScaledVector(player.velocity, dt);
  if (player.position.y <= 1.7) {
    player.position.y = 1.7;
    player.velocity.y = 0;
    player.isGrounded = true;
  }

  player.position.x = THREE.MathUtils.clamp(player.position.x, arenaBounds.minX, arenaBounds.maxX);
  player.position.z = THREE.MathUtils.clamp(player.position.z, arenaBounds.minZ, arenaBounds.maxZ);
  const body = new THREE.Box3().setFromCenterAndSize(player.position.clone().setY(0.9), new THREE.Vector3(0.8, 1.8, 0.8));
  if (obstacles.some((box) => box.intersectsBox(body))) {
    player.position.x = previous.x;
    player.position.z = previous.z;
  }
  if (player.position.y < -2) resetPlayer();

  camera.position.copy(player.position);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
}

function resetPlayer() {
  player.position.set(0, 1.7, 8);
  player.velocity.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0;
}

function updateTargets(dt: number) {
  if (!sessionStarted) return;
  const now = performance.now();
  const difficulty = difficulties[difficultyIndex];
  if (now - lastSpawnAt > difficulty.spawnInterval * 1000) {
    spawnTarget();
    lastSpawnAt = now;
  }
  targets.slice().forEach((target) => {
    const age = (now - target.spawnTime) / 1000;
    if (age > target.lifetime) {
      stats.targetsExpired += 1;
      if (target.type === 'popup') registerMiss('EXPIRED');
      removeTarget(target);
      return;
    }
    if (target.type === 'moving') {
      const t = now / 1000 * difficulty.targetSpeed + target.movePhase;
      const offset = Math.sin(t) * (target.moveAxis === 'x' ? 1.9 : 1.15);
      target.group.position.copy(target.basePosition);
      target.group.position[target.moveAxis] += offset;
    }
    target.group.rotation.y += dt * 0.7;
    target.group.children[1].rotation.z += dt * 2.4;
    const pulse = 1 + Math.sin(now * 0.008 + target.id) * 0.045;
    target.group.scale.setScalar(pulse);
    target.group.lookAt(camera.position);
  });
}

function updateEffects(dt: number) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    effect.age += dt;
    const p = effect.age / effect.lifetime;
    effect.mesh.scale.setScalar(1 + p * 2.6);
    const mat = effect.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, 0.8 * (1 - p));
    if (p >= 1) {
      scene.remove(effect.mesh);
      effects.splice(i, 1);
    }
  }
}

function updateChallenge(dt: number) {
  if (sessionMode !== 'Challenge' || challengeEnded) return;
  challengeRemaining -= dt;
  if (challengeRemaining <= 0) {
    challengeRemaining = 0;
    challengeEnded = true;
    targets.slice().forEach(removeTarget);
    els.resultSummary.innerHTML = `
      <div class="stats-row"><span>Score</span><strong>${stats.score}</strong></div>
      <div class="stats-row"><span>Accuracy</span><strong>${accuracy()}%</strong></div>
      <div class="stats-row"><span>Avg reaction</span><strong>${avgReaction()}ms</strong></div>
      <div class="stats-row"><span>Max combo</span><strong>${stats.maxCombo}</strong></div>
      <div class="stats-row"><span>Misses</span><strong>${stats.misses}</strong></div>`;
    els.results.hidden = false;
  }
}

function accuracy() {
  return stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 100;
}

function avgReaction() {
  return stats.reactionTimes.length ? Math.round(stats.reactionTimes.reduce((a, b) => a + b, 0) / stats.reactionTimes.length) : 0;
}

function hitsPerMinute() {
  const minutes = Math.max(0.01, (performance.now() - stats.startedAt) / 60000);
  return Math.round(stats.hits / minutes);
}

function updateHud() {
  const modeName = targetMode === 'mix' ? 'Mix' : targetMode[0].toUpperCase() + targetMode.slice(1);
  els.mode.textContent = `${sessionMode} / ${modeName}`;
  els.difficulty.textContent = difficulties[difficultyIndex].name;
  els.time.textContent = sessionMode === 'Challenge' ? `${Math.ceil(challengeRemaining)}s` : '--';
  els.fps.textContent = `FPS ${fpsValue}`;
  els.score.textContent = String(stats.score);
  els.accuracy.textContent = `${accuracy()}%`;
  els.combo.textContent = String(stats.combo);
  els.avgRt.textContent = `${avgReaction()}ms`;
  els.statsPanel.classList.toggle('is-hidden', !statsVisible);
  els.statsPanel.innerHTML = `
    <div class="stats-row"><span>Hits</span><strong data-testid="hits">${stats.hits}</strong></div>
    <div class="stats-row"><span>Misses</span><strong data-testid="misses">${stats.misses}</strong></div>
    <div class="stats-row"><span>Shots</span><strong>${stats.shots}</strong></div>
    <div class="stats-row"><span>Last RT</span><strong data-testid="last-rt">${Math.round(stats.lastReactionTime)}ms</strong></div>
    <div class="stats-row"><span>Best RT</span><strong>${Math.round(stats.bestReactionTime)}ms</strong></div>
    <div class="stats-row"><span>Max combo</span><strong data-testid="max-combo">${stats.maxCombo}</strong></div>
    <div class="stats-row"><span>Hits/min</span><strong data-testid="hpm">${hitsPerMinute()}</strong></div>
    <div class="stats-row"><span>Expired</span><strong>${stats.targetsExpired}</strong></div>`;
  writeDebugState();
}

function writeDebugState() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  (window as any).__aimArena = {
    player: { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch, sprint: player.isSprinting },
    stats: { ...stats, reactionTimes: [...stats.reactionTimes] },
    difficulty: difficulties[difficultyIndex],
    targetMode,
    sessionMode,
    challengeRemaining,
    targets: targets.map((t) => {
      const projected = t.group.position.clone().project(camera);
      return {
        id: t.id,
        type: t.type,
        x: t.group.position.x,
        y: t.group.position.y,
        z: t.group.position.z,
        screenX: Math.round((projected.x * 0.5 + 0.5) * width),
        screenY: Math.round((-projected.y * 0.5 + 0.5) * height),
        size: t.size,
        lifetime: t.lifetime
      };
    }),
    fps: fpsValue
  };
}

function animate() {
  const dt = Math.min(0.05, clock.getDelta());
  updatePlayer(dt);
  updateTargets(dt);
  updateEffects(dt);
  updateChallenge(dt);
  fpsAccumulator += dt;
  fpsFrames += 1;
  if (fpsAccumulator >= 0.35) {
    fpsValue = Math.round(fpsFrames / fpsAccumulator);
    fpsAccumulator = 0;
    fpsFrames = 0;
  }
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

function setCrosshair() {
  els.crosshair.className = 'crosshair';
  if (crosshairIndex === 1) els.crosshair.classList.add('ring');
  if (crosshairIndex === 2) els.crosshair.classList.add('dot');
}

window.addEventListener('resize', onResize);
window.addEventListener('keydown', (event) => {
  if (event.code === 'Tab') event.preventDefault();
  keys.add(event.code);
  if (event.code === 'KeyR') resetSession();
  if (event.code === 'KeyF') toggleSessionMode();
  if (event.code === 'Digit1') setTargetMode('static');
  if (event.code === 'Digit2') setTargetMode('moving');
  if (event.code === 'Digit3') setTargetMode('popup');
  if (event.code === 'Digit4') setTargetMode('mix');
  if (event.code === 'KeyQ') updateDifficulty(-1);
  if (event.code === 'KeyE') updateDifficulty(1);
  if (event.code === 'Tab') statsVisible = !statsVisible;
  if (event.code === 'KeyC') {
    crosshairIndex = (crosshairIndex + 1) % 3;
    setCrosshair();
  }
  if (event.code === 'KeyT') toggleChallengeLength();
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('mousemove', (event) => {
  updatePointerFromEvent(event);
  if (!activePointer && document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= event.movementX * 0.0022;
  player.pitch -= event.movementY * 0.0022;
  player.pitch = THREE.MathUtils.clamp(player.pitch, -1.22, 1.05);
});
window.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  if (els.overlay.hidden) onShoot(event);
});
document.addEventListener('pointerlockchange', () => {
  activePointer = document.pointerLockElement === renderer.domElement;
  els.overlay.hidden = activePointer;
});
els.start.addEventListener('click', async () => {
  els.overlay.hidden = true;
  sessionStarted = true;
  try {
    await renderer.domElement.requestPointerLock();
  } catch {
    activePointer = true;
  }
});
els.retry.addEventListener('click', () => {
  sessionMode = 'Challenge';
  resetSession();
});
els.timerToggle.addEventListener('click', toggleChallengeLength);
els.resultTimerToggle.addEventListener('click', toggleChallengeLength);
els.practice.addEventListener('click', () => {
  sessionMode = 'Practice';
  resetSession();
});

renderer.domElement.dataset.testid = 'game-canvas';
buildArena();
spawnTarget();
updateHud();
animate();
