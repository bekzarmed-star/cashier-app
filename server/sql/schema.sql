-- Zarmed Pratiksha Hospital — Cashier schema

CREATE TABLE IF NOT EXISTS cashiers (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('cashier', 'supervisor', 'admin')),
  counter_id    TEXT NOT NULL DEFAULT 'C-01',
  phone         TEXT NOT NULL DEFAULT '',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing DBs created before phone column
ALTER TABLE cashiers ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS account_codes (
  code      TEXT PRIMARY KEY,
  english   TEXT NOT NULL DEFAULT '',
  russian   TEXT NOT NULL DEFAULT '',
  uzbek     TEXT NOT NULL DEFAULT '',
  note      TEXT NOT NULL DEFAULT '',
  archived  BOOLEAN NOT NULL DEFAULT FALSE,
  grp       TEXT NOT NULL DEFAULT 'Расход'
);

CREATE TABLE IF NOT EXISTS patients (
  id         TEXT PRIMARY KEY,
  mrn        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  phone      TEXT,
  age        INT,
  gender     TEXT CHECK (gender IN ('M', 'F', 'O')),
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bills (
  id          TEXT PRIMARY KEY,
  invoice_no  TEXT NOT NULL UNIQUE,
  patient_id  TEXT NOT NULL REFERENCES patients(id),
  status      TEXT NOT NULL CHECK (status IN ('pending', 'partial', 'paid', 'cancelled', 'refunded')),
  paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bill_items (
  id         TEXT PRIMARY KEY,
  bill_id    TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,
  qty        NUMERIC(12, 2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14, 2) NOT NULL,
  discount   NUMERIC(14, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  receipt_no    TEXT NOT NULL UNIQUE,
  bill_id       TEXT REFERENCES bills(id),
  invoice_no    TEXT NOT NULL,
  patient_id    TEXT NOT NULL REFERENCES patients(id),
  patient_snap  JSONB NOT NULL,
  items_snap    JSONB NOT NULL,
  payments      JSONB NOT NULL,
  account_code  TEXT REFERENCES account_codes(code),
  subtotal      NUMERIC(14, 2) NOT NULL,
  discount      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total         NUMERIC(14, 2) NOT NULL,
  amount_paid   NUMERIC(14, 2) NOT NULL,
  change_amt    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cashier_id    TEXT NOT NULL REFERENCES cashiers(id),
  cashier_name  TEXT NOT NULL,
  counter_id    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'completed'
                CHECK (status IN ('completed', 'voided', 'refunded')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_drawers (
  id             TEXT PRIMARY KEY,
  counter_id     TEXT NOT NULL,
  cashier_id     TEXT NOT NULL REFERENCES cashiers(id),
  cashier_name   TEXT NOT NULL,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at      TIMESTAMPTZ,
  opening_float  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  expected_cash  NUMERIC(14, 2),
  counted_cash   NUMERIC(14, 2),
  variance       NUMERIC(14, 2),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_receipt ON transactions(receipt_no);
CREATE INDEX IF NOT EXISTS idx_account_codes_grp ON account_codes(grp);
CREATE INDEX IF NOT EXISTS idx_patients_mrn ON patients(mrn);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);

CREATE TABLE IF NOT EXISTS excel_files (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  headers       JSONB NOT NULL DEFAULT '[]',
  sheet_data    JSONB NOT NULL DEFAULT '[]',
  created_by    TEXT REFERENCES cashiers(id),
  created_by_name TEXT,
  updated_by    TEXT REFERENCES cashiers(id),
  updated_by_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_excel_files_updated ON excel_files(updated_at DESC);

CREATE TABLE IF NOT EXISTS admin_config (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  key_fingerprint TEXT NOT NULL,
  key_file_name   TEXT NOT NULL DEFAULT 'admin.eimzo.key',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token       TEXT PRIMARY KEY,
  admin_id    TEXT NOT NULL REFERENCES cashiers(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,
  full_name     TEXT NOT NULL,
  branch_code   TEXT NOT NULL DEFAULT '',
  branch_name   TEXT NOT NULL DEFAULT '',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(full_name);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(active);

/** Cashier acceptance of ERP invoices («Получено кассой») */
CREATE TABLE IF NOT EXISTS erp_invoice_acceptances (
  erp_id          TEXT PRIMARY KEY,
  reg_no          TEXT NOT NULL DEFAULT '',
  reg_date        TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  initiator       TEXT NOT NULL DEFAULT '',
  branch          TEXT NOT NULL DEFAULT '',
  pay_type        TEXT NOT NULL DEFAULT '',
  amount          NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'sum',
  status          TEXT NOT NULL DEFAULT '',
  snapshot        JSONB NOT NULL DEFAULT '{}'::jsonb,
  cashier_id      TEXT NOT NULL DEFAULT '',
  cashier_name    TEXT NOT NULL DEFAULT '',
  note            TEXT NOT NULL DEFAULT '',
  erp_pushed      BOOLEAN NOT NULL DEFAULT FALSE,
  erp_push_error  TEXT NOT NULL DEFAULT '',
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erp_accept_at ON erp_invoice_acceptances(accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_accept_reg ON erp_invoice_acceptances(reg_no);

