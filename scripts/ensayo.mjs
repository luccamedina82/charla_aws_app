// Ensayo de punta a punta: registra jugadores, juega partidas completas y
// prueba el panel de admin. AL FINAL REINICIA EL EVENTO (borra todos los
// jugadores y puntajes): no correrlo con la sala jugando.
//
// Contra docker compose local:
//   docker run --rm --network <proyecto>_default -v "$PWD/scripts:/s:ro" \
//     -e ADMIN_PASSWORD=... node:22-alpine node /s/ensayo.mjs
// Contra AWS:
//   BASE=https://charla.tekforge.site ADMIN_PASSWORD=$(aws ssm get-parameter \
//     --name /lab3/dev/app/admin_password --with-decryption \
//     --query Parameter.Value --output text --profile lab3) node scripts/ensayo.mjs
//
// Espera la tabla vacía al arrancar (2 jugadores al final del juego).
const BASE = process.env.BASE || 'http://app:8080';
const ADMIN = process.env.ADMIN_PASSWORD;
let fails = 0;

async function call(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
function check(name, ok, extra = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fails++;
}

async function playAll(token, pick) {
  const auth = { authorization: 'Bearer ' + token };
  let answered = 0, correct = 0, score = 0;
  for (const cat of ['principiante', 'intermedio', 'avanzado']) {
    for (;;) {
      const n = await call('POST', '/api/play/next', { category: cat }, auth);
      if (n.status === 409 && n.data.error === 'CATEGORY_DONE') break;
      if (n.status !== 200) throw new Error('next ' + n.status + ' ' + JSON.stringify(n.data));
      if ('correct' in n.data.question) throw new Error('la respuesta correcta viajó al navegador');
      const a = await call('POST', '/api/play/answer', { questionId: n.data.question.id, selected: pick(n.data.question) }, auth);
      if (a.status !== 200) throw new Error('answer ' + a.status);
      answered++; if (a.data.correct) correct++; score += a.data.points;
    }
  }
  return { answered, correct, score };
}

// --- Jugadores ---
const ana = await call('POST', '/api/players', { name: 'Ana', email: 'Ana.Lopez+charla@Gmail.com' });
check('registro de Ana', ana.status === 201);
const dup = await call('POST', '/api/players', { name: 'Ana bis', email: 'analopez@gmail.com' });
check('mismo mail normalizado se rechaza', dup.status === 409 && dup.data.error === 'EMAIL_USED');
const beto = await call('POST', '/api/players', { name: 'Beto', email: 'beto@utn.edu.ar' });
check('registro de Beto', beto.status === 201);

// Recargar con una pregunta abierta devuelve la misma
const authA = { authorization: 'Bearer ' + ana.data.token };
const q1 = await call('POST', '/api/play/next', { category: 'principiante' }, authA);
const q1b = await call('POST', '/api/play/next', { category: 'intermedio' }, authA);
check('pregunta abierta no se puede saltear', q1b.data.resumed === true && q1b.data.question.id === q1.data.question.id);
await call('POST', '/api/play/answer', { questionId: q1.data.question.id, selected: 0 }, authA);
const again = await call('POST', '/api/play/answer', { questionId: q1.data.question.id, selected: 1 }, authA);
check('no se responde dos veces', again.status === 409 && again.data.error === 'ALREADY_ANSWERED');

const rA = await playAll(ana.data.token, () => 0);
const rB = await playAll(beto.data.token, () => Math.floor(Math.random() * 4));
check('Ana terminó la partida', rA.answered === 14, `${rA.answered + 1} respondidas`);
check('Beto terminó la partida', rB.answered === 15, `${rB.correct}/15 correctas, ${rB.score} pts`);

const me = await call('GET', '/api/me', null, authA);
check('/api/me marca finished', me.data.finished === true, `Ana: ${me.data.player.score} pts, puesto ${me.data.rank}`);

const lb = await call('GET', '/api/leaderboard');
check('tabla con 2 jugadores, ordenada por puntos', lb.data.total === 2 && lb.data.rows[0].score >= lb.data.rows[1].score,
  lb.data.rows.map((r) => `${r.rank}. ${r.name} ${r.score}`).join(' | '));

// --- Admin ---
const bad = await call('POST', '/api/admin/login', { password: 'mala' });
check('login admin con contraseña mala', bad.status === 401);
const login = await call('POST', '/api/admin/login', { password: ADMIN });
check('login admin', login.status === 200);
const adm = { 'x-admin-token': login.data.token };

const qs = await call('GET', '/api/admin/questions', null, adm);
check('admin ve las 15 preguntas', qs.data.questions.length === 15);
const nueva = await call('POST', '/api/admin/questions', {
  category: 'avanzado', text: '¿Qué hace el bake time en un blue/green de ECS?',
  options: ['Nada', 'Espera antes de cortar la versión vieja', 'Compila la imagen', 'Borra el target group'], correct: 1
}, adm);
check('admin agrega pregunta', nueva.status === 201);
const edit = await call('PUT', '/api/admin/questions/' + nueva.data.question.id, {
  category: 'avanzado', text: '¿Para qué sirve el bake time en un blue/green de ECS?',
  options: ['Nada', 'Espera antes de cortar la versión vieja', 'Compila la imagen', 'Borra el target group'], correct: 1, isActive: false
}, adm);
check('admin edita y desactiva la pregunta', edit.status === 200 && edit.data.question.isActive === false);

const players = await call('GET', '/api/admin/players', null, adm);
check('admin ve jugadores con mail', players.data.players.length === 2 && players.data.players.every((p) => p.email));
const del = await call('DELETE', '/api/admin/players/' + beto.data.player.id, null, adm);
check('admin elimina a Beto', del.status === 200);
const betoOtraVez = await call('POST', '/api/players', { name: 'Beto', email: 'beto@utn.edu.ar' });
check('el mail de Beto queda libre', betoOtraVez.status === 201);

const noConfirm = await call('POST', '/api/admin/reset', { confirm: 'si' }, adm);
check('reset sin confirmar se rechaza', noConfirm.status === 400);
const reset = await call('POST', '/api/admin/reset', { confirm: 'REINICIAR' }, adm);
const lb2 = await call('GET', '/api/leaderboard');
check('reiniciar evento vacía la tabla', reset.status === 200 && lb2.data.total === 0);
const anaVieja = await call('GET', '/api/me', null, authA);
check('sesión vieja de Ana deja de valer', anaVieja.status === 401);

console.log(fails ? `\n${fails} FALLAS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
