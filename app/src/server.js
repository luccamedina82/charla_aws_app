const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { pool, waitForDatabase, migrate } = require('./db');

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT || 8080);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 h

if (!process.env.TOKEN_SECRET) {
  console.warn('[config] TOKEN_SECRET no está definido: se generó uno aleatorio. ' +
    'Con más de una task de la app, definilo (igual en todas) o los admins tendrán que loguearse de nuevo.');
}
if (!ADMIN_PASSWORD) {
  console.warn('[config] ADMIN_PASSWORD no está definido: el panel de admin queda deshabilitado.');
}

const CATEGORIES = {
  principiante: { label: 'Principiante', points: 100 },
  intermedio: { label: 'Intermedio', points: 200 },
  avanzado: { label: 'Avanzado', points: 300 }
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function cleanText(value, { min = 1, max = 500, field = 'texto' } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID', `Falta ${field}.`);
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (v.length < min) throw new HttpError(400, 'INVALID', `${field} es demasiado corto.`);
  if (v.length > max) throw new HttpError(400, 'INVALID', `${field} supera los ${max} caracteres.`);
  return v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Normaliza el mail para que no se pueda volver a jugar con trucos como
// "Juan@gmail.com", "juan+2@gmail.com" o "j.u.a.n@gmail.com".
function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new HttpError(400, 'INVALID_EMAIL', 'Ingresá un mail válido.');
  }
  const at = email.lastIndexOf('@');
  let local = email.slice(0, at).split('+')[0];
  let domain = email.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (!local) throw new HttpError(400, 'INVALID_EMAIL', 'Ingresá un mail válido.');
  return { email, normalized: `${local}@${domain}` };
}

function signAdminToken() {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() + ADMIN_TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'admin' && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function passwordMatches(input) {
  if (!ADMIN_PASSWORD || typeof input !== 'string') return false;
  const a = Buffer.from(sha256(input));
  const b = Buffer.from(sha256(ADMIN_PASSWORD));
  return crypto.timingSafeEqual(a, b);
}

// Rate limit simple en memoria (por task). Alcanza para frenar fuerza bruta
// sobre el login de admin y el registro masivo de mails.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'Demasiados intentos. Esperá un momento y probá de nuevo.' });
    }
    next();
  };
}

function rowToQuestion(row, { includeAnswer = false } = {}) {
  const q = {
    id: row.id,
    category: row.category,
    text: row.text,
    options: [row.option_a, row.option_b, row.option_c, row.option_d],
    points: CATEGORIES[row.category].points
  };
  if (includeAnswer) {
    q.correct = row.correct_option;
    q.isActive = !!row.is_active;
    q.sortOrder = row.sort_order;
  }
  return q;
}

function parseQuestionBody(body) {
  const category = String(body.category || '');
  if (!CATEGORIES[category]) throw new HttpError(400, 'INVALID', 'Categoría inválida.');
  const text = cleanText(body.text, { min: 5, max: 1000, field: 'La pregunta' });
  if (!Array.isArray(body.options) || body.options.length !== 4) {
    throw new HttpError(400, 'INVALID', 'Cada pregunta necesita exactamente 4 opciones.');
  }
  const options = body.options.map((o, i) => cleanText(o, { min: 1, max: 500, field: `La opción ${'ABCD'[i]}` }));
  const correct = Number(body.correct);
  if (!Number.isInteger(correct) || correct < 0 || correct > 3) {
    throw new HttpError(400, 'INVALID', 'Marcá cuál es la opción correcta.');
  }
  const isActive = body.isActive === undefined ? true : !!body.isActive;
  return { category, text, options, correct, isActive };
}

// ---------------------------------------------------------------------------
// Middlewares de autenticación
// ---------------------------------------------------------------------------
const requireAdmin = (req, res, next) => {
  if (!verifyAdminToken(req.get('x-admin-token'))) {
    return res.status(401).json({ error: 'ADMIN_REQUIRED', message: 'Tu sesión de admin venció. Ingresá de nuevo.' });
  }
  next();
};

