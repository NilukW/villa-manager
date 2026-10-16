const express = require('express');
const cors = require('cors');
const db = require('./db');
const { parseICS, generateICS } = require('./ical');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const { parseLaundryPdf } = require('./laundryParser');
const { parseUtilityPdf, UTILITY_TYPES } = require('./utilityParser');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET must be set (at least 32 characters) in backend/.env or the environment.');
    process.exit(1);
}

// Laundry and utility PDFs are parsed in memory only and never written to disk
const uploadPdf = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
});

// --- Auth Routes ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: "Invalid credentials" });

        const valid = bcrypt.compareSync(password, user.password);
        if (!valid) return res.status(401).json({ error: "Invalid credentials" });

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: "Login successful", token, username: user.username });
    });
});

// --- Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "Access denied. No token provided." });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid or expired token." });
        req.user = user;
        next();
    });
};

// Apply auth middleware to API routes
app.use('/api/rooms', authenticateToken);
app.use('/api/reservations', authenticateToken);
app.use('/api/expenses', authenticateToken);
app.use('/api/pending-expenses', authenticateToken);
app.use('/api/laundry', authenticateToken);
app.use('/api/utilities', authenticateToken);
app.use('/api/staff', authenticateToken);
app.use('/api/staff-payments', authenticateToken);
app.use('/api/staff-bonus', authenticateToken);
app.use('/api/notifications', authenticateToken);

// --- Rooms ---
app.get('/api/rooms', (req, res) => {
    db.all("SELECT * FROM rooms", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

// Helper to robustly parse breakfastIncluded to 1 or 0
const parseBreakfast = (val) => (val === true || val === 1 || val === '1' || val === 'true') ? 1 : 0;
const formatReservationRow = (row) => {
    if (!row) return row;
    return {
        ...row,
        breakfastIncluded: parseBreakfast(row.breakfastIncluded)
    };
};

// --- Reservations ---
app.get('/api/reservations', (req, res) => {
    db.all("SELECT * FROM reservations ORDER BY checkInDate ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const sanitized = (rows || []).map(formatReservationRow);
        res.json({ data: sanitized });
    });
});

// Create new reservation
app.post('/api/reservations', (req, res) => {
    const {
        guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
        roomName, roomNames, unitPrice, totalAmount, advancedAmount, advancedPayments, remarks, bookingSource,
        usdAmount, conversionRate, breakfastIncluded
    } = req.body;

    const roomsToBook = roomNames && roomNames.length > 0 ? roomNames : (roomName ? [roomName] : []);

    if (roomsToBook.length === 0) {
        return res.status(400).json({ error: "No rooms selected" });
    }

    const checkSql = `SELECT roomName FROM reservations WHERE roomName IN (${roomsToBook.map(() => '?').join(',')}) AND checkInDate < ? AND checkOutDate > ?`;
    db.all(checkSql, [...roomsToBook, checkOutDate, checkInDate], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows && rows.length > 0) {
            const conflictRooms = [...new Set(rows.map(r => r.roomName))].join(', ');
            return res.status(400).json({ error: `The following rooms are already booked during these dates: ${conflictRooms}` });
        }

        const sql = `INSERT INTO reservations (
            guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
            roomName, unitPrice, totalAmount, advancedAmount, advancedPayments, remarks, bookingSource, groupId,
            usdAmount, conversionRate, breakfastIncluded
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const numRooms = roomsToBook.length;
        const splitTotal = totalAmount ? (totalAmount / numRooms) : 0;
        const splitAdvance = advancedAmount ? (advancedAmount / numRooms) : 0;
        const splitUsdAmount = usdAmount ? (usdAmount / numRooms) : null;
        const newGroupId = Date.now().toString();
        
        let parsedPayments = [];
        try {
            parsedPayments = advancedPayments ? JSON.parse(advancedPayments) : [];
        } catch(e) {}
        
        const splitPayments = parsedPayments.map(p => ({
            ...p,
            amount: p.amount ? (Number(p.amount) / numRooms) : 0
        }));

        const insertPromise = (params) => new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });

        Promise.all(roomsToBook.map(rName => {
            return insertPromise([
                guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
                rName, unitPrice, splitTotal, splitAdvance, JSON.stringify(splitPayments), remarks, bookingSource || 'Manual', newGroupId,
                splitUsdAmount, conversionRate || null, parseBreakfast(breakfastIncluded)
            ]);
        }))
        .then(ids => {
            res.json({
                message: "Reservation(s) created successfully",
                data: { id: ids[0], insertedIds: ids, ...req.body }
            });
        })
        .catch(err => {
            res.status(400).json({ error: err.message });
        });
    });
});

// Get group reservation
app.get('/api/reservations/group/:groupId', (req, res) => {
    db.all("SELECT * FROM reservations WHERE groupId = ?", [req.params.groupId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) return res.status(404).json({ error: "Not found" });
        const sanitized = rows.map(formatReservationRow);
        res.json({ data: sanitized });
    });
});

// Update group reservation
app.put('/api/reservations/group/:groupId', (req, res) => {
    const {
        guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
        roomNames, unitPrice, totalAmount, advancedAmount, advancedPayments, remarks, bookingSource,
        usdAmount, conversionRate, breakfastIncluded
    } = req.body;
    const groupId = req.params.groupId;

    if (!roomNames || roomNames.length === 0) {
        return res.status(400).json({ error: "No rooms selected" });
    }

    const checkSql = `SELECT roomName FROM reservations WHERE roomName IN (${roomNames.map(() => '?').join(',')}) AND checkInDate < ? AND checkOutDate > ? AND groupId != ?`;
    db.all(checkSql, [...roomNames, checkOutDate, checkInDate, groupId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows && rows.length > 0) {
            const conflictRooms = [...new Set(rows.map(r => r.roomName))].join(', ');
            return res.status(400).json({ error: `The following rooms are already booked during these dates: ${conflictRooms}` });
        }

        // Rows are deleted and re-inserted, so carry over fields the edit form doesn't send:
        // the checkout confirmation (whole group) and each room's channel-sync uid
        db.all("SELECT roomName, uid, checkedOutAt FROM reservations WHERE groupId = ?", [groupId], (prevErr, previousRows) => {
        if (prevErr) return res.status(500).json({ error: prevErr.message });
        const uidByRoom = {};
        (previousRows || []).forEach(r => { if (r.uid) uidByRoom[r.roomName] = r.uid; });
        const checkedOutAt = (previousRows || []).map(r => r.checkedOutAt).find(Boolean) || null;

        db.run("DELETE FROM reservations WHERE groupId = ?", [groupId], function(delErr) {
            if (delErr) return res.status(500).json({ error: delErr.message });

            const sql = `INSERT INTO reservations (
                guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
                roomName, unitPrice, totalAmount, advancedAmount, advancedPayments, remarks, bookingSource, groupId,
                usdAmount, conversionRate, breakfastIncluded, uid, checkedOutAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            const numRooms = roomNames.length;
            const splitTotal = totalAmount ? (totalAmount / numRooms) : 0;
            const splitAdvance = advancedAmount ? (advancedAmount / numRooms) : 0;
            const splitUsdAmount = usdAmount ? (usdAmount / numRooms) : null;
            
            let parsedPayments = [];
            try { parsedPayments = advancedPayments ? JSON.parse(advancedPayments) : []; } catch(e) {}
            const splitPayments = parsedPayments.map(p => ({ ...p, amount: p.amount ? (Number(p.amount) / numRooms) : 0 }));

            const insertPromise = (params) => new Promise((resolve, reject) => {
                db.run(sql, params, function (err) {
                    if (err) reject(err); else resolve(this.lastID);
                });
            });

            Promise.all(roomNames.map(rName => {
                return insertPromise([
                    guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
                    rName, unitPrice, splitTotal, splitAdvance, JSON.stringify(splitPayments), remarks, bookingSource || 'Manual', groupId,
                    splitUsdAmount, conversionRate || null, parseBreakfast(breakfastIncluded), uidByRoom[rName] || null, checkedOutAt
                ]);
            }))
            .then(ids => {
                res.json({ message: "Group reservation updated successfully", data: { insertedIds: ids } });
            })
            .catch(err => res.status(400).json({ error: err.message }));
        });
        });
    });
});

// Delete group reservation
app.delete('/api/reservations/group/:groupId', (req, res) => {
    db.run("DELETE FROM reservations WHERE groupId = ?", req.params.groupId, function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Group reservation deleted", changes: this.changes });
    });
});

// Get single reservation
app.get('/api/reservations/:id', (req, res) => {
    db.get("SELECT * FROM reservations WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Not found" });
        res.json({ data: formatReservationRow(row) });
    });
});

// Update reservation
app.put('/api/reservations/:id', (req, res) => {
    const {
        guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
        roomName, unitPrice, totalAmount, advancedAmount, advancedPayments, remarks, bookingSource,
        usdAmount, conversionRate, breakfastIncluded
    } = req.body;

    const checkSql = `SELECT id FROM reservations WHERE roomName = ? AND checkInDate < ? AND checkOutDate > ? AND id != ?`;
    db.get(checkSql, [roomName, checkOutDate, checkInDate, req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(400).json({ error: `The room '${roomName}' is already booked by another guest during these dates!` });

        const sql = `UPDATE reservations SET 
            guestName = ?, phoneNo = ?, nicOrPassport = ?, checkInDate = ?, checkOutDate = ?,
            roomName = ?, unitPrice = ?, totalAmount = ?, advancedAmount = ?, advancedPayments = ?, remarks = ?, bookingSource = ?,
            usdAmount = ?, conversionRate = ?, breakfastIncluded = ?
            WHERE id = ?`;

        const params = [
            guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
            roomName, unitPrice, totalAmount, advancedAmount, advancedPayments || '[]', remarks, bookingSource, 
            usdAmount || null, conversionRate || null, parseBreakfast(breakfastIncluded), req.params.id
        ];

        db.run(sql, params, function (err) {
            if (err) return res.status(400).json({ error: err.message });
            res.json({ message: "Reservation updated successfully", changes: this.changes });
        });
    });
});

// Delete reservation
app.delete('/api/reservations/:id', (req, res) => {
    db.run("DELETE FROM reservations WHERE id = ?", req.params.id, function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Reservation deleted", changes: this.changes });
    });
});

// Payments for a booking group, as stored on each room row (already split per room).
// Older bookings may only have advancedAmount, which is turned into a single payment.
const groupPaymentState = (rows) => {
    const first = rows[0];
    let payments = [];
    try { payments = first.advancedPayments ? JSON.parse(first.advancedPayments) : []; } catch (e) {}
    if (payments.length === 0 && Number(first.advancedAmount) > 0) {
        payments = [{ date: first.checkInDate, amount: String(first.advancedAmount) }];
    }
    const total = rows.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
    const paid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0) * rows.length;
    return { payments, total, paid, pending: Math.round((total - paid) * 100) / 100 };
};

