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
            groupId TEXT
        )`);

        db.run("ALTER TABLE reservations ADD COLUMN advancedPayments TEXT DEFAULT '[]'", (err) => {
            // Error mapped if column already exists
        });

        db.run("ALTER TABLE reservations ADD COLUMN groupId TEXT", (err) => {
            if (!err) {
                db.run("UPDATE reservations SET groupId = CAST(id AS TEXT)");
            }
        });

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
    }
});

module.exports = db;
