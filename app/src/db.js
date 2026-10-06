const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const seedQuestions = require('./seed-questions');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'trivia',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'trivia',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  charset: 'utf8mb4',
  timezone: 'Z',
  // Con la base caída, que la request falle rápido (y responda 503) en vez de
  // quedar colgada los 10 s del default.
  connectTimeout: 5000
};

const pool = mysql.createPool(config);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Errores que significan "no hay base", no "la query está mal". El servidor
// los responde como 503 para que el frontend muestre el aviso y reintente.
const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH',
  'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR', 'DB_NOT_READY'
]);
const isUnavailable = (err) => !!err && UNAVAILABLE_CODES.has(err.code);

let ready = false;
const isReady = () => ready;

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);

  // Las dos tasks arrancan a la vez. Sin el lock, las dos ven la tabla vacía y
  // cargan las preguntas dos veces. GET_LOCK es por conexión: todo va por la
  // misma, y la segunda task espera hasta que la primera termine.
  const conn = await pool.getConnection();
  try {
    const [[{ locked }]] = await conn.query("SELECT GET_LOCK('trivia_migrate', 60) AS locked");
    if (locked !== 1) throw new Error('No se obtuvo el lock de migración');
    try {
      for (const stmt of statements) {
        await conn.query(stmt);
      }

      const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM questions');
      if (n === 0) {
        let order = 0;
        for (const q of seedQuestions) {
          await conn.query(
            `INSERT INTO questions (category, text, option_a, option_b, option_c, option_d, correct_option, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [q.category, q.text, ...q.options, q.correct, order++]
          );
        }
        console.log(`[db] Cargadas ${seedQuestions.length} preguntas iniciales.`);
      }
    } finally {
      await conn.query("SELECT RELEASE_LOCK('trivia_migrate')").catch(() => {});
    }
  } finally {
    conn.release();
  }
}

// Conecta y migra en segundo plano, sin límite de intentos. El servidor ya está
// escuchando: si la base no aparece, la task igual pasa el health check del ALB
// y responde 503 en /api hasta que la base vuelva.
async function initDatabase({ delayMs = 3000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      await migrate();
      ready = true;
      console.log('[db] Base lista.');
      return;
    } catch (err) {
      console.log(`[db] MySQL todavía no está listo (intento ${i}): ${err.code || err.message}`);
      await sleep(delayMs);
    }
  }
}

module.exports = { pool, initDatabase, isReady, isUnavailable };
