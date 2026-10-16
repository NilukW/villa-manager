import { useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { notifyDataChanged } from '../utils/notifications';
import { lkr, shortDate } from '../utils/bookings';
import { ButtonSpinner } from './ProcessingOverlay';

const today = () => new Date().toISOString().split('T')[0];

// Confirm a guest's checkout. If a balance remains it must be settled here:
// the amount is recorded as the final payment and checkout is confirmed in one step.
export default function CheckoutDialog({ booking, onClose, onDone }) {
    const hasBalance = booking.pending > 0.05;
    const [amount, setAmount] = useState(hasBalance ? String(booking.pending) : '0');
    const [paymentDate, setPaymentDate] = useState(today());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const short = hasBalance ? Math.round((booking.pending - Number(amount || 0)) * 100) / 100 : 0;

    const confirm = async (e) => {
        e.preventDefault();
        if (saving) return;
        if (short > 0.05) return setError(`The full balance of ${lkr(booking.pending)} must be settled to check out.`);
        setSaving(true);
        setError('');
        try {
            const res = await fetchWithAuth(`/api/reservations/group/${encodeURIComponent(booking.key)}/checkout`, {
                method: 'POST',
                body: JSON.stringify({ amountReceived: hasBalance ? Number(amount) : 0, paymentDate, checkoutDate: today() })
            });
            const text = await res.text();
            let json = {};
            try { json = JSON.parse(text); } catch { throw new Error(`Server returned an unexpected response (HTTP ${res.status}).`); }
            if (!res.ok) throw new Error(json.error || 'Failed to confirm checkout');
            notifyDataChanged();
            onDone && onDone();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1800, padding: '1.5rem' }}>
            <form onSubmit={confirm} className="card animate-slide-up" style={{ width: '100%', maxWidth: '460px', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <LogOut size={20} className="text-primary" /> Confirm Checkout
                    </h3>
                    <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}>
                        <X size={20} />
                    </button>
                </div>

                <div style={{ padding: '1.5rem' }}>
                    <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text)' }}>{booking.guestName}</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-light)' }}>
                            {booking.rooms.join(', ')} · {shortDate(booking.checkIn)} → {shortDate(booking.checkOut)} ({booking.nights} night{booking.nights === 1 ? '' : 's'})
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
                        {[['Total', booking.total, 'var(--text)'], ['Paid', booking.paid, 'var(--success)'], ['Balance', Math.max(0, booking.pending), hasBalance ? '#b91c1c' : 'var(--success)']].map(([label, val, color]) => (
                            <div key={label} style={{ padding: '0.65rem', backgroundColor: '#f8fafc', border: '1px solid var(--border)', borderRadius: '0.5rem' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
                                <div style={{ fontWeight: 700, color, fontSize: '0.95rem' }}>{lkr(val)}</div>
                            </div>
                        ))}
                    </div>

                    {hasBalance ? (
                        <>
                            <div style={{ padding: '0.65rem 0.85rem', marginBottom: '1rem', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '0.5rem', fontSize: '0.85rem', color: '#92400e', display: 'flex', gap: '0.5rem' }}>
                                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                                Collect the balance before the guest leaves. It is recorded as the final payment for this booking.
                            </div>
                            <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div className="form-group">
                                    <label className="form-label">Amount received (LKR)</label>
                                    <input type="number" step="any" min="0" className="form-control" value={amount} onChange={e => setAmount(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Payment date</label>
                                    <input type="date" className="form-control" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} required />
                                </div>
                            </div>
                        </>
                    ) : (
                        <div style={{ padding: '0.65rem 0.85rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', fontSize: '0.9rem', color: '#166534', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <CheckCircle2 size={16} /> Fully paid — just confirm the guest has checked out.
                        </div>
                    )}

                    {error && (
                        <div style={{ marginTop: '1rem', padding: '0.65rem 0.75rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', fontSize: '0.85rem' }}>{error}</div>
                    )}
                </div>

                <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', backgroundColor: '#f8fafc' }}>
                    <button type="button" className="btn" onClick={onClose} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>Cancel</button>
                    <button type="submit" className="btn" disabled={saving || short > 0.05} style={{ backgroundColor: short > 0.05 ? '#cbd5e1' : '#10b981', color: 'white', fontWeight: 600 }}>
                        {saving ? <ButtonSpinner /> : <CheckCircle2 size={16} />}
                        {saving ? 'Confirming...' : hasBalance ? `Settle ${lkr(Number(amount || 0))} & Check Out` : 'Confirm Checkout'}
                    </button>
                </div>
            </form>
        </div>,
        document.body
    );
}
