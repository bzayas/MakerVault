-- MakerVault Database Schema
-- SQLite3

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pin_hash TEXT,
    avatar_color TEXT DEFAULT '#007AFF',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Categories (dynamic, user-editable)
CREATE TABLE IF NOT EXISTS categories (
    key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'shippingbox',
    color TEXT NOT NULL DEFAULT '#8E8E93',
    position INTEGER NOT NULL DEFAULT 0,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Locations (hierarchical)
CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    parent_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
    position INTEGER,
    qr_code_value TEXT UNIQUE,
    notes TEXT,
    capacity INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);
CREATE INDEX IF NOT EXISTS idx_locations_type ON locations(type);

-- Printers
CREATE TABLE IF NOT EXISTS printers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Printer Slots (AMS + External)
CREATE TABLE IF NOT EXISTS printer_slots (
    id TEXT PRIMARY KEY,
    printer_id TEXT NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
    ams_type TEXT NOT NULL CHECK (ams_type IN ('amsLite', 'ams2Pro', 'amsHT', 'externalManual')),
    ams_unit_number INTEGER NOT NULL,
    slot_number INTEGER NOT NULL,
    name TEXT,
    current_filament_id TEXT REFERENCES items(id) ON DELETE SET NULL,
    location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_printer_slots_printer ON printer_slots(printer_id);

-- Items (core table)
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    subcategory TEXT,
    brand TEXT,
    sku TEXT,
    upc TEXT,
    barcode TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'pcs',
    min_quantity INTEGER,
    reorder_url TEXT,
    purchase_price REAL,
    pack_quantity INTEGER,  -- units of `unit` covered by one purchase_price (NULL/1 = per-unit)
    purchase_date TEXT,
    vendor TEXT,
    location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
    home_location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
    photo_data BLOB,
    photo_path TEXT,
    notes TEXT,
    tags TEXT DEFAULT '[]',  -- JSON array of strings
    custom_fields TEXT,  -- JSON object {label: value}, free-form per item
    whereabouts TEXT,  -- Free-text "In Use" location (e.g. "Workbench", "Print Bed")
    color TEXT,  -- Optional color name for any item type
    color_hex TEXT,  -- Optional hex color code for any item type
    original_import_name TEXT,  -- Name as parsed from an invoice import
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_location ON items(location_id);
CREATE INDEX IF NOT EXISTS idx_items_sku ON items(sku);
CREATE INDEX IF NOT EXISTS idx_items_upc ON items(upc);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_vendor ON items(vendor);

-- Filament extension table
CREATE TABLE IF NOT EXISTS filaments (
    item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    material TEXT NOT NULL,
    color TEXT,
    color_hex TEXT,
    color_mode TEXT NOT NULL DEFAULT 'solid' CHECK (color_mode IN ('solid', 'gradient', 'split', 'sparkle', 'silk')),
    color_hex2 TEXT,
    color_hex3 TEXT,
    color_hex4 TEXT,
    diameter REAL NOT NULL DEFAULT 1.75,
    spool_weight REAL DEFAULT 1000,
    remaining_weight REAL,
    status TEXT NOT NULL DEFAULT 'inStock' CHECK (status IN (
        'inStock', 'loadedInAMS', 'loadedExternal', 'inUse', 'empty'
    )),
    printer_slot_id TEXT REFERENCES printer_slots(id) ON DELETE SET NULL,
    spool_type TEXT DEFAULT 'withSpool' CHECK (spool_type IN ('withSpool', 'refill')),
    dry_box_id TEXT REFERENCES locations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_filaments_status ON filaments(status);
CREATE INDEX IF NOT EXISTS idx_filaments_material ON filaments(material);

-- Tool extension table
CREATE TABLE IF NOT EXISTS tools (
    item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    tool_type TEXT,
    serial_number TEXT,
    checked_out INTEGER NOT NULL DEFAULT 0,
    checked_out_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    checked_out_at TEXT,
    home_location_id TEXT REFERENCES locations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tools_checked_out ON tools(checked_out);

-- Activity Log
CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN (
        'added', 'edited', 'moved', 'checkedOut', 'checkedIn',
        'quantityChanged', 'deleted', 'imported',
        'merged', 'skipped', 'quantity_updated', 'updated'
    )),
    item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
    location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
    details TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_log_item ON activity_log(item_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);

-- Import batches (for PDF imports)
CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,  -- 'bambulab', 'amazon', 'csv', 'manual'
    vendor TEXT,
    order_number TEXT,
    order_date TEXT,
    invoice_number TEXT,
    grand_total REAL,
    original_filename TEXT,
    original_pdf BLOB,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    imported_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT
);

-- Link table: import batch -> items
CREATE TABLE IF NOT EXISTS import_batch_items (
    batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    unit_price REAL,   -- per-unit paid (after discount, before tax)
    list_price REAL,   -- per-unit list price on the invoice
    line_total REAL,   -- line subtotal (after discount, before tax)
    discount REAL,
    tax REAL,
    quantity INTEGER,  -- quantity on this invoice line
    PRIMARY KEY (batch_id, item_id)
);

-- Duplicate-finder "not duplicates" dismissals (item_a < item_b lexically)
CREATE TABLE IF NOT EXISTS duplicate_dismissals (
    item_a TEXT NOT NULL,
    item_b TEXT NOT NULL,
    dismissed_at TEXT NOT NULL,
    PRIMARY KEY (item_a, item_b)
);

-- Label templates
CREATE TABLE IF NOT EXISTS label_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    width_mm REAL NOT NULL,
    height_mm REAL NOT NULL,
    background_color TEXT DEFAULT '#FFFFFF',
    border_enabled INTEGER DEFAULT 0,
    border_thickness REAL DEFAULT 0.5,
    border_color TEXT DEFAULT '#000000',
    padding_mm REAL DEFAULT 1.0,
    auto_fit INTEGER DEFAULT 1,
    lines_config TEXT NOT NULL DEFAULT '[]',  -- JSON array of line configs
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Label size presets
CREATE TABLE IF NOT EXISTS label_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    width_mm REAL NOT NULL,
    height_mm REAL NOT NULL
);

-- Barcode auto-generation sequences (per-category prefix)
CREATE TABLE IF NOT EXISTS barcode_sequences (
    category_prefix TEXT PRIMARY KEY,
    next_value INTEGER NOT NULL DEFAULT 1
);

-- Web port addition: column added by migration 12 in the FastAPI server
