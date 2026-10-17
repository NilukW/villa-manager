import { useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { HandCoins, X, CheckCircle2 } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { notifyDataChanged } from '../utils/notifications';
import { lkr, shortDate } from '../utils/bookings';
import { ButtonSpinner } from './ProcessingOverlay';

const isoDate = (d) => format(d, 'yyyy-MM-dd');

// Record a payment towards a booking's balance: the full balance or part of it,
// dated whenever it was received (check-in day, today, check-out day or any other date).
export default function SettleDialog({ booking, onClose, onDone }) {
    const [amount, setAmount] = useState(String(Math.max(0, booking.pending)));
    const [date, setDate] = useState(isoDate(new Date()));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const value = Number(amount || 0);
    const over = value > booking.pending + 0.05;
    const remaining = Math.max(0, Math.round((booking.pending - value) * 100) / 100);

    const quickDates = [
        ['Check-in day', isoDate(booking.checkIn)],
        ['Today', isoDate(new Date())],
        ['Check-out day', isoDate(booking.checkOut)]
    ];

    const save = async (e) => {
        e.preventDefault();
        if (saving) return;
        if (!(value > 0)) return setError('Enter the amount received.');
        if (over) return setError(`That is more than the balance due (${lkr(booking.pending)}).`);
        setSaving(true);
        setError('');
        try {
            const res = await fetchWithAuth(`/api/reservations/group/${encodeURIComponent(booking.key)}/settle`, {
                method: 'POST',
                body: JSON.stringify({ amountReceived: value, date })
            });
            const text = await res.text();
            let json = {};
            try { json = JSON.parse(text); } catch { throw new Error(`Server returned an unexpected response (HTTP ${res.status}).`); }
            if (!res.ok) throw new Error(json.error || 'Failed to record payment');
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
            <form onSubmit={save} className="card animate-slide-up" style={{ width: '100%', maxWidth: '460px', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <HandCoins size={20} className="text-primary" /> Settle Payment
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
                        {[['Total', booking.total, 'var(--text)'], ['Paid', booking.paid, 'var(--success)'], ['Balance', Math.max(0, booking.pending), '#b91c1c']].map(([label, val, color]) => (
                            <div key={label} style={{ padding: '0.65rem', backgroundColor: '#f8fafc', border: '1px solid var(--border)', borderRadius: '0.5rem' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
                                <div style={{ fontWeight: 700, color, fontSize: '0.95rem' }}>{lkr(val)}</div>
                            </div>
                        ))}
                    </div>

                    <div className="form-group">
                        <label className="form-label">Amount received (LKR)</label>
                        <input type="number" step="any" min="0" className="form-control" value={amount} onChange={e => setAmount(e.target.value)} required autoFocus />
                        <div style={{ fontSize: '0.8rem', color: over ? '#b91c1c' : 'var(--text-light)' }}>
                            {over ? `More than the balance of ${lkr(booking.pending)}` : remaining > 0.05 ? `Part payment — ${lkr(remaining)} will still be due` : 'Settles the balance in full'}
                        </div>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Payment date</label>
                        <input type="date" className="form-control" value={date} onChange={e => setDate(e.target.value)} required />
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {quickDates.map(([label, d]) => (
                                <button
                                    key={label}
                                    type="button"
                                    onClick={() => setDate(d)}
                                    className="btn"
                                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem', border: `1px solid ${date === d ? 'var(--primary)' : 'var(--border)'}`, backgroundColor: date === d ? '#eef2ff' : 'white', color: date === d ? 'var(--primary)' : 'var(--text-light)' }}
                                >
                                    {label} · {format(new Date(`${d}T00:00:00`), 'd MMM')}
                                </button>
                            ))}
                        </div>
                    </div>

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
