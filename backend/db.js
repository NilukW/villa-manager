const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');

// Resolves once the startup schema statements below have all run, so startup jobs that depend on
// new columns (e.g. the checkout backfill) can wait for them instead of guessing with a timer
let markReady;
const ready = new Promise(resolve => { markReady = resolve; });

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        // Run the schema statements strictly in order. Without this they run concurrently, and on a
        // brand-new database an ALTER TABLE can execute before its CREATE TABLE and silently fail.
        db.serialize(() => {

        // Create Reservations Table
        db.run(`CREATE TABLE IF NOT EXISTS reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guestName TEXT NOT NULL,
            phoneNo TEXT,
            nicOrPassport TEXT,
            checkInDate TEXT NOT NULL,
            checkOutDate TEXT NOT NULL,
            roomName TEXT NOT NULL,
            unitPrice REAL NOT NULL,
            totalAmount REAL NOT NULL,
            advancedAmount REAL,
            advancedPayments TEXT,
            remarks TEXT,
            bookingSource TEXT DEFAULT 'Manual',
            groupId TEXT,
            breakfastIncluded INTEGER DEFAULT 0
        )`);

        db.run("ALTER TABLE reservations ADD COLUMN advancedPayments TEXT DEFAULT '[]'", (err) => {
            // Error mapped if column already exists
        });

        db.run("ALTER TABLE reservations ADD COLUMN groupId TEXT", (err) => {
            if (!err) {
                db.run("UPDATE reservations SET groupId = CAST(id AS TEXT)");
            }
        });

        db.run("ALTER TABLE reservations ADD COLUMN usdAmount REAL", () => {});
        db.run("ALTER TABLE reservations ADD COLUMN conversionRate REAL", () => {});
        db.run("ALTER TABLE reservations ADD COLUMN breakfastIncluded INTEGER DEFAULT 0", () => {});
        // No longer used: checkout confirmation was replaced by date-based status + Settle.
        // Kept because removing a column from existing SQLite databases needs a table rebuild.
        db.run("ALTER TABLE reservations ADD COLUMN checkedOutAt TEXT", () => {});

        // Create Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`, (err) => {
            if (!err) {
                // Seed admin user if empty
                db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
                    if (row && row.count === 0) {
                        const bcrypt = require('bcryptjs');
                        const hash = bcrypt.hashSync('admin123', 10);
                        db.run('INSERT INTO users (username, password) VALUES (?,?)', ['admin', hash]);
                    }
                });
            }
        });

        // Create Rooms Table
        db.run(`CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL
        )`, (err) => {
            if (!err) {
                // Seed rooms if empty
                db.get("SELECT COUNT(*) as count FROM rooms", (err, row) => {
                    if (row && row.count === 0) {
                        const insert = 'INSERT INTO rooms (name, type) VALUES (?,?)';
                        db.run(insert, ['Standard 1', 'Standard']);
                        db.run(insert, ['Standard 2', 'Standard']);
                        db.run(insert, ['Standard 3', 'Standard']);
                        db.run(insert, ['Standard 4', 'Standard']);
                        db.run(insert, ['Family Studio', 'Studio']);
                    }
                });
            }
        });
        // Create Expenses Table
        db.run(`CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            category TEXT NOT NULL,
            amount REAL NOT NULL,
            description TEXT
        )`);
        // Create Pending Expenses Table
        db.run(`CREATE TABLE IF NOT EXISTS pending_expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            category TEXT NOT NULL,
            amount REAL NOT NULL,
            description TEXT
        )`);

        // iCal sync integration columns & settings table
        db.run("ALTER TABLE rooms ADD COLUMN icalUrl TEXT", () => {});
        db.run("ALTER TABLE reservations ADD COLUMN uid TEXT", () => {});
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        // Create Laundry Bills Tables
        db.run(`CREATE TABLE IF NOT EXISTS laundry_bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoiceNo TEXT NOT NULL,
            vendor TEXT DEFAULT 'Shiny Laundry',
            date TEXT NOT NULL,
            month TEXT,
            totalQty INTEGER DEFAULT 0,
            totalAmount REAL NOT NULL,
            status TEXT DEFAULT 'Pending',
            paidDate TEXT,
            paymentNotes TEXT,
            expenseId INTEGER,
            pdfPath TEXT,
            originalFileName TEXT,
            dailyBreakdown TEXT,
            fileHash TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, () => {
            // SHA-256 of the uploaded PDF, so the same file can't be saved twice (added after first release)
            db.run("ALTER TABLE laundry_bills ADD COLUMN fileHash TEXT", () => {
                db.run("CREATE INDEX IF NOT EXISTS idx_laundry_bills_filehash ON laundry_bills (fileHash)", () => {});
            });
        });

        db.run(`CREATE TABLE IF NOT EXISTS laundry_bill_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            billId INTEGER NOT NULL,
            description TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unitPrice REAL NOT NULL,
            amount REAL NOT NULL,
            FOREIGN KEY (billId) REFERENCES laundry_bills (id) ON DELETE CASCADE
        )`);

        db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_laundry_bills_invoice ON laundry_bills (invoiceNo COLLATE NOCASE)", () => {});

        // Utility Bills (electricity, water, telecom) share one table, keyed by type
        db.run(`CREATE TABLE IF NOT EXISTS utility_bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            billNo TEXT NOT NULL,
            provider TEXT,
            accountNo TEXT,
            tariff TEXT,
            premises TEXT,
            date TEXT NOT NULL,
            month TEXT,
            periodFrom TEXT,
            periodTo TEXT,
            dueDate TEXT,
            previousReading REAL,
            currentReading REAL,
            unitsUsed REAL,
            totalAmount REAL NOT NULL,
            charges TEXT,
            status TEXT DEFAULT 'Pending',
            paidDate TEXT,
            paymentNotes TEXT,
            expenseId INTEGER,
            originalFileName TEXT,
            fileHash TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, () => {
            // SHA-256 of the uploaded PDF, so the same file can't be saved twice (added after first release)
            db.run("ALTER TABLE utility_bills ADD COLUMN fileHash TEXT", () => {
                db.run("CREATE INDEX IF NOT EXISTS idx_utility_bills_filehash ON utility_bills (fileHash)", () => {});
            });
        });

        db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_utility_bills_type_billno ON utility_bills (type, billNo COLLATE NOCASE)", () => {});

        // Payments against laundry/utility bills (a bill may be paid in several parts);
        // billKind is 'laundry' or 'utility', expenseId links the expense posted for that payment
        db.run(`CREATE TABLE IF NOT EXISTS bill_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            billKind TEXT NOT NULL,
            billId INTEGER NOT NULL,
            date TEXT NOT NULL,
            amount REAL NOT NULL,
            notes TEXT,
            expenseId INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        db.run("CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments (billKind, billId)", () => {});

        // Groceries & supplies: a catalogue of things bought regularly, and purchases (itemised, or
        // just a total for small no-bill buys). Each purchase posts one 'Supplies' expense.
        // groupKey: kitchen | cleaning | amenities | gas | other
        db.run(`CREATE TABLE IF NOT EXISTS grocery_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            groupKey TEXT NOT NULL DEFAULT 'other',
            unit TEXT DEFAULT 'pcs',
            active INTEGER NOT NULL DEFAULT 1,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        // Starter catalogue, added only while the catalogue is empty (never re-added after edits)
        db.run(`INSERT INTO grocery_items (name, groupKey, unit)
            SELECT column1, column2, column3 FROM (VALUES
                ('Eggs', 'kitchen', 'pcs'), ('Bread', 'kitchen', 'loaf'), ('Coffee', 'kitchen', 'pack'),
                ('Milk powder', 'kitchen', 'pack'), ('Tea powder', 'kitchen', 'pack'), ('Spices', 'kitchen', 'pack'),
                ('Coconut', 'kitchen', 'pcs'), ('Vegetables', 'kitchen', 'kg'), ('Rice', 'kitchen', 'kg'),
                ('Sausages', 'kitchen', 'pack'), ('Bananas', 'kitchen', 'bunch'),
                ('Soap', 'cleaning', 'pcs'), ('Dishwash liquid', 'cleaning', 'bottle'), ('Laundry liquid', 'cleaning', 'bottle'),
                ('Toilet cleaner', 'cleaning', 'bottle'), ('Mop cleaner', 'cleaning', 'bottle'),
                ('Water bottles', 'amenities', 'bottle'), ('Air freshener', 'amenities', 'bottle'), ('Mosquito repellent', 'amenities', 'pcs'),
                ('Gas refill', 'gas', 'cylinder')
            ) WHERE NOT EXISTS (SELECT 1 FROM grocery_items)`, () => {});

        db.run(`CREATE TABLE IF NOT EXISTS grocery_purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            shop TEXT,
            billNo TEXT,
            groupKey TEXT,
            notes TEXT,
            totalAmount REAL NOT NULL,
            expenseId INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Item lines of an itemised purchase; name/group/unit are copied so history survives catalogue edits
        db.run(`CREATE TABLE IF NOT EXISTS grocery_purchase_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purchaseId INTEGER NOT NULL,
            itemId INTEGER,
            itemName TEXT NOT NULL,
            groupKey TEXT,
            unit TEXT,
            quantity REAL NOT NULL DEFAULT 1,
            unitPrice REAL NOT NULL DEFAULT 0,
            amount REAL NOT NULL DEFAULT 0
        )`);

        // Photos/PDFs of grocery bills, kept in the database so backups include them.
        // purchaseId stays NULL between "read the bill" and "save the purchase"; unlinked files are cleaned up later.
        db.run(`CREATE TABLE IF NOT EXISTS grocery_bill_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purchaseId INTEGER,
            fileHash TEXT NOT NULL,
            fileName TEXT,
            mimeType TEXT NOT NULL,
            data BLOB NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Inventory (things the villa owns) and their service/repair history.
        // category: appliance | kitchenware | gas | furniture | linen | other
        // condition: working | needs_repair | broken | disposed
        db.run(`CREATE TABLE IF NOT EXISTS inventory_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'other',
            quantity INTEGER NOT NULL DEFAULT 1,
            location TEXT,
            purchaseDate TEXT,
            purchaseCost REAL,
            supplier TEXT,
            billNo TEXT,
            warrantyUntil TEXT,
            condition TEXT NOT NULL DEFAULT 'working',
            serviceIntervalMonths INTEGER,
            notes TEXT,
            expenseId INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS inventory_services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            itemId INTEGER NOT NULL,
            date TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'service',
            description TEXT,
            vendor TEXT,
            cost REAL,
            expenseId INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        // unitId: which unit was worked on (NULL = the item / all its units); part: e.g. 'Condenser' for type 'part'
        db.run("ALTER TABLE inventory_services ADD COLUMN unitId INTEGER", () => {});
        db.run("ALTER TABLE inventory_services ADD COLUMN part TEXT", () => {});

        // Individual units of an item tracked one by one (e.g. each A/C by room), so repairs and
        // replaced parts can be followed per unit. When an item has units, its quantity follows them.
        db.run(`CREATE TABLE IF NOT EXISTS inventory_units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            itemId INTEGER NOT NULL,
            label TEXT NOT NULL,
            location TEXT,
            serialNo TEXT,
            condition TEXT NOT NULL DEFAULT 'working',
            notes TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        // When each unit was installed (its service schedule starts here until the first service) and its warranty
        db.run("ALTER TABLE inventory_units ADD COLUMN installedDate TEXT", () => {});
        db.run("ALTER TABLE inventory_units ADD COLUMN warrantyUntil TEXT", () => {});

        // Staff & salary payments
        db.run(`CREATE TABLE IF NOT EXISTS staff (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            monthlySalary REAL NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // One row per advance or salary payment; month is the salary month (YYYY-MM) it counts against.
        // salaryForMonth snapshots the monthly salary at payment time so later raises don't rewrite past balances.
        db.run(`CREATE TABLE IF NOT EXISTS staff_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staffId INTEGER NOT NULL,
            type TEXT NOT NULL,
            month TEXT NOT NULL,
            date TEXT NOT NULL,
            amount REAL NOT NULL,
            salaryForMonth REAL,
            notes TEXT,
            expenseId INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (staffId) REFERENCES staff (id)
        )`, () => {
            // Links a 'bonus' payment row to its staff_bonuses decision (added after first release)
            db.run("ALTER TABLE staff_payments ADD COLUMN bonusId INTEGER", () => {});
        });

        // One decision per profit month: the bonus was either paid out or deliberately skipped
        db.run(`CREATE TABLE IF NOT EXISTS staff_bonuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL,
            revenue REAL,
            expenses REAL,
            netProfit REAL,
            percentage REAL,
            calculatedPool REAL,
            pool REAL,
            staffCount INTEGER,
            perStaff REAL,
            paidDate TEXT,
            notes TEXT,
            decidedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, () => {
            // calculatedPool = percentage × net profit; pool = the amount actually given, which the user may edit
            db.run("ALTER TABLE staff_bonuses ADD COLUMN calculatedPool REAL", () => {
                // Last statement queued during startup: everything above has been applied
                markReady();
            });
        });
        });
    }
});

db.ready = ready;

module.exports = db;
