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
            nicOrPassport TEXT NOT NULL,
            checkInDate TEXT NOT NULL,
            checkOutDate TEXT NOT NULL,
            roomName TEXT NOT NULL,
            unitPrice REAL NOT NULL,
            totalAmount REAL NOT NULL,
            advancedAmount REAL,
            advancedPayments TEXT,
            remarks TEXT,
            bookingSource TEXT DEFAULT 'Manual'
        )`);

        db.run("ALTER TABLE reservations ADD COLUMN advancedPayments TEXT DEFAULT '[]'", (err) => {
            // Error mapped if column already exists
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
    }
});

module.exports = db;
