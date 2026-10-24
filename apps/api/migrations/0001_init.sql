-- FitLens AI — initial schema (Cloudflare D1 / SQLite)
-- Conventions: TEXT UUID primary keys, ISO-8601 UTC timestamps, money in integer minor units.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iter INTEGER NOT NULL,
  display_name  TEXT,
  locale        TEXT NOT NULL DEFAULT 'en-US',
  currency      TEXT NOT NULL DEFAULT 'USD',
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  client       TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE consents (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose        TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  granted_at     TEXT NOT NULL,
  revoked_at     TEXT
);
CREATE INDEX idx_consents_user ON consents(user_id, purpose);

CREATE TABLE assets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key  TEXT NOT NULL UNIQUE,
  mime_type   TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  source_url  TEXT,
  created_at  TEXT NOT NULL,
  expires_at  TEXT,
  deleted_at  TEXT
);
CREATE INDEX idx_assets_user ON assets(user_id, purpose);
CREATE INDEX idx_assets_expiry ON assets(expires_at) WHERE deleted_at IS NULL;

CREATE TABLE products (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  brand                 TEXT,
  category              TEXT NOT NULL,
  color                 TEXT,
  size                  TEXT,
  style_number          TEXT,
  gtin                  TEXT,
  sku                   TEXT,
  description           TEXT,
  image_url             TEXT NOT NULL,
  product_url           TEXT NOT NULL,
  retailer_domain       TEXT NOT NULL,
  price_minor           INTEGER,
  currency              TEXT,
  garment_asset_id      TEXT REFERENCES assets(id) ON DELETE SET NULL,
  extraction_method     TEXT NOT NULL,
  extraction_confidence REAL NOT NULL,
  created_at            TEXT NOT NULL
);
CREATE INDEX idx_products_user ON products(user_id, created_at);
CREATE UNIQUE INDEX idx_products_user_url ON products(user_id, product_url, image_url);

CREATE TABLE retailers (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  domain              TEXT NOT NULL UNIQUE,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  return_policy       TEXT,
  created_at          TEXT NOT NULL
);

-- Offers ingested from authorized retailer feeds (see /v1/admin/catalog).
CREATE TABLE catalog_items (
  id             TEXT PRIMARY KEY,
  retailer_id    TEXT NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
  external_id    TEXT NOT NULL,
  title          TEXT NOT NULL,
  brand          TEXT,
  style_number   TEXT,
  gtin           TEXT,
  color          TEXT,
  size           TEXT,
  product_url    TEXT NOT NULL,
  image_url      TEXT,
  price_minor    INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  shipping_minor INTEGER,
  available      INTEGER,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL,
  UNIQUE (retailer_id, external_id)
);
CREATE INDEX idx_catalog_gtin ON catalog_items(gtin);
CREATE INDEX idx_catalog_style ON catalog_items(style_number);
CREATE INDEX idx_catalog_brand ON catalog_items(brand);

CREATE TABLE offer_snapshots (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  offer_key      TEXT NOT NULL,
  retailer       TEXT NOT NULL,
  title          TEXT NOT NULL,
  product_url    TEXT NOT NULL,
  price_minor    INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  shipping_minor INTEGER,
  available      INTEGER,
  match_status   TEXT NOT NULL,
  match_score    REAL NOT NULL,
  evidence_json  TEXT NOT NULL,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  checked_at     TEXT NOT NULL
);
CREATE INDEX idx_snapshots_product ON offer_snapshots(product_id, checked_at);

CREATE TABLE reviews (
  id           TEXT PRIMARY KEY,
  retailer_id  TEXT REFERENCES retailers(id) ON DELETE SET NULL,
  brand        TEXT,
  style_number TEXT,
  gtin         TEXT,
  rating       REAL NOT NULL,
  title        TEXT,
  body         TEXT NOT NULL,
  author       TEXT,
  source_url   TEXT,
  is_demo      INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_reviews_gtin ON reviews(gtin);
CREATE INDEX idx_reviews_style ON reviews(brand, style_number);

CREATE TABLE review_summaries (
  product_key  TEXT PRIMARY KEY,
  summary      TEXT NOT NULL,
  source_ids   TEXT NOT NULL,
  model        TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE TABLE tryon_jobs (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id       TEXT REFERENCES products(id) ON DELETE SET NULL,
  person_asset_id  TEXT NOT NULL,
  garment_asset_id TEXT NOT NULL,
  quality          TEXT NOT NULL,
  category         TEXT NOT NULL,
  status           TEXT NOT NULL,
  provider         TEXT NOT NULL,
  provider_job_id  TEXT,
  idempotency_key  TEXT,
  warnings_json    TEXT NOT NULL DEFAULT '[]',
  error_code       TEXT,
  error_message    TEXT,
  retryable        INTEGER NOT NULL DEFAULT 0,
  attempts         INTEGER NOT NULL DEFAULT 0,
  result_media_id  TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  submitted_at     TEXT,
  last_polled_at   TEXT
);
CREATE INDEX idx_tryon_user ON tryon_jobs(user_id, created_at);
CREATE INDEX idx_tryon_active ON tryon_jobs(status, updated_at);
CREATE UNIQUE INDEX idx_tryon_idem ON tryon_jobs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE rendered_media (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        TEXT,
  kind          TEXT NOT NULL,
  asset_id      TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_media_user ON rendered_media(user_id, created_at);

CREATE TABLE wardrobe_items (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  product_id     TEXT REFERENCES products(id) ON DELETE SET NULL,
  media_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  tryon_id       TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_wardrobe_user ON wardrobe_items(user_id, created_at);

CREATE TABLE usage_events (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation       TEXT NOT NULL,
  units           INTEGER NOT NULL DEFAULT 1,
  estimated_cost  REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_usage_user_day ON usage_events(user_id, operation, created_at);

CREATE TABLE audit_events (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  object_type TEXT,
  object_id   TEXT,
  ip_hash     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_audit_actor ON audit_events(actor_id, created_at);

CREATE TABLE rate_limits (
  bucket       TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
