-- ============================================================
-- Boleteria - SQLite schema (v2)
-- Run these PRAGMAs on EVERY connection (foreign_keys is per-connection):
--   PRAGMA foreign_keys = ON;
--   PRAGMA busy_timeout = 5000;
--   PRAGMA synchronous = NORMAL;   -- safe with WAL
-- journal_mode = WAL persists in the file once set.
-- Conventions: money = integer cents, timestamps = UTC ISO-8601 text.
-- ============================================================

-- ---------- USERS & SESSIONS ----------
CREATE TABLE users (
  id                 TEXT PRIMARY KEY NOT NULL,
  name               TEXT NOT NULL,
  email              TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  phone              TEXT,
  role               TEXT NOT NULL DEFAULT 'user'   CHECK (role   IN ('user','admin','organizador')),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  stripe_customer_id TEXT UNIQUE,                   -- needed to reuse saved cards
  banned_at          TEXT,
  ban_reason         TEXT,
  deleted_at         TEXT,
  last_login_at      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Unique only among non-deleted users, so a deleted user can re-register.
CREATE UNIQUE INDEX ux_users_email_active ON users(email COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE user_sessions (
  id                 TEXT PRIMARY KEY NOT NULL,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  ip_address         TEXT,
  user_agent         TEXT,
  device_name        TEXT,
  expires_at         TEXT NOT NULL,
  revoked_at         TEXT,
  last_used_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_sessions_user_active ON user_sessions(user_id) WHERE revoked_at IS NULL;

-- ---------- CATALOG ----------
CREATE TABLE event_type (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE places (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  address    TEXT,
  city       TEXT,
  capacity   INTEGER CHECK (capacity IS NULL OR capacity > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE seats (
  id          TEXT PRIMARY KEY NOT NULL,
  place_id    TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  section     TEXT NOT NULL,
  row         TEXT NOT NULL,
  seat_number TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (place_id, section, row, seat_number)
);

CREATE TABLE events (
  id            TEXT PRIMARY KEY NOT NULL,
  organizer_id  TEXT NOT NULL REFERENCES users(id),
  place_id      TEXT NOT NULL REFERENCES places(id),
  event_type_id TEXT NOT NULL REFERENCES event_type(id),
  title         TEXT NOT NULL,
  description   TEXT,
  image_url     TEXT,
  capacity      INTEGER CHECK (capacity IS NULL OR capacity > 0),
  start_date    TEXT NOT NULL,
  finish_date   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','published','soldout','cancelled','finished')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (finish_date >= start_date)
);
CREATE INDEX ix_events_status_start ON events(status, start_date);
CREATE INDEX ix_events_organizer    ON events(organizer_id);

CREATE TABLE ticket_type (
  id                 TEXT PRIMARY KEY NOT NULL,
  event_id           TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  admission_type     TEXT NOT NULL CHECK (admission_type IN ('no assigned seat','numbered seat')),
  price_cents        INTEGER NOT NULL CHECK (price_cents >= 0),
  total_quantity     INTEGER NOT NULL CHECK (total_quantity >= 0),
  available_quantity INTEGER NOT NULL,
  start_of_sale      TEXT,
  end_of_sale        TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Last line of defense against overselling / over-restoring stock:
  CHECK (available_quantity >= 0 AND available_quantity <= total_quantity)
);
CREATE INDEX ix_ticket_type_event ON ticket_type(event_id);

-- Which seats belong to which ticket tier for a given event.
CREATE TABLE ticket_type_seats (
  id             TEXT PRIMARY KEY NOT NULL,
  ticket_type_id TEXT NOT NULL REFERENCES ticket_type(id) ON DELETE CASCADE,
  event_id       TEXT NOT NULL REFERENCES events(id)      ON DELETE CASCADE,
  seat_id        TEXT NOT NULL REFERENCES seats(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (ticket_type_id, seat_id),
  UNIQUE (event_id, seat_id)          -- a seat can only be in one tier per event
);

-- DB-level guarantee that a seat belongs to the event's place.
CREATE TRIGGER trg_tts_seat_in_event_place
BEFORE INSERT ON ticket_type_seats
BEGIN
  SELECT RAISE(ABORT, 'seat does not belong to the event place')
  WHERE (SELECT place_id FROM seats  WHERE id = NEW.seat_id)
     IS NOT (SELECT place_id FROM events WHERE id = NEW.event_id);
END;

-- ---------- ORDERS & PAYMENTS ----------
CREATE TABLE orders (
  id         TEXT PRIMARY KEY NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  event_id   TEXT NOT NULL REFERENCES events(id),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','confirmed','cancelled','refunded')),
  expires_at TEXT,                    -- set on creation (e.g. now + 15 min); NULL once confirmed
  paid_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_orders_user ON orders(user_id);
-- Powers the cleanup job: "pending orders past expires_at"
CREATE INDEX ix_orders_pending_expiry ON orders(expires_at) WHERE status = 'pending';

CREATE TABLE order_items (
  id              TEXT PRIMARY KEY NOT NULL,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_type_id  TEXT NOT NULL REFERENCES ticket_type(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  subtotal_cents  INTEGER NOT NULL CHECK (subtotal_cents = quantity * unit_price_cents),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_order_items_order ON order_items(order_id);

CREATE TABLE user_payment_methods (
  id                         TEXT PRIMARY KEY NOT NULL,
  user_id                    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                   TEXT NOT NULL DEFAULT 'stripe',
  provider_payment_method_id TEXT NOT NULL,           -- pm_xxx
  brand                      TEXT,
  last4                      TEXT,
  exp_month                  INTEGER CHECK (exp_month BETWEEN 1 AND 12),
  exp_year                   INTEGER,
  funding                    TEXT,
  holder_name                TEXT,
  is_default                 INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  deleted_at                 TEXT,
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, provider_payment_method_id)
);
CREATE INDEX ix_upm_user ON user_payment_methods(user_id) WHERE deleted_at IS NULL;
-- At most one default card per user
CREATE UNIQUE INDEX ux_upm_one_default ON user_payment_methods(user_id)
  WHERE is_default = 1 AND deleted_at IS NULL;

CREATE TABLE payments (
  id                      TEXT PRIMARY KEY NOT NULL,
  order_id                TEXT NOT NULL REFERENCES orders(id),
  user_payment_method_id  TEXT REFERENCES user_payment_methods(id),
  amount_cents            INTEGER NOT NULL CHECK (amount_cents >= 0),
  refunded_amount_cents   INTEGER NOT NULL DEFAULT 0,
  currency                TEXT NOT NULL DEFAULT 'usd',
  method                  TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','completed','failed','refunded','partially_refunded','cancelled')),
  provider                TEXT NOT NULL DEFAULT 'stripe',
  provider_payment_id     TEXT,                       -- cs_xxx or pi_xxx
  failure_reason          TEXT,
  paid_at                 TEXT,
  refunded_at             TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (refunded_amount_cents >= 0 AND refunded_amount_cents <= amount_cents)
);
CREATE INDEX ix_payments_order ON payments(order_id);
-- Webhooks look payments up by Stripe ID; also prevents duplicates.
CREATE UNIQUE INDEX ux_payments_provider_id ON payments(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

-- ---------- TICKETS ----------
-- Created as 'reserved' INSIDE the BEGIN IMMEDIATE lock transaction (this is what
-- holds the seat while payment is pending). Promoted to 'active' by the webhook.
CREATE TABLE tickets (
  id            TEXT PRIMARY KEY NOT NULL,
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  event_id      TEXT NOT NULL REFERENCES events(id),
  seat_id       TEXT REFERENCES seats(id),          -- NULL for 'no assigned seat'
  unique_code   TEXT NOT NULL UNIQUE,                  -- UUID, goes in the QR
  status        TEXT NOT NULL DEFAULT 'reserved'
                CHECK (status IN ('reserved','active','used','cancelled')),
  used_at       TEXT,
  cancelled_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_tickets_order_item ON tickets(order_item_id);
-- THE seat-uniqueness guarantee: one live ticket per seat per event.
CREATE UNIQUE INDEX ux_tickets_live_seat ON tickets(event_id, seat_id)
  WHERE seat_id IS NOT NULL AND status != 'cancelled';
