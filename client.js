const socket = io();
const gameWrapper = document.getElementById('game-wrapper');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const scoreDisplay = document.getElementById('score-display');
const hpDisplay = document.getElementById('hp-display');
const rankList = document.getElementById('rank-list');
const muteBtn = document.getElementById('mute-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');

const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const nicknameInput = document.getElementById('nickname-input');
const deathMsg = document.getElementById('death-msg');
const colorBtns = document.querySelectorAll('.color-btn');

let worldSize = { width: 2400, height: 1600 };
let selectedHue = 135;
let gameState = { players: {}, foods: [] };
let visualPlayers = {};

// Câmera com zoom dinâmico
let camera = { x: 1200, y: 800, zoom: 1.15 };

// Partículas e textos flutuantes (+20, +150)
let particles = [];
let floatingTexts = [];

// --- SISTEMA DE ÁUDIO (Web Audio API sem arquivos externos) ---
let audioCtx = null;
let isMuted = false;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playSound(type) {
  if (isMuted || !audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === 'eat') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.08);
  } else if (type === 'kill') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(750, now + 0.25);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.start(now);
    osc.stop(now + 0.25);
  } else if (type === 'wall') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.start(now);
    osc.stop(now + 0.07);
  } else if (type === 'die') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.45);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.start(now);
    osc.stop(now + 0.45);
  }
}

muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  muteBtn.textContent = isMuted ? '🔇 Som: OFF' : '🔊 Som: ON';
});

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    gameWrapper.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
});

// --- PARTÍCULAS E TEXTOS ---
function spawnParticles(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 3 + 1;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      life: 1.0
    });
  }
}

function spawnFloatingText(x, y, text, color = '#facc15') {
  floatingTexts.push({ x, y, text, color, life: 1.0 });
}

// --- EVENTOS DE UI E SOCKET ---
colorBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    colorBtns.forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedHue = Number(btn.dataset.hue);
  });
});

function startGame() {
  initAudio();
  const nick = nicknameInput.value.trim() || 'Você';
  socket.emit('joinGame', { nickname: nick, hue: selectedHue });
  startScreen.style.display = 'none';
  deathMsg.style.display = 'none';
}

startBtn.addEventListener('click', startGame);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame();
});

socket.on('worldConfig', (cfg) => {
  worldSize = cfg;
});

socket.on('ateFood', ({ x, y, pts, color }) => {
  playSound('eat');
  spawnParticles(x, y, color, 6);
  if (pts >= 40) spawnFloatingText(x, y - 10, `+${pts}`, '#4ade80');
});

socket.on('eliminatedEnemy', ({ x, y, pts }) => {
  playSound('kill');
  spawnParticles(x, y, '#facc15', 22);
  spawnFloatingText(x, y - 15, `ELIMINOU! +${pts}`, '#facc15');
});

socket.on('gameOver', ({ score }) => {
  playSound('die');
  deathMsg.textContent = `Você foi eliminado! Pontuação final: ${score}`;
  deathMsg.style.display = 'block';
  startBtn.textContent = 'JOGAR NOVAMENTE';
  startScreen.style.display = 'flex';
});

let lastUiUpdate = 0;
let lastWallSound = 0;

socket.on('gameState', (state) => {
  gameState = state;

  for (const id in visualPlayers) {
    if (!state.players[id]) delete visualPlayers[id];
  }

  const now = Date.now();
  const me = gameState.players[socket.id];

  if (me && me.takingWallDamage && now - lastWallSound > 160) {
    lastWallSound = now;
    playSound('wall');
  }

  if (now - lastUiUpdate > 200) {
    lastUiUpdate = now;

    if (me) {
      scoreDisplay.textContent = `Pontos: ${me.score} | Tamanho: ${me.length}`;
      hpDisplay.textContent = `Vida: ${Math.max(0, Math.ceil(me.hp))}%`;
    }

    const sorted = Object.values(gameState.players).sort((a, b) => b.score - a.score);
    rankList.innerHTML = sorted
      .slice(0, 5)
      .map((p, i) => {
        const isMe = p.id === socket.id ? 'class="rank-me"' : '';
        return `<li ${isMe}><span>#${i + 1} ${p.name}</span><span>${p.score} pts</span></li>`;
      })
      .join('');
  }
});

// Mira sempre aponta do centro da tela (onde está a cabeça da sua cobra) para o mouse
let lastMouseEmit = 0;
canvas.addEventListener('mousemove', (e) => {
  const now = Date.now();
  if (now - lastMouseEmit < 50) return;
  if (!visualPlayers[socket.id]) return;

  lastMouseEmit = now;
  const rect = canvas.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  socket.emit('updateAngle', Math.atan2(mouseY - centerY, mouseX - centerX));
});

canvas.addEventListener('mousedown', () => socket.emit('setBoost', true));
window.addEventListener('mouseup', () => socket.emit('setBoost', false));

function lerp(start, end, factor) {
  return start + (end - start) * factor;
}

// --- MINIMAPA NO CANTO INFERIOR DIREITO ---
function drawMinimap(me) {
  const mapW = 170;
  const mapH = (worldSize.height / worldSize.width) * mapW;
  const pad = 16;
  const x0 = canvas.width - mapW - pad;
  const y0 = canvas.height - mapH - pad;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x0, y0, mapW, mapH);
  ctx.strokeRect(x0, y0, mapW, mapH);

  for (const id in visualPlayers) {
    const p = visualPlayers[id];
    const px = x0 + (p.x / worldSize.width) * mapW;
    const py = y0 + (p.y / worldSize.height) * mapH;
    const isMe = id === socket.id;

    ctx.beginPath();
    ctx.arc(px, py, isMe ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? '#facc15' : p.colors.main;
    ctx.fill();
  }
}

