// Payments against laundry and utility bills. A bill can be paid in several parts; every payment
// is its own row here and its own expense (dated on the payment day), and the bill's status is
// derived from the total paid: Pending -> Partially Paid -> Paid.
const db = require('./db');

const KINDS = {
    laundry: { table: 'laundry_bills' },
    utility: { table: 'utility_bills' }
};

const run = (sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const all = (sql, params = []) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const get = (sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));

const round2 = (n) => Math.round(n * 100) / 100;
const tableFor = (kind) => {
    if (!KINDS[kind]) throw new Error(`Unknown bill kind: ${kind}`);
    return KINDS[kind].table;
};

const statusFor = (total, paid) => {
    if (paid <= 0.009) return 'Pending';
    return paid >= Number(total || 0) - 0.009 ? 'Paid' : 'Partially Paid';
};

// payments grouped by bill id, oldest first
const paymentsFor = async (kind, billIds) => {
    const map = {};
    if (billIds.length === 0) return map;
    const rows = await all(
        `SELECT * FROM bill_payments WHERE billKind = ? AND billId IN (${billIds.map(() => '?').join(',')}) ORDER BY date, id`,
        [kind, ...billIds]
    );
    rows.forEach(p => { (map[p.billId] = map[p.billId] || []).push(p); });
    return map;
};

// Adds payments, paidAmount and balance to bill rows for API responses
const withPayments = async (kind, bills) => {
    const map = await paymentsFor(kind, bills.map(b => b.id));
    return bills.map(b => {
        const payments = map[b.id] || [];
        const paidAmount = round2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
        return { ...b, payments, paidAmount, balance: round2(Math.max(0, Number(b.totalAmount || 0) - paidAmount)) };
    });
};

// Recompute status (and paidDate = latest payment date) from the payments recorded so far
const refreshStatus = async (kind, billId) => {
    const table = tableFor(kind);
    const bill = await get(`SELECT totalAmount FROM ${table} WHERE id = ?`, [billId]);
    if (!bill) return null;
    const row = await get("SELECT COALESCE(SUM(amount), 0) AS paid, MAX(date) AS lastDate FROM bill_payments WHERE billKind = ? AND billId = ?", [kind, billId]);
    const status = statusFor(bill.totalAmount, row.paid);
    await run(`UPDATE ${table} SET status = ?, paidDate = ? WHERE id = ?`, [status, row.paid > 0 ? row.lastDate : null, billId]);
    return { status, paid: round2(row.paid), balance: round2(Math.max(0, bill.totalAmount - row.paid)) };
};

// Record one payment: an expense plus a bill_payments row, in one transaction.
// amount defaults to the remaining balance; paying more than the balance is refused.
const recordPayment = async (kind, billId, { amount, date, notes, category, description }) => {
    const table = tableFor(kind);
    const bill = await get(`SELECT * FROM ${table} WHERE id = ?`, [billId]);
    if (!bill) throw Object.assign(new Error('Bill not found'), { status: 404 });

    const paidRow = await get("SELECT COALESCE(SUM(amount), 0) AS paid FROM bill_payments WHERE billKind = ? AND billId = ?", [kind, billId]);
    const balance = round2(Number(bill.totalAmount || 0) - paidRow.paid);
    if (balance <= 0.009) throw Object.assign(new Error('This bill is already fully paid.'), { status: 400 });

    const payAmount = amount === undefined || amount === null || amount === '' ? balance : round2(Number(amount));
    if (!(payAmount > 0)) throw Object.assign(new Error('Payment amount must be greater than zero.'), { status: 400 });
    if (payAmount > balance + 0.009) {
        throw Object.assign(new Error(`Payment of LKR ${payAmount.toLocaleString()} is more than the balance due (LKR ${balance.toLocaleString()}).`), { status: 400 });
    }

    const isPart = payAmount < Number(bill.totalAmount || 0) - 0.009;
    const desc = typeof description === 'function' ? description(bill) : description;
    await run('BEGIN TRANSACTION');
    try {
        const expense = await run("INSERT INTO expenses (date, category, amount, description) VALUES (?, ?, ?, ?)",
            [date, category, payAmount, `${desc}${isPart ? ' (part payment)' : ''}`]);
        await run("INSERT INTO bill_payments (billKind, billId, date, amount, notes, expenseId) VALUES (?, ?, ?, ?, ?, ?)",
            [kind, billId, date, payAmount, (notes || '').trim(), expense.lastID]);
        const state = await refreshStatus(kind, billId);
        await run('COMMIT');
        return { amount: payAmount, ...state };
    } catch (err) {
        await run('ROLLBACK').catch(() => {});
        throw err;
    }
};

