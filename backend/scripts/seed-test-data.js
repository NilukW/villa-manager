// Dev only: adds clearly-marked test data for trying out Staff Bonus, Salaries & Advances,
// Financials and Analytics. Remove it with remove-test-data.js. Never run against production.
// Markers: guestName/remarks "[TEST]", expense descriptions "[TEST]", staff names "(test)", groupId "test-*".
// Usage (from backend/): npm run test-data:add   [or: node scripts/seed-test-data.js [path-to-db]]
const path = require('path');
const sqlite3 = require('sqlite3');
require('./guard')('seed-test-data');

const dbPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'database.sqlite'));
console.log(`Database: ${dbPath}`);
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE);

const run = (sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const get = (sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));

// [groupId, guest, checkIn, checkOut, rooms[], perRoomTotal, paidPerRoom, payDate, source]
const bookings = [
    // August 2026 — fully paid
    ['test-aug-1', 'Anna Schmidt', '2026-08-03', '2026-08-07', ['Standard 1'], 120000, 120000, '2026-08-07', 'Booking.com'],
    ['test-aug-2', 'Liam Walsh', '2026-08-12', '2026-08-15', ['Standard 2'], 85000, 85000, '2026-08-15', 'Direct'],
    ['test-aug-3', 'Perera Family', '2026-08-20', '2026-08-23', ['Standard 3', 'Standard 4'], 60000, 60000, '2026-08-23', 'Direct'],
    // September 2026 — fully paid
    ['test-sep-1', 'Sophie Martin', '2026-09-02', '2026-09-07', ['Standard 1'], 150000, 150000, '2026-09-07', 'Booking.com'],
    ['test-sep-2', 'Kenji Tanaka', '2026-09-10', '2026-09-13', ['Standard 2'], 95000, 95000, '2026-09-13', 'Airbnb'],
    ['test-sep-3', 'Fernando Group', '2026-09-18', '2026-09-23', ['Family Studio'], 210000, 210000, '2026-09-23', 'Direct'],
    // September 2026 — only partly paid, so NOT counted as revenue
    ['test-sep-4', 'Unpaid Guest', '2026-09-25', '2026-09-28', ['Standard 3'], 80000, 30000, '2026-09-25', 'Direct']
];

const expenses = [
    ['2026-08-05', 'Maintenance', 25000, 'Pool pump repair'],
    ['2026-08-14', 'Supplies', 18500, 'Groceries & toiletries'],
    ['2026-08-28', 'Cleaning', 12000, 'Deep cleaning service'],
    ['2026-09-06', 'Maintenance', 40000, 'AC servicing (5 units)'],
    ['2026-09-15', 'Supplies', 22000, 'Breakfast supplies'],
    ['2026-09-27', 'Utilities', 31500, 'Generator fuel']
];

// Bookings around the day the script runs, for the dashboard calendar, "today" cards and checkout
// reminders: [groupId, guest, phone, checkIn offset, checkOut offset, rooms[], perRoomTotal, paidPerRoom, source, breakfast]
const currentBookings = [
    ['test-now-1', 'Emma Clarke', '0771234567', -2, 0, ['Standard 1'], 90000, 45000, 'Direct', true],      // leaving today, balance due
    ['test-now-2', 'Raj Patel', '0712345678', -3, 0, ['Standard 2'], 105000, 105000, 'Booking.com', false], // leaving today, fully paid
    ['test-now-3', 'Silva Family', '0765554433', 0, 3, ['Standard 3', 'Standard 4'], 96000, 30000, 'Direct', true], // arriving today, advance paid
    ['test-now-4', 'Marco Rossi', '+393331234567', -1, 3, ['Family Studio'], 160000, 0, 'Direct', false],  // staying, nothing paid yet
    ['test-now-5', 'Hannah Becker', '', 5, 8, ['Standard 1'], 99000, 99000, 'Booking.com', true],           // next week, prepaid
    ['test-now-6', 'Nuwan Jayasinghe', '0779876543', 0, 2, ['Standard 2'], 64000, 20000, 'Direct', false]  // same-day turnover after Raj
];

