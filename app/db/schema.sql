-- Esquema de la Trivia AWS.
-- La app lo ejecuta sola al arrancar (CREATE TABLE IF NOT EXISTS), así que el
-- contenedor de MySQL puede ser la imagen oficial sin nada extra.
-- Las sentencias se separan por ";" al final de línea.

CREATE TABLE IF NOT EXISTS questions (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category        ENUM('principiante','intermedio','avanzado') NOT NULL,
  text            TEXT NOT NULL,
  option_a        VARCHAR(500) NOT NULL,
  option_b        VARCHAR(500) NOT NULL,
  option_c        VARCHAR(500) NOT NULL,
  option_d        VARCHAR(500) NOT NULL,
  correct_option  TINYINT UNSIGNED NOT NULL,          -- 0 = A, 1 = B, 2 = C, 3 = D
  is_active       TINYINT(1) NOT NULL DEFAULT 1,      -- borrar = desactivar (se conserva el historial)
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_questions_category (category, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS players (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name             VARCHAR(40) NOT NULL,
  email            VARCHAR(254) NOT NULL,
  -- Mail normalizado (minúsculas, sin +alias, sin puntos en Gmail).
  -- UNIQUE = cada mail juega una sola vez. Las partidas de admin lo dejan en NULL
  -- (MySQL permite varios NULL en un índice UNIQUE), por eso pueden repetir.
  email_normalized VARCHAR(254) NULL,
  is_admin         TINYINT(1) NOT NULL DEFAULT 0,
  token_hash       CHAR(64) NOT NULL,
  score            INT NOT NULL DEFAULT 0,
  correct_count    INT NOT NULL DEFAULT 0,
  answered_count   INT NOT NULL DEFAULT 0,
  last_scored_at   TIMESTAMP(3) NULL DEFAULT NULL,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_players_email (email_normalized),
  UNIQUE KEY uq_players_token (token_hash),
  KEY idx_players_ranking (is_admin, score, last_scored_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_answers (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id        INT UNSIGNED NOT NULL,
  question_id      INT UNSIGNED NOT NULL,
  served_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  answered_at      TIMESTAMP(3) NULL DEFAULT NULL,
  selected_option  TINYINT UNSIGNED NULL,
  is_correct       TINYINT(1) NULL,
  points           INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  -- Cada jugador recibe cada pregunta una única vez.
  UNIQUE KEY uq_player_question (player_id, question_id),
  KEY idx_answers_pending (player_id, answered_at),
  CONSTRAINT fk_answers_player   FOREIGN KEY (player_id)   REFERENCES players(id)   ON DELETE CASCADE,
  CONSTRAINT fk_answers_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
