-- Madurai Bus — initial schema
-- Trusted contacts, favourites, offline cache and reminders are intentionally
-- NOT stored here: they live only on the user's device (IndexedDB).

CREATE TABLE operators (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL CHECK (type IN ('govt','private','minibus')),
  authority   TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_sample   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE data_sources (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('official','operator','public_record','field_survey','user_submission','sample')),
  url         TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX data_sources_name_uq ON data_sources (lower(name));

CREATE TABLE stops (
  id          SERIAL PRIMARY KEY,
  name_en     TEXT NOT NULL,
  name_ta     TEXT,
  aliases     TEXT[] NOT NULL DEFAULT '{}',
  lat         DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  lng         DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_sample   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stops_name_en_uq ON stops (lower(name_en));

CREATE TABLE routes (
  id                   SERIAL PRIMARY KEY,
  route_no             TEXT NOT NULL,
  operator_id          INT NOT NULL REFERENCES operators(id),
  bus_type             TEXT NOT NULL DEFAULT 'ordinary' CHECK (bus_type IN ('ordinary','express','deluxe','ac','mini')),
  origin_stop_id       INT NOT NULL REFERENCES stops(id),
  destination_stop_id  INT NOT NULL REFERENCES stops(id),
  color                TEXT NOT NULL DEFAULT '#1D9E75' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  status               TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified','unverified','outdated','sample')),
  source_id            INT REFERENCES data_sources(id),
  verified_at          DATE,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  is_sample            BOOLEAN NOT NULL DEFAULT FALSE,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (origin_stop_id <> destination_stop_id)
);
-- Duplicate detection: same number + operator + endpoints.
CREATE UNIQUE INDEX routes_dupe_uq ON routes (lower(route_no), operator_id, origin_stop_id, destination_stop_id);

CREATE TABLE route_stops (
  route_id     INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  seq          INT NOT NULL CHECK (seq >= 0),
  stop_id      INT NOT NULL REFERENCES stops(id),
  offset_min   INT CHECK (offset_min >= 0),       -- minutes from route start; NULL = unknown
  distance_km  NUMERIC(6,1) CHECK (distance_km >= 0),
  PRIMARY KEY (route_id, seq)
);
CREATE INDEX route_stops_stop_idx ON route_stops (stop_id);

-- One row per scheduled trip (departure from the route's first stop).
CREATE TABLE schedules (
  id              SERIAL PRIMARY KEY,
  route_id        INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  departure_time  TIME NOT NULL,
  days            SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',  -- ISO: 1=Mon … 7=Sun
  valid_from      DATE,
  valid_to        DATE
);
CREATE UNIQUE INDEX schedules_uq ON schedules (route_id, departure_time, days);

CREATE TABLE fares (
  id           SERIAL PRIMARY KEY,
  route_id     INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  from_stop_id INT NOT NULL REFERENCES stops(id),
  to_stop_id   INT NOT NULL REFERENCES stops(id),
  amount       NUMERIC(8,2) NOT NULL CHECK (amount >= 0),
  status       TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified','unverified','outdated','sample')),
  source_id    INT REFERENCES data_sources(id),
  verified_at  DATE,
  UNIQUE (route_id, from_stop_id, to_stop_id)
);

CREATE TABLE users (
  id               SERIAL PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('admin','editor')),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts  INT NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE verification_records (
  id           SERIAL PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('route','fare','alert')),
  entity_id    INT NOT NULL,
  status       TEXT NOT NULL,
  source_id    INT REFERENCES data_sources(id),
  verified_by  INT REFERENCES users(id),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX verification_entity_idx ON verification_records (entity_type, entity_id);

CREATE TABLE alerts (
  id                   SERIAL PRIMARY KEY,
  type                 TEXT NOT NULL CHECK (type IN ('cancellation','diversion','stop_change','road_closure','schedule_change')),
  title                TEXT NOT NULL,
  body                 TEXT,
  starts_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at              TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','archived')),
  verification_status  TEXT NOT NULL CHECK (verification_status IN ('verified','unverified')),
  source_text          TEXT NOT NULL,
  source_id            INT REFERENCES data_sources(id),
  created_by           INT REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE alert_targets (
  alert_id  INT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  route_id  INT REFERENCES routes(id) ON DELETE CASCADE,
  stop_id   INT REFERENCES stops(id) ON DELETE CASCADE,
  CHECK (route_id IS NOT NULL OR stop_id IS NOT NULL)
);
CREATE INDEX alert_targets_alert_idx ON alert_targets (alert_id);

CREATE TABLE submissions (
  id               SERIAL PRIMARY KEY,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer_id      INT REFERENCES users(id),
  review_note      TEXT,
  created_route_id INT REFERENCES routes(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at      TIMESTAMPTZ
);

CREATE TABLE import_batches (
  id          SERIAL PRIMARY KEY,
  file_name   TEXT,
  user_id     INT REFERENCES users(id),
  dry_run     BOOLEAN NOT NULL,
  summary     JSONB NOT NULL,
  conflicts   JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT,
  user_email  TEXT,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  before      JSONB,
  after       JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON audit_log (created_at DESC);

CREATE TABLE feedback (
  id          SERIAL PRIMARY KEY,
  message     TEXT NOT NULL,
  contact     TEXT,
  page        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Aggregate counters only (no personal data).
CREATE TABLE usage_events (
  day    DATE NOT NULL,
  event  TEXT NOT NULL,
  count  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event)
);

-- Rate limiting for public POST endpoints (hashed key, no raw IPs).
CREATE TABLE rate_limits (
  key           TEXT PRIMARY KEY,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INT NOT NULL
);
