const express = require('express');
const cors = require('cors');
const db = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'villamanager_super_secret_key_2026';

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

// --- Rooms ---
app.get('/api/rooms', (req, res) => {
    db.all("SELECT * FROM rooms", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

// --- Reservations ---
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

    const checkSql = `SELECT id FROM reservations WHERE roomName = ? AND checkInDate < ? AND checkOutDate > ?`;
    db.get(checkSql, [roomName, checkOutDate, checkInDate], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(400).json({ error: `The room '${roomName}' is already booked during these dates!` });

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

    const checkSql = `SELECT id FROM reservations WHERE roomName = ? AND checkInDate < ? AND checkOutDate > ? AND id != ?`;
    db.get(checkSql, [roomName, checkOutDate, checkInDate, req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(400).json({ error: `The room '${roomName}' is already booked by another guest during these dates!` });

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
});

// Delete reservation
app.delete('/api/reservations/:id', (req, res) => {
    db.run("DELETE FROM reservations WHERE id = ?", req.params.id, function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Reservation deleted", changes: this.changes });
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

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