// Confirm a guest's checkout. Any remaining balance must be settled in the same step:
// amountReceived is recorded as a payment, and checkout is refused while a balance remains.
app.post('/api/reservations/group/:groupId/checkout', (req, res) => {
    const groupId = req.params.groupId;
    const amountReceived = Number(req.body.amountReceived || 0);
    const paymentDate = req.body.paymentDate || todayKey();
    const checkoutDate = req.body.checkoutDate || todayKey();
    if (isNaN(amountReceived) || amountReceived < 0) return res.status(400).json({ error: "Invalid amount received" });

    db.all("SELECT * FROM reservations WHERE groupId = ? OR (id = ? AND (groupId IS NULL OR groupId = ''))", [groupId, groupId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) return res.status(404).json({ error: "Booking not found" });
        if (rows.some(r => r.checkedOutAt)) return res.status(400).json({ error: "This guest has already been checked out." });

        const state = groupPaymentState(rows);
        const remaining = Math.round((state.pending - amountReceived) * 100) / 100;
        if (remaining > 0.05) {
            return res.status(400).json({
                error: `A balance of LKR ${state.pending.toLocaleString()} is due. Settle the full balance to confirm the checkout (LKR ${remaining.toLocaleString()} still short).`
            });
        }

        const payments = [...state.payments];
        if (amountReceived > 0) payments.push({ date: paymentDate, amount: String(amountReceived / rows.length) });
        const advancePerRoom = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const ids = rows.map(r => r.id);

        db.run(`UPDATE reservations SET advancedPayments = ?, advancedAmount = ?, checkedOutAt = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
            [JSON.stringify(payments), advancePerRoom, checkoutDate, ...ids], (upErr) => {
            if (upErr) return res.status(500).json({ error: upErr.message });
            res.json({
                message: amountReceived > 0
                    ? `Payment of LKR ${amountReceived.toLocaleString()} recorded and checkout confirmed`
                    : "Checkout confirmed",
                data: { checkedOutAt: checkoutDate }
            });
        });
    });
});

// Undo a checkout confirmation (payments recorded with it are kept)
app.delete('/api/reservations/group/:groupId/checkout', (req, res) => {
    const groupId = req.params.groupId;
    db.run("UPDATE reservations SET checkedOutAt = NULL WHERE groupId = ? OR (id = ? AND (groupId IS NULL OR groupId = ''))", [groupId, groupId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Booking not found" });
        res.json({ message: "Checkout undone" });
    });
});

// Settle group reservation balance
app.post('/api/reservations/group/:groupId/settle', (req, res) => {
    const { amountReceived, date } = req.body;
    const groupId = req.params.groupId;

    if (!amountReceived || isNaN(amountReceived)) {
        return res.status(400).json({ error: "Invalid amount received" });
    }

    db.all("SELECT * FROM reservations WHERE groupId = ?", [groupId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) return res.status(404).json({ error: "Group not found" });

        const firstRow = rows[0];
        let payments = [];
        try {
            payments = firstRow.advancedPayments ? JSON.parse(firstRow.advancedPayments) : [];
        } catch (e) {}

        const numRooms = rows.length;
        const totalAmountSettled = Number(amountReceived);
        
        // Add the explicitly split settlement amount to the already split payments list
        const splitSettledAmount = totalAmountSettled / numRooms;
        const settlementDate = date || todayKey();
        
        payments.push({
            date: settlementDate,
            amount: splitSettledAmount.toString()
        });

        // Calculate the new split advance per room from the updated payments array
        const splitAdvance = payments.reduce((sum, p) => sum + Number(p.amount), 0);
        
        const newPaymentsJson = JSON.stringify(payments);

        db.run("UPDATE reservations SET advancedAmount = ?, advancedPayments = ? WHERE groupId = ?", 
            [splitAdvance, newPaymentsJson, groupId], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            res.json({ message: "Balance settled completely" });
        });
    });
});

// --- Expenses Management ---
app.get('/api/expenses', (req, res) => {
    db.all("SELECT * FROM expenses ORDER BY date DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.post('/api/expenses', (req, res) => {
    const { date, category, amount, description } = req.body;
    if (!date || !category || !amount) return res.status(400).json({ error: "Missing required fields" });
    
    db.run("INSERT INTO expenses (date, category, amount, description) VALUES (?, ?, ?, ?)", 
        [date, category, amount, description || ''], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Expense added", data: { id: this.lastID, date, category, amount, description } });
    });
});

app.delete('/api/expenses/:id', (req, res) => {
    db.run("DELETE FROM expenses WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Expense deleted", changes: this.changes });
    });
});

// --- Pending Expenses Management ---
app.get('/api/pending-expenses', (req, res) => {
    db.all("SELECT * FROM pending_expenses ORDER BY date DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.post('/api/pending-expenses', (req, res) => {
    const { date, category, amount, description } = req.body;
    if (!date || !category || !amount) return res.status(400).json({ error: "Missing required fields" });
    
    db.run("INSERT INTO pending_expenses (date, category, amount, description) VALUES (?, ?, ?, ?)", 
        [date, category, amount, description || ''], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Pending expense added", data: { id: this.lastID, date, category, amount, description } });
    });
});

app.delete('/api/pending-expenses/:id', (req, res) => {
    db.run("DELETE FROM pending_expenses WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Pending expense deleted", changes: this.changes });
    });
});

app.post('/api/pending-expenses/:id/settle', (req, res) => {
    const id = req.params.id;
    const settlementDate = req.body.date || todayKey();
    
    db.get("SELECT * FROM pending_expenses WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Pending expense not found" });
        
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run("INSERT INTO expenses (date, category, amount, description) VALUES (?, ?, ?, ?)", 
                [settlementDate, row.category, row.amount, row.description], function(insertErr) {
                if (insertErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: insertErr.message });
                }
                const newExpenseId = this.lastID;
                db.run("DELETE FROM pending_expenses WHERE id = ?", [id], function(deleteErr) {
                    if (deleteErr) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: deleteErr.message });
                    }
                    db.run("COMMIT");
                    res.json({ 
                        message: "Expense settled successfully", 
                        data: { id: newExpenseId, date: settlementDate, category: row.category, amount: row.amount, description: row.description } 
                    });
                });
            });
        });
    });
});

// --- Laundry Bills & Analytics Management ---

// A laundry bill is a duplicate when the identical PDF (SHA-256) or the same invoice number
// already exists. Calls back with (err, existingBill, message).
const findLaundryDuplicate = ({ invoiceNo, fileHash }, cb) => {
    db.get(
        `SELECT id, invoiceNo, date, status, totalAmount, fileHash FROM laundry_bills
         WHERE (? IS NOT NULL AND fileHash = ?) OR (? != '' AND LOWER(invoiceNo) = LOWER(?))
         ORDER BY (fileHash = ?) DESC LIMIT 1`,
        [fileHash || null, fileHash || null, invoiceNo || '', invoiceNo || '', fileHash || null],
        (err, existing) => {
            if (err || !existing) return cb(err, null, null);
            const details = `invoice ${existing.invoiceNo} on ${existing.date} (Status: ${existing.status}, Amount: LKR ${(existing.totalAmount || 0).toLocaleString()})`;
            const message = fileHash && existing.fileHash === fileHash
                ? `This PDF has already been uploaded as ${details}. Duplicate bills are not allowed.`
                : `Invoice "${invoiceNo}" has already been uploaded as ${details}. Duplicate bills are not allowed.`;
            cb(null, existing, message);
        }
    );
};

// Upload and preview PDF data (with duplicate check)
app.post('/api/laundry/upload-preview', uploadPdf.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No PDF file provided" });
    }
    try {
        const parsed = await parseLaundryPdf(req.file.buffer);
        const fileInfo = {
            originalName: req.file.originalname,
            size: req.file.size,
            hash: crypto.createHash('sha256').update(req.file.buffer).digest('hex')
        };

        findLaundryDuplicate({ invoiceNo: parsed.invoiceNo, fileHash: fileInfo.hash }, (dbErr, existing, message) => {
            if (dbErr) return res.status(500).json({ error: dbErr.message });
            if (existing) {
                return res.status(409).json({ error: message, duplicate: true, existingBill: existing });
            }
            res.json({
                message: "Laundry invoice parsed successfully",
                data: parsed,
                file: fileInfo
            });
        });
    } catch (err) {
        console.error("Error parsing laundry PDF:", err);
        res.status(500).json({ error: "Failed to parse laundry PDF: " + err.message });
    }
});

// Get all laundry bills with their line items
app.get('/api/laundry/bills', (req, res) => {
    db.all("SELECT * FROM laundry_bills ORDER BY date DESC, id DESC", [], (err, bills) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!bills || bills.length === 0) return res.json({ data: [] });

        const billIds = bills.map(b => b.id);
        const placeholders = billIds.map(() => '?').join(',');
        db.all(`SELECT * FROM laundry_bill_items WHERE billId IN (${placeholders}) ORDER BY id ASC`, billIds, (itemErr, items) => {
            if (itemErr) return res.status(500).json({ error: itemErr.message });

            const itemsMap = {};
            (items || []).forEach(it => {
                if (!itemsMap[it.billId]) itemsMap[it.billId] = [];
                itemsMap[it.billId].push(it);
            });

            const enriched = bills.map(b => {
                let parsedDaily = {};
                try {
                    if (b.dailyBreakdown) parsedDaily = JSON.parse(b.dailyBreakdown);
                } catch(e) {}
                return {
                    ...b,
                    dailyBreakdown: parsedDaily,
                    items: itemsMap[b.id] || []
                };
            });

            res.json({ data: enriched });
        });
    });
});

// Get single laundry bill
app.get('/api/laundry/bills/:id', (req, res) => {
    db.get("SELECT * FROM laundry_bills WHERE id = ?", [req.params.id], (err, bill) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!bill) return res.status(404).json({ error: "Bill not found" });

        db.all("SELECT * FROM laundry_bill_items WHERE billId = ? ORDER BY id ASC", [bill.id], (itemErr, items) => {
            if (itemErr) return res.status(500).json({ error: itemErr.message });
            let parsedDaily = {};
            try {
                if (bill.dailyBreakdown) parsedDaily = JSON.parse(bill.dailyBreakdown);
            } catch(e) {}
            res.json({
                data: {
                    ...bill,
                    dailyBreakdown: parsedDaily,
                    items: items || []
                }
            });
        });
    });
});

// Create new laundry bill (as Pending or Paid)
app.post('/api/laundry/bills', (req, res) => {
    const {
        invoiceNo, vendor, date, month, totalQty, totalAmount,
        status, paidDate, paymentNotes, pdfPath, originalFileName,
        dailyBreakdown, items, fileHash
    } = req.body;

    if (!invoiceNo || !date || totalAmount === undefined) {
        return res.status(400).json({ error: "Missing required fields: invoiceNo, date, or totalAmount" });
    }

    findLaundryDuplicate({ invoiceNo, fileHash }, (checkErr, existing, message) => {
        if (checkErr) return res.status(500).json({ error: checkErr.message });
        if (existing) {
            return res.status(409).json({ error: message, duplicate: true, existingBill: existing });
        }

        const isPaid = status === 'Paid';
        const finalPaidDate = isPaid ? (paidDate || date) : null;
        const dailyStr = typeof dailyBreakdown === 'object' ? JSON.stringify(dailyBreakdown) : (dailyBreakdown || '{}');

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

        const insertSql = `INSERT INTO laundry_bills (
            invoiceNo, vendor, date, month, totalQty, totalAmount, status,
            paidDate, paymentNotes, pdfPath, originalFileName, dailyBreakdown, fileHash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        db.run(insertSql, [
            invoiceNo, vendor || 'Shiny Laundry', date, month || '',
            Number(totalQty || 0), Number(totalAmount || 0), isPaid ? 'Paid' : 'Pending',
            finalPaidDate, paymentNotes || '', pdfPath || '', originalFileName || '', dailyStr, fileHash || null
        ], function(insertErr) {
            if (insertErr) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: insertErr.message });
            }

            const newBillId = this.lastID;
            const lineItems = Array.isArray(items) ? items : [];

            if (lineItems.length > 0) {
                const itemStmt = db.prepare("INSERT INTO laundry_bill_items (billId, description, quantity, unitPrice, amount) VALUES (?, ?, ?, ?, ?)");
                lineItems.forEach(it => {
                    itemStmt.run([
                        newBillId,
                        it.description || 'Linen Item',
                        Number(it.quantity || 0),
                        Number(it.unitPrice || 0),
                        Number(it.amount || 0)
                    ]);
                });
                itemStmt.finalize();
            }

            if (isPaid) {
                const desc = `Laundry Bill ${invoiceNo} - ${vendor || 'Shiny Laundry'}${month ? ` (${month})` : ''} - ${totalQty || 0} items`;
                db.run("INSERT INTO expenses (date, category, amount, description) VALUES (?, 'Laundry', ?, ?)",
                    [finalPaidDate, Number(totalAmount), desc], function(expErr) {
                    if (expErr) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: expErr.message });
                    }
                    const newExpenseId = this.lastID;
                    db.run("UPDATE laundry_bills SET expenseId = ? WHERE id = ?", [newExpenseId, newBillId], function(upErr) {
                        if (upErr) {
                            db.run("ROLLBACK");
                            return res.status(500).json({ error: upErr.message });
                        }
                        db.run("COMMIT");
                        res.json({
                            message: "Laundry bill saved and marked as paid",
                            data: { id: newBillId, expenseId: newExpenseId, status: 'Paid' }
                        });
                    });
                });
            } else {
                db.run("COMMIT");
                res.json({
                    message: "Laundry bill saved as pending",
                    data: { id: newBillId, status: 'Pending' }
                });
            }
        });
    });
    });
});

