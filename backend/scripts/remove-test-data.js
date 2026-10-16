// Dev only: removes everything added by seed-test-data.js, plus anything created while testing with it:
// test bookings/expenses/staff, their payments, and Aug/Sep 2026 bonus decisions (with their payments
// and expenses, including any paid to real staff during testing).
// Usage (from backend/): npm run test-data:remove   [or: node scripts/remove-test-data.js [path-to-db]]
const path = require('path');
const sqlite3 = require('sqlite3');
require('./guard')('remove-test-data');

const dbPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'database.sqlite'));
console.log(`Database: ${dbPath}`);
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE);
const run = (sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this.changes); }));

(async () => {
    await run('BEGIN TRANSACTION');
    try {
        const counts = {};
        // Bonus decisions for the test months, with their payments and expenses
        counts.bonusExpenses = await run(`DELETE FROM expenses WHERE id IN (
            SELECT p.expenseId FROM staff_payments p JOIN staff_bonuses b ON b.id = p.bonusId WHERE b.month IN ('2026-08', '2026-09'))`);
        counts.bonusPayments = await run(`DELETE FROM staff_payments WHERE bonusId IN (
            SELECT id FROM staff_bonuses WHERE month IN ('2026-08', '2026-09'))`);
        counts.bonusDecisions = await run("DELETE FROM staff_bonuses WHERE month IN ('2026-08', '2026-09')");

        // Test staff with all their payments and expenses
        counts.testStaffExpenses = await run(`DELETE FROM expenses WHERE id IN (
            SELECT p.expenseId FROM staff_payments p JOIN staff s ON s.id = p.staffId WHERE s.name LIKE '%(test)')`);
        counts.testStaffPayments = await run("DELETE FROM staff_payments WHERE staffId IN (SELECT id FROM staff WHERE name LIKE '%(test)')");
        counts.testStaff = await run("DELETE FROM staff WHERE name LIKE '%(test)'");

        counts.bookings = await run("DELETE FROM reservations WHERE groupId LIKE 'test-%'");
        counts.expenses = await run("DELETE FROM expenses WHERE description LIKE '[TEST]%'");

        // Let reminders restart from the default (the month before the next check)
        await run("DELETE FROM settings WHERE key = 'staffBonusStartMonth'");

        await run('COMMIT');
        console.log('Test data removed:', counts);
    } catch (err) {
        await run('ROLLBACK');
        console.error('Failed, nothing was removed:', err.message);
        process.exitCode = 1;
    }
    db.close();
})();