// Remove one payment and its expense
const deletePayment = async (kind, billId, paymentId) => {
    const payment = await get("SELECT * FROM bill_payments WHERE id = ? AND billKind = ? AND billId = ?", [paymentId, kind, billId]);
    if (!payment) throw Object.assign(new Error('Payment not found'), { status: 404 });
    await run('BEGIN TRANSACTION');
    try {
        if (payment.expenseId) await run("DELETE FROM expenses WHERE id = ?", [payment.expenseId]);
        await run("DELETE FROM bill_payments WHERE id = ?", [payment.id]);
        const state = await refreshStatus(kind, billId);
        await run('COMMIT');
        return state;
    } catch (err) {
        await run('ROLLBACK').catch(() => {});
        throw err;
    }
};

// Remove every payment (and expense) of a bill — used by "revert to pending" and bill deletion.
// Pass inTransaction when the caller already opened one.
const clearPayments = async (kind, billId, { inTransaction = false } = {}) => {
    if (!inTransaction) await run('BEGIN TRANSACTION');
    try {
        await run("DELETE FROM expenses WHERE id IN (SELECT expenseId FROM bill_payments WHERE billKind = ? AND billId = ? AND expenseId IS NOT NULL)", [kind, billId]);
        await run("DELETE FROM bill_payments WHERE billKind = ? AND billId = ?", [kind, billId]);
        // Legacy single expense from before part payments, if it was never migrated
        const bill = await get(`SELECT expenseId FROM ${tableFor(kind)} WHERE id = ?`, [billId]);
        if (bill && bill.expenseId) {
            const stillLinked = await get("SELECT id FROM bill_payments WHERE expenseId = ?", [bill.expenseId]);
            if (!stillLinked) await run("DELETE FROM expenses WHERE id = ?", [bill.expenseId]);
        }
        await run(`UPDATE ${tableFor(kind)} SET expenseId = NULL WHERE id = ?`, [billId]);
        const state = await refreshStatus(kind, billId);
        if (!inTransaction) await run('COMMIT');
        return state;
    } catch (err) {
        if (!inTransaction) await run('ROLLBACK').catch(() => {});
        throw err;
    }
};

// Keep payment expense descriptions in step when a bill's details are edited (amounts are untouched)
const refreshExpenseDescriptions = async (kind, billId, describe) => {
    const bill = await get(`SELECT * FROM ${tableFor(kind)} WHERE id = ?`, [billId]);
    if (!bill) return;
    const payments = await all("SELECT * FROM bill_payments WHERE billKind = ? AND billId = ?", [kind, billId]);
    for (const p of payments) {
        if (!p.expenseId) continue;
        const isPart = Number(p.amount) < Number(bill.totalAmount || 0) - 0.009;
        await run("UPDATE expenses SET description = ? WHERE id = ?", [`${describe(bill)}${isPart ? ' (part payment)' : ''}`, p.expenseId]);
    }
};

// One-time conversion of bills marked Paid before part payments existed: their single linked
// expense becomes one full payment, so totals and Financials stay exactly the same.
const migrateLegacyPaidBills = async () => {
    let converted = 0;
    for (const kind of Object.keys(KINDS)) {
        const table = tableFor(kind);
        const legacy = await all(
            `SELECT b.* FROM ${table} b WHERE b.status = 'Paid'
             AND NOT EXISTS (SELECT 1 FROM bill_payments p WHERE p.billKind = ? AND p.billId = b.id)`,
            [kind]
        );
        for (const b of legacy) {
            await run("INSERT INTO bill_payments (billKind, billId, date, amount, notes, expenseId) VALUES (?, ?, ?, ?, ?, ?)",
                [kind, b.id, b.paidDate || b.date, Number(b.totalAmount || 0), b.paymentNotes || '', b.expenseId || null]);
            converted++;
        }
    }
    return converted;
};

module.exports = {
    withPayments,
    recordPayment,
    deletePayment,
    clearPayments,
    refreshStatus,
    refreshExpenseDescriptions,
    migrateLegacyPaidBills,
    statusFor
};