// Mark a pending bill as Paid
app.post('/api/laundry/bills/:id/pay', (req, res) => {
    const billId = req.params.id;
    const { paidDate, paymentNotes } = req.body;
    const finalPaidDate = paidDate || todayKey();

    db.get("SELECT * FROM laundry_bills WHERE id = ?", [billId], (err, bill) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!bill) return res.status(404).json({ error: "Bill not found" });
        if (bill.status === 'Paid') return res.status(400).json({ error: "Bill is already marked as paid" });

        const desc = `Laundry Bill ${bill.invoiceNo} - ${bill.vendor || 'Shiny Laundry'}${bill.month ? ` (${bill.month})` : ''} - ${bill.totalQty || 0} items`;

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run("INSERT INTO expenses (date, category, amount, description) VALUES (?, 'Laundry', ?, ?)",
                [finalPaidDate, Number(bill.totalAmount), desc], function(expErr) {
                if (expErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: expErr.message });
                }
                const newExpenseId = this.lastID;
                const notes = paymentNotes !== undefined ? paymentNotes : (bill.paymentNotes || '');
                db.run("UPDATE laundry_bills SET status = 'Paid', paidDate = ?, paymentNotes = ?, expenseId = ? WHERE id = ?",
                    [finalPaidDate, notes, newExpenseId, billId], function(upErr) {
                    if (upErr) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: upErr.message });
                    }
                    db.run("COMMIT");
                    res.json({
                        message: "Bill marked as paid and added to expenses",
                        data: { id: billId, expenseId: newExpenseId, paidDate: finalPaidDate, status: 'Paid' }
                    });
                });
            });
        });
    });
});

// Revert a paid bill back to Pending
app.post('/api/laundry/bills/:id/unpay', (req, res) => {
    const billId = req.params.id;
    db.get("SELECT * FROM laundry_bills WHERE id = ?", [billId], (err, bill) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!bill) return res.status(404).json({ error: "Bill not found" });

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            if (bill.expenseId) {
                db.run("DELETE FROM expenses WHERE id = ?", [bill.expenseId], () => {});
            }
            db.run("UPDATE laundry_bills SET status = 'Pending', paidDate = NULL, expenseId = NULL WHERE id = ?", [billId], function(upErr) {
                if (upErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: upErr.message });
                }
                db.run("COMMIT");
                res.json({ message: "Bill reverted to pending status", data: { id: billId, status: 'Pending' } });
            });
        });
    });
});

// Update a laundry bill
app.put('/api/laundry/bills/:id', (req, res) => {
    const billId = req.params.id;
    const {
        invoiceNo, vendor, date, month, totalQty, totalAmount,
        status, paidDate, paymentNotes, items, dailyBreakdown
    } = req.body;

    db.get("SELECT * FROM laundry_bills WHERE id = ?", [billId], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!existing) return res.status(404).json({ error: "Bill not found" });

        const isPaid = (status || existing.status) === 'Paid';
        const finalPaidDate = isPaid ? (paidDate || existing.paidDate || date || existing.date) : null;
        const dailyStr = dailyBreakdown !== undefined 
            ? (typeof dailyBreakdown === 'object' ? JSON.stringify(dailyBreakdown) : dailyBreakdown)
            : existing.dailyBreakdown;

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            const updateSql = `UPDATE laundry_bills SET
                invoiceNo = ?, vendor = ?, date = ?, month = ?, totalQty = ?,
                totalAmount = ?, status = ?, paidDate = ?, paymentNotes = ?, dailyBreakdown = ?
                WHERE id = ?`;

            db.run(updateSql, [
                invoiceNo || existing.invoiceNo,
                vendor || existing.vendor,
                date || existing.date,
                month !== undefined ? month : existing.month,
                Number(totalQty !== undefined ? totalQty : existing.totalQty),
                Number(totalAmount !== undefined ? totalAmount : existing.totalAmount),
                isPaid ? 'Paid' : 'Pending',
                finalPaidDate,
                paymentNotes !== undefined ? paymentNotes : existing.paymentNotes,
                dailyStr,
                billId
            ], function(upErr) {
                if (upErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: upErr.message });
                }

                // If items are provided, replace them
                if (Array.isArray(items)) {
                    db.run("DELETE FROM laundry_bill_items WHERE billId = ?", [billId], (delErr) => {
                        if (!delErr && items.length > 0) {
                            const itemStmt = db.prepare("INSERT INTO laundry_bill_items (billId, description, quantity, unitPrice, amount) VALUES (?, ?, ?, ?, ?)");
                            items.forEach(it => {
                                itemStmt.run([
                                    billId,
                                    it.description || 'Linen Item',
                                    Number(it.quantity || 0),
                                    Number(it.unitPrice || 0),
                                    Number(it.amount || 0)
                                ]);
                            });
                            itemStmt.finalize();
                        }
                    });
                }

                // Sync linked expense if already paid
                if (existing.expenseId) {
                    const desc = `Laundry Bill ${invoiceNo || existing.invoiceNo} - ${vendor || existing.vendor}${month ? ` (${month})` : ''} - ${totalQty || existing.totalQty} items`;
                    db.run("UPDATE expenses SET date = ?, amount = ?, description = ? WHERE id = ?",
                        [finalPaidDate, Number(totalAmount || existing.totalAmount), desc, existing.expenseId], () => {});
                }

                db.run("COMMIT");
                res.json({ message: "Laundry bill updated successfully" });
            });
        });
    });
});

// Delete a laundry bill
app.delete('/api/laundry/bills/:id', (req, res) => {
    const billId = req.params.id;
    db.get("SELECT * FROM laundry_bills WHERE id = ?", [billId], (err, bill) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!bill) return res.status(404).json({ error: "Bill not found" });

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            if (bill.expenseId) {
                db.run("DELETE FROM expenses WHERE id = ?", [bill.expenseId], () => {});
            }
            db.run("DELETE FROM laundry_bill_items WHERE billId = ?", [billId], () => {});
            db.run("DELETE FROM laundry_bills WHERE id = ?", [billId], function(delErr) {
                if (delErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: delErr.message });
                }
                db.run("COMMIT");
                res.json({ message: "Laundry bill deleted successfully" });
            });
        });
    });
});

// --- Utility Bills (Electricity, Water, Telecom) ---

const UTILITY_LABELS = { electricity: 'Electricity', water: 'Water', telecom: 'Telecom', booking: 'Booking.com' };

// Financials category for each bill type when it is marked paid
const UTILITY_EXPENSE_CATEGORIES = { booking: 'Commission' };
const utilityExpenseCategory = (type) => UTILITY_EXPENSE_CATEGORIES[type] || 'Utilities';

const utilityExpenseDesc = (bill) => {
    if (bill.type === 'booking') {
        return `Booking.com Commission - Invoice ${bill.billNo}${bill.month ? ` (${bill.month})` : ''}${bill.accountNo ? ` - Property ${bill.accountNo}` : ''}`;
    }
    const label = UTILITY_LABELS[bill.type] || 'Utility';
    const units = bill.unitsUsed !== null && bill.unitsUsed !== undefined && bill.unitsUsed !== ''
        ? ` - ${bill.unitsUsed} ${bill.type === 'water' ? 'm³' : 'units'}`
        : '';
    // Name the account rather than the bill ref so multiple accounts stay distinguishable in Financials
    const ref = bill.accountNo ? `A/C ${bill.accountNo}${bill.premises ? ` (${bill.premises.split(',')[0].trim()})` : ''}` : bill.billNo;
    return `${label} Bill ${ref}${bill.provider ? ` - ${bill.provider}` : ''}${bill.month ? ` (${bill.month})` : ''}${units}`;
};

const toNullableNumber = (val) => {
    if (val === undefined || val === null || val === '') return null;
    const n = Number(val);
    return isNaN(n) ? null : n;
};

