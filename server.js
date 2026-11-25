const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const ARENA_WIDTH = 2400;
const ARENA_HEIGHT = 1600;
const TICK_RATE = 30;
const BASE_SPEED = 5.2;
const BOOST_SPEED = 9.0;
const ACCEL_RATE = 0.25;
const TURN_SPEED = 0.16;
const SEGMENT_SPACING = 6;
const MAX_FOOD = 150;
const BOT_COUNT = 7;

const players = {};
let foods = [];

const BOT_NAMES = ['Nagini', 'Python', 'Jiboia', 'Anaconda', 'Viper', 'Cobra Kai', 'Kaa', 'Mamba'];

function getColorsFromHue(hue) {
  const validHue = typeof hue === 'number' && !isNaN(hue) ? hue : Math.floor(Math.random() * 360);
  return {
    main: `hsl(${validHue}, 85%, 55%)`,
    dark: `hsl(${validHue}, 85%, 35%)`
  };
}

function spawnFood(x, y, size = null, color = null) {
  return {
    id: Math.random().toString(36).substring(2, 9),
    x: Math.round(x ?? Math.floor(Math.random() * (ARENA_WIDTH - 80)) + 40),
    y: Math.round(y ?? Math.floor(Math.random() * (ARENA_HEIGHT - 80)) + 40),
    color: color ?? `hsl(${Math.floor(Math.random() * 360)}, 90%, 60%)`,
    size: size ?? (Math.random() > 0.85 ? 9 : 5)
  };
}

for (let i = 0; i < MAX_FOOD; i++) {
  foods.push(spawnFood());
}

function createSnake(id, isBot = false, name = 'Jogador', hue = null) {
  const startX = Math.floor(Math.random() * (ARENA_WIDTH - 400)) + 200;
  const startY = Math.floor(Math.random() * (ARENA_HEIGHT - 400)) + 200;
  const startAngle = Math.random() * Math.PI * 2;
  const initialLength = 20;

  const segments = [];
  for (let i = 0; i < initialLength; i++) {
    segments.push({
      x: Math.round(startX - Math.cos(startAngle) * i * SEGMENT_SPACING),
      y: Math.round(startY - Math.sin(startAngle) * i * SEGMENT_SPACING)
    });
  }

  return {
    id,
    name: name.trim().slice(0, 14) || 'Jogador',
    isBot,
    x: startX,
    y: startY,
    angle: startAngle,
    targetAngle: startAngle,
    speed: BASE_SPEED,
    colors: getColorsFromHue(hue),
    length: initialLength,
    score: 0,
    hp: 100,
    maxHp: 100,
    boosting: false,
    takingWallDamage: false,
    segments,
    aiTimer: 0
  };
}

function dropSnakeLoot(snake) {
  for (let i = 0; i < snake.segments.length; i += 2) {
    const seg = snake.segments[i];
    const offsetX = (Math.random() - 0.5) * 18;
    const offsetY = (Math.random() - 0.5) * 18;
    foods.push(spawnFood(seg.x + offsetX, seg.y + offsetY, 9, snake.colors.main));
  }
}

for (let i = 0; i < BOT_COUNT; i++) {
  players[`bot_${i}`] = createSnake(`bot_${i}`, true, BOT_NAMES[i % BOT_NAMES.length]);
}

io.on('connection', (socket) => {
  socket.emit('worldConfig', { width: ARENA_WIDTH, height: ARENA_HEIGHT });

  socket.on('joinGame', ({ nickname, hue }) => {
    players[socket.id] = createSnake(socket.id, false, nickname || 'Você', hue);
  });

  socket.on('updateAngle', (angle) => {
    if (players[socket.id]) players[socket.id].targetAngle = angle;
  });

  socket.on('setBoost', (isBoosting) => {
    if (players[socket.id]) players[socket.id].boosting = isBoosting;
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      dropSnakeLoot(players[socket.id]);
      delete players[socket.id];
    }
  });
});

function steerTowards(current, target, maxTurn) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  if (Math.abs(diff) < maxTurn) return target;
  return current + Math.sign(diff) * maxTurn;
}

