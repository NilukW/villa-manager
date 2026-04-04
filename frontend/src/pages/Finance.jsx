import { useState, useEffect, useMemo } from 'react';
import { fetchWithAuth } from '../utils/api';
import { PlusCircle, Trash2, IndianRupee, PieChart as PieChartIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function Finance() {
    const [bookings, setBookings] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [loading, setLoading] = useState(true);

    const [expenseForm, setExpenseForm] = useState({
        date: new Date().toISOString().split('T')[0],
        category: 'Utilities',
        amount: '',
        description: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('');
    const [expenseSortConfig, setExpenseSortConfig] = useState({ key: 'date', direction: 'desc' });
    const [earningSourceFilter, setEarningSourceFilter] = useState('');
    const [earningSortConfig, setEarningSortConfig] = useState({ key: 'date', direction: 'desc' });

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
                        paid = parsed.reduce((sum, p) => sum + Number(p.amount || 0), 0);
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

    const handleAddExpense = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const res = await fetchWithAuth('/api/expenses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(expenseForm)
            });
            if (!res.ok) throw new Error("Failed to add expense");
            
            const data = await res.json();
            setExpenses([data.data, ...expenses]);
            
            setExpenseForm({
                ...expenseForm,
                amount: '',
                description: ''
            });
        } catch (err) {
            alert(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteExpense = async (id) => {
        if (!window.confirm("Delete this expense?")) return;
        try {
            const res = await fetchWithAuth(`/api/expenses/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error("Failed to delete expense");
            setExpenses(expenses.filter(e => e.id !== id));
        } catch (err) {
            alert(err.message);
        }
    };

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
                        paid = parsed.reduce((sum, p) => sum + Number(p.amount || 0), 0);
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

    const handleSort = (key) => {
        let direction = 'desc';
        if (expenseSortConfig.key === key && expenseSortConfig.direction === 'desc') direction = 'asc';
        setExpenseSortConfig({ key, direction });
    };

    const getSortIndicator = (key) => expenseSortConfig.key === key ? (expenseSortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

    const filteredExpenses = expenses
        .filter(e => isWithinRange(e.date))
        .filter(e => expenseCategoryFilter ? e.category === expenseCategoryFilter : true)
        .sort((a, b) => {
            let valA = a[expenseSortConfig.key];
            let valB = b[expenseSortConfig.key];
            if (expenseSortConfig.key === 'amount') {
                valA = Number(valA);
                valB = Number(valB);
            }
            if (valA < valB) return expenseSortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return expenseSortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

    const handleEarningSort = (key) => {
        let direction = 'desc';
        if (earningSortConfig.key === key && earningSortConfig.direction === 'desc') direction = 'asc';
        setEarningSortConfig({ key, direction });
    };

    const getEarningSortIndicator = (key) => earningSortConfig.key === key ? (earningSortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

    const filteredEarnings = (metrics.earningsList || [])
        .filter(e => earningSourceFilter ? e.source === earningSourceFilter : true)
        .sort((a, b) => {
            let valA = a[earningSortConfig.key];
            let valB = b[earningSortConfig.key];
            if (earningSortConfig.key === 'amount') {
                valA = Number(valA);
                valB = Number(valB);
            }
            if (valA < valB) return earningSortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return earningSortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

    if (loading) return <div style={{ padding: '2rem' }}>Loading Finance Hub...</div>;

    return (
        <div className="animate-slide-up">
            <div className="page-header">
                <h1 className="page-title">Financial Overview</h1>
                <button className="btn btn-primary" onClick={downloadCSV}>⭳ Export Ledger CSV</button>
            </div>

            {/* Global Date Filter */}
            <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', backgroundColor: '#f8fafc', flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--text-dark)' }}>Filter Ledger Period:</strong>
                <input type="date" className="form-control" value={dateRange.start} onChange={e => setDateRange({ ...dateRange, start: e.target.value })} style={{ width: 'auto' }} />
                <span>to</span>
                <input type="date" className="form-control" value={dateRange.end} onChange={e => setDateRange({ ...dateRange, end: e.target.value })} style={{ width: 'auto' }} />
                <button className="btn" onClick={() => setDateRange({ start: '', end: '' })} style={{ backgroundColor: 'transparent', border: '1px solid var(--border)', color: 'var(--text-light)' }}>Clear Filter</button>
            </div>

            {/* Dashboard Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                <div className="card" style={{ padding: '1.5rem', borderLeft: '4px solid var(--success)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <p style={{ color: 'var(--text-light)', margin: 0, fontWeight: 600 }}>Total Revenue</p>
                            <h2 style={{ margin: '0.5rem 0 0 0', fontSize: '2rem', color: 'var(--text-dark)' }}>
                                LKR {metrics.revenue.toLocaleString()}
                            </h2>
                        </div>
                        <div style={{ backgroundColor: '#f0fdf4', padding: '0.75rem', borderRadius: '50%', color: 'var(--success)' }}>
                            <ArrowUpRight size={24} />
                        </div>
                    </div>
                    <p style={{ margin: '1rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                        From fully settled bookings
                    </p>
                </div>

                <div className="card" style={{ padding: '1.5rem', borderLeft: '4px solid var(--danger)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <p style={{ color: 'var(--text-light)', margin: 0, fontWeight: 600 }}>Total Expenses</p>
                            <h2 style={{ margin: '0.5rem 0 0 0', fontSize: '2rem', color: 'var(--text-dark)' }}>
                                LKR {metrics.expenses.toLocaleString()}
                            </h2>
                        </div>
                        <div style={{ backgroundColor: '#fef2f2', padding: '0.75rem', borderRadius: '50%', color: 'var(--danger)' }}>
                            <ArrowDownRight size={24} />
                        </div>
                    </div>
                    <p style={{ margin: '1rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                        Operational outgoings
                    </p>
                </div>

                <div className="card" style={{ padding: '1.5rem', borderLeft: '4px solid var(--primary)', backgroundColor: 'var(--primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <p style={{ color: '#e0e7ff', margin: 0, fontWeight: 600 }}>Net Profit</p>
                            <h2 style={{ margin: '0.5rem 0 0 0', fontSize: '2rem', color: 'white' }}>
                                LKR {metrics.profit.toLocaleString()}
                            </h2>
                        </div>
                        <div style={{ backgroundColor: '#4f46e5', padding: '0.75rem', borderRadius: '50%', color: 'white' }}>
                            <PieChartIcon size={24} />
                        </div>
                    </div>
                    <p style={{ margin: '1rem 0 0 0', fontSize: '0.85rem', color: '#c7d2fe' }}>
                        Revenue minus Expenses
                    </p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: '2rem' }}>
                {/* Form Col */}
                <div>
                    <div className="card" style={{ padding: '1.5rem' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '1.5rem', color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <PlusCircle size={20} className="text-primary" />
                            Log New Expense
                        </h3>
                        <form onSubmit={handleAddExpense} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div className="form-group">
                                <label className="form-label">Date</label>
                                <input 
                                    type="date" 
                                    className="form-control" 
                                    value={expenseForm.date}
                                    onChange={e => setExpenseForm({...expenseForm, date: e.target.value})}
                                    required 
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Category</label>
                                <select 
                                    className="form-control"
                                    value={expenseForm.category}
                                    onChange={e => setExpenseForm({...expenseForm, category: e.target.value})}
                                    required
                                >
                                    <option value="Maintenance">Maintenance & Repairs</option>
                                    <option value="Cleaning">Cleaning / Laundry</option>
                                    <option value="Utilities">Utilities (Water, Power, Internet)</option>
                                    <option value="Salary">Staff Salary</option>
                                    <option value="Supplies">Supplies & Groceries</option>
                                    <option value="Other">Other Category</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Amount (LKR)</label>
                                <input 
                                    type="number" 
                                    step="any"
                                    className="form-control" 
                                    value={expenseForm.amount}
                                    onChange={e => setExpenseForm({...expenseForm, amount: e.target.value})}
                                    required 
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Description (Optional)</label>
                                <input 
                                    type="text" 
                                    className="form-control" 
                                    placeholder="e.g. Fixed the plumbing"
                                    value={expenseForm.description}
                                    onChange={e => setExpenseForm({...expenseForm, description: e.target.value})}
                                />
                            </div>
                            <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ marginTop: '0.5rem' }}>
                                Add Expense Record
                            </button>
                        </form>
                    </div>
                </div>

                {/* List Col */}
                <div>
                    {/* Earnings Ledger */}
                    <div className="card" style={{ padding: '0', overflow: 'hidden', marginBottom: '2rem' }}>
                        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f0fdf4' }}>
                            <h3 style={{ margin: 0, color: 'var(--success)' }}>Confirmed Earnings Ledger</h3>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-light)', cursor: 'pointer', userSelect: 'none' }}>
                                    <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleEarningSort('date')}>Paid Date{getEarningSortIndicator('date')}</th>
                                    <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleEarningSort('guestName')}>Guest{getEarningSortIndicator('guestName')}</th>
                                    <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleEarningSort('source')}>Source{getEarningSortIndicator('source')}</th>
                                    <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleEarningSort('amount')}>Amount{getEarningSortIndicator('amount')}</th>
                                    <th style={{ padding: '1rem', fontWeight: 600 }}>Rooms</th>
                                </tr>
                                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
                                    <td style={{ padding: '0.5rem' }}></td>
                                    <td style={{ padding: '0.5rem' }}></td>
                                    <td style={{ padding: '0.5rem' }}>
                                        <select 
                                            className="form-control" 
                                            value={earningSourceFilter} 
                                            onChange={e => setEarningSourceFilter(e.target.value)} 
                                            style={{ width: '100%', padding: '0.3rem', fontSize: '0.85rem' }}
                                        >
                                            <option value="">All Sources</option>
                                            <option value="Direct">Direct / Walk-in</option>
                                            <option value="Booking.com">Booking.com</option>
                                            <option value="Airbnb">Airbnb</option>
                                            <option value="Other">Other</option>
                                        </select>
                                    </td>
                                    <td style={{ padding: '0.5rem' }}></td>
                                    <td style={{ padding: '0.5rem' }}></td>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredEarnings.length === 0 && (
                                    <tr>
                                        <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                            No fully settled earnings match this filter.
                                        </td>
                                    </tr>
                                )}
                                {filteredEarnings.map(earn => (
                                    <tr key={earn.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>{new Date(earn.date).toLocaleDateString()}</td>
                                        <td style={{ padding: '1rem', fontWeight: 500 }}>{earn.guestName}</td>
                                        <td style={{ padding: '1rem' }}>
                                            <span style={{ padding: '0.25rem 0.5rem', backgroundColor: earn.source === 'Booking.com' ? '#003580' : '#f1f5f9', color: earn.source === 'Booking.com' ? 'white' : 'var(--text)', borderRadius: '1rem', fontSize: '0.85rem' }}>
                                                {earn.source}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--success)' }}>
                                            + {(earn.amount || 0).toLocaleString()}
                                        </td>
                                        <td style={{ padding: '1rem', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                                            {earn.rooms || '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
                        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc' }}>
                            <h3 style={{ margin: 0, color: 'var(--text-dark)' }}>Recent Expenses Ledger</h3>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-light)', cursor: 'pointer', userSelect: 'none' }}>
                                        <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleSort('date')}>Date{getSortIndicator('date')}</th>
                                        <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleSort('category')}>Category{getSortIndicator('category')}</th>
                                        <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleSort('amount')}>Amount{getSortIndicator('amount')}</th>
                                        <th style={{ padding: '1rem', fontWeight: 600 }}>Description</th>
                                        <th style={{ padding: '1rem', fontWeight: 600 }}></th>
                                    </tr>
                                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
                                        <td style={{ padding: '0.5rem' }}></td>
                                        <td style={{ padding: '0.5rem' }}>
                                            <select 
                                                className="form-control" 
                                                value={expenseCategoryFilter} 
                                                onChange={e => setExpenseCategoryFilter(e.target.value)} 
                                                style={{ width: '100%', padding: '0.3rem', fontSize: '0.85rem' }}
                                            >
                                                <option value="">All Categories</option>
                                                <option value="Maintenance">Maintenance & Repairs</option>
                                                <option value="Cleaning">Cleaning / Laundry</option>
                                                <option value="Utilities">Utilities</option>
                                                <option value="Salary">Staff Salary</option>
                                                <option value="Supplies">Supplies & Groceries</option>
                                                <option value="Other">Other Category</option>
                                            </select>
                                        </td>
                                        <td style={{ padding: '0.5rem' }}></td>
                                        <td style={{ padding: '0.5rem' }}></td>
                                        <td style={{ padding: '0.5rem' }}></td>
                                    </tr>
                            </thead>
                            <tbody>
                                {filteredExpenses.length === 0 && (
                                    <tr>
                                        <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                            No expenses match this filter.
                                        </td>
                                    </tr>
                                )}
                                {filteredExpenses.map(exp => (
                                    <tr key={exp.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>{new Date(exp.date).toLocaleDateString()}</td>
                                        <td style={{ padding: '1rem' }}>
                                            <span style={{ padding: '0.25rem 0.5rem', backgroundColor: '#f1f5f9', color: 'var(--text)', borderRadius: '1rem', fontSize: '0.85rem' }}>
                                                {exp.category}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--danger)' }}>
                                            - {(exp.amount || 0).toLocaleString()}
                                        </td>
                                        <td style={{ padding: '1rem', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                                            {exp.description || '-'}
                                        </td>
                                        <td style={{ padding: '1rem', textAlign: 'right' }}>
                                            <button 
                                                className="btn" 
                                                onClick={() => handleDeleteExpense(exp.id)}
                                                style={{ padding: '0.4rem', backgroundColor: 'transparent', color: 'inherit', border: 'none', cursor: 'pointer' }}
                                                title="Delete Expense"
                                            >
                                                <Trash2 size={18} className="text-danger" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