const formatUtilityRow = (row) => {
    let charges = [];
    try {
        if (row.charges) charges = JSON.parse(row.charges);
    } catch (e) {}
    return { ...row, charges };
};

// Previous due = this month's charges of earlier bills on the same account that are still
// Pending in the app. Provider statements carry their own "Previous Due", but it lags behind
// actual payments, so it is never stored.
const withRunningDue = (rows) => {
    const sortKey = (b) => `${b.periodTo || b.date}|${String(b.id).padStart(10, '0')}`;
    const unpaidByAccount = {};
    const computed = {};
    [...rows].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).forEach(b => {
        const key = `${b.type}|${b.accountNo || `bill-${b.id}`}`;
        const previousDue = Math.round((unpaidByAccount[key] || 0) * 100) / 100;
        computed[b.id] = { previousDue, totalDue: Math.round((previousDue + Number(b.totalAmount || 0)) * 100) / 100 };
        if (b.status !== 'Paid') unpaidByAccount[key] = (unpaidByAccount[key] || 0) + Number(b.totalAmount || 0);
    });
    return rows.map(b => ({ ...formatUtilityRow(b), ...computed[b.id] }));
};

const normKey = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// A bill is a duplicate when any one of these matches an existing bill:
//  1. the identical PDF file (SHA-256), whatever type it was saved under
//  2. same type + bill/invoice number
//  3. same type + account + billing month — catches manual re-entry or a re-issued bill with a new number
// Calls back with (err, existingBill, message).
const findUtilityDuplicate = (bill, excludeId, cb) => {
    db.all(
        "SELECT id, type, billNo, accountNo, month, date, status, totalAmount, fileHash FROM utility_bills WHERE id != ? AND (type = ? OR fileHash = ?)",
        [excludeId || 0, bill.type, bill.fileHash || '\u0000'],
        (err, rows) => {
            if (err) return cb(err);
            const label = (t) => UTILITY_LABELS[t] || 'Utility';
            const describe = (e) => `${label(e.type)} bill ${e.billNo} for ${e.month || e.date} (Status: ${e.status}, Amount: LKR ${Number(e.totalAmount || 0).toLocaleString()})`;
            const sameFile = bill.fileHash && rows.find(e => e.fileHash === bill.fileHash);
            if (sameFile) {
                return cb(null, sameFile, `This PDF has already been uploaded as ${describe(sameFile)}. Duplicate bills are not allowed.`);
            }
            const sameNo = bill.billNo && rows.find(e => e.type === bill.type && normKey(e.billNo) === normKey(bill.billNo));
            if (sameNo) {
                return cb(null, sameNo, `Bill "${bill.billNo}" has already been uploaded: ${describe(sameNo)}. Duplicate bills are not allowed.`);
            }
            const sameMonth = bill.accountNo && bill.month && rows.find(e =>
                e.type === bill.type && normKey(e.accountNo) === normKey(bill.accountNo) && normKey(e.month) === normKey(bill.month));
            if (sameMonth) {
                return cb(null, sameMonth, `Account ${bill.accountNo} already has a bill for ${bill.month}: ${describe(sameMonth)}. Duplicate bills are not allowed.`);
            }
            cb(null, null, null);
        }
    );
};