const requirePlayer = wrap(async (req, res, next) => {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'NO_SESSION', 'Primero ingresá tu nombre y mail.');
  const [rows] = await pool.query('SELECT * FROM players WHERE token_hash = ?', [sha256(token)]);
  if (!rows.length) throw new HttpError(401, 'NO_SESSION', 'Tu sesión ya no existe. Pedile a un admin que la revise.');
  req.player = rows[0];
  next();
});

// ---------------------------------------------------------------------------
// Consultas compartidas
// ---------------------------------------------------------------------------
async function getRanking() {
  const [rows] = await pool.query(
    `SELECT id, name, score, correct_count, answered_count
       FROM players
      WHERE is_admin = 0
      ORDER BY score DESC, (last_scored_at IS NULL), last_scored_at ASC, id ASC`
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    id: r.id,
    name: r.name,
    score: r.score,
    correct: r.correct_count,
    answered: r.answered_count
  }));
}

async function getProgress(player) {
  const [rows] = await pool.query(
    `SELECT q.category,
            COUNT(*) AS total,
            SUM(a.answered_at IS NOT NULL) AS answered
       FROM questions q
       LEFT JOIN player_answers a ON a.question_id = q.id AND a.player_id = ?
      WHERE q.is_active = 1
      GROUP BY q.category`,
    [player.id]
  );
  const byCat = {};
  for (const key of CATEGORY_KEYS) {
    byCat[key] = { key, label: CATEGORIES[key].label, points: CATEGORIES[key].points, total: 0, answered: 0, remaining: 0 };
  }
  for (const r of rows) {
    const total = Number(r.total);
    const answered = Number(r.answered || 0);
    byCat[r.category].total = total;
    byCat[r.category].answered = answered;
    byCat[r.category].remaining = total - answered;
  }
  return CATEGORY_KEYS.map((k) => byCat[k]);
}

async function getPendingQuestion(playerId) {
  const [rows] = await pool.query(
    `SELECT q.*
       FROM player_answers a
       JOIN questions q ON q.id = a.question_id
      WHERE a.player_id = ? AND a.answered_at IS NULL
      ORDER BY a.served_at ASC
      LIMIT 1`,
    [playerId]
  );
  return rows.length ? rowToQuestion(rows[0]) : null;
}

async function buildMe(player) {
  const [categories, pending] = await Promise.all([getProgress(player), getPendingQuestion(player.id)]);
  const remaining = categories.reduce((s, c) => s + c.remaining, 0);
  let rank = null;
  let totalPlayers = null;
  if (!player.is_admin) {
    const ranking = await getRanking();
    totalPlayers = ranking.length;
    const mine = ranking.find((r) => r.id === player.id);
    rank = mine ? mine.rank : null;
  }
  return {
    player: {
      id: player.id,
      name: player.name,
      isAdmin: !!player.is_admin,
      score: player.score,
      correct: player.correct_count,
      answered: player.answered_count
    },
    rank,
    totalPlayers,
    categories,
    pending,
    finished: remaining === 0 && !pending
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1); // detrás del ALB
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
  });
  next();
});