const isoDay = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const insertBooking = async ({ groupId, guest, phone, checkIn, checkOut, rooms, perRoom, paidPerRoom, payDate, source, breakfast }) => {
    const nights = Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000));
    const payments = paidPerRoom > 0 ? [{ date: payDate, amount: paidPerRoom }] : [];
    for (const room of rooms) {
        await run(`INSERT INTO reservations (guestName, phoneNo, checkInDate, checkOutDate, roomName, unitPrice, totalAmount,
                   advancedAmount, advancedPayments, remarks, bookingSource, groupId, breakfastIncluded)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[TEST] sample booking', ?, ?, ?)`,
            [`[TEST] ${guest}`, phone, checkIn, checkOut, room, Math.round(perRoom / nights), perRoom,
             paidPerRoom, JSON.stringify(payments), source, groupId, breakfast ? 1 : 0]);
    }
};

(async () => {
    const history = await get("SELECT COUNT(*) AS n FROM reservations WHERE groupId LIKE 'test-aug-%' OR groupId LIKE 'test-sep-%'");
    const current = await get("SELECT COUNT(*) AS n FROM reservations WHERE groupId LIKE 'test-now-%'");
    if (history.n > 0 && current.n > 0) {
        console.log('Test data is already present. Run remove-test-data.js first if you want to re-seed.');
        return db.close();
    }

    await run('BEGIN TRANSACTION');
    try {
        if (current.n === 0) {
            for (const [groupId, guest, phone, inOff, outOff, rooms, perRoom, paidPerRoom, source, breakfast] of currentBookings) {
                await insertBooking({ groupId, guest, phone, checkIn: isoDay(inOff), checkOut: isoDay(outOff), rooms, perRoom, paidPerRoom, payDate: isoDay(inOff), source, breakfast });
            }
            console.log(`Added ${currentBookings.length} bookings around today (${isoDay(0)}): 2 leaving today, 2 arriving, 1 staying, 1 next week.`);
        }

        if (history.n > 0) {
            await run('COMMIT');
            return db.close();
        }

        for (const [groupId, guest, checkIn, checkOut, rooms, perRoom, paidPerRoom, payDate, source] of bookings) {
            await insertBooking({ groupId, guest, phone: '', checkIn, checkOut, rooms, perRoom, paidPerRoom, payDate, source, breakfast: true });
        }

        for (const [date, category, amount, desc] of expenses) {
            await run('INSERT INTO expenses (date, category, amount, description) VALUES (?, ?, ?, ?)',
                [date, category, amount, `[TEST] ${desc}`]);
        }

        const nimal = await run("INSERT INTO staff (name, monthlySalary, active) VALUES ('Nimal (test)', 45000, 1)");
        await run("INSERT INTO staff (name, monthlySalary, active) VALUES ('Saman (test)', 40000, 1)");

        // An October advance for Nimal, recorded the same way the app does (payment + Salary expense)
        const exp = await run("INSERT INTO expenses (date, category, amount, description) VALUES ('2026-10-10', 'Salary', 10000, '[TEST] Salary Advance - Nimal (test) (Oct 2026)')");
        await run(`INSERT INTO staff_payments (staffId, type, month, date, amount, salaryForMonth, notes, expenseId)
                   VALUES (?, 'advance', '2026-10', '2026-10-10', 10000, 45000, '[TEST] advance', ?)`, [nimal.lastID, exp.lastID]);

        // Start bonus reminders from August so the Aug 2026 decision (due 29 Sep) shows as pending today
        await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('staffBonusStartMonth', '2026-08')");

        await run('COMMIT');
        console.log('Test data added:');
        console.log('  Aug 2026: revenue 325,000 - expenses 55,500 = net profit 269,500');
        console.log('  Sep 2026: revenue 455,000 - expenses 93,500 = net profit 361,500 (80,000 partly-paid booking excluded)');
        console.log('  Staff: Nimal (test) 45,000, Saman (test) 40,000 (+ your existing staff)');
        console.log('  Oct 2026: 10,000 advance for Nimal (test)');
        console.log('  Bonus reminders start from Aug 2026');
    } catch (err) {
        await run('ROLLBACK');
        console.error('Failed, nothing was added:', err.message);
        process.exitCode = 1;
    }
    db.close();
})();
