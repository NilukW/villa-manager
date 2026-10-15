const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');

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
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

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
    }
});

module.exports = db;
