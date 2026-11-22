// Esquema do banco do DIGITAL ISP (SQLite local e Postgres em produção). Banco novo: sem migrações de versões antigas.
// A base (acesso, revendas, planos, auditoria, domínios) veio do NEXA Broadcast c51d2469 já na forma final; as telas e a TV
// Corporativa entram pelos módulos de cada uma. Mudanças no banco de produção: só aditivas.
import { funcionalidadesDDL, FUNCIONALIDADES_PG_MIGRATE } from './schema-funcionalidades.js';
import { telasDDL, telasPgMigrate, TELAS_LATE_INDEXES } from './schema-telas.js';
import { tvcorpDDL } from './schema-tvcorp.js';
import { tvcorpDadosDDL } from './schema-tvcorp-dados.js';
import { digitalDDL } from './schema-digital.js';

export const BASE_TABLES = Object.freeze(["settings","tenants","plans","users","access_groups","user_groups","revoked_tokens","audit_log","domains"]);

const sqliteBase = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tenants (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'trial',
  plan_id              INTEGER,
  contact_name         TEXT NOT NULL DEFAULT '',
  contact_email        TEXT NOT NULL DEFAULT '',
  notes                TEXT NOT NULL DEFAULT '',
  trial_ends_at        INTEGER,
  current_period_end   INTEGER,
  grace_until          INTEGER,
  gateway              TEXT,
  gateway_customer     TEXT,
  gateway_subscription TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  document             TEXT,
  document_type        TEXT,
  phone                TEXT NOT NULL DEFAULT '',
  address              TEXT,
  accept_global_content INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price_cents  INTEGER NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'brl',
  interval     TEXT NOT NULL DEFAULT 'month',
  trial_days   INTEGER NOT NULL DEFAULT 0,
  limits       TEXT NOT NULL DEFAULT '{}',
  features     TEXT NOT NULL DEFAULT '{}',
  active       INTEGER NOT NULL DEFAULT 1,
  public       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0,
  gateway_refs TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL
, profile_id INTEGER);
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
  created_at    INTEGER NOT NULL,
  tenant_id     INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS access_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '[]',
  channels    TEXT,
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  tenant_id   INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS user_groups (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        TEXT PRIMARY KEY,
  user_id    INTEGER,
  exp        INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,
  user_id  INTEGER,
  username TEXT NOT NULL DEFAULT '',
  action   TEXT NOT NULL,
  detail   TEXT NOT NULL DEFAULT '',
  status   INTEGER,
  ip       TEXT NOT NULL DEFAULT '',
  tenant_id    INTEGER DEFAULT 1,
  impersonator TEXT
);
CREATE TABLE IF NOT EXISTS domains (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL,
  hostname      TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL DEFAULT 'viewer',
  status        TEXT NOT NULL DEFAULT 'pending',
  verify_token  TEXT NOT NULL,
  verified_at   INTEGER,
  last_check_at INTEGER,
  last_error    TEXT,
  created_at    INTEGER NOT NULL,
  cf_id         TEXT,
  warning       TEXT,
  mode          TEXT NOT NULL DEFAULT 'manual',
  include_www   INTEGER NOT NULL DEFAULT 0,
  cf_zone_id    TEXT,
  cf_status     TEXT,
  name_servers  TEXT,
  railway_status TEXT,
  railway_ids   TEXT,
  railway_verified INTEGER NOT NULL DEFAULT 0,
  provider_error TEXT,
  next_check_at INTEGER
);
`;
const sqliteBaseIndexes = `
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_domains_tenant ON domains(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_groups_tenant_name ON access_groups(COALESCE(tenant_id, 0), name);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens(exp);
`;
const pgBase = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS access_groups (
  id          BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '[]',
  channels    TEXT,
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  tenant_id   BIGINT DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  token_ver     INTEGER NOT NULL DEFAULT 0,
  must_change   INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  locked_until  BIGINT NOT NULL DEFAULT 0,
  last_login    BIGINT,
  created_at    BIGINT NOT NULL,
  tenant_id     BIGINT DEFAULT 1
);
CREATE TABLE IF NOT EXISTS user_groups (
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id       BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  ts       BIGINT NOT NULL,
  user_id  BIGINT,
  username TEXT NOT NULL DEFAULT '',
  action   TEXT NOT NULL,
  detail   TEXT NOT NULL DEFAULT '',
  status   INTEGER,
  ip       TEXT NOT NULL DEFAULT '',
  tenant_id    BIGINT DEFAULT 1,
  impersonator TEXT
);
CREATE TABLE IF NOT EXISTS plans (
  id           BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price_cents  BIGINT NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'brl',
  interval     TEXT NOT NULL DEFAULT 'month',
  trial_days   INTEGER NOT NULL DEFAULT 0,
  limits       TEXT NOT NULL DEFAULT '{}',
  features     TEXT NOT NULL DEFAULT '{}',
  active       INTEGER NOT NULL DEFAULT 1,
  public       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0,
  gateway_refs TEXT NOT NULL DEFAULT '{}',
  created_at   BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenants (
  id                   BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'trial',
  plan_id              BIGINT,
  contact_name         TEXT NOT NULL DEFAULT '',
  contact_email        TEXT NOT NULL DEFAULT '',
  notes                TEXT NOT NULL DEFAULT '',
  trial_ends_at        BIGINT,
  current_period_end   BIGINT,
  grace_until          BIGINT,
  gateway              TEXT,
  gateway_customer     TEXT,
  gateway_subscription TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at           BIGINT NOT NULL,
  updated_at           BIGINT NOT NULL,
  document             TEXT,
  document_type        TEXT,
  phone                TEXT NOT NULL DEFAULT '',
  address              TEXT,
  accept_global_content INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS domains (
  id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  tenant_id     BIGINT NOT NULL,
  hostname      TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL DEFAULT 'viewer',
  status        TEXT NOT NULL DEFAULT 'pending',
  verify_token  TEXT NOT NULL,
  verified_at   BIGINT,
  last_check_at BIGINT,
  last_error    TEXT,
  created_at    BIGINT NOT NULL,
  cf_id         TEXT,
  warning       TEXT,
  mode          TEXT NOT NULL DEFAULT 'manual',
  include_www   INTEGER NOT NULL DEFAULT 0,
  cf_zone_id    TEXT,
  cf_status     TEXT,
  name_servers  TEXT,
  railway_status TEXT,
  railway_ids   TEXT,
  railway_verified INTEGER NOT NULL DEFAULT 0,
  provider_error TEXT,
  next_check_at BIGINT
);
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        TEXT PRIMARY KEY,
  user_id    BIGINT,
  exp        BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
`;
const pgBaseMigrate = `
ALTER TABLE access_groups ADD COLUMN IF NOT EXISTS tenant_id BIGINT DEFAULT 1;
ALTER TABLE users         ADD COLUMN IF NOT EXISTS tenant_id BIGINT DEFAULT 1;
ALTER TABLE audit_log     ADD COLUMN IF NOT EXISTS tenant_id BIGINT DEFAULT 1;
ALTER TABLE audit_log     ADD COLUMN IF NOT EXISTS impersonator TEXT;
ALTER TABLE tenants       ADD COLUMN IF NOT EXISTS document TEXT;
ALTER TABLE tenants       ADD COLUMN IF NOT EXISTS document_type TEXT;
ALTER TABLE tenants       ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants       ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE tenants       ADD COLUMN IF NOT EXISTS accept_global_content INTEGER NOT NULL DEFAULT 1;
ALTER TABLE domains       ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE domains       ADD COLUMN IF NOT EXISTS include_www INTEGER NOT NULL DEFAULT 0;
ALTER TABLE domains       ADD COLUMN IF NOT EXISTS cf_zone_id TEXT;
ALTER TABLE domains       ADD COLUMN IF NOT EXISTS cf_status TEXT;
ALTER TABLE domains       ADD COLUMN IF NOT EXISTS name_servers TEXT;
ALTER TABLE domains       ADD COLUMN IF NOT EXISTS railway_status TEXT;
ALTER TABLE domains       ADD COLUMN IF NOT EXISTS railway_ids TEXT;
ALTER TABLE domains       ADD COLUMN IF NOT EXISTS railway_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE domains       ADD COLUMN IF NOT EXISTS provider_error TEXT;
ALTER TABLE domains       ADD COLUMN IF NOT EXISTS next_check_at BIGINT;
ALTER TABLE plans         ADD COLUMN IF NOT EXISTS profile_id BIGINT;
`;
const pgBaseIndexes = `
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_domains_tenant ON domains(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_groups_tenant_name ON access_groups(COALESCE(tenant_id, 0), name);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens(exp);
`;

export const sqliteDDL = `${sqliteBase}
${funcionalidadesDDL('sqlite')}
${telasDDL('sqlite')}
${tvcorpDDL('sqlite')}
${tvcorpDadosDDL('sqlite')}
${digitalDDL('sqlite')}
`;
export const sqliteIndexes = `${sqliteBaseIndexes}
${TELAS_LATE_INDEXES}
`;
export const pgDDL = `${pgBase}
${funcionalidadesDDL('pg')}
${telasDDL('pg')}
${tvcorpDDL('pg')}
${tvcorpDadosDDL('pg')}
${digitalDDL('pg')}
`;
export const pgMigrate = `${pgBaseMigrate}
${FUNCIONALIDADES_PG_MIGRATE}
${telasPgMigrate}
`;
export const pgIndexes = `${pgBaseIndexes}
${TELAS_LATE_INDEXES}
`;
