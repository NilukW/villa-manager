import React, { useState, useEffect, useMemo } from 'react';
import { fetchWithAuth } from '../utils/api';
import FinanceMetricsCards from '../components/Finance/FinanceMetricsCards';
import ExpenseForm from '../components/Finance/ExpenseForm';
import EarningsLedger from '../components/Finance/EarningsLedger';
import ExpensesLedger from '../components/Finance/ExpensesLedger';

export default function Finance() {
    const [bookings, setBookings] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [loading, setLoading] = useState(true);

    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [activeTab, setActiveTab] = useState('Overview');

    const isWithinRange = (dateStr) => {
        if (!dateStr) return true;
        if (dateRange.start && dateStr < dateRange.start) return false;
        if (dateRange.end && dateStr > dateRange.end) return false;
        return true;
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [resRes, expRes] = await Promise.all([
                    fetchWithAuth('/api/reservations'),
                    fetchWithAuth('/api/expenses')
                ]);
                
                const bs = await resRes.json();
                const es = await expRes.json();
                
                setBookings(bs.data || []);
                setExpenses(es.data || []);
            } catch (err) {
                console.error("Failed to load finance data", err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    // Calculate Financials based on Groups
    const metrics = useMemo(() => {
        // First group reservations uniquely
        const groups = {};
        bookings.forEach(b => {
            const gid = b.groupId || b.id;
            if (!groups[gid]) {
                groups[gid] = { ...b, totalAmount: 0, advancedAmount: 0, advancedPayments: b.advancedPayments, roomNamesList: [] };
            }
            groups[gid].totalAmount += Number(b.totalAmount || 0);
            groups[gid].roomNamesList.push(b.roomName);
        });

        // Loop groups and calculate accurate paid amounts and totals
        let revenue = 0;
        const arr = [];
        
        Object.values(groups).forEach(g => {
            let paid = g.advancedAmount || 0;
            let settlementDate = g.checkOutDate;
            try {
                if (g.advancedPayments) {
                    const parsed = JSON.parse(g.advancedPayments);
                    if (parsed.length > 0) {
                        paid = parsed.reduce((sum, p) => sum + Number(p.amount || 0), 0) * g.roomNamesList.length;
                        settlementDate = parsed[parsed.length - 1].date || g.checkOutDate;
                    }
                }
            } catch(e) {}
            
            // Only consider it Revenue if it is fully settled (Pending <= 0)
            const pending = Number(g.totalAmount || 0) - paid;
            if (pending <= 0.05 && isWithinRange(settlementDate)) { 
                revenue += g.totalAmount;
                arr.push({
                    id: g.groupId || g.id,
                    date: settlementDate,
                    guestName: g.guestName,
                    rooms: g.roomNamesList.join(', '),
                    amount: g.totalAmount,
                    source: g.bookingSource || 'Direct'
                });
            }
        });

        const totalExpenses = expenses.filter(e => isWithinRange(e.date)).reduce((sum, exp) => sum + Number(exp.amount), 0);

        return {
            revenue,
            expenses: totalExpenses,
            profit: revenue - totalExpenses,
            earningsList: arr
        };
    }, [bookings, expenses, dateRange]);

    const downloadCSV = () => {
        const headers = ["Date", "Type", "Category", "Amount", "Description", "Guest/Entity"];
        const csvRows = [headers.join(',')];

        const groups = {};
        bookings.forEach(b => {
            const gid = b.groupId || b.id;
            if (!groups[gid]) {
                groups[gid] = { ...b, totalAmount: 0, advancedAmount: 0, roomNamesList: [] };
            }
            groups[gid].totalAmount += Number(b.totalAmount || 0);
            groups[gid].roomNamesList.push(b.roomName);
        });

        const ledger = [];
        Object.values(groups).forEach(g => {
            let paid = g.advancedAmount || 0;
            let settlementDate = g.checkOutDate;
            try {
                if (g.advancedPayments) {
                    const parsed = JSON.parse(g.advancedPayments);
                    if (parsed.length > 0) {
                        paid = parsed.reduce((sum, p) => sum + Number(p.amount || 0), 0) * g.roomNamesList.length;
                        settlementDate = parsed[parsed.length - 1].date || g.checkOutDate;
                    }
                }
            } catch(e) {}
            
            const pending = Number(g.totalAmount || 0) - paid;
            if (pending <= 0.05 && isWithinRange(settlementDate)) { 
                ledger.push({
                    date: settlementDate,
                    type: "Earning",
                    category: "Booking Revenue",
                    amount: g.totalAmount,
                    description: `Rooms: ${g.roomNamesList.join(' | ')}`,
                    entity: g.guestName
                });
            }
        });

        expenses.filter(e => isWithinRange(e.date)).forEach(e => {
            ledger.push({
                date: e.date,
                type: "Expense",
                category: e.category,
                amount: -Math.abs(Number(e.amount)),
                description: e.description || '',
                entity: 'Internal'
            });
        });

        ledger.sort((a, b) => new Date(b.date) - new Date(a.date));

        ledger.forEach(r => {
            const row = [r.date, r.type, r.category, r.amount, `"${r.description}"`, `"${r.entity}"`];
            csvRows.push(row.join(','));
        });

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `financial-ledger-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    };

    const handleExpenseAdded = (newExpense) => {
        setExpenses([newExpense, ...expenses]);
    };

    const handleExpenseDeleted = (deletedId) => {
        setExpenses(expenses.filter(e => e.id !== deletedId));
    };

    if (loading) return <div style={{ padding: '2rem' }}>Loading Finance Hub...</div>;

    const filteredExpensesForLedger = expenses.filter(e => isWithinRange(e.date));

    return (
        <div className="animate-slide-up">
            <div className="page-header" style={{ marginBottom: '1rem' }}>
                <h1 className="page-title">Financial Overview</h1>
                <button className="btn btn-primary" onClick={downloadCSV}>⭳ Export Ledger CSV</button>
            </div>

            {/* Global Date Filter */}
            <div className="card" style={{ padding: '1rem', marginBottom: '2rem', display: 'flex', gap: '1rem', alignItems: 'center', backgroundColor: '#f8fafc', flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--text-dark)' }}>Filter Period:</strong>
                <input type="date" className="form-control" value={dateRange.start} onChange={e => setDateRange({ ...dateRange, start: e.target.value })} style={{ width: 'auto' }} />
                <span>to</span>
                <input type="date" className="form-control" value={dateRange.end} onChange={e => setDateRange({ ...dateRange, end: e.target.value })} style={{ width: 'auto' }} />
                <button className="btn" onClick={() => setDateRange({ start: '', end: '' })} style={{ backgroundColor: 'transparent', border: '1px solid var(--border)', color: 'var(--text-light)' }}>Clear Filter</button>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid var(--border)', marginBottom: '2rem' }}>
                {['Overview', 'Earnings', 'Expenses'].map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            padding: '0.75rem 1.5rem',
                            fontWeight: 600,
                            fontSize: '1rem',
                            backgroundColor: 'transparent',
                            border: 'none',
                            borderBottom: activeTab === tab ? '3px solid var(--primary)' : '3px solid transparent',
                            color: activeTab === tab ? 'var(--primary)' : 'var(--text-light)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            marginBottom: '-2px' // align with border
                        }}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="tab-content" style={{ minHeight: '400px' }}>
                {activeTab === 'Overview' && (
                    <FinanceMetricsCards metrics={metrics} />
                )}

                {activeTab === 'Earnings' && (
                    <EarningsLedger earningsList={metrics.earningsList} />
                )}

                {activeTab === 'Expenses' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: '2rem' }}>
                        <div>
                            <ExpenseForm onExpenseAdded={handleExpenseAdded} />
                        </div>
                        <div>
                            <ExpensesLedger 
                                expenses={filteredExpensesForLedger} 
                                onExpenseDeleted={handleExpenseDeleted} 
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