function updateBotAI(bot) {
  bot.aiTimer--;
  const margin = 150;

  if (bot.x < margin || bot.x > ARENA_WIDTH - margin || bot.y < margin || bot.y > ARENA_HEIGHT - margin) {
    bot.targetAngle = Math.atan2(ARENA_HEIGHT / 2 - bot.y, ARENA_WIDTH / 2 - bot.x);
    bot.boosting = false;
    return;
  }

  if (bot.aiTimer <= 0) {
    bot.aiTimer = Math.floor(Math.random() * 15) + 8;
    let closestFood = null;
    let minDist = 380;

    for (const f of foods) {
      const d = Math.hypot(bot.x - f.x, bot.y - f.y);
      if (d < minDist) {
        minDist = d;
        closestFood = f;
      }
    }

    if (closestFood) {
      bot.targetAngle = Math.atan2(closestFood.y - bot.y, closestFood.x - bot.x);
    } else {
      bot.targetAngle += (Math.random() - 0.5) * 1.4;
    }
  }
}

setInterval(() => {
  const deadIds = [];

  for (const id in players) {
    const p = players[id];
    if (p.isBot) updateBotAI(p);

    p.angle = steerTowards(p.angle, p.targetAngle, TURN_SPEED);

    const canBoost = p.boosting && p.length > 20;
    const targetSpeed = canBoost ? BOOST_SPEED : BASE_SPEED;

    if (p.speed < targetSpeed) {
      p.speed = Math.min(targetSpeed, p.speed + ACCEL_RATE);
    } else if (p.speed > targetSpeed) {
      p.speed = Math.max(targetSpeed, p.speed - ACCEL_RATE);
    }

    if (canBoost && Math.random() < 0.25) {
      p.length -= 1;
      const tail = p.segments[p.segments.length - 1];
      if (tail) foods.push(spawnFood(tail.x, tail.y, 4, p.colors.main));
    }

    p.x += Math.cos(p.angle) * p.speed;
    p.y += Math.sin(p.angle) * p.speed;

    const hitWall = p.x <= 16 || p.x >= ARENA_WIDTH - 16 || p.y <= 16 || p.y >= ARENA_HEIGHT - 16;
    p.takingWallDamage = hitWall;

    if (hitWall) {
      p.hp -= 1.4;
      if (p.hp <= 0) {
        deadIds.push(id);
        continue;
      }
    }

    p.x = Math.max(16, Math.min(ARENA_WIDTH - 16, p.x));
    p.y = Math.max(16, Math.min(ARENA_HEIGHT - 16, p.y));

    p.segments[0] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    for (let i = 1; i < p.length; i++) {
      const prev = p.segments[i - 1];
      const curr = p.segments[i] || { x: prev.x, y: prev.y };

      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 0) {
        p.segments[i] = {
          x: Math.round((prev.x + (dx / dist) * SEGMENT_SPACING) * 10) / 10,
          y: Math.round((prev.y + (dy / dist) * SEGMENT_SPACING) * 10) / 10
        };
      } else {
        p.segments[i] = { ...prev };
      }
    }
    p.segments.length = p.length;

    // Comer bolinhas
    const eatRadius = Math.min(28, 16 + p.length * 0.03);
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      if (Math.hypot(p.x - f.x, p.y - f.y) < eatRadius + f.size) {
        const gain = f.size >= 8 ? 4 : 2;
        const pts = gain * 10;
        p.length += gain;
        p.score += pts;
        p.hp = Math.min(p.maxHp, p.hp + 2);

        if (!p.isBot) {
          io.to(id).emit('ateFood', { x: f.x, y: f.y, pts, color: f.color });
        }

        foods.splice(i, 1);
        if (foods.length < MAX_FOOD) foods.push(spawnFood());
      }
    }

    // Colisão com outras cobras
    for (const otherId in players) {
      if (id === otherId) continue;
      const other = players[otherId];
      const otherRadius = Math.min(26, 13 + other.length * 0.03);

      for (let i = 0; i < other.segments.length; i++) {
        if (Math.hypot(p.x - other.segments[i].x, p.y - other.segments[i].y) < otherRadius + 6) {
          other.score += 150;
          if (!other.isBot) {
            io.to(otherId).emit('eliminatedEnemy', { x: p.x, y: p.y, pts: 150 });
          }
          deadIds.push(id);
          break;
        }
      }
      if (deadIds.includes(id)) break;
    }
  }

  for (const deadId of deadIds) {
    const deadSnake = players[deadId];
    if (!deadSnake) continue;
    dropSnakeLoot(deadSnake);

    if (deadSnake.isBot) {
      players[deadId] = createSnake(deadId, true, deadSnake.name);
    } else {
      io.to(deadId).emit('gameOver', { score: deadSnake.score });
      delete players[deadId];
    }
  }

  io.emit('gameState', { players, foods });
}, 1000 / TICK_RATE);

server.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000');
});