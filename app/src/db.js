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
  timezone: 'Z'
};

const pool = mysql.createPool(config);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// El contenedor de MySQL tarda en estar listo (sobre todo la primera vez que
// inicializa el volumen), así que reintentamos antes de rendirnos.
async function waitForDatabase({ attempts = 40, delayMs = 3000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      console.log(`[db] MySQL todavía no responde (${i}/${attempts}): ${err.code || err.message}`);
      if (i === attempts) throw err;
      await sleep(delayMs);
    }
  }
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await pool.query(stmt);
  }

  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM questions');
  if (n === 0) {
    let order = 0;
    for (const q of seedQuestions) {
      await pool.query(
        `INSERT INTO questions (category, text, option_a, option_b, option_c, option_d, correct_option, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [q.category, q.text, ...q.options, q.correct, order++]
      );
    }
    console.log(`[db] Cargadas ${seedQuestions.length} preguntas iniciales.`);
  }
}

module.exports = { pool, waitForDatabase, migrate };
