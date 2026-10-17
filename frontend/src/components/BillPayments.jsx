import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Clock, AlertCircle, CircleDot, X, Trash2, Wallet } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { ButtonSpinner } from './ProcessingOverlay';

// Shared pieces for paying laundry and utility bills in one or more parts.

const today = () => new Date().toISOString().split('T')[0];
const lkr = (val) => `LKR ${Number(val || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const readJson = async (res) => {
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new Error(`Server returned an unexpected response (HTTP ${res.status}).`); }
};

export const isBillOverdue = (bill) => bill.status !== 'Paid' && bill.dueDate && bill.dueDate < today();

export function BillStatusBadge({ bill }) {
    const s = bill.status === 'Paid'
        ? { bg: '#dcfce7', fg: '#15803d', Icon: CheckCircle2, text: 'Paid' }
        : isBillOverdue(bill)
            ? { bg: '#fee2e2', fg: '#b91c1c', Icon: AlertCircle, text: bill.status === 'Partially Paid' ? 'Overdue · part paid' : 'Overdue' }
            : bill.status === 'Partially Paid'
                ? { bg: '#e0f2fe', fg: '#0369a1', Icon: CircleDot, text: 'Partially paid' }
                : { bg: '#fef3c7', fg: '#b45309', Icon: Clock, text: 'Pending' };
    const { Icon } = s;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.6rem', borderRadius: '1rem', backgroundColor: s.bg, color: s.fg, fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
            <Icon size={13} /> {s.text}
        </span>
    );
}

// "Paid X · Due Y" line for bills with part payments
export function PaidDueLine({ bill }) {
    if (!(Number(bill.paidAmount) > 0) || bill.status === 'Paid') return null;
    return (
        <div style={{ fontSize: '0.75rem', fontWeight: 500, marginTop: '0.15rem' }}>
            <span style={{ color: 'var(--success)' }}>Paid {Number(bill.paidAmount).toLocaleString()}</span>
            <span style={{ color: '#b45309' }}> · Due {Number(bill.balance).toLocaleString()}</span>
        </div>
    );
}

// Record a full or part payment. payUrl receives { amount, paidDate, paymentNotes }.
export function PayBillModal({ title, reference, subtitle, bill, payUrl, expenseCategory, onClose, onDone }) {
    const balance = Number(bill.balance ?? bill.totalAmount);
    const [amount, setAmount] = useState(String(balance));
    const [paidDate, setPaidDate] = useState(today());
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const value = Number(amount || 0);
    const over = value > balance + 0.009;
    const remaining = Math.max(0, Math.round((balance - value) * 100) / 100);

    const save = async (e) => {
        e.preventDefault();
        if (saving) return;
        if (!(value > 0)) return setError('Enter the amount paid.');
        if (over) return setError(`That is more than the balance due (${lkr(balance)}).`);
        setSaving(true);
        setError('');
        try {
            const res = await fetchWithAuth(payUrl, { method: 'POST', body: JSON.stringify({ amount: value, paidDate, paymentNotes: notes }) });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to record payment');
            onDone && onDone();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1800, padding: '1.5rem' }}>
            <form onSubmit={save} className="card animate-slide-up" style={{ width: '100%', maxWidth: '480px', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Wallet className="text-success" size={20} /> {title}
                    </h3>
                    <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}>
                        <X size={20} />
                    </button>
                </div>

                <div style={{ padding: '1.5rem' }}>
                    <div style={{ padding: '1rem', backgroundColor: '#f0fdf4', borderRadius: '0.5rem', border: '1px solid #bbf7d0', marginBottom: '1.25rem' }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#14532d' }}>{reference}</div>
                        {subtitle && <div style={{ fontSize: '0.8rem', color: '#166534' }}>{subtitle}</div>}
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.85rem', marginTop: '0.5rem', color: '#166534' }}>
                            <span>Total <b>{lkr(bill.totalAmount)}</b></span>
                            {Number(bill.paidAmount) > 0 && <span>Paid <b>{lkr(bill.paidAmount)}</b></span>}
                            <span style={{ color: '#b45309' }}>Due <b>{lkr(balance)}</b></span>
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Amount paid (LKR)</label>
                        <input type="number" step="any" min="0" className="form-control" value={amount} onChange={e => setAmount(e.target.value)} required autoFocus />
                        <div style={{ fontSize: '0.8rem', color: over ? '#b91c1c' : 'var(--text-light)' }}>
                            {over ? `More than the balance of ${lkr(balance)}` : remaining > 0.009 ? `Part payment — ${lkr(remaining)} will still be due` : 'Pays the bill in full'}
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Payment date</label>
                        <input type="date" className="form-control" value={paidDate} onChange={e => setPaidDate(e.target.value)} required />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Notes / reference (optional)</label>
                        <input type="text" className="form-control" placeholder="e.g. Bank transfer, cash..." value={notes} onChange={e => setNotes(e.target.value)} />
                    </div>

                    <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', margin: '1rem 0 0 0' }}>
                        Each payment is added to Financials as a separate <b>"{expenseCategory}"</b> expense on its payment date.
                    </p>

                    {error && (
                        <div style={{ marginTop: '1rem', padding: '0.65rem 0.75rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', fontSize: '0.85rem' }}>{error}</div>
                    )}
                </div>

                <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', backgroundColor: '#f8fafc' }}>
                    <button type="button" className="btn" onClick={onClose} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>Cancel</button>
                    <button type="submit" className="btn" disabled={saving || over || !(value > 0)} style={{ backgroundColor: over || !(value > 0) ? '#cbd5e1' : '#10b981', color: 'white', fontWeight: 600 }}>
                        {saving ? <ButtonSpinner /> : <CheckCircle2 size={16} />}
                        {saving ? 'Saving...' : `Record ${lkr(value)}`}
                    </button>
                </div>
            </form>
        </div>,
        document.body
    );
}

// Payments made against a bill, each removable. paymentsUrl is the bill's /payments base URL.
export function PaymentsList({ payments, paymentsUrl, onChanged }) {
    const [removing, setRemoving] = useState(null);
    if (!payments || payments.length === 0) return null;

    const remove = async (p) => {
        if (!window.confirm(`Remove the payment of ${lkr(p.amount)} on ${p.date}? Its expense will also be removed from Financials.`)) return;
        setRemoving(p.id);
        try {
            const res = await fetchWithAuth(`${paymentsUrl}/${p.id}`, { method: 'DELETE' });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to remove payment');
            onChanged && onChanged();
        } catch (err) {
            alert(err.message);
        } finally {
            setRemoving(null);
        }
    };

    return (
        <div style={{ marginBottom: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text)' }}>Payments ({payments.length})</h4>
            <div style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden' }}>
                {payments.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', borderBottom: '1px solid var(--border)', fontSize: '0.9rem' }}>
                        <span style={{ whiteSpace: 'nowrap', color: 'var(--text-light)' }}>{p.date}</span>
                        <span style={{ flex: 1, color: 'var(--text-light)', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.notes || ''}</span>
                        <b style={{ whiteSpace: 'nowrap' }}>{lkr(p.amount)}</b>
                        <button type="button" onClick={() => remove(p)} disabled={removing === p.id} title="Remove this payment" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: '0.2rem' }}>
                            {removing === p.id ? <ButtonSpinner /> : <Trash2 size={15} />}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