// Upload and preview a utility bill PDF (with duplicate check)
app.post('/api/utilities/upload-preview', uploadPdf.single('file'), async (req, res) => {
    const type = req.body.type;
    if (!UTILITY_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid utility type. Expected one of: ${UTILITY_TYPES.join(', ')}` });
    }
    if (!req.file) {
        return res.status(400).json({ error: "No PDF file provided" });
    }
    try {
        const parsed = await parseUtilityPdf(type, req.file.buffer);
        const fileInfo = {
            originalName: req.file.originalname,
            size: req.file.size,
            hash: crypto.createHash('sha256').update(req.file.buffer).digest('hex')
        };

        findUtilityDuplicate({ ...parsed, fileHash: fileInfo.hash }, null, (dbErr, existing, message) => {
            if (dbErr) return res.status(500).json({ error: dbErr.message });
            if (existing) {
                return res.status(409).json({ error: message, duplicate: true, existingBill: existing });
            }
            res.json({ message: "Utility bill parsed", data: parsed, file: fileInfo });
        });
    } catch (err) {
        console.error("Error parsing utility PDF:", err);
        res.status(500).json({ error: "Failed to parse utility PDF: " + err.message });
    }
});

// Get utility bills, optionally filtered by type
app.get('/api/utilities/bills', (req, res) => {
    const { type } = req.query;
    const sql = type
        ? "SELECT * FROM utility_bills WHERE type = ? ORDER BY date DESC, id DESC"
        : "SELECT * FROM utility_bills ORDER BY date DESC, id DESC";
    db.all(sql, type ? [type] : [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: withRunningDue(rows || []) });
    });
});

// Get single utility bill
app.get('/api/utilities/bills/:id', (req, res) => {
    db.get("SELECT * FROM utility_bills WHERE id = ?", [req.params.id], (err, bill) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!bill) return res.status(404).json({ error: "Bill not found" });
        if (!bill.accountNo) return res.json({ data: withRunningDue([bill])[0] });

        db.all("SELECT * FROM utility_bills WHERE type = ? AND accountNo = ?", [bill.type, bill.accountNo], (accErr, rows) => {
            if (accErr) return res.status(500).json({ error: accErr.message });
            res.json({ data: withRunningDue(rows).find(r => r.id === bill.id) });
        });
    });
});

// Create new utility bill (as Pending or Paid)
app.post('/api/utilities/bills', (req, res) => {
    const {
        type, billNo, provider, accountNo, tariff, premises, date, month, periodFrom, periodTo, dueDate,
        previousReading, currentReading, unitsUsed, totalAmount, charges,
        status, paidDate, paymentNotes, originalFileName, fileHash
    } = req.body;

    if (!UTILITY_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid utility type. Expected one of: ${UTILITY_TYPES.join(', ')}` });
    }
    if (!billNo || !date || totalAmount === undefined || totalAmount === '') {
        return res.status(400).json({ error: "Missing required fields: billNo, date, or totalAmount" });
    }

    findUtilityDuplicate({ type, billNo, accountNo, month, fileHash }, null, (checkErr, existing, message) => {
        if (checkErr) return res.status(500).json({ error: checkErr.message });
        if (existing) {
            return res.status(409).json({ error: message, duplicate: true, existingBill: existing });
        }

        const isPaid = status === 'Paid';
        const finalPaidDate = isPaid ? (paidDate || date) : null;
        const chargesStr = JSON.stringify(Array.isArray(charges) ? charges : []);
        const bill = {
            type, billNo, provider: provider || '', month: month || '',
            accountNo: accountNo || '', premises: premises || '',
            unitsUsed: toNullableNumber(unitsUsed)
        };

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            const insertSql = `INSERT INTO utility_bills (
                type, billNo, provider, accountNo, tariff, premises, date, month, periodFrom, periodTo, dueDate,
                previousReading, currentReading, unitsUsed, totalAmount, charges,
                status, paidDate, paymentNotes, originalFileName, fileHash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            db.run(insertSql, [
                type, billNo, bill.provider, accountNo || '', tariff || '', premises || '', date, bill.month,
                periodFrom || null, periodTo || null, dueDate || null,
                toNullableNumber(previousReading), toNullableNumber(currentReading), bill.unitsUsed,
                Number(totalAmount || 0), chargesStr,
                isPaid ? 'Paid' : 'Pending', finalPaidDate, paymentNotes || '', originalFileName || '', fileHash || null
            ], function(insertErr) {
                if (insertErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: insertErr.message });
                }
                const newBillId = this.lastID;

                if (!isPaid) {
                    db.run("COMMIT");
                    return res.json({
                        message: "Utility bill saved as pending",
                        data: { id: newBillId, status: 'Pending' }
                    });
                }

                db.run("INSERT INTO expenses (date, category, amount, description) VALUES (?, ?, ?, ?)",
                    [finalPaidDate, utilityExpenseCategory(type), Number(totalAmount), utilityExpenseDesc(bill)], function(expErr) {
                    if (expErr) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: expErr.message });
                    }
                    const newExpenseId = this.lastID;
                    db.run("UPDATE utility_bills SET expenseId = ? WHERE id = ?", [newExpenseId, newBillId], function(upErr) {
                        if (upErr) {
                            db.run("ROLLBACK");
                            return res.status(500).json({ error: upErr.message });
                        }
                        db.run("COMMIT");
                        res.json({
                            message: "Utility bill saved and marked as paid",
                            data: { id: newBillId, expenseId: newExpenseId, status: 'Paid' }
                        });
                    });
                });
            });
        });
    });
});

// Mark a pending utility bill as Paid
app.post('/api/utilities/bills/:id/pay', (req, res) => {
    const billId = req.params.id;
    const { paidDate, paymentNotes } = req.body;
    const finalPaidDate = paidDate || todayKey();

    db.get("SELECT * FROM utility_bills WHERE id = ?", [billId], (err, bill) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!bill) return res.status(404).json({ error: "Bill not found" });
        if (bill.status === 'Paid') return res.status(400).json({ error: "Bill is already marked as paid" });

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run("INSERT INTO expenses (date, category, amount, description) VALUES (?, ?, ?, ?)",
                [finalPaidDate, utilityExpenseCategory(bill.type), Number(bill.totalAmount), utilityExpenseDesc(bill)], function(expErr) {
                if (expErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: expErr.message });
                }
                const newExpenseId = this.lastID;
                const notes = paymentNotes !== undefined ? paymentNotes : (bill.paymentNotes || '');
                db.run("UPDATE utility_bills SET status = 'Paid', paidDate = ?, paymentNotes = ?, expenseId = ? WHERE id = ?",
                    [finalPaidDate, notes, newExpenseId, billId], function(upErr) {
                    if (upErr) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: upErr.message });
                    }
                    db.run("COMMIT");
                    res.json({
                        message: "Bill marked as paid and added to expenses",
                        data: { id: billId, expenseId: newExpenseId, paidDate: finalPaidDate, status: 'Paid' }
                    });
                });
            });
        });
    });
});

// Revert a paid utility bill back to Pending
app.post('/api/utilities/bills/:id/unpay', (req, res) => {
    const billId = req.params.id;
    db.get("SELECT * FROM utility_bills WHERE id = ?", [billId], (err, bill) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!bill) return res.status(404).json({ error: "Bill not found" });

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            if (bill.expenseId) {
                db.run("DELETE FROM expenses WHERE id = ?", [bill.expenseId], () => {});
            }
            db.run("UPDATE utility_bills SET status = 'Pending', paidDate = NULL, expenseId = NULL WHERE id = ?", [billId], function(upErr) {
                if (upErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: upErr.message });
                }
                db.run("COMMIT");
                res.json({ message: "Bill reverted to pending status", data: { id: billId, status: 'Pending' } });
            });
        });
    });
});

// Update a utility bill
app.put('/api/utilities/bills/:id', (req, res) => {
    const billId = req.params.id;

    db.get("SELECT * FROM utility_bills WHERE id = ?", [billId], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!existing) return res.status(404).json({ error: "Bill not found" });

        // Fields absent from the body keep their stored value
        const pick = (field) => req.body[field] !== undefined ? req.body[field] : existing[field];
        const pickNumber = (field) => req.body[field] !== undefined ? toNullableNumber(req.body[field]) : existing[field];

        const merged = {
            type: existing.type,
            billNo: pick('billNo') || existing.billNo,
            provider: pick('provider'),
            accountNo: pick('accountNo'),
            tariff: pick('tariff'),
            premises: pick('premises'),
            date: pick('date') || existing.date,
            month: pick('month'),
            periodFrom: pick('periodFrom') || null,
            periodTo: pick('periodTo') || null,
            dueDate: pick('dueDate') || null,
            previousReading: pickNumber('previousReading'),
            currentReading: pickNumber('currentReading'),
            unitsUsed: pickNumber('unitsUsed'),
            totalAmount: Number(pick('totalAmount') || 0),
            charges: req.body.charges !== undefined ? JSON.stringify(Array.isArray(req.body.charges) ? req.body.charges : []) : existing.charges,
            paymentNotes: pick('paymentNotes')
        };
        // Paid status changes go through /pay and /unpay so the linked expense stays consistent
        const finalPaidDate = existing.status === 'Paid' ? (req.body.paidDate || existing.paidDate) : null;

        findUtilityDuplicate(merged, billId, (dupErr, duplicate, message) => {
            if (dupErr) return res.status(500).json({ error: dupErr.message });
            if (duplicate) {
                return res.status(409).json({ error: message, duplicate: true, existingBill: duplicate });
            }

            db.serialize(() => {
                db.run("BEGIN TRANSACTION");

                const updateSql = `UPDATE utility_bills SET
                    billNo = ?, provider = ?, accountNo = ?, tariff = ?, premises = ?, date = ?, month = ?,
                    periodFrom = ?, periodTo = ?, dueDate = ?,
                    previousReading = ?, currentReading = ?, unitsUsed = ?,
                    totalAmount = ?, charges = ?, paidDate = ?, paymentNotes = ?
                    WHERE id = ?`;

                db.run(updateSql, [
                    merged.billNo, merged.provider, merged.accountNo, merged.tariff, merged.premises, merged.date, merged.month,
                    merged.periodFrom, merged.periodTo, merged.dueDate,
                    merged.previousReading, merged.currentReading, merged.unitsUsed,
                    merged.totalAmount, merged.charges, finalPaidDate, merged.paymentNotes,
                    billId
                ], function(upErr) {
                    if (upErr) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: upErr.message });
                    }

                    // Sync linked expense if already paid
                    if (existing.expenseId) {
                        db.run("UPDATE expenses SET date = ?, amount = ?, description = ? WHERE id = ?",
                            [finalPaidDate, merged.totalAmount, utilityExpenseDesc(merged), existing.expenseId], () => {});
                    }

                    db.run("COMMIT");
                    res.json({ message: "Utility bill updated successfully" });
                });
            });
        });
    });
});

// Delete a utility bill
app.delete('/api/utilities/bills/:id', (req, res) => {
    const billId = req.params.id;
    db.get("SELECT * FROM utility_bills WHERE id = ?", [billId], (err, bill) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!bill) return res.status(404).json({ error: "Bill not found" });

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            if (bill.expenseId) {
                db.run("DELETE FROM expenses WHERE id = ?", [bill.expenseId], () => {});
            }
            db.run("DELETE FROM utility_bills WHERE id = ?", [billId], function(delErr) {
                if (delErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: delErr.message });
                }
                db.run("COMMIT");
                res.json({ message: "Utility bill deleted successfully" });
            });
        });
    });
});

// --- Staff & Salary Payments ---

const STAFF_PAYMENT_TYPES = ['advance', 'salary'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isMonthKey = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');
const monthLabel = (m) => `${MONTH_NAMES[parseInt(m.slice(5, 7), 10) - 1]} ${m.slice(0, 4)}`;
const staffExpenseDesc = (type, name, month, notes) =>
    `${type === 'advance' ? 'Salary Advance' : 'Salary'} - ${name} (${monthLabel(month)})${notes ? ` - ${notes}` : ''}`;

// List staff (active first), each with their total payment count so the UI knows who can be deleted
app.get('/api/staff', (req, res) => {
    db.all(`SELECT s.*, (SELECT COUNT(*) FROM staff_payments p WHERE p.staffId = s.id) AS paymentCount
            FROM staff s ORDER BY s.active DESC, s.name COLLATE NOCASE`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.post('/api/staff', (req, res) => {
    const name = (req.body.name || '').trim();
    const monthlySalary = Number(req.body.monthlySalary);
    if (!name) return res.status(400).json({ error: "Name is required" });
    if (isNaN(monthlySalary) || monthlySalary < 0) return res.status(400).json({ error: "Monthly salary must be a positive number" });

    db.get("SELECT id FROM staff WHERE LOWER(name) = LOWER(?)", [name], (dupErr, existing) => {
        if (dupErr) return res.status(500).json({ error: dupErr.message });
        if (existing) return res.status(409).json({ error: `A staff member named "${name}" already exists.` });
        db.run("INSERT INTO staff (name, monthlySalary, active) VALUES (?, ?, 1)", [name, monthlySalary], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Staff member added", data: { id: this.lastID } });
        });
    });
});

app.put('/api/staff/:id', (req, res) => {
    const staffId = req.params.id;
    db.get("SELECT * FROM staff WHERE id = ?", [staffId], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!existing) return res.status(404).json({ error: "Staff member not found" });

        const name = req.body.name !== undefined ? String(req.body.name).trim() : existing.name;
        const monthlySalary = req.body.monthlySalary !== undefined ? Number(req.body.monthlySalary) : existing.monthlySalary;
        const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : existing.active;
        if (!name) return res.status(400).json({ error: "Name is required" });
        if (isNaN(monthlySalary) || monthlySalary < 0) return res.status(400).json({ error: "Monthly salary must be a positive number" });

        db.get("SELECT id FROM staff WHERE LOWER(name) = LOWER(?) AND id != ?", [name, staffId], (dupErr, dup) => {
            if (dupErr) return res.status(500).json({ error: dupErr.message });
            if (dup) return res.status(409).json({ error: `A staff member named "${name}" already exists.` });
            db.run("UPDATE staff SET name = ?, monthlySalary = ?, active = ? WHERE id = ?", [name, monthlySalary, active, staffId], (upErr) => {
                if (upErr) return res.status(500).json({ error: upErr.message });
                res.json({ message: "Staff member updated" });
            });
        });
    });
});

// Only staff with no payment history can be deleted; others are deactivated instead
app.delete('/api/staff/:id', (req, res) => {
    db.get("SELECT COUNT(*) AS n FROM staff_payments WHERE staffId = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row.n > 0) {
            return res.status(409).json({ error: "This staff member has payment records and cannot be deleted. Mark them inactive instead." });
        }
        db.run("DELETE FROM staff WHERE id = ?", [req.params.id], function(delErr) {
            if (delErr) return res.status(500).json({ error: delErr.message });
            if (this.changes === 0) return res.status(404).json({ error: "Staff member not found" });
            res.json({ message: "Staff member deleted" });
        });
    });
});

// Payments for one salary month (YYYY-MM), newest first
app.get('/api/staff-payments', (req, res) => {
    const { month } = req.query;
    if (!isMonthKey(month)) return res.status(400).json({ error: "month must be in YYYY-MM format" });
    db.all(`SELECT p.*, s.name AS staffName FROM staff_payments p JOIN staff s ON s.id = p.staffId
            WHERE p.month = ? ORDER BY p.date DESC, p.id DESC`, [month], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

// Record an advance or salary payment and post it as a Salary expense
app.post('/api/staff-payments', (req, res) => {
    const { staffId, type, month, date, notes } = req.body;
    const amount = Number(req.body.amount);
    if (!STAFF_PAYMENT_TYPES.includes(type)) return res.status(400).json({ error: "type must be 'advance' or 'salary'" });
    if (!isMonthKey(month)) return res.status(400).json({ error: "month must be in YYYY-MM format" });
    if (!date) return res.status(400).json({ error: "Payment date is required" });
    if (!(amount > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });

    db.get("SELECT * FROM staff WHERE id = ?", [staffId], (err, staff) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!staff) return res.status(404).json({ error: "Staff member not found" });

        // Keep the salary snapshot consistent within a month: reuse the first payment's figure
        db.get("SELECT salaryForMonth FROM staff_payments WHERE staffId = ? AND month = ? AND salaryForMonth IS NOT NULL ORDER BY id LIMIT 1",
            [staff.id, month], (snapErr, snap) => {
            if (snapErr) return res.status(500).json({ error: snapErr.message });
            const salaryForMonth = snap ? snap.salaryForMonth : staff.monthlySalary;
            const cleanNotes = (notes || '').trim();

            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                db.run("INSERT INTO expenses (date, category, amount, description) VALUES (?, 'Salary', ?, ?)",
                    [date, amount, staffExpenseDesc(type, staff.name, month, cleanNotes)], function(expErr) {
                    if (expErr) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: expErr.message });
                    }
                    const expenseId = this.lastID;
                    db.run(`INSERT INTO staff_payments (staffId, type, month, date, amount, salaryForMonth, notes, expenseId)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [staff.id, type, month, date, amount, salaryForMonth, cleanNotes, expenseId], function(payErr) {
                        if (payErr) {
                            db.run("ROLLBACK");
                            return res.status(500).json({ error: payErr.message });
                        }
                        db.run("COMMIT");
                        res.json({
                            message: type === 'advance' ? "Advance recorded and added to expenses" : "Salary payment recorded and added to expenses",
                            data: { id: this.lastID, expenseId }
                        });
                    });
                });
            });
        });
    });
});

// Delete a payment together with its expense
app.delete('/api/staff-payments/:id', (req, res) => {
    db.get("SELECT * FROM staff_payments WHERE id = ?", [req.params.id], (err, payment) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!payment) return res.status(404).json({ error: "Payment not found" });
        if (payment.bonusId) {
            return res.status(409).json({ error: "Bonus payments are managed on the Staff Bonus page. Undo the bonus decision there instead." });
        }
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            if (payment.expenseId) db.run("DELETE FROM expenses WHERE id = ?", [payment.expenseId], () => {});
            db.run("DELETE FROM staff_payments WHERE id = ?", [payment.id], (delErr) => {
                if (delErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: delErr.message });
                }
                db.run("COMMIT");
                res.json({ message: "Payment deleted and removed from expenses" });
            });
        });
    });
});

