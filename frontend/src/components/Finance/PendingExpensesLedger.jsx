import React, { useState } from 'react';
import { Trash2, CheckCircle } from 'lucide-react';
import { fetchWithAuth } from '../../utils/api';

export default function PendingExpensesLedger({ expenses, onExpenseDeleted, onExpenseSettled }) {
    const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('');
    const [expenseSortConfig, setExpenseSortConfig] = useState({ key: 'date', direction: 'desc' });
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);

    const handleSort = (key) => {
        let direction = 'desc';
        if (expenseSortConfig.key === key && expenseSortConfig.direction === 'desc') direction = 'asc';
        setExpenseSortConfig({ key, direction });
        setCurrentPage(1);
    };

    const getSortIndicator = (key) => expenseSortConfig.key === key ? (expenseSortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

    const handleFilterChange = (val) => {
        setExpenseCategoryFilter(val);
        setCurrentPage(1);
    };

    const handleDeleteExpense = async (id) => {
        if (!window.confirm("Delete this pending expense?")) return;
        try {
            const res = await fetchWithAuth(`/api/pending-expenses/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error("Failed to delete pending expense");
            if (onExpenseDeleted) onExpenseDeleted(id);
        } catch (err) {
            alert(err.message);
        }
    };

    const handleSettleExpense = async (id) => {
        if (!window.confirm("Mark this pending expense as settled (paid)? It will move to the settled Expenses tab.")) return;
        try {
            const res = await fetchWithAuth(`/api/pending-expenses/${id}/settle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: new Date().toISOString().split('T')[0] })
            });
            if (!res.ok) throw new Error("Failed to settle expense");
            const data = await res.json();
            if (onExpenseSettled) onExpenseSettled(id, data.data);
        } catch (err) {
            alert(err.message);
        }
    };

    const filteredExpenses = (expenses || [])
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

    const totalItems = filteredExpenses.length;
    const totalPages = itemsPerPage === 'All' ? 1 : Math.ceil(totalItems / itemsPerPage) || 1;
    const safePage = Math.min(Math.max(1, currentPage), totalPages);

    let paginatedExpenses = filteredExpenses;
    if (itemsPerPage !== 'All') {
        const startIndex = (safePage - 1) * itemsPerPage;
        paginatedExpenses = filteredExpenses.slice(startIndex, startIndex + itemsPerPage);
    }

    return (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc' }}>
                <h3 style={{ margin: 0, color: 'var(--text-dark)' }}>Pending Expenses Ledger</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-light)', cursor: 'pointer', userSelect: 'none' }}>
                            <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleSort('date')}>Date{getSortIndicator('date')}</th>
                            <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleSort('category')}>Category{getSortIndicator('category')}</th>
                            <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleSort('amount')}>Amount{getSortIndicator('amount')}</th>
                            <th style={{ padding: '1rem', fontWeight: 600 }}>Description</th>
                            <th style={{ padding: '1rem', fontWeight: 600 }}>Actions</th>
                        </tr>
                        <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
                            <td style={{ padding: '0.5rem' }}></td>
                            <td style={{ padding: '0.5rem' }}>
                                <select 
                                    className="form-control" 
                                    value={expenseCategoryFilter} 
                                    onChange={e => handleFilterChange(e.target.value)} 
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
                        {paginatedExpenses.length === 0 && (
                            <tr>
                                <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                    No pending expenses match this filter.
                                </td>
                            </tr>
                        )}
                        {paginatedExpenses.map(exp => (
                            <tr key={exp.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>{new Date(exp.date).toLocaleDateString()}</td>
                                <td style={{ padding: '1rem' }}>
                                    <span style={{ padding: '0.25rem 0.5rem', backgroundColor: '#fef3c7', color: '#d97706', borderRadius: '1rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                        {exp.category}
                                    </span>
                                </td>
                                <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--warning)' }}>
                                    {(exp.amount || 0).toLocaleString()}
                                </td>
                                <td style={{ padding: '1rem', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                                    {exp.description || '-'}
                                </td>
                                <td style={{ padding: '1rem' }}>
                                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                                        <button 
                                            className="btn" 
                                            onClick={() => handleSettleExpense(exp.id)}
                                            style={{ padding: '0.4rem', backgroundColor: 'transparent', color: 'var(--success)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                            title="Settle Expense (Mark Paid)"
                                        >
                                            <CheckCircle size={18} />
                                        </button>
                                        <button 
                                            className="btn" 
                                            onClick={() => handleDeleteExpense(exp.id)}
                                            style={{ padding: '0.4rem', backgroundColor: 'transparent', color: 'var(--danger)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                            title="Delete Pending Expense"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                    <span>Items per page:</span>
                    <select 
                        className="form-control" 
                        style={{ padding: '0.2rem', width: 'auto' }} 
                        value={itemsPerPage} 
                        onChange={(e) => {
                            const val = e.target.value;
                            setItemsPerPage(val === 'All' ? 'All' : Number(val));
                            setCurrentPage(1);
                        }}
                    >
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value="All">All</option>
                    </select>
                </div>
                
                {itemsPerPage !== 'All' && totalPages > 1 && (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button 
                            className="btn" 
                            style={{ padding: '0.3rem 0.6rem', border: '1px solid var(--border)', background: 'var(--surface)', cursor: safePage === 1 ? 'not-allowed' : 'pointer', opacity: safePage === 1 ? 0.5 : 1 }}
                            disabled={safePage === 1}
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        >
                            Previous
                        </button>
                        <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                            Page {safePage} of {totalPages}
                        </span>
                        <button 
                            className="btn" 
                            style={{ padding: '0.3rem 0.6rem', border: '1px solid var(--border)', background: 'var(--surface)', cursor: safePage === totalPages ? 'not-allowed' : 'pointer', opacity: safePage === totalPages ? 0.5 : 1 }}
                            disabled={safePage === totalPages}
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        >
                            Next
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
