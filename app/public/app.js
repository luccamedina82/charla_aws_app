(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Constantes
  // -------------------------------------------------------------------------
  var CATS = {
    principiante: { label: 'Principiante', eyebrow: 'Nivel 1', points: 100, desc: 'Fundamentos y servicios core de AWS.' },
    intermedio: { label: 'Intermedio', eyebrow: 'Nivel 2', points: 200, desc: 'Arquitectura, escalado y buenas prácticas.' },
    avanzado: { label: 'Avanzado', eyebrow: 'Nivel 3', points: 300, desc: 'Modernización, contenedores y serverless.' }
  };
  var CAT_KEYS = Object.keys(CATS);
  var LETTERS = ['A', 'B', 'C', 'D'];
  var BOARD_REFRESH_MS = 5000;

  var PENCIL = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="1.8"/></svg>';

  // -------------------------------------------------------------------------
  // Almacenamiento local (puede fallar en modo privado: nunca es crítico)
  // -------------------------------------------------------------------------
  var KEYS = { player: 'trivia.playerToken', admin: 'trivia.adminToken', adminPlay: 'trivia.adminPlay' };
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) {
      try {
        if (v === null || v === undefined) window.localStorage.removeItem(k);
        else window.localStorage.setItem(k, v);
      } catch (e) { /* sin storage */ }
    }
  };

  var state = {
    playerToken: store.get(KEYS.player),
    adminToken: store.get(KEYS.admin),
    adminPlay: store.get(KEYS.adminPlay) === '1',
    me: null,
    question: null,
    selected: null,
    result: null,
    adminTab: 'preguntas',
    adminQuestions: null,
    adminPlayers: null,
    editing: null,
    leaderboard: null,
    boardTimer: null
  };

  var view = document.getElementById('view');
  var toastEl = document.getElementById('toast');
  var dbBanner = document.getElementById('db-banner');
  var servedBy = document.getElementById('served-by');
  var servedText = document.getElementById('served-text');

  function setPlayerToken(t) { state.playerToken = t; store.set(KEYS.player, t); }
  function setAdminToken(t) { state.adminToken = t; store.set(KEYS.admin, t); }
  function setAdminPlay(on) { state.adminPlay = !!on; store.set(KEYS.adminPlay, on ? '1' : null); }
  function clearPlayer() {
    setPlayerToken(null);
    state.me = null;
    state.question = null;
    state.selected = null;
    state.result = null;
  }

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', !!isError);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3400);
  }

  // Botones destructivos: primer toque arma, segundo confirma.
  function armed(btn, confirmText) {
    if (btn.dataset.armed === '1') {
      clearTimeout(btn._armTimer);
      return true;
    }
    btn.dataset.armed = '1';
    btn.dataset.orig = btn.textContent;
    btn.textContent = confirmText;
    btn.classList.add('confirming');
    btn._armTimer = setTimeout(function () {
      btn.dataset.armed = '';
      btn.textContent = btn.dataset.orig;
      btn.classList.remove('confirming');
    }, 4000);
    return false;
  }

  function api(method, url, body, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.playerToken) headers.Authorization = 'Bearer ' + state.playerToken;
    if (opts.admin && state.adminToken) headers['X-Admin-Token'] = state.adminToken;

    return fetch(url, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined })
      .catch(function () {
        var e = new Error('No hay conexión con el servidor. Revisá tu internet y probá de nuevo.');
        e.code = 'NETWORK';
        throw e;
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var err = new Error(data.message || ('Error ' + res.status));
            err.code = data.error;
            err.status = res.status;
            if (err.code === 'ADMIN_REQUIRED') setAdminToken(null);
            if (err.code === 'DB_UNAVAILABLE') setDbDown(true);
            throw err;
          }
          if (!opts.noDb) setDbDown(false);
          return data;
        });
      });
  }

  // -------------------------------------------------------------------------
  // Base caída y task que respondió
  // -------------------------------------------------------------------------
  // Con la base caída se muestra el aviso y se chequea sola cada 5 s. Cuando
  // vuelve, la vista que había quedado en error se recarga sin tocar nada.
  var dbDown = false;
  function setDbDown(down) {
    if (dbDown === down) return;
    dbDown = down;
    dbBanner.hidden = !down;
    if (!down && state.dbErrorView) {
      state.dbErrorView = false;
      render();
    }
  }

  // Color estable derivado del ID de la task: misma task, mismo color.
  function taskColor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return 'hsl(' + h + ', 85%, 65%)';
  }

  function refreshServedBy() {
    fetch('/api/whoami', { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (w) {
        servedText.textContent = 'task ' + w.task + ' · ' + w.az + ' · v ' + w.version;
        servedBy.style.setProperty('--task', taskColor(w.task));
      })
      .catch(function () { servedText.textContent = 'sin conexión con el servidor'; });
    // Siempre, no solo después de un error: así el aviso aparece también en
    // pantallas que no consultan la API solas (por ejemplo, el registro).
    api('GET', '/api/health/db').catch(function () {});
  }

  function withBusy(btn, promise) {
    if (btn) btn.disabled = true;
    return promise.finally(function () { if (btn && btn.isConnected) btn.disabled = false; });
  }

  function totalQuestions(me) {
    return me.categories.reduce(function (s, c) { return s + c.total; }, 0);
  }

  // -------------------------------------------------------------------------
  // Router
  // -------------------------------------------------------------------------
  function currentRoute() {
    var h = location.hash.replace(/^#\/?/, '');
    return ['jugar', 'tabla', 'admin'].indexOf(h) >= 0 ? h : 'jugar';
  }

  function render() {
    var r = currentRoute();
    Array.prototype.forEach.call(document.querySelectorAll('.nav-link'), function (a) {
      a.classList.toggle('active', a.dataset.route === r);
    });
    stopBoard();
    if (r === 'tabla') return renderBoard();
    if (r === 'admin') return renderAdmin();
    return renderPlay();
  }

  function renderError(err) {
    if (err.code === 'DB_UNAVAILABLE') state.dbErrorView = true;
    view.innerHTML =
      '<section class="stack">' +
        '<p class="error">' + esc(err.message) + '</p>' +
        '<div class="row"><button class="btn" data-action="retry">Reintentar</button></div>' +
      '</section>';
  }

  // -------------------------------------------------------------------------
  // JUGAR
  // -------------------------------------------------------------------------
  function renderPlay() {
    if (!state.playerToken) return renderRegister();
    if (!state.me) {
      view.innerHTML = '<p class="loading">Cargando tu partida…</p>';
      return api('GET', '/api/me').then(function (me) {
        state.me = me;
        renderPlay();
      }).catch(function (err) {
        if (err.status === 401) {
          clearPlayer();
          return renderRegister(err.message);
        }
        renderError(err);
      });
    }
    if (!state.question && state.me.pending) {
      state.question = state.me.pending;
      state.selected = null;
      state.result = null;
    }
    if (state.question) return renderQuestion();
    if (state.me.finished) return renderFinished();
    return renderCategories();
  }

  function renderRegister(message, values) {
    values = values || {};
    var legend = CAT_KEYS.map(function (k) {
      return '<span class="tier-' + k + '">' + CATS[k].label + ' · ' + CATS[k].points + ' pts</span>';
    }).join('');

    view.innerHTML =
      '<section class="register">' +
        '<div class="stack">' +
          '<p class="eyebrow">Juego de preguntas</p>' +
          '<h1 class="title">Trivia AWS DEMO</h1>' +
          '<p class="lead">Ingresá tu nombre y tu mail para empezar. Elegí un nivel, respondé y sumá puntos. Cada persona juega una sola vez y cada pregunta se responde una única vez.</p>' +
          '<div class="points-legend">' + legend + '</div>' +
        '</div>' +
        '<form class="panel form" id="register-form" novalidate>' +
          (state.adminPlay
            ? '<p class="admin-play-badge">Partida de admin: podés jugar las veces que quieras y no aparece en la tabla.</p>'
            : '') +
          '<label class="field"><span>Nombre (se muestra en la tabla)</span>' +
            '<input class="input" id="reg-name" name="name" maxlength="30" autocomplete="nickname" required value="' + esc(values.name) + '" /></label>' +
          '<label class="field"><span>Mail</span>' +
            '<input class="input" id="reg-email" name="email" type="email" maxlength="254" autocomplete="email" inputmode="email" required value="' + esc(values.email) + '" /></label>' +
          (message ? '<p class="error">' + esc(message) + '</p>' : '') +
          '<button class="btn btn-primary btn-lg" type="submit">Empezar a jugar</button>' +
          (state.adminPlay
            ? '<button class="btn" type="button" data-action="cancel-admin-play">Cancelar partida de admin</button>'
            : '<p class="hint">Usamos tu mail solo para verificar que juegues una única vez. No se muestra en la tabla de puntuación.</p>') +
        '</form>' +
      '</section>';
  }

  function onRegister(form) {
    var name = form.name.value.trim();
    var email = form.email.value.trim();
    var values = { name: name, email: email };
    if (name.length < 2) return renderRegister('Tu nombre tiene que tener al menos 2 caracteres.', values);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return renderRegister('Ingresá un mail válido.', values);

    var btn = form.querySelector('button[type="submit"]');
    withBusy(btn, api('POST', '/api/players', { name: name, email: email }, { admin: state.adminPlay }))
      .then(function (data) {
        setPlayerToken(data.token);
        delete data.token;
        state.me = data;
        state.question = null;
        state.result = null;
        renderPlay();
      })
      .catch(function (err) { renderRegister(err.message, values); });
  }

  function playerStrip() {
    var me = state.me;
    var p = me.player;
    var rank = me.rank
      ? '<div class="stat"><b>#' + me.rank + '</b><span>de ' + me.totalPlayers + '</span></div>'
      : '';
    return (
      '<div class="player-strip">' +
        '<div class="player-who">' +
          '<span class="label">Jugando como</span>' +
          '<span class="player-name">' + esc(p.name) + (p.isAdmin ? ' <span class="badge">admin</span>' : '') + '</span>' +
        '</div>' +
        '<div class="player-stats">' +
          '<div class="stat"><b class="score">' + p.score + '</b><span>Puntos</span></div>' +
          '<div class="stat"><b>' + p.correct + '/' + p.answered + '</b><span>Correctas</span></div>' +
          '<div class="stat"><b>' + p.answered + '/' + totalQuestions(me) + '</b><span>Respondidas</span></div>' +
          rank +
        '</div>' +
      '</div>'
    );
  }

  function renderCategories() {
    var me = state.me;
    var cards = me.categories.map(function (c) {
      var meta = CATS[c.key];
      var done = c.remaining === 0;
      var pips = '';
      for (var i = 0; i < c.total; i++) pips += '<span class="pip' + (i < c.answered ? ' filled' : '') + '"></span>';
      return (
        '<button class="cat-card tier-' + c.key + '" type="button" data-action="pick" data-cat="' + c.key + '"' + (done ? ' disabled' : '') + '>' +
          '<span class="cat-eyebrow">' + meta.eyebrow + ' · ' + c.points + ' pts</span>' +
          '<h2 class="cat-title">' + meta.label + '</h2>' +
          '<p class="lead small">' + meta.desc + '</p>' +
          '<div class="cat-meta">' +
            '<span class="cat-count">' + (done ? 'completo' : c.remaining + ' de ' + c.total + ' disponibles') + '</span>' +
            '<div class="pips">' + pips + '</div>' +
          '</div>' +
          '<span class="cat-cta">' + (done ? 'Nivel completo ✓' : 'Sacar pregunta →') + '</span>' +
        '</button>'
      );
    }).join('');

    view.innerHTML =
      '<section class="stack">' +
        playerStrip() +
        '<p class="label">Elegí un nivel</p>' +
        '<div class="categories">' + cards + '</div>' +
        '<div class="row">' +
          '<a class="btn btn-sm" href="#/tabla">Ver tabla de puntuación</a>' +
          '<button class="btn btn-sm btn-danger" type="button" data-action="leave">' + (state.me.player.isAdmin ? 'Terminar partida de admin' : 'Salir') + '</button>' +
        '</div>' +
      '</section>';
  }

  function renderQuestion() {
    var q = state.question;
    var r = state.result;
    var meta = CATS[q.category];

    var options = q.options.map(function (opt, i) {
      var cls = 'option';
      if (r) {
        if (i === r.correctOption) cls += ' is-correct';
        else if (i === r.selected) cls += ' is-wrong';
      } else if (i === state.selected) {
        cls += ' selected';
      }
      return (
        '<button class="' + cls + '" type="button" data-action="select" data-i="' + i + '"' + (r ? ' disabled' : '') + '>' +
          '<span class="letter">' + LETTERS[i] + '</span><span>' + esc(opt) + '</span>' +
        '</button>'
      );
    }).join('');

    var feedback = '';
    if (r) {
      feedback = r.correct
        ? '<div class="feedback good"><b>¡Correcta!</b><span>+' + r.points + ' puntos</span></div>'
        : '<div class="feedback bad"><b>Incorrecta</b><span>La respuesta era ' + LETTERS[r.correctOption] + ') ' + esc(q.options[r.correctOption]) + '</span></div>';
    }

    var actions = r
      ? '<button class="btn btn-primary btn-lg" type="button" data-action="continue">' + (state.me.finished ? 'Ver mi resultado' : 'Seguir jugando') + '</button>'
      : '<button class="btn btn-primary btn-lg" type="button" data-action="confirm"' + (state.selected === null ? ' disabled' : '') + '>Confirmar respuesta</button>' +
        '<span class="hint">Una vez confirmada no se puede cambiar.</span>';

    view.innerHTML =
      '<section class="stack question tier-' + q.category + '">' +
        '<div class="q-meta">' +
          '<span class="tier-pill">' + meta.label + '</span>' +
          '<span class="label">' + q.points + ' pts si acertás</span>' +
        '</div>' +
        '<p class="q-text">' + esc(q.text) + '</p>' +
        '<div class="options' + (r ? ' locked' : '') + '">' + options + '</div>' +
        feedback +
        '<div class="row">' + actions + '</div>' +
      '</section>';
  }

  function renderFinished() {
    var me = state.me;
    var p = me.player;
    var rankText = me.rank ? ' y quedaste #' + me.rank + ' de ' + me.totalPlayers : '';
    view.innerHTML =
      '<section class="stack">' +
        playerStrip() +
        '<div class="panel finish">' +
          '<div class="finish-score">' + p.score + '</div>' +
          '<div class="stack">' +
            '<p class="eyebrow">Partida terminada</p>' +
            '<h2 class="h2">¡Terminaste, ' + esc(p.name) + '!</h2>' +
            '<p class="lead">Acertaste ' + p.correct + ' de ' + p.answered + ' preguntas' + rankText + '.</p>' +
            '<div class="row">' +
              '<a class="btn btn-primary" href="#/tabla">Ver tabla de puntuación</a>' +
              (p.isAdmin
                ? '<button class="btn" type="button" data-action="admin-replay">Jugar otra vez (admin)</button>'
                : '<button class="btn" type="button" data-action="next-player">Dejar lugar al siguiente jugador</button>') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  // -------------------------------------------------------------------------
  // TABLA DE PUNTUACIÓN
  // -------------------------------------------------------------------------
  function stopBoard() {
    if (state.boardTimer) clearInterval(state.boardTimer);
    state.boardTimer = null;
  }

  function renderBoard() {
    view.innerHTML =
      '<section class="stack" id="board-root">' +
        '<div class="board-head">' +
          '<div class="stack" style="gap:10px">' +
            '<p class="eyebrow">En vivo</p>' +
            '<h1 class="title">Tabla de puntuación</h1>' +
            '<p class="hint" id="board-meta">Cargando…</p>' +
          '</div>' +
          '<div class="row">' +
            '<button class="btn btn-sm" type="button" data-action="fullscreen">Pantalla completa</button>' +
          '</div>' +
        '</div>' +
        '<div class="board" id="board"><p class="board-empty">Cargando tabla…</p></div>' +
      '</section>';

    var loadMe = state.playerToken && !state.me
      ? api('GET', '/api/me').then(function (me) { state.me = me; }).catch(function () {})
      : Promise.resolve();

    loadMe.then(refreshBoard);
    state.boardTimer = setInterval(refreshBoard, BOARD_REFRESH_MS);
  }

  function refreshBoard() {
    if (currentRoute() !== 'tabla') return stopBoard();
    return api('GET', '/api/leaderboard?limit=200')
      .then(function (data) {
        state.leaderboard = data;
        paintBoard();
      })
      .catch(function (err) {
        var meta = document.getElementById('board-meta');
        if (meta) meta.textContent = err.message;
      });
  }

  function paintBoard() {
    var board = document.getElementById('board');
    var meta = document.getElementById('board-meta');
    if (!board) return;
    var data = state.leaderboard;
    var myId = state.me && state.me.player ? state.me.player.id : null;
    var time = new Date(data.updatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    meta.textContent = data.total + (data.total === 1 ? ' jugador' : ' jugadores') + ' · se actualiza cada 5 s · última actualización ' + time;

    if (!data.rows.length) {
      board.innerHTML = '<p class="board-empty">Todavía no jugó nadie. ¡Sé la primera persona en sumar puntos!</p>';
      return;
    }
    var head =
      '<div class="board-row head"><span>#</span><span>Jugador</span><span class="num hide-sm">Correctas</span><span class="num">Puntos</span></div>';
    board.innerHTML = head + data.rows.map(function (r) {
      var cls = 'board-row';
      if (r.rank <= 3) cls += ' top-' + r.rank;
      if (r.id === myId) cls += ' me';
      return (
        '<div class="' + cls + '">' +
          '<span class="rank">' + r.rank + '</span>' +
          '<span class="name">' + esc(r.name) + (r.id === myId ? '<span class="you">vos</span>' : '') + '</span>' +
          '<span class="num hide-sm">' + r.correct + '/' + r.answered + '</span>' +
          '<span class="pts">' + r.score + '</span>' +
        '</div>'
      );
    }).join('');
  }

  document.addEventListener('fullscreenchange', function () {
    var root = document.getElementById('board-root');
    if (root) root.classList.toggle('board-fullscreen', document.fullscreenElement === root);
  });

  // -------------------------------------------------------------------------
  // ADMIN
  // -------------------------------------------------------------------------
  function renderAdmin() {
    if (!state.adminToken) return renderAdminLogin();

    var tabs = [
      ['preguntas', 'Preguntas'],
      ['jugadores', 'Jugadores'],
      ['evento', 'Evento']
    ].map(function (t) {
      return '<button class="tab' + (state.adminTab === t[0] ? ' active' : '') + '" type="button" data-action="admin-tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('');

    view.innerHTML =
      '<section class="stack">' +
        '<div class="stack" style="gap:10px">' +
          '<p class="eyebrow">Panel de admin</p>' +
          '<h1 class="title">Editar trivia</h1>' +
        '</div>' +
        '<div class="tabs" role="tablist">' + tabs + '</div>' +
        '<div id="admin-body"><p class="loading">Cargando…</p></div>' +
      '</section>';

    if (state.adminTab === 'preguntas') return loadAdminQuestions();
    if (state.adminTab === 'jugadores') return loadAdminPlayers();
    return renderAdminEvent();
  }

  function adminBody() { return document.getElementById('admin-body'); }

  function handleAdminError(err) {
    if (err.code === 'ADMIN_REQUIRED') {
      toast(err.message, true);
      return renderAdminLogin();
    }
    if (err.code === 'DB_UNAVAILABLE') state.dbErrorView = true;
    var body = adminBody();
    if (body) body.innerHTML = '<p class="error">' + esc(err.message) + '</p>';
  }

  function renderAdminLogin(message) {
    view.innerHTML =
      '<section class="register">' +
        '<div class="stack">' +
          '<p class="eyebrow">Panel de admin</p>' +
          '<h1 class="title">Editar trivia</h1>' +
          '<p class="lead">Desde acá podés editar las preguntas con el lápiz, ver y moderar jugadores, jugar partidas de prueba y reiniciar el evento.</p>' +
        '</div>' +
        '<form class="panel form" id="admin-login" novalidate>' +
          '<label class="field"><span>Contraseña de admin</span>' +
            '<input class="input" id="admin-password" name="password" type="password" autocomplete="current-password" required /></label>' +
          (message ? '<p class="error">' + esc(message) + '</p>' : '') +
          '<button class="btn btn-primary btn-lg" type="submit">Entrar</button>' +
        '</form>' +
      '</section>';
  }

  function onAdminLogin(form) {
    var btn = form.querySelector('button[type="submit"]');
    withBusy(btn, api('POST', '/api/admin/login', { password: form.password.value }, { noDb: true }))
      .then(function (data) {
        setAdminToken(data.token);
        toast('Sesión de admin iniciada');
        renderAdmin();
      })
      .catch(function (err) { renderAdminLogin(err.message); });
  }

  // ---------- Preguntas ----------
  function loadAdminQuestions() {
    return api('GET', '/api/admin/questions', undefined, { admin: true })
      .then(function (data) {
        state.adminQuestions = data.questions;
        paintAdminQuestions();
      })
      .catch(handleAdminError);
  }

  function questionForm(q, category) {
    q = q || { id: '', category: category, text: '', options: ['', '', '', ''], correct: 0, isActive: true };
    var catOptions = CAT_KEYS.map(function (k) {
      return '<option value="' + k + '"' + (q.category === k ? ' selected' : '') + '>' + CATS[k].label + ' (' + CATS[k].points + ' pts)</option>';
    }).join('');
    var opts = [0, 1, 2, 3].map(function (i) {
      var checked = q.correct === i;
      return (
        '<div class="opt-row">' +
          '<label class="radio' + (checked ? ' checked' : '') + '"><input type="radio" name="correct" value="' + i + '"' + (checked ? ' checked' : '') + ' /> ' + LETTERS[i] + ' correcta</label>' +
          '<input class="input" name="opt' + i + '" maxlength="500" placeholder="Opción ' + LETTERS[i] + '" value="' + esc(q.options[i]) + '" required />' +
        '</div>'
      );
    }).join('');

    return (
      '<form class="q-item" data-form="question" data-id="' + esc(q.id) + '" novalidate>' +
        '<div class="q-form">' +
          '<p class="label">' + (q.id ? 'Editando pregunta' : 'Nueva pregunta') + '</p>' +
          '<label class="field"><span>Nivel</span><select class="select" name="category">' + catOptions + '</select></label>' +
          '<label class="field"><span>Pregunta</span><textarea class="textarea" name="text" maxlength="1000" required>' + esc(q.text) + '</textarea></label>' +
          opts +
          '<label class="check"><input type="checkbox" name="isActive"' + (q.isActive ? ' checked' : '') + ' /> Activa (aparece en el juego)</label>' +
          '<div class="row">' +
            '<button class="btn btn-primary" type="submit">Guardar</button>' +
            '<button class="btn" type="button" data-action="cancel-edit">Cancelar</button>' +
          '</div>' +
        '</div>' +
      '</form>'
    );
  }

  function questionItem(q) {
    if (state.editing === q.id) return questionForm(q);
    var opts = q.options.map(function (o, i) {
      return '<li class="' + (i === q.correct ? 'correct' : '') + '"><b>' + LETTERS[i] + ')</b><span>' + esc(o) + '</span></li>';
    }).join('');
    return (
      '<article class="q-item' + (q.isActive ? '' : ' inactive') + '">' +
        '<div class="q-item-body">' +
          '<p class="q-item-text">' + esc(q.text) + '</p>' +
          '<ul class="q-item-options">' + opts + '</ul>' +
          (q.isActive ? '' : '<span><span class="badge off">desactivada</span></span>') +
        '</div>' +
        '<button class="icon-btn" type="button" data-action="edit-q" data-id="' + q.id + '" title="Editar pregunta" aria-label="Editar pregunta">' + PENCIL + '</button>' +
      '</article>'
    );
  }

  function paintAdminQuestions() {
    var body = adminBody();
    if (!body) return;
    var sections = CAT_KEYS.map(function (k) {
      var list = state.adminQuestions.filter(function (q) { return q.category === k; });
      var active = list.filter(function (q) { return q.isActive; }).length;
      var isNew = state.editing === 'new:' + k;
      return (
        '<section class="cat-section tier-' + k + '">' +
          '<div class="cat-section-head">' +
            '<div class="row"><span class="tier-pill">' + CATS[k].label + '</span><span class="hint">' + active + ' activas · ' + CATS[k].points + ' pts c/u</span></div>' +
            '<button class="btn btn-sm" type="button" data-action="new-q" data-cat="' + k + '">+ Agregar pregunta</button>' +
          '</div>' +
          '<div class="q-list">' +
            (isNew ? questionForm(null, k) : '') +
            (list.length ? list.map(questionItem).join('') : '<p class="hint">No hay preguntas en este nivel.</p>') +
          '</div>' +
        '</section>'
      );
    }).join('');

    body.innerHTML =
      '<div class="stack">' +
        '<p class="hint">Tocá el lápiz para editar. Los cambios se aplican al instante en el juego. Cambiar la respuesta correcta no recalcula los puntos que ya se otorgaron. Para sacar una pregunta del juego sin perder el historial, desactivala.</p>' +
        sections +
      '</div>';
  }

  function onSaveQuestion(form) {
    var id = form.dataset.id;
    var correctInput = form.querySelector('input[name="correct"]:checked');
    var payload = {
      category: form.category.value,
      text: form.text.value,
      options: [0, 1, 2, 3].map(function (i) { return form['opt' + i].value; }),
      correct: correctInput ? Number(correctInput.value) : -1,
      isActive: form.isActive.checked
    };
    var btn = form.querySelector('button[type="submit"]');
    var req = id
      ? api('PUT', '/api/admin/questions/' + id, payload, { admin: true })
      : api('POST', '/api/admin/questions', payload, { admin: true });

    withBusy(btn, req)
      .then(function (data) {
        var saved = data.question;
        var idx = state.adminQuestions.findIndex(function (q) { return q.id === saved.id; });
        if (idx >= 0) state.adminQuestions[idx] = saved;
        else state.adminQuestions.push(saved);
        state.editing = null;
        paintAdminQuestions();
        toast(id ? 'Pregunta actualizada' : 'Pregunta agregada');
      })
      .catch(function (err) {
        if (err.code === 'ADMIN_REQUIRED') return handleAdminError(err);
        toast(err.message, true);
      });
  }

  // ---------- Jugadores ----------
  function loadAdminPlayers() {
    return api('GET', '/api/admin/players', undefined, { admin: true })
      .then(function (data) {
        state.adminPlayers = data.players;
        paintAdminPlayers();
      })
      .catch(handleAdminError);
  }

  function paintAdminPlayers() {
    var body = adminBody();
    if (!body) return;
    var players = state.adminPlayers;
    var rows = players.map(function (p) {
      return (
        '<tr>' +
          '<td>' + esc(p.name) + (p.isAdmin ? ' <span class="badge">admin</span>' : '') + '</td>' +
          '<td class="email">' + esc(p.email) + '</td>' +
          '<td class="num">' + p.score + '</td>' +
          '<td class="num">' + p.correct + '/' + p.answered + '</td>' +
          '<td class="num"><button class="btn btn-sm btn-danger" type="button" data-action="delete-player" data-id="' + p.id + '">Eliminar</button></td>' +
        '</tr>'
      );
    }).join('');

    body.innerHTML =
      '<div class="stack">' +
        '<div class="row" style="justify-content:space-between">' +
          '<p class="hint">' + players.length + ' registros. Eliminar a alguien borra su puntaje y libera su mail para que pueda volver a jugar (útil si se le cerró la sesión o puso un nombre inapropiado).</p>' +
          '<button class="btn btn-sm" type="button" data-action="reload-players">Actualizar</button>' +
        '</div>' +
        (players.length
          ? '<div class="table-wrap"><table class="data"><thead><tr><th>Nombre</th><th>Mail</th><th class="num">Puntos</th><th class="num">Correctas</th><th class="num"></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<p class="board-empty">Todavía no hay jugadores.</p>') +
      '</div>';
  }

  // ---------- Evento ----------
  function renderAdminEvent() {
    var body = adminBody();
    if (!body) return;
    body.innerHTML =
      '<div class="stack">' +
        '<div class="panel stack" style="gap:14px">' +
          '<h2 class="h2">Partida de prueba</h2>' +
          '<p class="lead small">Jugá como admin: no necesitás un mail nuevo, podés repetir todas las veces que quieras y tus puntos no aparecen en la tabla.</p>' +
          '<div class="row"><button class="btn btn-primary" type="button" data-action="admin-play">Jugar como admin</button></div>' +
        '</div>' +
        '<div class="panel stack danger-zone" style="gap:14px">' +
          '<h2 class="h2">Reiniciar evento</h2>' +
          '<p class="lead small">Borra todos los jugadores, respuestas y puntajes. Las preguntas no se tocan. Escribí <b class="mono">REINICIAR</b> para confirmar.</p>' +
          '<form class="row" id="reset-form" novalidate>' +
            '<input class="input" id="reset-confirm" name="confirm" placeholder="REINICIAR" autocomplete="off" style="max-width:220px" />' +
            '<button class="btn btn-danger" type="submit">Borrar todos los puntajes</button>' +
          '</form>' +
        '</div>' +
        '<div class="row"><button class="btn btn-sm" type="button" data-action="admin-logout">Cerrar sesión de admin</button></div>' +
      '</div>';
  }

  function onReset(form) {
    var btn = form.querySelector('button[type="submit"]');
    withBusy(btn, api('POST', '/api/admin/reset', { confirm: form.confirm.value.trim() }, { admin: true }))
      .then(function () {
        state.adminPlayers = null;
        state.leaderboard = null;
        form.reset();
        toast('Se borraron todos los puntajes');
      })
      .catch(function (err) {
        if (err.code === 'ADMIN_REQUIRED') return handleAdminError(err);
        toast(err.message, true);
      });
  }

  // -------------------------------------------------------------------------
  // Acciones (delegación de eventos)
  // -------------------------------------------------------------------------
  var actions = {
    retry: function () { render(); },

    pick: function (btn) {
      withBusy(btn, api('POST', '/api/play/next', { category: btn.dataset.cat }))
        .then(function (data) {
          state.question = data.question;
          state.selected = null;
          state.result = null;
          if (data.resumed) toast('Tenías esta pregunta abierta: respondela para seguir.');
          renderQuestion();
        })
        .catch(function (err) {
          toast(err.message, true);
          state.me = null;
          renderPlay();
        });
    },

    select: function (btn) {
      if (state.result) return;
      state.selected = Number(btn.dataset.i);
      renderQuestion();
    },

    confirm: function (btn) {
      if (state.selected === null || state.result) return;
      withBusy(btn, api('POST', '/api/play/answer', { questionId: state.question.id, selected: state.selected }))
        .then(function (data) {
          state.result = { correct: data.correct, correctOption: data.correctOption, selected: data.selected, points: data.points };
          state.me = { player: data.player, rank: data.rank, totalPlayers: data.totalPlayers, categories: data.categories, pending: data.pending, finished: data.finished };
          renderQuestion();
        })
        .catch(function (err) {
          toast(err.message, true);
          if (err.code === 'ALREADY_ANSWERED' || err.code === 'NOT_SERVED' || err.status === 401) {
            if (err.status === 401) clearPlayer();
            state.me = null;
            state.question = null;
            renderPlay();
          }
        });
    },

    'continue': function () {
      state.question = null;
      state.selected = null;
      state.result = null;
      renderPlay();
    },

    leave: function (btn) {
      var isAdmin = state.me && state.me.player.isAdmin;
      if (!armed(btn, isAdmin ? '¿Terminar? Tocá de nuevo' : '¿Salir? Con este mail no vas a poder volver')) return;
      clearPlayer();
      if (isAdmin) {
        location.hash = '#/admin';
        state.adminTab = 'evento';
      }
      render();
    },

    'next-player': function () {
      clearPlayer();
      setAdminPlay(false);
      renderPlay();
    },

    'admin-replay': function () {
      clearPlayer();
      setAdminPlay(true);
      renderPlay();
    },

    'cancel-admin-play': function () {
      setAdminPlay(false);
      location.hash = '#/admin';
      render();
    },

    fullscreen: function () {
      var root = document.getElementById('board-root');
      if (!root) return;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (root.requestFullscreen) root.requestFullscreen().catch(function () { toast('Tu navegador no permite pantalla completa.', true); });
    },

    'admin-tab': function (btn) {
      state.adminTab = btn.dataset.tab;
      state.editing = null;
      renderAdmin();
    },

    'edit-q': function (btn) {
      state.editing = Number(btn.dataset.id);
      paintAdminQuestions();
      var form = view.querySelector('form[data-form="question"]');
      if (form) {
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        form.text.focus();
      }
    },

    'new-q': function (btn) {
      state.editing = 'new:' + btn.dataset.cat;
      paintAdminQuestions();
      var form = view.querySelector('form[data-form="question"]');
      if (form) form.text.focus();
    },

    'cancel-edit': function () {
      state.editing = null;
      paintAdminQuestions();
    },

    'reload-players': function (btn) { withBusy(btn, loadAdminPlayers()); },

    'delete-player': function (btn) {
      if (!armed(btn, '¿Seguro? Tocá de nuevo')) return;
      withBusy(btn, api('DELETE', '/api/admin/players/' + btn.dataset.id, undefined, { admin: true }))
        .then(function () {
          toast('Jugador eliminado');
          return loadAdminPlayers();
        })
        .catch(function (err) {
          if (err.code === 'ADMIN_REQUIRED') return handleAdminError(err);
          toast(err.message, true);
        });
    },

    'admin-play': function () {
      clearPlayer();
      setAdminPlay(true);
      location.hash = '#/jugar';
    },

    'admin-logout': function () {
      setAdminToken(null);
      setAdminPlay(false);
      state.adminQuestions = null;
      state.adminPlayers = null;
      toast('Sesión de admin cerrada');
      renderAdmin();
    }
  };

  view.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || !view.contains(el) || el.disabled) return;
    var fn = actions[el.dataset.action];
    if (fn) fn(el, e);
  });

  view.addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    if (form.id === 'register-form') return onRegister(form);
    if (form.id === 'admin-login') return onAdminLogin(form);
    if (form.id === 'reset-form') return onReset(form);
    if (form.dataset.form === 'question') return onSaveQuestion(form);
  });

  view.addEventListener('change', function (e) {
    if (e.target.name === 'correct') {
      var form = e.target.form;
      Array.prototype.forEach.call(form.querySelectorAll('.radio'), function (label) {
        label.classList.toggle('checked', label.querySelector('input').checked);
      });
    }
  });

  window.addEventListener('hashchange', render);
  render();
  refreshServedBy();
  setInterval(refreshServedBy, BOARD_REFRESH_MS);
})();
