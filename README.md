# Trivia AWS Builders

Trivia por niveles con tabla de puntuación en vivo, panel de admin para editar preguntas y MySQL para guardar jugadores y puntajes. Pensado para correr en **Amazon ECS (Fargate)** con dos servicios: uno para la app y otro para MySQL.

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
trivia-aws/
├── app/
│   ├── Dockerfile
│   ├── package.json / package-lock.json
│   ├── db/schema.sql          ← tablas (la app las crea sola al arrancar)
│   ├── src/server.js          ← API Express
│   ├── src/db.js              ← conexión, reintentos y migración
│   ├── src/seed-questions.js  ← las 15 preguntas iniciales
│   └── public/                ← frontend (HTML/CSS/JS, sin build)
├── ecs/
│   ├── task-def-mysql.json
│   ├── task-def-app.json
│   ├── service-mysql.json
│   └── service-app.json
├── docker-compose.yml         ← para probar local
└── .env.example
```

La app crea las tablas y carga las 15 preguntas la primera vez que arranca (solo si la tabla de preguntas está vacía). El contenedor de MySQL usa la **imagen oficial sin modificar**.

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
| `DB_HOST` | Host de MySQL | `mysql` (alias de Service Connect) |
| `DB_PORT` | Puerto | `3306` |
| `DB_NAME` / `DB_USER` | Base y usuario | `trivia` |
| `DB_PASSWORD` | Contraseña del usuario | (Secrets Manager) |
| `ADMIN_PASSWORD` | Contraseña del panel de admin | (Secrets Manager) |
| `TOKEN_SECRET` | Firma las sesiones de admin. **Tiene que ser el mismo en todas las tasks.** | `openssl rand -hex 32` |
| `PORT` | Puerto HTTP | `8080` |

---

## Despliegue en ECS (Fargate)

Arquitectura:

```
Internet → ALB (:80/:443) → servicio trivia-app (2 tasks, :8080)
                                   │  Service Connect "mysql:3306"
                                   ▼
                          servicio trivia-mysql (1 task) → EFS (/var/lib/mysql)
```

En los JSON de `ecs/` reemplazá los `<PLACEHOLDERS>` (cuenta, región, subnets, security groups, EFS, ARNs de secretos y target group).

### 1. Imagen de la app en ECR

```bash
aws ecr create-repository --repository-name trivia-aws
aws ecr get-login-password | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com
docker build -t trivia-aws ./app
docker tag trivia-aws:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/trivia-aws:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/trivia-aws:latest
```

> Si vas a buildear en una Mac con chip M, usá `docker build --platform linux/amd64 ...` (las task definitions están en `X86_64`).

### 2. Secretos (Secrets Manager)

```bash
aws secretsmanager create-secret --name trivia/db \
  --secret-string '{"root_password":"<ROOT_PASS>","password":"<DB_PASS>"}'
aws secretsmanager create-secret --name trivia/app \
  --secret-string "{\"admin_password\":\"<ADMIN_PASS>\",\"token_secret\":\"$(openssl rand -hex 32)\"}"
```

Copiá los ARN completos (terminan en `-XXXXXX`) a las task definitions. El rol `ecsTaskExecutionRole` necesita `secretsmanager:GetSecretValue` sobre esos secretos.

### 3. Almacenamiento para MySQL (EFS)

**Importante:** sin un volumen persistente, si la task de MySQL se reinicia se pierden todos los puntajes. Por eso MySQL monta EFS.

```bash
aws efs create-file-system --encrypted --tags Key=Name,Value=trivia-mysql
# Mount target en cada subnet privada, con un SG que acepte 2049 desde <SG_MYSQL>
aws efs create-mount-target --file-system-id <EFS_ID> --subnet-id <PRIVATE_SUBNET_1> --security-groups <SG_EFS>
aws efs create-mount-target --file-system-id <EFS_ID> --subnet-id <PRIVATE_SUBNET_2> --security-groups <SG_EFS>
# Access point con el usuario de MySQL de la imagen oficial (uid/gid 999)
aws efs create-access-point --file-system-id <EFS_ID> \
  --posix-user Uid=999,Gid=999 \
  --root-directory 'Path=/mysql,CreationInfo={OwnerUid=999,OwnerGid=999,Permissions=750}'
```

### 4. Security groups

| SG | Entrada |
|---|---|
| `SG_ALB` | 80/443 desde Internet |
| `SG_APP` | 8080 desde `SG_ALB` |
| `SG_MYSQL` | 3306 desde `SG_APP` |
| `SG_EFS` | 2049 desde `SG_MYSQL` |

Las tasks van en subnets privadas: necesitan NAT Gateway (o VPC endpoints de ECR, Secrets Manager, CloudWatch Logs y S3) para bajar imágenes y leer secretos.

### 5. Cluster, namespace y task definitions

```bash
aws ecs create-cluster --cluster-name trivia \
  --service-connect-defaults namespace=trivia.local
aws ecs register-task-definition --cli-input-json file://ecs/task-def-mysql.json
aws ecs register-task-definition --cli-input-json file://ecs/task-def-app.json
```

### 6. ALB y target group

- Target group tipo **IP**, protocolo HTTP, puerto **8080**.
- Health check path: **`/api/health`** (devuelve 200 solo si la app llega a MySQL).
- Listener del ALB → ese target group. Copiá su ARN a `ecs/service-app.json`.

### 7. Servicios (primero MySQL)

```bash
aws ecs create-service --cli-input-json file://ecs/service-mysql.json
# esperá a que la task de MySQL esté RUNNING y healthy
aws ecs create-service --cli-input-json file://ecs/service-app.json
```

La app reintenta conectarse a MySQL durante ~2 minutos al arrancar, así que si arranca antes no pasa nada.

### Notas de operación

- **MySQL siempre con 1 sola task.** `service-mysql.json` usa `minimumHealthyPercent: 0` y `maximumPercent: 100` para que en un deploy nunca haya dos MySQL escribiendo sobre el mismo EFS. Por eso un redeploy de MySQL tiene unos segundos de corte.
- La **app sí escala horizontalmente** (es stateless: las sesiones viven en MySQL, no en memoria). Por eso `TOKEN_SECRET` tiene que ser el mismo en todas las tasks.
- Para un evento corto, MySQL en contenedor + EFS alcanza. Si esto pasa a uso permanente, conviene migrar la base a **Amazon RDS for MySQL** (backups automáticos, Multi-AZ): solo cambia `DB_HOST`, la app no necesita cambios.
- Logs en CloudWatch, grupo `/ecs/trivia`.

### Actualizar la app

```bash
docker build -t trivia-aws ./app && docker tag ... && docker push ...
aws ecs update-service --cluster trivia --service trivia-app --force-new-deployment
```

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
| `GET` | `/api/health` | health check del ALB / ECS |

---

## Límites a tener en cuenta

- El mail **no se verifica** con un código: se valida el formato y que no se repita. Alguien podría inventar un mail que no existe para jugar dos veces. Si hace falta verificación real, el siguiente paso es mandar un código por **Amazon SES** antes de habilitar la partida.
- La sesión del jugador se guarda en el navegador. Si alguien borra los datos del navegador a mitad de partida, no puede volver a entrar con el mismo mail: un admin lo elimina desde **Jugadores** y vuelve a empezar.
- Cambiar la respuesta correcta de una pregunta no recalcula los puntos ya otorgados.
