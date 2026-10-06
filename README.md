# Trivia AWS Builders

Trivia por niveles con tabla de puntuación en vivo, panel de admin para editar preguntas y MySQL para guardar jugadores y puntajes. Corre en **Amazon ECS sobre EC2** detrás de un ALB, con la infraestructura en Terraform: [`charla_aws_terraform`](https://github.com/luccamedina82/charla_aws_terraform). Sitio: `https://charla.tekforge.site`.

AWS Student Builder Group at UTN FRC.

---

## Qué hace

**Jugadores**

- Al entrar ponen **nombre** y **mail**. El nombre aparece en la tabla; el mail no se muestra.
- **Cada mail juega una sola vez.** El mail se normaliza antes de guardarlo (minúsculas, sin `+alias`, sin puntos en Gmail), así que `Juan.Perez+2@Gmail.com` y `juanperez@gmail.com` cuentan como el mismo.
- Eligen un nivel y reciben una pregunta al azar que todavía no respondieron. **Cada pregunta se responde una única vez.**
- Si recargan la página con una pregunta abierta, les vuelve a salir la misma: no se puede "saltear" una pregunta difícil.
- Puntos: Principiante 100, Intermedio 200, Avanzado 300 (solo si aciertan).
- Las respuestas correctas **nunca se mandan al navegador** antes de responder: se validan en el servidor.

**Tabla de puntuación** (`/#/tabla`)

- Se actualiza sola cada 5 segundos. Tiene botón de **pantalla completa** para proyectarla.
- Orden: más puntos primero; si hay empate, gana quien llegó antes a ese puntaje.

**Admin** (`/#/admin`, el lápiz de arriba a la derecha)

- Login con contraseña (`ADMIN_PASSWORD`).
- **Preguntas:** el lápiz de cada pregunta abre el editor (texto, 4 opciones, cuál es la correcta, nivel, activa/inactiva). También se pueden agregar nuevas. Los cambios se aplican al instante.
- **Jugadores:** lista con mails y puntajes. Eliminar a alguien borra su puntaje y libera su mail (sirve si a alguien se le cerró la sesión o puso un nombre inapropiado).
- **Evento:** "Jugar como admin" (sin límite de partidas, no aparece en la tabla) y "Reiniciar evento" (borra todos los jugadores y puntajes; las preguntas quedan).

---

## Estructura

```
charla_aws_app/
├── buildspec.yml              ← build de CodeBuild (lo dispara un push a main)
├── app/
│   ├── Dockerfile
│   ├── package.json / package-lock.json
│   ├── db/schema.sql          ← tablas (la app las crea sola al arrancar)
│   ├── src/server.js          ← API Express
│   ├── src/db.js              ← conexión, reintentos y migración
│   ├── src/seed-questions.js  ← las 15 preguntas iniciales
│   └── public/                ← frontend (HTML/CSS/JS, sin build)
├── docker-compose.yml         ← para probar local
└── .env.example
```

La app crea las tablas y carga las 15 preguntas la primera vez que arranca (solo si la tabla de preguntas está vacía). La carga va con `GET_LOCK`: si dos tasks arrancan a la vez, solo una inserta. El contenedor de MySQL usa la **imagen oficial sin modificar**.

Las task definitions y los servicios de ECS **no viven acá**: los crea Terraform y después el pipeline registra revisiones nuevas de la task definition del frontend.

---

## Probar en tu máquina

```bash
cp .env.example .env        # cambiá las contraseñas
docker compose up --build
```

Abrí http://localhost:8080. El panel de admin usa la contraseña que pusiste en `ADMIN_PASSWORD`.

---

## Variables de entorno de la app

| Variable | Para qué | Ejemplo |
|---|---|---|
| `DB_HOST` | Host de MySQL | `mysql.lab3.local` (Cloud Map, nunca una IP) |
| `DB_PORT` | Puerto | `3306` |
| `DB_NAME` / `DB_USER` | Base y usuario | `trivia` |
| `DB_PASSWORD` | Contraseña del usuario | (SSM Parameter Store) |
| `ADMIN_PASSWORD` | Contraseña del panel de admin | (SSM Parameter Store) |
| `TOKEN_SECRET` | Firma las sesiones de admin. **Tiene que ser el mismo en todas las tasks.** | (SSM Parameter Store) |
| `PORT` | Puerto HTTP | `8080` |
| `APP_VERSION` | Versión que muestra el pie de página. La fija el build (`--build-arg`) | hash corto del commit |

En AWS todas las de la base y los secretos llegan desde **SSM Parameter Store** por el bloque `secrets` de la task definition. Terraform genera las contraseñas al azar. Para leer la del panel de admin después de un `apply`:

```bash
aws ssm get-parameter --name /lab3/dev/app/admin_password --with-decryption \
  --query Parameter.Value --output text --profile lab3
```

---

## Despliegue en AWS

```
Internet → ALB (:443, :80 redirige) → servicio frontend (2 tasks, :8080, una por AZ)
                                           │  DB_HOST = mysql.lab3.local (Cloud Map)
                                           ▼
                                  servicio mysql (1 task) → EFS (/var/lib/mysql)
```

La infraestructura entera (red, cluster ECS sobre EC2, ALB, HTTPS, EFS, SSM, ECR y el pipeline) está en [`charla_aws_terraform`](https://github.com/luccamedina82/charla_aws_terraform). Los pasos para levantarla están en su `docs/runbook.md`.

### Pipeline

Cada push a `main` dispara CodePipeline:

1. **Source**: este repo, vía CodeStar Connection.
2. **Build**: CodeBuild corre `buildspec.yml`:
   - `node --check` sobre todos los `.js`. Si alguno tiene un error de sintaxis, el build se corta y el sitio sigue con la versión anterior.
   - `docker build ./app` con `APP_VERSION` = hash corto del commit.
   - Push a ECR con tag `AAAAMMDD-HHMMSS-<commit>` (UTC).
   - Genera `imagedefinitions.json` para el contenedor `frontend`.
3. **Deploy**: ECS registra una task definition nueva y hace **blue/green** detrás del ALB, con 2 minutos de bake antes de cortar la versión vieja.

### Comportamiento ante fallas

- **`/api/health` no toca la base.** Es el health check del ALB: si consultara MySQL, una caída de la base marcaría todas las tasks como unhealthy y ECS las mataría, convirtiendo una falla parcial en una caída total. Para ver el estado de la base está `/api/health/db`, que el ALB no usa.
- **La app escucha antes de conectar con la base.** La conexión y la migración corren en segundo plano, con reintentos sin límite. Una task que arranca con MySQL caído igual pasa el health check.
- **Con la base caída**, `/api` responde `503 DB_UNAVAILABLE`, el frontend muestra un aviso y reintenta solo cada 5 s. Cuando la base vuelve, todo se recupera sin recargar.
- **El pie de página muestra qué task respondió**, su AZ y la versión, con un color derivado del ID de la task. Sale de `/api/whoami`, que lee el metadata endpoint de ECS.

### Notas de operación

- **MySQL siempre con 1 sola task**, para que nunca haya dos escribiendo sobre el mismo EFS.
- La **app sí escala horizontalmente** (es stateless: las sesiones viven en MySQL, no en memoria). Por eso `TOKEN_SECRET` tiene que ser el mismo en todas las tasks.
- Para un evento corto, MySQL en contenedor + EFS alcanza. Si esto pasa a uso permanente, conviene migrar la base a **Amazon RDS for MySQL** (backups automáticos, Multi-AZ): solo cambia `DB_HOST`, la app no necesita cambios.

---

## API (referencia rápida)

| Método | Ruta | Quién |
|---|---|---|
| `POST` | `/api/players` `{name, email}` | público (con `X-Admin-Token` crea partida de admin) |
| `GET` | `/api/me` | jugador (`Authorization: Bearer <token>`) |
| `POST` | `/api/play/next` `{category}` | jugador |
| `POST` | `/api/play/answer` `{questionId, selected}` | jugador |
| `GET` | `/api/leaderboard` | público |
| `POST` | `/api/admin/login` `{password}` | público (rate limited) |
| `GET/POST` | `/api/admin/questions` | admin (`X-Admin-Token`) |
| `PUT` | `/api/admin/questions/:id` | admin |
| `GET` | `/api/admin/players` | admin |
| `DELETE` | `/api/admin/players/:id` | admin |
| `POST` | `/api/admin/reset` `{confirm:"REINICIAR"}` | admin |
| `GET` | `/api/health` | health check del ALB (no toca la base) |
| `GET` | `/api/health/db` | diagnóstico: 200 si la base responde, 503 si no |
| `GET` | `/api/whoami` | público: task, AZ y versión que respondieron |

---

## Límites a tener en cuenta

- El mail **no se verifica** con un código: se valida el formato y que no se repita. Alguien podría inventar un mail que no existe para jugar dos veces. Si hace falta verificación real, el siguiente paso es mandar un código por **Amazon SES** antes de habilitar la partida.
- La sesión del jugador se guarda en el navegador. Si alguien borra los datos del navegador a mitad de partida, no puede volver a entrar con el mismo mail: un admin lo elimina desde **Jugadores** y vuelve a empezar.
- Cambiar la respuesta correcta de una pregunta no recalcula los puntos ya otorgados.