// --- Staff Bonus (share of monthly net profit) ---

const DEFAULT_BONUS_PERCENT = 10;
const round2 = (n) => Math.round(n * 100) / 100;
const shiftMonthKey = (key, delta) => {
    const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
// Today's date in the server's local timezone (set TZ=Asia/Colombo in .env). toISOString() would
// give the UTC date, which is still "yesterday" in Sri Lanka until 05:30.
const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The bonus for a month is decided on the day before the last day of the following month
// (September's bonus on 30 October).
const bonusDueDate = (month) => {
    const next = shiftMonthKey(month, 1);
    const lastDay = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)), 0)).getUTCDate();
    return `${next}-${String(lastDay - 1).padStart(2, '0')}`;
};

const getSetting = (key, cb) => db.get("SELECT value FROM settings WHERE key = ?", [key], (err, row) => cb(err, row ? row.value : null));
const setSetting = (key, value, cb) => db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, String(value)], cb);

// Net profit for a month, using the same rules as Financials / Analytics:
// revenue = booking groups that are fully paid, counted in the month of their final payment
// (or check-out); expenses = all expenses dated in the month.
const computeMonthProfit = (month, cb) => {
    db.all("SELECT * FROM reservations", [], (err, bookings) => {
        if (err) return cb(err);
        const groups = {};
        bookings.forEach(b => {
            const gid = b.groupId || b.id;
            if (!groups[gid]) groups[gid] = { ...b, totalAmount: 0, advancedAmount: 0, rooms: 0 };
            groups[gid].totalAmount += Number(b.totalAmount || 0);
            groups[gid].advancedAmount += Number(b.advancedAmount || 0);
            groups[gid].rooms++;
        });

        let revenue = 0;
        let bookingCount = 0;
        Object.values(groups).forEach(g => {
            let paid = g.advancedAmount || 0;
            let settlementDate = g.checkOutDate;
            try {
                const parsed = g.advancedPayments ? JSON.parse(g.advancedPayments) : [];
                if (parsed.length > 0) {
                    paid = parsed.reduce((sum, p) => sum + Number(p.amount || 0), 0) * g.rooms;
                    settlementDate = parsed[parsed.length - 1].date || g.checkOutDate;
                }
            } catch (e) {}
            if (g.totalAmount - paid <= 0.05 && settlementDate && String(settlementDate).slice(0, 7) === month) {
                revenue += g.totalAmount;
                bookingCount++;
            }
        });

        db.get("SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM expenses WHERE substr(date, 1, 7) = ?", [month], (expErr, exp) => {
            if (expErr) return cb(expErr);
            cb(null, {
                revenue: round2(revenue),
                bookingCount,
                expenses: round2(exp.total),
                expenseCount: exp.n,
                netProfit: round2(revenue - exp.total)
            });
        });
    });
};

// Reminders start from the first month the feature was used, so older months are never flagged
const getBonusStartMonth = (cb) => {
    getSetting('staffBonusStartMonth', (err, value) => {
        if (err) return cb(err);
        if (value) return cb(null, value);
        const start = shiftMonthKey(todayKey().slice(0, 7), -1);
        setSetting('staffBonusStartMonth', start, () => cb(null, start));
    });
};

// Months whose decision date has arrived but which have no paid/skipped decision yet
const findPendingBonusMonths = (cb) => {
    getBonusStartMonth((err, start) => {
        if (err) return cb(err);
        db.all("SELECT month FROM staff_bonuses", [], (decErr, rows) => {
            if (decErr) return cb(decErr);
            const decided = new Set(rows.map(r => r.month));
            const today = todayKey();
            const pending = [];
            const upcoming = [];
            for (let m = start; m < today.slice(0, 7); m = shiftMonthKey(m, 1)) {
                if (decided.has(m)) continue;
                const dueDate = bonusDueDate(m);
                (dueDate <= today ? pending : upcoming).push({ month: m, monthLabel: monthLabel(m), dueDate });
            }
            cb(null, { pending, upcoming });
        });
    });
};

app.get('/api/staff-bonus/settings', (req, res) => {
    getSetting('staffBonusPercent', (err, value) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: { percentage: value !== null ? Number(value) : DEFAULT_BONUS_PERCENT } });
    });
});

app.put('/api/staff-bonus/settings', (req, res) => {
    const percentage = Number(req.body.percentage);
    if (!(percentage >= 0 && percentage <= 100)) return res.status(400).json({ error: "Percentage must be between 0 and 100" });
    setSetting('staffBonusPercent', percentage, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Default bonus percentage saved", data: { percentage } });
    });
});

// Months waiting for a decision (drives the sidebar badge and dashboard banner)
app.get('/api/staff-bonus/pending', (req, res) => {
    findPendingBonusMonths((err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: result });
    });
});

// Calculation for one profit month, plus the existing decision if there is one
app.get('/api/staff-bonus/preview', (req, res) => {
    const { month } = req.query;
    if (!isMonthKey(month)) return res.status(400).json({ error: "month must be in YYYY-MM format" });
    computeMonthProfit(month, (err, profit) => {
        if (err) return res.status(500).json({ error: err.message });
        db.get("SELECT * FROM staff_bonuses WHERE month = ?", [month], (decErr, decision) => {
            if (decErr) return res.status(500).json({ error: decErr.message });
            const done = (payments) => res.json({
                data: { month, monthLabel: monthLabel(month), dueDate: bonusDueDate(month), ...profit, decision: decision || null, payments }
            });
            if (!decision) return done([]);
            db.all(`SELECT p.*, s.name AS staffName FROM staff_payments p JOIN staff s ON s.id = p.staffId
                    WHERE p.bonusId = ? ORDER BY s.name COLLATE NOCASE`, [decision.id], (pErr, payments) => {
                if (pErr) return res.status(500).json({ error: pErr.message });
                done(payments);
            });
        });
    });
});

// Decision history, newest month first
app.get('/api/staff-bonus', (req, res) => {
    db.all("SELECT * FROM staff_bonuses ORDER BY month DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows.map(r => ({ ...r, monthLabel: monthLabel(r.month) })) });
    });
});