app.get('/api/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

// ---------- Jugadores ----------
app.post('/api/players', rateLimit({ windowMs: 60_000, max: 20 }), wrap(async (req, res) => {
  const name = cleanText(req.body.name, { min: 2, max: 30, field: 'El nombre' });
  const { email, normalized } = normalizeEmail(req.body.email);
  const asAdmin = verifyAdminToken(req.get('x-admin-token'));

  const token = crypto.randomBytes(32).toString('base64url');
  try {
    const [result] = await pool.query(
      `INSERT INTO players (name, email, email_normalized, is_admin, token_hash) VALUES (?, ?, ?, ?, ?)`,
      [name, email, asAdmin ? null : normalized, asAdmin ? 1 : 0, sha256(token)]
    );
    const [rows] = await pool.query('SELECT * FROM players WHERE id = ?', [result.insertId]);
    res.status(201).json({ token, ...(await buildMe(rows[0])) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'EMAIL_USED', 'Este mail ya participó. Cada persona puede jugar una sola vez.');
    }
    throw err;
  }
}));

app.get('/api/me', requirePlayer, wrap(async (req, res) => {
  res.json(await buildMe(req.player));
}));

// Pide una pregunta de la categoría. Si el jugador tiene una pregunta abierta
// sin responder, se le devuelve esa misma: recargar la página no sirve para
// "saltear" preguntas difíciles.
app.post('/api/play/next', requirePlayer, wrap(async (req, res) => {
  const category = String(req.body.category || '');
  if (!CATEGORIES[category]) throw new HttpError(400, 'INVALID', 'Categoría inválida.');

  const pending = await getPendingQuestion(req.player.id);
  if (pending) return res.json({ question: pending, resumed: true });

  for (let attempt = 0; attempt < 3; attempt++) {
    const [rows] = await pool.query(
      `SELECT q.*
         FROM questions q
        WHERE q.category = ? AND q.is_active = 1
          AND NOT EXISTS (SELECT 1 FROM player_answers a WHERE a.player_id = ? AND a.question_id = q.id)
        ORDER BY RAND()
        LIMIT 1`,
      [category, req.player.id]
    );
    if (!rows.length) {
      throw new HttpError(409, 'CATEGORY_DONE', `Ya respondiste todas las preguntas de ${CATEGORIES[category].label}.`);
    }
    const [ins] = await pool.query(
      'INSERT IGNORE INTO player_answers (player_id, question_id) VALUES (?, ?)',
      [req.player.id, rows[0].id]
    );
    if (ins.affectedRows === 1) return res.json({ question: rowToQuestion(rows[0]), resumed: false });
  }
  throw new HttpError(409, 'RETRY', 'No se pudo asignar una pregunta. Probá de nuevo.');
}));

app.post('/api/play/answer', requirePlayer, wrap(async (req, res) => {
  const questionId = Number(req.body.questionId);
  const selected = Number(req.body.selected);
  if (!Number.isInteger(questionId)) throw new HttpError(400, 'INVALID', 'Pregunta inválida.');
  if (!Number.isInteger(selected) || selected < 0 || selected > 3) {
    throw new HttpError(400, 'INVALID', 'Elegí una de las cuatro opciones.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT a.id, a.answered_at, a.selected_option, a.is_correct, a.points, q.correct_option, q.category
         FROM player_answers a
         JOIN questions q ON q.id = a.question_id
        WHERE a.player_id = ? AND a.question_id = ?
        FOR UPDATE`,
      [req.player.id, questionId]
    );
    if (!rows.length) throw new HttpError(404, 'NOT_SERVED', 'Esa pregunta no te fue asignada.');
    const row = rows[0];
    if (row.answered_at) {
      throw new HttpError(409, 'ALREADY_ANSWERED', 'Esta pregunta ya la respondiste.');
    }

    const correct = selected === row.correct_option;
    const points = correct ? CATEGORIES[row.category].points : 0;

    await conn.query(
      'UPDATE player_answers SET answered_at = NOW(3), selected_option = ?, is_correct = ?, points = ? WHERE id = ?',
      [selected, correct ? 1 : 0, points, row.id]
    );
    await conn.query(
      `UPDATE players
          SET score = score + ?,
              correct_count = correct_count + ?,
              answered_count = answered_count + 1,
              last_scored_at = IF(? > 0, NOW(3), last_scored_at)
        WHERE id = ?`,
      [points, correct ? 1 : 0, points, req.player.id]
    );
    await conn.commit();

    const [players] = await pool.query('SELECT * FROM players WHERE id = ?', [req.player.id]);
    res.json({
      correct,
      correctOption: row.correct_option,
      selected,
      points,
      ...(await buildMe(players[0]))
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}));

app.get('/api/leaderboard', wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const ranking = await getRanking();
  res.json({ total: ranking.length, rows: ranking.slice(0, limit), updatedAt: new Date().toISOString() });
}));

// ---------- Admin ----------
app.post('/api/admin/login', rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_DISABLED', message: 'El panel de admin no está configurado (falta ADMIN_PASSWORD).' });
  }
  if (!passwordMatches(req.body.password)) {
    return res.status(401).json({ error: 'BAD_PASSWORD', message: 'Contraseña incorrecta.' });
  }
  res.json({ token: signAdminToken(), expiresInMs: ADMIN_TOKEN_TTL_MS });
});

app.get('/api/admin/questions', requireAdmin, wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM questions
      ORDER BY FIELD(category, 'principiante', 'intermedio', 'avanzado'), sort_order, id`
  );
  res.json({ questions: rows.map((r) => rowToQuestion(r, { includeAnswer: true })) });
}));

app.post('/api/admin/questions', requireAdmin, wrap(async (req, res) => {
  const q = parseQuestionBody(req.body);
  const [[{ next }]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM questions WHERE category = ?', [q.category]);
  const [result] = await pool.query(
    `INSERT INTO questions (category, text, option_a, option_b, option_c, option_d, correct_option, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [q.category, q.text, ...q.options, q.correct, q.isActive ? 1 : 0, next]
  );
  const [rows] = await pool.query('SELECT * FROM questions WHERE id = ?', [result.insertId]);
  res.status(201).json({ question: rowToQuestion(rows[0], { includeAnswer: true }) });
}));

app.put('/api/admin/questions/:id', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const q = parseQuestionBody(req.body);
  const [result] = await pool.query(
    `UPDATE questions
        SET category = ?, text = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?, correct_option = ?, is_active = ?
      WHERE id = ?`,
    [q.category, q.text, ...q.options, q.correct, q.isActive ? 1 : 0, id]
  );
  if (!result.affectedRows) throw new HttpError(404, 'NOT_FOUND', 'La pregunta no existe.');
  const [rows] = await pool.query('SELECT * FROM questions WHERE id = ?', [id]);
  res.json({ question: rowToQuestion(rows[0], { includeAnswer: true }) });
}));

app.get('/api/admin/players', requireAdmin, wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, email, is_admin, score, correct_count, answered_count, created_at
       FROM players
      ORDER BY is_admin ASC, score DESC, created_at ASC`
  );
  res.json({
    players: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      isAdmin: !!r.is_admin,
      score: r.score,
      correct: r.correct_count,
      answered: r.answered_count,
      createdAt: r.created_at
    }))
  });
}));

