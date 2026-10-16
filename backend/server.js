const express = require('express');
const cors = require('cors');
const db = require('./db');
const { parseICS, generateICS } = require('./ical');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { parseLaundryPdf } = require('./laundryParser');
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

// Laundry PDFs are parsed in memory only and never written to disk
const uploadLaundry = multer({
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

        db.run("DELETE FROM reservations WHERE groupId = ?", [groupId], function(delErr) {
            if (delErr) return res.status(500).json({ error: delErr.message });

            const sql = `INSERT INTO reservations (
                guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
                roomName, unitPrice, totalAmount, advancedAmount, advancedPayments, remarks, bookingSource, groupId,
                usdAmount, conversionRate, breakfastIncluded
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
                    splitUsdAmount, conversionRate || null, parseBreakfast(breakfastIncluded)
                ]);
            }))
            .then(ids => {
                res.json({ message: "Group reservation updated successfully", data: { insertedIds: ids } });
            })
            .catch(err => res.status(400).json({ error: err.message }));
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
        const settlementDate = date || new Date().toISOString().split('T')[0];
        
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
    const settlementDate = req.body.date || new Date().toISOString().split('T')[0];
    
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

// Upload and preview PDF data (with duplicate check)
app.post('/api/laundry/upload-preview', uploadLaundry.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No PDF file provided" });
    }
    try {
        const parsed = await parseLaundryPdf(req.file.buffer);
        const fileInfo = {
            originalName: req.file.originalname,
            size: req.file.size
        };

        // Check if a bill with this invoice number has already been uploaded
        if (parsed.invoiceNo) {
            db.get("SELECT id, invoiceNo, date, status, totalAmount FROM laundry_bills WHERE LOWER(invoiceNo) = LOWER(?)", [parsed.invoiceNo], (dbErr, existing) => {
                if (dbErr) return res.status(500).json({ error: dbErr.message });
                if (existing) {
                    return res.status(409).json({
                        error: `Invoice "${parsed.invoiceNo}" has already been uploaded on ${existing.date} (Status: ${existing.status}, Amount: LKR ${(existing.totalAmount || 0).toLocaleString()}). Duplicate bills cannot be uploaded.`,
                        duplicate: true,
                        existingBill: existing
                    });
                }

                res.json({
                    message: "Laundry invoice parsed successfully",
                    data: parsed,
                    file: fileInfo
                });
            });
        } else {
            res.json({
                message: "Laundry invoice parsed successfully",
                data: parsed,
                file: fileInfo
            });
        }
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
        dailyBreakdown, items
    } = req.body;

    if (!invoiceNo || !date || totalAmount === undefined) {
        return res.status(400).json({ error: "Missing required fields: invoiceNo, date, or totalAmount" });
    }

    // Check for duplicate invoice number
    db.get("SELECT id, invoiceNo, date, status, totalAmount FROM laundry_bills WHERE LOWER(invoiceNo) = LOWER(?)", [invoiceNo], (checkErr, existing) => {
        if (checkErr) return res.status(500).json({ error: checkErr.message });
        if (existing) {
            return res.status(409).json({
                error: `Invoice "${invoiceNo}" already exists in the system (Status: ${existing.status}, Amount: LKR ${(existing.totalAmount || 0).toLocaleString()}). Duplicate bills cannot be saved.`
            });
        }

        const isPaid = status === 'Paid';
        const finalPaidDate = isPaid ? (paidDate || date) : null;
        const dailyStr = typeof dailyBreakdown === 'object' ? JSON.stringify(dailyBreakdown) : (dailyBreakdown || '{}');

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

        const insertSql = `INSERT INTO laundry_bills (
            invoiceNo, vendor, date, month, totalQty, totalAmount, status,
            paidDate, paymentNotes, pdfPath, originalFileName, dailyBreakdown
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        db.run(insertSql, [
            invoiceNo, vendor || 'Shiny Laundry', date, month || '',
            Number(totalQty || 0), Number(totalAmount || 0), isPaid ? 'Paid' : 'Pending',
            finalPaidDate, paymentNotes || '', pdfPath || '', originalFileName || '', dailyStr
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
    const finalPaidDate = paidDate || new Date().toISOString().split('T')[0];

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

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