// --- LOOP DE RENDERIZAÇÃO ---
function render() {
  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Suavizar jogadores
  for (const id in gameState.players) {
    const target = gameState.players[id];
    if (!visualPlayers[id]) {
      visualPlayers[id] = JSON.parse(JSON.stringify(target));
    } else {
      const vis = visualPlayers[id];
      vis.x = lerp(vis.x, target.x, 0.45);
      vis.y = lerp(vis.y, target.y, 0.45);
      vis.angle = target.angle;
      vis.hp = target.hp;
      vis.boosting = target.boosting;
      vis.takingWallDamage = target.takingWallDamage;
      vis.length = target.length;

      while (vis.segments.length < target.segments.length) {
        vis.segments.push({ ...target.segments[vis.segments.length] });
      }
      vis.segments.length = target.segments.length;

      for (let i = 0; i < target.segments.length; i++) {
        vis.segments[i].x = lerp(vis.segments[i].x, target.segments[i].x, 0.45);
        vis.segments[i].y = lerp(vis.segments[i].y, target.segments[i].y, 0.45);
      }
    }
  }

  const me = visualPlayers[socket.id];

  // Atualizar Câmera e Zoom dinâmico conforme o tamanho da cobra
  if (me) {
    camera.x = lerp(camera.x, me.x, 0.15);
    camera.y = lerp(camera.y, me.y, 0.15);

    // Quanto maior o length, menor o zoom (vai de 1.15 até 0.55 para mostrar muito mais arena)
    const targetZoom = Math.max(0.55, 1.15 - (me.length - 20) * 0.0025);
    camera.zoom = lerp(camera.zoom, targetZoom, 0.05);
  } else {
    // Modo espectador na tela inicial
    camera.x = worldSize.width / 2;
    camera.y = worldSize.height / 2;
    camera.zoom = 0.55;
  }

  // Aplicar transformação da câmera no mundo
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Fundo da arena
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, worldSize.width, worldSize.height);

  // Grade do chão
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  const step = 50;
  for (let x = 0; x <= worldSize.width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, worldSize.height);
    ctx.stroke();
  }
  for (let y = 0; y <= worldSize.height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(worldSize.width, y);
    ctx.stroke();
  }

  // Parede elétrica vermelha ao redor da arena
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, worldSize.width, worldSize.height);

  // Comidas
  for (const f of gameState.foods) {
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
    ctx.fillStyle = f.color;
    ctx.fill();
  }

  // Cobras
  const playerList = Object.values(visualPlayers).sort((a, b) =>
    a.id === socket.id ? 1 : b.id === socket.id ? -1 : 0
  );

  for (const p of playerList) {
    const isMe = p.id === socket.id;
    const baseRadius = Math.min(26, 12 + p.length * 0.035);

    if (isMe) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      for (let i = p.segments.length - 1; i >= 0; i--) {
        const seg = p.segments[i];
        const radius = (i > p.segments.length - 6 ? baseRadius * 0.65 : baseRadius) + 3;
        ctx.beginPath();
        ctx.arc(seg.x, seg.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (let i = p.segments.length - 1; i >= 0; i--) {
      const seg = p.segments[i];
      const radius = i > p.segments.length - 6 ? baseRadius * 0.65 : baseRadius;

      ctx.beginPath();
      ctx.arc(seg.x, seg.y, radius, 0, Math.PI * 2);

      if (p.takingWallDamage && Math.floor(Date.now() / 80) % 2 === 0) {
        ctx.fillStyle = '#ef4444';
      } else {
        ctx.fillStyle = i % 3 === 0 ? p.colors.dark : p.colors.main;
      }
      ctx.fill();
    }

    if (isMe) {
      const pointerX = p.x + Math.cos(p.angle) * (baseRadius + 14);
      const pointerY = p.y + Math.sin(p.angle) * (baseRadius + 14);
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(pointerX, pointerY, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Olhos proporcionais ao tamanho da cabeça
    const eyeDist = baseRadius * 0.62;
    const eyeSize = Math.max(4, baseRadius * 0.28);
    const eyeOffsetX = Math.cos(p.angle) * (baseRadius * 0.4);
    const eyeOffsetY = Math.sin(p.angle) * (baseRadius * 0.4);

    for (const side of [-0.55, 0.55]) {
      const ex = p.x + Math.cos(p.angle + side) * eyeDist;
      const ey = p.y + Math.sin(p.angle + side) * eyeDist;

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, ey, eyeSize, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(ex + eyeOffsetX * 0.25, ey + eyeOffsetY * 0.25, eyeSize * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Barra de vida e Nome
    const barWidth = Math.max(36, baseRadius * 2.4);
    const barHeight = 5;
    const hpPercent = Math.max(0, p.hp / p.maxHp);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(p.x - barWidth / 2, p.y - baseRadius - 14, barWidth, barHeight);

    ctx.fillStyle = hpPercent > 0.4 ? '#22c55e' : '#ef4444';
    ctx.fillRect(p.x - barWidth / 2, p.y - baseRadius - 14, barWidth * hpPercent, barHeight);

    ctx.fillStyle = isMe ? '#facc15' : '#94a3b8';
    ctx.font = isMe ? 'bold 14px sans-serif' : '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isMe ? `★ ${p.name}` : p.name, p.x, p.y - baseRadius - 20);
  }

  // Partículas
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.life -= 0.04;
    if (pt.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = pt.life;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Textos flutuantes (+40, +150)
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y -= 1.2;
    ft.life -= 0.025;
    if (ft.life <= 0) {
      floatingTexts.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = ft.life;
    ctx.fillStyle = ft.color;
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // Desenhar Minimapa fixo na tela
  drawMinimap(me);

  requestAnimationFrame(render);
}

requestAnimationFrame(render);