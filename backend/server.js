const express = require('express');
const cors = require('cors');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Get all rooms
app.get('/api/rooms', (req, res) => {
    db.all("SELECT * FROM rooms", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

// Get all reservations
app.get('/api/reservations', (req, res) => {
    db.all("SELECT * FROM reservations ORDER BY checkInDate ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

// Create new reservation
app.post('/api/reservations', (req, res) => {
    const {
        guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
        roomName, unitPrice, totalAmount, advancedAmount, advancedPayments, remarks, bookingSource
    } = req.body;

    const sql = `INSERT INTO reservations (
        guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
        roomName, unitPrice, totalAmount, advancedAmount, advancedPayments, remarks, bookingSource
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
        guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
        roomName, unitPrice, totalAmount, advancedAmount, advancedPayments || '[]', remarks, bookingSource || 'Manual'
    ];

    db.run(sql, params, function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({
            message: "Reservation created successfully",
            data: { id: this.lastID, ...req.body }
        });
    });
});

// Get single reservation
app.get('/api/reservations/:id', (req, res) => {
    db.get("SELECT * FROM reservations WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Not found" });
        res.json({ data: row });
    });
});

// Update reservation
app.put('/api/reservations/:id', (req, res) => {
    const {
        guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
        roomName, unitPrice, totalAmount, advancedAmount, advancedPayments, remarks, bookingSource
    } = req.body;

    const sql = `UPDATE reservations SET 
        guestName = ?, phoneNo = ?, nicOrPassport = ?, checkInDate = ?, checkOutDate = ?,
        roomName = ?, unitPrice = ?, totalAmount = ?, advancedAmount = ?, advancedPayments = ?, remarks = ?, bookingSource = ?
        WHERE id = ?`;

    const params = [
        guestName, phoneNo, nicOrPassport, checkInDate, checkOutDate,
        roomName, unitPrice, totalAmount, advancedAmount, advancedPayments || '[]', remarks, bookingSource, req.params.id
    ];

    db.run(sql, params, function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Reservation updated successfully", changes: this.changes });
    });
});

// Delete reservation
app.delete('/api/reservations/:id', (req, res) => {
    db.run("DELETE FROM reservations WHERE id = ?", req.params.id, function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Reservation deleted", changes: this.changes });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