// Record the decision for a month: action 'pay' splits the pool equally between the chosen staff
// and posts one Salary expense per person; action 'skip' records that no bonus is given.
// The pool defaults to percentage × net profit, but an explicit `amount` (the final total to give) overrides it.
app.post('/api/staff-bonus', (req, res) => {
    const { month, action, paidDate, notes } = req.body;
    const percentage = Number(req.body.percentage);
    const finalAmount = req.body.amount === undefined || req.body.amount === null || req.body.amount === '' ? null : Number(req.body.amount);
    const staffIds = Array.isArray(req.body.staffIds) ? req.body.staffIds.map(Number) : [];
    if (!isMonthKey(month)) return res.status(400).json({ error: "month must be in YYYY-MM format" });
    if (!['pay', 'skip'].includes(action)) return res.status(400).json({ error: "action must be 'pay' or 'skip'" });
    if (month >= todayKey().slice(0, 7)) return res.status(400).json({ error: "The bonus can only be decided once the month has ended." });

    db.get("SELECT id, status FROM staff_bonuses WHERE month = ?", [month], (dupErr, existing) => {
        if (dupErr) return res.status(500).json({ error: dupErr.message });
        if (existing) {
            return res.status(409).json({ error: `The ${monthLabel(month)} bonus has already been ${existing.status === 'paid' ? 'paid' : 'skipped'}. Undo that decision first to change it.` });
        }

        // Profit is always recalculated here rather than trusted from the client
        computeMonthProfit(month, (profitErr, profit) => {
            if (profitErr) return res.status(500).json({ error: profitErr.message });
            const cleanNotes = (notes || '').trim();

            if (action === 'skip') {
                return db.run(`INSERT INTO staff_bonuses (month, status, revenue, expenses, netProfit, percentage, notes)
                               VALUES (?, 'skipped', ?, ?, ?, ?, ?)`,
                    [month, profit.revenue, profit.expenses, profit.netProfit, isNaN(percentage) ? null : percentage, cleanNotes], function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: `No bonus for ${monthLabel(month)} — decision recorded`, data: { id: this.lastID } });
                });
            }

            if (!(percentage >= 0 && percentage <= 100)) return res.status(400).json({ error: "Percentage must be between 0 and 100" });
            if (!paidDate) return res.status(400).json({ error: "Payment date is required" });
            if (finalAmount !== null && !(finalAmount > 0)) return res.status(400).json({ error: "The bonus amount to give must be greater than zero" });
            const calculatedPool = profit.netProfit > 0 ? round2(profit.netProfit * percentage / 100) : 0;
            if (finalAmount === null && calculatedPool <= 0) {
                return res.status(400).json({ error: `${monthLabel(month)} has no net profit (LKR ${profit.netProfit.toLocaleString()}), so there is no bonus to share. Enter an amount to give one anyway.` });
            }
            if (staffIds.length === 0) return res.status(400).json({ error: "Select at least one staff member" });

            const placeholders = staffIds.map(() => '?').join(',');
            db.all(`SELECT * FROM staff WHERE id IN (${placeholders})`, staffIds, (staffErr, staffRows) => {
                if (staffErr) return res.status(500).json({ error: staffErr.message });
                if (staffRows.length !== staffIds.length) return res.status(400).json({ error: "One or more selected staff members no longer exist" });

                const perStaff = round2((finalAmount !== null ? finalAmount : calculatedPool) / staffRows.length);
                // Pool is the sum actually paid out, so it always matches the expenses (no stray cents)
                const pool = round2(perStaff * staffRows.length);
                const paidMonth = paidDate.slice(0, 7);

                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    db.run(`INSERT INTO staff_bonuses (month, status, revenue, expenses, netProfit, percentage, calculatedPool, pool, staffCount, perStaff, paidDate, notes)
                            VALUES (?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [month, profit.revenue, profit.expenses, profit.netProfit, percentage, calculatedPool, pool, staffRows.length, perStaff, paidDate, cleanNotes], function(bonusErr) {
                        if (bonusErr) {
                            db.run("ROLLBACK");
                            return res.status(500).json({ error: bonusErr.message });
                        }
                        const bonusId = this.lastID;
                        let remaining = staffRows.length;
                        let failed = false;

                        staffRows.forEach(s => {
                            const edited = Math.abs(pool - calculatedPool) > 0.01 * staffRows.length;
                            const desc = `Staff Bonus - ${s.name} (${monthLabel(month)} profit${edited ? '' : `, ${percentage}%`})`;
                            db.run("INSERT INTO expenses (date, category, amount, description) VALUES (?, 'Salary', ?, ?)",
                                [paidDate, perStaff, desc], function(expErr) {
                                if (failed) return;
                                if (expErr) {
                                    failed = true;
                                    db.run("ROLLBACK");
                                    return res.status(500).json({ error: expErr.message });
                                }
                                db.run(`INSERT INTO staff_payments (staffId, type, month, date, amount, notes, expenseId, bonusId)
                                        VALUES (?, 'bonus', ?, ?, ?, ?, ?, ?)`,
                                    [s.id, paidMonth, paidDate, perStaff, `${monthLabel(month)} profit bonus`, this.lastID, bonusId], (payErr) => {
                                    if (failed) return;
                                    if (payErr) {
                                        failed = true;
                                        db.run("ROLLBACK");
                                        return res.status(500).json({ error: payErr.message });
                                    }
                                    if (--remaining === 0) {
                                        db.run("COMMIT");
                                        res.json({
                                            message: `${monthLabel(month)} bonus paid: LKR ${perStaff.toLocaleString()} each to ${staffRows.length} staff`,
                                            data: { id: bonusId, pool, perStaff }
                                        });
                                    }
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// Undo a decision: removes the bonus payments and their expenses so the month can be decided again
app.delete('/api/staff-bonus/:id', (req, res) => {
    db.get("SELECT * FROM staff_bonuses WHERE id = ?", [req.params.id], (err, bonus) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!bonus) return res.status(404).json({ error: "Bonus decision not found" });
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run("DELETE FROM expenses WHERE id IN (SELECT expenseId FROM staff_payments WHERE bonusId = ?)", [bonus.id], () => {});
            db.run("DELETE FROM staff_payments WHERE bonusId = ?", [bonus.id], () => {});
            db.run("DELETE FROM staff_bonuses WHERE id = ?", [bonus.id], (delErr) => {
                if (delErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: delErr.message });
                }
                db.run("COMMIT");
                res.json({ message: `${monthLabel(bonus.month)} bonus decision undone` });
            });
        });
    });
});

// --- Notifications ---
// Notifications are derived from the data on every request rather than stored, so each one
// disappears by itself once the underlying task is done (bonus decided, bill uploaded, bill paid).

const BILL_REMINDER_TYPES = {
    laundry: 'Laundry',
    electricity: 'Electricity',
    water: 'Water',
    telecom: 'Telecom',
    booking: 'Booking.com'
};

const DEFAULT_REMINDER_SETTINGS = {
    // Day of the month by which each bill is normally received; after that day a missing bill is flagged
    bills: {
        laundry: { enabled: true, day: 15 },
        electricity: { enabled: true, day: 20 },
        water: { enabled: true, day: 7 },
        telecom: { enabled: true, day: 5 },
        booking: { enabled: true, day: 7 }
    },
    dueSoonDays: 3,
    bonus: { enabled: true },
    checkouts: { enabled: true }
};

const dbAll = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const getSettingAsync = (key) => new Promise((resolve, reject) => getSetting(key, (err, value) => err ? reject(err) : resolve(value)));
const setSettingAsync = (key, value) => new Promise((resolve, reject) => setSetting(key, value, (err) => err ? reject(err) : resolve()));

const loadReminderSettings = async () => {
    const raw = await getSettingAsync('reminderSettings');
    let saved = {};
    try { saved = raw ? JSON.parse(raw) : {}; } catch (e) {}
    const bills = {};
    Object.keys(DEFAULT_REMINDER_SETTINGS.bills).forEach(type => {
        bills[type] = { ...DEFAULT_REMINDER_SETTINGS.bills[type], ...((saved.bills || {})[type] || {}) };
    });
    return {
        bills,
        dueSoonDays: saved.dueSoonDays !== undefined ? saved.dueSoonDays : DEFAULT_REMINDER_SETTINGS.dueSoonDays,
        bonus: { ...DEFAULT_REMINDER_SETTINGS.bonus, ...(saved.bonus || {}) },
        checkouts: { ...DEFAULT_REMINDER_SETTINGS.checkouts, ...(saved.checkouts || {}) }
    };
};

// The configured day, clamped to the length of the month (e.g. 31 → 30 in September)
const reminderDateFor = (month, day) => {
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    return `${month}-${String(Math.min(Math.max(1, day), lastDay)).padStart(2, '0')}`;
};

const ordinal = (n) => {
    const suffix = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    return `${n}${suffix}`;
};

const addDaysIso = (iso, days) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
};

const buildNotifications = async () => {
    const settings = await loadReminderSettings();
    const today = todayKey();
    const thisMonth = today.slice(0, 7);
    const items = [];

    // 1. Staff bonus decisions that are due
    if (settings.bonus.enabled) {
        const { pending } = await new Promise((resolve, reject) => findPendingBonusMonths((err, r) => err ? reject(err) : resolve(r)));
        pending.forEach(p => items.push({
            id: `bonus-${p.month}`,
            kind: 'bonus',
            severity: p.dueDate < today ? 'overdue' : 'due',
            title: `Staff bonus for ${p.monthLabel}`,
            detail: `Decide whether to give the ${p.monthLabel} profit bonus.`,
            date: p.dueDate,
            link: `/staff/bonus?month=${p.month}`
        }));
    }

    // 2. Bills not uploaded by their usual day. Months are checked from when reminders were first
    //    used, so history before that is never flagged.
    let startMonth = await getSettingAsync('billRemindersStartMonth');
    if (!startMonth) {
        startMonth = thisMonth;
        await setSettingAsync('billRemindersStartMonth', startMonth);
    }
    const utilityBills = await dbAll("SELECT type, accountNo, premises, tariff, substr(date, 1, 7) AS month FROM utility_bills");
    const laundryBills = await dbAll("SELECT substr(date, 1, 7) AS month FROM laundry_bills");

    for (const [type, label] of Object.entries(BILL_REMINDER_TYPES)) {
        const cfg = settings.bills[type];
        if (!cfg || !cfg.enabled) continue;
        const rows = type === 'laundry' ? laundryBills.map(r => ({ ...r, accountNo: '' })) : utilityBills.filter(r => r.type === type);

        // One reminder per known account (e.g. two electricity meters); a single one if none is known yet
        const accounts = {};
        rows.forEach(r => { if (r.accountNo) accounts[r.accountNo] = r; });
        const accountList = Object.keys(accounts).length > 0 ? Object.values(accounts) : [{ accountNo: '' }];

        for (let m = startMonth; m <= thisMonth; m = shiftMonthKey(m, 1)) {
            const dueDate = reminderDateFor(m, Number(cfg.day) || 1);
            if (dueDate > today) continue;
            accountList.forEach(acc => {
                const received = rows.some(r => r.month === m && (!acc.accountNo || r.accountNo === acc.accountNo));
                if (received) return;
                const place = acc.premises ? ` (${acc.premises.split(',')[0].trim()})` : '';
                items.push({
                    id: `bill-missing-${type}-${acc.accountNo || 'all'}-${m}`,
                    kind: 'bill-missing',
                    severity: m < thisMonth ? 'overdue' : 'due',
                    title: `${label} bill for ${monthLabel(m)} not uploaded`,
                    detail: acc.accountNo
                        ? `No bill for account ${acc.accountNo}${place} yet. Usually received by the ${ordinal(Number(cfg.day))}.`
                        : `No ${label.toLowerCase()} bill uploaded for this month yet.`,
                    date: dueDate,
                    link: type === 'laundry' ? '/utilities/laundry' : `/utilities/${type}`
                });
            });
        }
    }

    // 3. Unpaid utility bills that are due soon or overdue
    const dueSoonDays = Math.max(0, Number(settings.dueSoonDays) || 0);
    const horizon = addDaysIso(today, dueSoonDays);
    const unpaid = await dbAll(
        "SELECT id, type, billNo, accountNo, month, dueDate, totalAmount FROM utility_bills WHERE status != 'Paid' AND dueDate IS NOT NULL AND dueDate != '' AND dueDate <= ?",
        [horizon]
    );
    unpaid.forEach(b => {
        const label = UTILITY_LABELS[b.type] || 'Utility';
        const overdue = b.dueDate < today;
        items.push({
            id: `bill-due-${b.id}`,
            kind: 'bill-due',
            severity: overdue ? 'overdue' : 'due',
            title: `${label} bill ${overdue ? 'overdue' : b.dueDate === today ? 'due today' : 'due soon'}`,
            detail: `${b.month || b.billNo}${b.accountNo ? ` · A/C ${b.accountNo}` : ''} · LKR ${Number(b.totalAmount || 0).toLocaleString()} — mark it paid once settled.`,
            date: b.dueDate,
            link: `/utilities/${b.type}`
        });
    });

    // 4. Guest checkouts to confirm (with the balance settled). Only checkouts from the day this
    //    reminder was first used are flagged, so older bookings never flood the list.
    if (settings.checkouts.enabled) {
        let checkoutStart = await getSettingAsync('checkoutRemindersStartDate');
        if (!checkoutStart) {
            checkoutStart = today;
            await setSettingAsync('checkoutRemindersStartDate', checkoutStart);
        }
        const rows = await dbAll(
            `SELECT * FROM reservations WHERE checkOutDate >= ? AND checkOutDate <= ?
             AND (checkedOutAt IS NULL OR checkedOutAt = '') ORDER BY checkOutDate`,
            [checkoutStart, today]
        );
        const groups = {};
        rows.forEach(r => {
            const key = r.groupId || String(r.id);
            (groups[key] = groups[key] || []).push(r);
        });
        Object.entries(groups).forEach(([key, groupRows]) => {
            const first = groupRows[0];
            const { pending } = groupPaymentState(groupRows);
            const rooms = groupRows.map(r => r.roomName).join(', ');
            const isToday = first.checkOutDate === today;
            items.push({
                id: `checkout-${key}`,
                kind: 'checkout',
                severity: isToday ? 'due' : 'overdue',
                title: `${isToday ? 'Checkout today' : 'Checkout not confirmed'}: ${first.guestName}`,
                detail: `${rooms} · ${pending > 0.05 ? `balance LKR ${pending.toLocaleString()} to settle` : 'fully paid'} — confirm the checkout.`,
                date: first.checkOutDate,
                link: `/?checkout=${encodeURIComponent(key)}`
            });
        });
    }

    // Overdue first, then by date
    const rank = { overdue: 0, due: 1, info: 2 };
    items.sort((a, b) => (rank[a.severity] - rank[b.severity]) || String(a.date).localeCompare(String(b.date)));
    return items;
};

app.get('/api/notifications', async (req, res) => {
    try {
        const items = await buildNotifications();
        res.json({ data: { items, count: items.length } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/notifications/settings', async (req, res) => {
    try {
        res.json({ data: { ...(await loadReminderSettings()), billTypes: BILL_REMINDER_TYPES } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/notifications/settings', async (req, res) => {
    try {
        const current = await loadReminderSettings();
        const body = req.body || {};
        const bills = { ...current.bills };
        Object.entries(body.bills || {}).forEach(([type, cfg]) => {
            if (!bills[type]) return;
            const day = cfg.day !== undefined ? Number(cfg.day) : bills[type].day;
            if (!(Number.isInteger(day) && day >= 1 && day <= 31)) throw Object.assign(new Error(`Day for ${BILL_REMINDER_TYPES[type]} must be between 1 and 31`), { status: 400 });
            bills[type] = { enabled: cfg.enabled !== undefined ? !!cfg.enabled : bills[type].enabled, day };
        });
        const dueSoonDays = body.dueSoonDays !== undefined ? Number(body.dueSoonDays) : current.dueSoonDays;
        if (!(Number.isInteger(dueSoonDays) && dueSoonDays >= 0 && dueSoonDays <= 30)) {
            return res.status(400).json({ error: "Days before the due date must be between 0 and 30" });
        }
        const bonus = { enabled: body.bonus && body.bonus.enabled !== undefined ? !!body.bonus.enabled : current.bonus.enabled };
        const checkouts = { enabled: body.checkouts && body.checkouts.enabled !== undefined ? !!body.checkouts.enabled : current.checkouts.enabled };
        const next = { bills, dueSoonDays, bonus, checkouts };
        await setSettingAsync('reminderSettings', JSON.stringify(next));
        res.json({ message: "Reminder settings saved", data: next });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// --- User Management ---
// Get all users
app.get('/api/users', authenticateToken, (req, res) => {
    db.all("SELECT id, username FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

// Create new user
app.post('/api/users', authenticateToken, (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });
    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash], function (err) {
        if (err) return res.status(400).json({ error: "Username might already exist" });
        res.json({ message: "User created", data: { id: this.lastID, username } });
    });
});

// Update password
app.put('/api/users/:id/password', authenticateToken, (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Missing password" });
    const hash = bcrypt.hashSync(password, 10);
    db.run("UPDATE users SET password = ? WHERE id = ?", [hash, req.params.id], function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Password updated" });
    });
});

// Delete user
app.delete('/api/users/:id', authenticateToken, (req, res) => {
    if (req.params.id == 1 || req.user.id == req.params.id) {
        return res.status(400).json({ error: "Cannot delete the primary admin or yourself" });
    }
    db.run("DELETE FROM users WHERE id = ?", req.params.id, function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "User deleted", changes: this.changes });
    });
});

// --- iCal Calendar Sync Integration ---

async function syncCalendars() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM rooms WHERE icalUrl IS NOT NULL AND icalUrl != ''", [], async (err, rooms) => {
            if (err) return reject(err);
            
            let roomsSynced = 0;
            let bookingsCreated = 0;
            let bookingsUpdated = 0;
            let bookingsLinked = 0;
            
            try {
                for (const room of rooms) {
                    console.log(`Syncing room ${room.name} from: ${room.icalUrl}`);
                    const response = await fetch(room.icalUrl);
                    if (!response.ok) {
                        console.error(`Failed to fetch iCal for room ${room.name}: ${response.statusText}`);
                        continue;
                    }
                    const icsText = await response.text();
                    const events = parseICS(icsText);
                    roomsSynced++;
                    
                    for (const event of events) {
                        await new Promise((resEvent, rejEvent) => {
                            // Check if a reservation with this uid already exists
                            db.get("SELECT * FROM reservations WHERE uid = ?", [event.uid], (err, existing) => {
                                if (err) return rejEvent(err);
                                
                                if (existing) {
                                    // Update existing booking if dates or name changed
                                    const updateSql = `UPDATE reservations SET 
                                        checkInDate = ?, checkOutDate = ?, guestName = ?, remarks = ?
                                        WHERE id = ?`;
                                    db.run(updateSql, [
                                        event.checkInDate, 
                                        event.checkOutDate, 
                                        event.guestName, 
                                        event.remarks, 
                                        existing.id
                                    ], function(err) {
                                        if (err) return rejEvent(err);
                                        if (this.changes > 0) bookingsUpdated++;
                                        resEvent();
                                    });
                                } else {
                                    // UID not found. Search for a manual Booking.com booking that matches check-in/out and roomName
                                    // to link them together without duplication.
                                    db.get(`SELECT * FROM reservations 
                                            WHERE roomName = ? AND checkInDate = ? AND checkOutDate = ? 
                                            AND (uid IS NULL OR uid = '') AND bookingSource = 'Booking.com'`,
                                            [room.name, event.checkInDate, event.checkOutDate], (err, matchingManual) => {
                                        if (err) return rejEvent(err);
                                        
                                        if (matchingManual) {
                                            // Link it by updating its UID
                                            db.run("UPDATE reservations SET uid = ? WHERE id = ?", [event.uid, matchingManual.id], (err) => {
                                                if (err) return rejEvent(err);
                                                bookingsLinked++;
                                                resEvent();
                                            });
                                        } else {
                                            // Create new reservation
                                            const sql = `INSERT INTO reservations (
                                                guestName, checkInDate, checkOutDate, roomName, 
                                                unitPrice, totalAmount, advancedAmount, advancedPayments, 
                                                remarks, bookingSource, groupId, uid, breakfastIncluded
                                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                                            
                                            const newGroupId = Date.now().toString() + Math.random().toString(36).substring(2, 5);
                                            const insertParams = [
                                                event.guestName,
                                                event.checkInDate,
                                                event.checkOutDate,
                                                room.name,
                                                0, // default unit price to 0 for imported
                                                event.totalAmount || 0, // from description if parsed
                                                0, // advancedAmount
                                                '[]', // advancedPayments
                                                event.remarks,
                                                'Booking.com',
                                                newGroupId,
                                                event.uid,
                                                0
                                            ];
                                            
                                            db.run(sql, insertParams, function(err) {
                                                if (err) return rejEvent(err);
                                                bookingsCreated++;
                                                resEvent();
                                            });
                                        }
                                    });
                                }
                            });
                        });
                    }
                }
                
                // Write success metadata to settings
                const stats = {
                    time: new Date().toISOString(),
                    status: 'success',
                    roomsSynced,
                    bookingsCreated,
                    bookingsUpdated,
                    bookingsLinked
                };
                
                db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['lastSync', JSON.stringify(stats)], (err) => {
                    if (err) console.error("Failed to save sync stats:", err.message);
                    resolve(stats);
                });
                
            } catch (syncErr) {
                console.error("Sync loop error:", syncErr);
                const stats = {
                    time: new Date().toISOString(),
                    status: 'failed',
                    error: syncErr.message
                };
                db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['lastSync', JSON.stringify(stats)], () => {
                    reject(syncErr);
                });
            }
        });
    });
}

