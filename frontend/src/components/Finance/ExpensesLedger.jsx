import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { fetchWithAuth } from '../../utils/api';

export default function ExpensesLedger({ expenses, onExpenseDeleted }) {
    const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('');
    const [expenseSortConfig, setExpenseSortConfig] = useState({ key: 'date', direction: 'desc' });

    const handleSort = (key) => {
        let direction = 'desc';
        if (expenseSortConfig.key === key && expenseSortConfig.direction === 'desc') direction = 'asc';
        setExpenseSortConfig({ key, direction });
    };

    const getSortIndicator = (key) => expenseSortConfig.key === key ? (expenseSortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

    const handleDeleteExpense = async (id) => {
        if (!window.confirm("Delete this expense?")) return;
        try {
            const res = await fetchWithAuth(`/api/expenses/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error("Failed to delete expense");
            if (onExpenseDeleted) onExpenseDeleted(id);
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

    return (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc' }}>
                <h3 style={{ margin: 0, color: 'var(--text-dark)' }}>Recent Expenses Ledger</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
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
    );
}
