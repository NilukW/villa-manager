import React, { useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { fetchWithAuth } from '../../utils/api';

export default function ExpenseForm({ onExpenseAdded }) {
    const [expenseForm, setExpenseForm] = useState({
        date: new Date().toISOString().split('T')[0],
        category: 'Utilities',
        amount: '',
        description: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

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
            
            if (onExpenseAdded) onExpenseAdded(data.data);
            
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

    return (
        <div className="card" style={{ padding: '1.5rem', height: '100%' }}>
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
    );
}