// Sync Routes (protected by authenticateToken where appropriate)
app.put('/api/rooms/:id/ical', authenticateToken, (req, res) => {
    const { icalUrl } = req.body;
    const roomId = req.params.id;
    db.run("UPDATE rooms SET icalUrl = ? WHERE id = ?", [icalUrl || null, roomId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Room iCal URL updated successfully", changes: this.changes });
    });
});

app.post('/api/rooms/sync', authenticateToken, async (req, res) => {
    try {
        const stats = await syncCalendars();
        res.json({ message: "Sync completed successfully", stats });
    } catch (err) {
        res.status(500).json({ error: "Sync failed: " + err.message });
    }
});

app.get('/api/sync-status', authenticateToken, (req, res) => {
    db.get("SELECT value FROM settings WHERE key = 'lastSync'", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        let stats = null;
        if (row && row.value) {
            try {
                stats = JSON.parse(row.value);
            } catch (e) {}
        }
        res.json({ stats });
    });
});

// Public Export URL (No Auth required)
app.get('/api/ical/room/:id.ics', (req, res) => {
    const roomId = req.params.id;
    db.get("SELECT * FROM rooms WHERE id = ?", [roomId], (err, room) => {
        if (err) return res.status(500).send("Database error: " + err.message);
        if (!room) return res.status(404).send("Room not found");
        
        db.all("SELECT * FROM reservations WHERE roomName = ? ORDER BY checkInDate ASC", [room.name], (err, rows) => {
            if (err) return res.status(500).send("Database error: " + err.message);
            
            const icsContent = generateICS(rows || [], room.name);
            res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="room_${roomId}.ics"`);
            res.send(icsContent);
        });
    });
});

// Start background cron task (sync every 30 minutes)
setInterval(async () => {
    try {
        console.log("Running background calendar sync...");
        await syncCalendars();
    } catch (err) {
        console.error("Background sync failed:", err.message);
    }
}, 30 * 60 * 1000);

// Run initial sync on server boot after 5 seconds
setTimeout(async () => {
    try {
        console.log("Running initial boot calendar sync...");
        await syncCalendars();
    } catch (err) {
        console.error("Initial sync failed:", err.message);
    }
}, 5000);

// One-time tidy-up when checkout confirmation was introduced: bookings that had already ended
// before that day and are fully paid are marked checked out on their own checkout date.
// Ended bookings with a balance are left alone so they can be settled and checked out properly.
// Guarded by a settings flag so it never runs again (otherwise it would silently confirm
// checkouts the user forgot, defeating the checkout reminders).
const backfillPastCheckouts = async () => {
    try {
        if (await getSettingAsync('checkoutBackfillDone')) return;
        const columns = await dbAll("PRAGMA table_info(reservations)");
        if (!columns.some(c => c.name === 'checkedOutAt')) {
            console.warn('Checkout backfill skipped: reservations.checkedOutAt column not found; will retry on next start.');
            return;
        }

        const cutoff = todayKey();
        const rows = await dbAll(
            "SELECT * FROM reservations WHERE checkOutDate < ? AND (checkedOutAt IS NULL OR checkedOutAt = '')",
            [cutoff]
        );
        const groups = {};
        rows.forEach(r => {
            const key = r.groupId || String(r.id);
            (groups[key] = groups[key] || []).push(r);
        });

        let marked = 0;
        let leftWithBalance = 0;
        for (const groupRows of Object.values(groups)) {
            if (groupPaymentState(groupRows).pending > 0.05) {
                leftWithBalance++;
                continue;
            }
            const ids = groupRows.map(r => r.id);
            await new Promise((resolve, reject) => db.run(
                `UPDATE reservations SET checkedOutAt = checkOutDate WHERE id IN (${ids.map(() => '?').join(',')})`,
                ids, (err) => err ? reject(err) : resolve()
            ));
            marked++;
        }

        await setSettingAsync('checkoutBackfillDone', JSON.stringify({ ranOn: cutoff, marked, leftWithBalance }));
        console.log(`Checkout backfill: marked ${marked} past fully-paid booking(s) as checked out; ${leftWithBalance} past booking(s) with a balance left for review.`);
    } catch (err) {
        console.error('Checkout backfill failed (will retry on next start):', err.message);
    }
};

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Wait for db.js to finish its startup migrations before touching reservations
    db.ready.then(backfillPastCheckouts);
});
