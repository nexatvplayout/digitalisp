// Esquema ANTERIOR a multi-tenancy (copia congelada), usado pelos testes de migracao de bancos antigos.
export const legacySqliteDDL = `
CREATE TABLE IF NOT EXISTS channels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  tagline    TEXT NOT NULL DEFAULT '',
  number     INTEGER NOT NULL DEFAULT 1,
  epoch      INTEGER NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  filename      TEXT NOT NULL UNIQUE,
  original_name TEXT,
  kind          TEXT NOT NULL DEFAULT 'program',
  duration      REAL NOT NULL DEFAULT 0,
  size          INTEGER NOT NULL DEFAULT 0,
  width         INTEGER,
  height        INTEGER,
  vcodec        TEXT,
  acodec        TEXT,
  thumb         TEXT,
  gain_db       REAL NOT NULL DEFAULT 0,
  loudness      TEXT,
  source_url    TEXT,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL DEFAULT 1,
  position   INTEGER NOT NULL,
  media_id   INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS break_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL DEFAULT 1,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('after_programs','after_minutes')),
  value      INTEGER NOT NULL CHECK (value > 0),
  media_ids  TEXT NOT NULL DEFAULT '[]',
  enabled    INTEGER NOT NULL DEFAULT 1,
  signal     INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS outputs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  protocol   TEXT NOT NULL,
  url        TEXT NOT NULL DEFAULT '',
  enabled    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ingests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  key        TEXT NOT NULL UNIQUE,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  image       TEXT,
  cta         TEXT NOT NULL DEFAULT 'Ver produto',
  clicks      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS product_cues (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id   INTEGER NOT NULL,
  media_id     INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  offset_sec   REAL NOT NULL,
  duration_sec REAL NOT NULL,
  mode         TEXT NOT NULL DEFAULT 'both',
  position     TEXT NOT NULL DEFAULT 'br',
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS channel_state (
  channel_id     INTEGER PRIMARY KEY,
  epoch          INTEGER NOT NULL,
  cycle_duration REAL NOT NULL DEFAULT 0,
  media_id       INTEGER,
  title          TEXT,
  slot_index     INTEGER,
  position       REAL,
  transport      TEXT,
  updated_at     INTEGER NOT NULL,
  schedule_json  TEXT
);
CREATE TABLE IF NOT EXISTS as_run (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL DEFAULT 1,
  media_id   INTEGER,
  title      TEXT NOT NULL,
  kind       TEXT,
  duration   REAL,
  started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL DEFAULT 1,
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  hue        INTEGER NOT NULL DEFAULT 0,
  product_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '[]',
  channels    TEXT,
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  token_ver     INTEGER NOT NULL DEFAULT 0,
  must_change   INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER NOT NULL DEFAULT 0,
  last_login    INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_groups (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,
  user_id  INTEGER,
  username TEXT NOT NULL DEFAULT '',
  action   TEXT NOT NULL,
  detail   TEXT NOT NULL DEFAULT '',
  status   INTEGER,
  ip       TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER,
  product_name TEXT NOT NULL,
  price        TEXT NOT NULL DEFAULT '',
  qty          INTEGER NOT NULL DEFAULT 1,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  channel_slug TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'new',
  device       TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS polls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  question   TEXT NOT NULL,
  options    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  closed_at  INTEGER
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  voter      TEXT NOT NULL,
  option     INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, voter)
);
`;