app.delete('/api/admin/players/:id', requireAdmin, wrap(async (req, res) => {
  const [result] = await pool.query('DELETE FROM players WHERE id = ?', [Number(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, 'NOT_FOUND', 'El jugador no existe.');
  res.json({ ok: true });
}));

// Borra todos los jugadores y sus respuestas (nuevo evento). Las preguntas quedan.
app.post('/api/admin/reset', requireAdmin, wrap(async (req, res) => {
  if (req.body.confirm !== 'REINICIAR') {
    throw new HttpError(400, 'CONFIRM_REQUIRED', 'Escribí REINICIAR para confirmar.');
  }
  await pool.query('DELETE FROM players');
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Ruta inexistente.' }));

// ---------- Frontend ----------
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '5m', index: 'index.html' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// ---------- Errores ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'INVALID_JSON', message: 'El cuerpo de la request no es JSON válido.' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'INTERNAL', message: 'Error interno. Probá de nuevo en unos segundos.' });
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
async function main() {
  await waitForDatabase();
  await migrate();
  const server = app.listen(PORT, () => console.log(`[app] Trivia AWS escuchando en :${PORT}`));

  const shutdown = (signal) => {
    console.log(`[app] ${signal} recibido, cerrando...`);
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[app] No se pudo iniciar:', err);
  process.exit(1);
});