const ID = 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY';
export const legacyPgDDL = `
CREATE TABLE IF NOT EXISTS channels (
  id         ${ID},
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  tagline    TEXT NOT NULL DEFAULT '',
  number     INTEGER NOT NULL DEFAULT 1,
  epoch      BIGINT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id            ${ID},
  title         TEXT NOT NULL,
  filename      TEXT NOT NULL UNIQUE,
  original_name TEXT,
  kind          TEXT NOT NULL DEFAULT 'program',
  duration      DOUBLE PRECISION NOT NULL DEFAULT 0,
  size          BIGINT NOT NULL DEFAULT 0,
  width         INTEGER,
  height        INTEGER,
  vcodec        TEXT,
  acodec        TEXT,
  thumb         TEXT,
  gain_db       DOUBLE PRECISION NOT NULL DEFAULT 0,
  loudness      TEXT,
  source_url    TEXT,
  created_at    BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist (
  id         ${ID},
  channel_id BIGINT NOT NULL DEFAULT 1,
  position   INTEGER NOT NULL,
  media_id   BIGINT NOT NULL REFERENCES media(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS break_rules (
  id         ${ID},
  channel_id BIGINT NOT NULL DEFAULT 1,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('after_programs','after_minutes')),
  value      INTEGER NOT NULL CHECK (value > 0),
  media_ids  TEXT NOT NULL DEFAULT '[]',
  enabled    INTEGER NOT NULL DEFAULT 1,
  signal     INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS outputs (
  id         ${ID},
  channel_id BIGINT NOT NULL,
  name       TEXT NOT NULL,
  protocol   TEXT NOT NULL,
  url        TEXT NOT NULL DEFAULT '',
  enabled    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ingests (
  id         ${ID},
  name       TEXT NOT NULL,
  key        TEXT NOT NULL UNIQUE,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id          ${ID},
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  image       TEXT,
  cta         TEXT NOT NULL DEFAULT 'Ver produto',
  clicks      BIGINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_cues (
  id           ${ID},
  channel_id   BIGINT NOT NULL,
  media_id     BIGINT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  product_id   BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  offset_sec   DOUBLE PRECISION NOT NULL,
  duration_sec DOUBLE PRECISION NOT NULL,
  mode         TEXT NOT NULL DEFAULT 'both',
  position     TEXT NOT NULL DEFAULT 'br',
  created_at   BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS channel_state (
  channel_id     BIGINT PRIMARY KEY,
  epoch          BIGINT NOT NULL,
  cycle_duration DOUBLE PRECISION NOT NULL DEFAULT 0,
  media_id       BIGINT,
  title          TEXT,
  slot_index     INTEGER,
  position       DOUBLE PRECISION,
  transport      TEXT,
  updated_at     BIGINT NOT NULL,
  schedule_json  TEXT
);
CREATE TABLE IF NOT EXISTS as_run (
  id         ${ID},
  channel_id BIGINT NOT NULL DEFAULT 1,
  media_id   BIGINT,
  title      TEXT NOT NULL,
  kind       TEXT,
  duration   DOUBLE PRECISION,
  started_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat (
  id         ${ID},
  channel_id BIGINT NOT NULL DEFAULT 1,
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  hue        INTEGER NOT NULL DEFAULT 0,
  product_id BIGINT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS access_groups (
  id          ${ID},
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '[]',
  channels    TEXT,
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id            ${ID},
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  token_ver     INTEGER NOT NULL DEFAULT 0,
  must_change   INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  locked_until  BIGINT NOT NULL DEFAULT 0,
  last_login    BIGINT,
  created_at    BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_groups (
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id       ${ID},
  ts       BIGINT NOT NULL,
  user_id  BIGINT,
  username TEXT NOT NULL DEFAULT '',
  action   TEXT NOT NULL,
  detail   TEXT NOT NULL DEFAULT '',
  status   INTEGER,
  ip       TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS orders (
  id           ${ID},
  product_id   BIGINT,
  product_name TEXT NOT NULL,
  price        TEXT NOT NULL DEFAULT '',
  qty          INTEGER NOT NULL DEFAULT 1,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  channel_slug TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'new',
  device       TEXT NOT NULL DEFAULT '',
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS polls (
  id         ${ID},
  channel_id BIGINT NOT NULL,
  question   TEXT NOT NULL,
  options    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL,
  closed_at  BIGINT
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id    BIGINT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  voter      TEXT NOT NULL,
  option     INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (poll_id, voter)
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, id);
CREATE INDEX IF NOT EXISTS idx_polls_ch ON polls(channel_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(id);
CREATE INDEX IF NOT EXISTS idx_playlist_ch ON playlist(channel_id, position);
CREATE INDEX IF NOT EXISTS idx_asrun_ch ON as_run(channel_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_ch ON chat(channel_id, id);
CREATE INDEX IF NOT EXISTS idx_cues_ch ON product_cues(channel_id, media_id);
`;

