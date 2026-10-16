import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ChevronLeft, ChevronRight, HandCoins, Banknote, Trash2, X, CheckCircle2, Clock, AlertCircle, UserCog, Gift } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ProcessingOverlay, { ButtonSpinner } from '../components/ProcessingOverlay';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const today = () => new Date().toISOString().split('T')[0];
const currentMonthKey = () => today().slice(0, 7);
const monthLabel = (key) => `${MONTHS[parseInt(key.slice(5, 7), 10) - 1]} ${key.slice(0, 4)}`;
const shiftMonth = (key, delta) => {
    const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const lkr = (val) => `LKR ${Number(val || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round(n * 100) / 100;

const readJson = async (res) => {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Server returned an unexpected response (HTTP ${res.status}).${res.status === 404 ? ' The backend may need a restart to pick up new routes.' : ''}`);
    }
};

const TYPE_STYLES = {
    advance: { label: 'Advance', bg: '#fef3c7', fg: '#b45309', Icon: HandCoins },
    salary: { label: 'Salary', bg: '#dcfce7', fg: '#15803d', Icon: Banknote },
    bonus: { label: 'Bonus', bg: '#ede9fe', fg: '#6d28d9', Icon: Gift }
};

const modalBackdrop = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.6)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem'
};

export default function StaffPayments() {
    const [month, setMonth] = useState(currentMonthKey());
    const [staff, setStaff] = useState([]);
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);

    const [paying, setPaying] = useState(null); // { member, type, amount, date, notes, balance }
    const [isSaving, setIsSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const fetchData = async (forMonth = month) => {
        try {
            setLoading(true);
            const [staffRes, payRes] = await Promise.all([
                fetchWithAuth('/api/staff'),
                fetchWithAuth(`/api/staff-payments?month=${forMonth}`)
            ]);
            const staffJson = await readJson(staffRes);
            const payJson = await readJson(payRes);
            if (!staffRes.ok) throw new Error(staffJson.error || 'Failed to load staff');
            if (!payRes.ok) throw new Error(payJson.error || 'Failed to load payments');
            setStaff(staffJson.data || []);
            setPayments(payJson.data || []);
        } catch (err) {
            console.error('Error loading salary data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData(month);
    }, [month]);

    // One row per active staff member, plus inactive staff who have payments in this month
    const rows = useMemo(() => {
        return staff
            .filter(s => s.active || payments.some(p => p.staffId === s.id))
            .map(s => {
                const own = payments.filter(p => p.staffId === s.id);
                const snapshot = own.find(p => p.salaryForMonth !== null && p.salaryForMonth !== undefined);
                const salary = snapshot ? Number(snapshot.salaryForMonth) : Number(s.monthlySalary || 0);
                const advances = own.filter(p => p.type === 'advance').reduce((sum, p) => sum + Number(p.amount), 0);
                const salaryPaid = own.filter(p => p.type === 'salary').reduce((sum, p) => sum + Number(p.amount), 0);
                // Bonuses paid this month add to total pay but are separate from the salary balance
                const bonus = own.filter(p => p.type === 'bonus').reduce((sum, p) => sum + Number(p.amount), 0);
                return { member: s, salary, bonus, totalPay: round2(salary + bonus), advances, salaryPaid, balance: round2(salary - advances - salaryPaid) };
            });
    }, [staff, payments]);

    const totals = useMemo(() => rows.reduce((t, r) => ({
        salary: t.salary + r.salary,
        bonus: t.bonus + r.bonus,
        totalPay: t.totalPay + r.totalPay,
        advances: t.advances + r.advances,
        salaryPaid: t.salaryPaid + r.salaryPaid,
        outstanding: t.outstanding + Math.max(0, r.balance)
    }), { salary: 0, bonus: 0, totalPay: 0, advances: 0, salaryPaid: 0, outstanding: 0 }), [rows]);

    const openPayment = (row, type) => {
        setFormError('');
        setPaying({
            member: row.member,
            type,
            balance: row.balance,
            amount: type === 'salary' && row.balance > 0 ? String(row.balance) : '',
            date: today(),
            notes: ''
        });
    };

    const handleSavePayment = async (e) => {
        e.preventDefault();
        if (isSaving) return;
        const amount = Number(paying.amount);
        if (!(amount > 0)) return setFormError('Please enter an amount greater than zero.');
        if (!paying.date) return setFormError('Please choose the payment date.');
        if (amount > paying.balance + 0.001) {
            const over = round2(amount - Math.max(0, paying.balance));
            if (!window.confirm(`This is ${lkr(over)} more than the remaining balance for ${monthLabel(month)} (${lkr(Math.max(0, paying.balance))}). Record it anyway?`)) return;
        }

        setIsSaving(true);
        setFormError('');
        try {
            const res = await fetchWithAuth('/api/staff-payments', {
                method: 'POST',
                body: JSON.stringify({
                    staffId: paying.member.id,
                    type: paying.type,
                    month,
                    date: paying.date,
                    amount,
                    notes: paying.notes
                })
            });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to record payment');
            await fetchData(month);
            setPaying(null);
        } catch (err) {
            setFormError(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (payment) => {
        const kind = TYPE_STYLES[payment.type].label.toLowerCase();
        if (!window.confirm(`Delete this ${kind} of ${lkr(payment.amount)} for ${payment.staffName}? The matching expense will also be removed from Financials.`)) return;
        try {
            const res = await fetchWithAuth(`/api/staff-payments/${payment.id}`, { method: 'DELETE' });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to delete payment');
            await fetchData(month);
        } catch (err) {
            alert(err.message);
        }
    };

    const statusFor = (r) => {
        if (r.balance < -0.001) return { text: `Overpaid ${lkr(-r.balance)}`, bg: '#fee2e2', fg: '#b91c1c', Icon: AlertCircle };
        if (r.salary > 0 && r.balance <= 0.001) return { text: 'Settled', bg: '#dcfce7', fg: '#15803d', Icon: CheckCircle2 };
        if (r.advances > 0 || r.salaryPaid > 0) return { text: 'Part paid', bg: '#fef3c7', fg: '#b45309', Icon: Clock };
        return { text: 'Unpaid', bg: '#f1f5f9', fg: 'var(--text-light)', Icon: Clock };
    };

    const summaryCard = (label, value, sub, color) => (
        <div className="card" style={{ padding: '1.25rem', borderLeft: `4px solid ${color}` }}>
            <div style={{ color: 'var(--text-light)', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text)', margin: '0.35rem 0' }}>{value}</div>
            <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{sub}</div>
        </div>
    );

    return (
        <div className="animate-slide-up" style={{ paddingBottom: '3rem' }}>
            <ProcessingOverlay
                show={isSaving}
                message={paying?.type === 'advance' ? 'Recording advance...' : 'Recording salary payment...'}
                detail="Adding it to expenses. Please wait."
            />

            <div className="page-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Wallet className="text-primary" size={28} />
                        Salaries & Advances
                    </h1>
                    <p style={{ color: 'var(--text-light)', marginTop: '0.25rem', fontSize: '0.95rem' }}>
                        Give advances during the month and settle the balance at month end. Every payment is added to Financials as a Salary expense.
                    </p>
                </div>

                {/* Month selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button className="btn" onClick={() => setMonth(m => shiftMonth(m, -1))} style={{ padding: '0.5rem', border: '1px solid var(--border)', backgroundColor: 'white' }} title="Previous month">
                        <ChevronLeft size={18} />
                    </button>
                    <input
                        type="month"
                        className="form-control"
                        value={month}
                        onChange={e => e.target.value && setMonth(e.target.value)}
                        style={{ width: 'auto', fontWeight: 600 }}
                    />
                    <button className="btn" onClick={() => setMonth(m => shiftMonth(m, 1))} style={{ padding: '0.5rem', border: '1px solid var(--border)', backgroundColor: 'white' }} title="Next month">
                        <ChevronRight size={18} />
                    </button>
                    {month !== currentMonthKey() && (
                        <button className="btn" onClick={() => setMonth(currentMonthKey())} style={{ border: '1px solid var(--border)', backgroundColor: 'white', fontSize: '0.85rem' }}>
                            This month
                        </button>
                    )}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
                {summaryCard(
                    `Total Pay · ${monthLabel(month)}`,
                    lkr(totals.totalPay),
                    totals.bonus > 0 ? `Salaries ${lkr(totals.salary)} + bonus ${lkr(totals.bonus)}` : `${rows.length} staff · salaries only`,
                    'var(--primary)'
                )}
                {summaryCard('Advances Given', lkr(totals.advances), 'Deducted from month-end salary', '#f59e0b')}
                {summaryCard('Salaries Paid', lkr(totals.salaryPaid), 'Month-end payments', 'var(--success)')}
                {summaryCard('Balance to Pay', lkr(totals.outstanding), totals.outstanding > 0 ? 'Still owed for this month' : 'All settled', totals.outstanding > 0 ? '#ef4444' : 'var(--success)')}
            </div>

            {/* Staff balances */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '2rem' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '980px' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)', color: 'var(--text-light)', fontSize: '0.85rem', textTransform: 'uppercase' }}>
                                <th style={{ padding: '1rem' }}>Staff</th>
                                <th style={{ padding: '1rem' }}>Salary</th>
                                <th style={{ padding: '1rem' }}>Bonus</th>
                                <th style={{ padding: '1rem' }}>Total Pay</th>
                                <th style={{ padding: '1rem' }}>Advances</th>
                                <th style={{ padding: '1rem' }}>Salary Paid</th>
                                <th style={{ padding: '1rem' }}>Balance</th>
                                <th style={{ padding: '1rem' }}>Status</th>
                                <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={9} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>Loading...</td></tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={9} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                        No active staff. <Link to="/staff/manage">Add staff members</Link> first.
                                    </td>
                                </tr>
                            ) : rows.map(r => {
                                const status = statusFor(r);
                                const StatusIcon = status.Icon;
                                return (
                                    <tr key={r.member.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.95rem' }}>
                                        <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--text)' }}>
                                            {r.member.name}
                                            {!r.member.active && <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontWeight: 500 }}>Inactive</div>}
                                        </td>
                                        <td style={{ padding: '1rem' }}>{lkr(r.salary)}</td>
                                        <td style={{ padding: '1rem', color: r.bonus > 0 ? '#6d28d9' : 'var(--text-light)' }}>{r.bonus > 0 ? `+ ${lkr(r.bonus)}` : '-'}</td>
                                        <td style={{ padding: '1rem', fontWeight: 700, color: 'var(--text)' }}>{lkr(r.totalPay)}</td>
                                        <td style={{ padding: '1rem', color: r.advances > 0 ? '#b45309' : 'var(--text-light)' }}>{r.advances > 0 ? `− ${lkr(r.advances)}` : '-'}</td>
                                        <td style={{ padding: '1rem', color: r.salaryPaid > 0 ? '#15803d' : 'var(--text-light)' }}>{r.salaryPaid > 0 ? `− ${lkr(r.salaryPaid)}` : '-'}</td>
                                        <td style={{ padding: '1rem', fontWeight: 700, color: r.balance > 0 ? 'var(--text)' : 'var(--text-light)' }}>{lkr(Math.max(0, r.balance))}</td>
                                        <td style={{ padding: '1rem' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.6rem', borderRadius: '1rem', fontSize: '0.8rem', fontWeight: 600, backgroundColor: status.bg, color: status.fg }}>
                                                <StatusIcon size={13} /> {status.text}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1rem', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                <button
                                                    className="btn"
                                                    onClick={() => openPayment(r, 'advance')}
                                                    style={{ padding: '0.4rem 0.75rem', border: '1px solid #fcd34d', backgroundColor: '#fffbeb', color: '#b45309', fontSize: '0.85rem' }}
                                                >
                                                    <HandCoins size={15} /> Advance
                                                </button>
                                                <button
                                                    className="btn"
                                                    onClick={() => openPayment(r, 'salary')}
                                                    disabled={r.balance <= 0.001}
                                                    style={{ padding: '0.4rem 0.75rem', backgroundColor: r.balance > 0.001 ? '#10b981' : '#e2e8f0', color: r.balance > 0.001 ? 'white' : 'var(--text-light)', fontSize: '0.85rem', cursor: r.balance > 0.001 ? 'pointer' : 'not-allowed' }}
                                                    title={r.balance > 0.001 ? 'Pay the remaining salary' : 'Nothing left to pay this month'}
                                                >
                                                    <Banknote size={15} /> Pay Salary
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Payment history */}
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text)', fontSize: '1.15rem' }}>
                Payments for {monthLabel(month)} ({payments.length})
            </h3>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '640px' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)', color: 'var(--text-light)', fontSize: '0.85rem', textTransform: 'uppercase' }}>
                                <th style={{ padding: '0.85rem 1rem' }}>Date</th>
                                <th style={{ padding: '0.85rem 1rem' }}>Staff</th>
                                <th style={{ padding: '0.85rem 1rem' }}>Type</th>
                                <th style={{ padding: '0.85rem 1rem' }}>Amount</th>
                                <th style={{ padding: '0.85rem 1rem' }}>Notes</th>
                                <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {payments.length === 0 ? (
                                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>No advances, salary or bonus payments recorded for {monthLabel(month)}.</td></tr>
                            ) : payments.map(p => {
                                const t = TYPE_STYLES[p.type];
                                const TypeIcon = t.Icon;
                                return (
                                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.92rem' }}>
                                        <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>{p.date}</td>
                                        <td style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>{p.staffName}</td>
                                        <td style={{ padding: '0.85rem 1rem' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.55rem', borderRadius: '1rem', fontSize: '0.8rem', fontWeight: 600, backgroundColor: t.bg, color: t.fg }}>
                                                <TypeIcon size={13} /> {t.label}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>{lkr(p.amount)}</td>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-light)' }}>{p.notes || '-'}</td>
                                        <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                                            {p.bonusId ? (
                                                <Link to="/staff/bonus" style={{ fontSize: '0.8rem' }} title="Bonus payments are undone from the Staff Bonus page">
                                                    Manage in Staff Bonus
                                                </Link>
                                            ) : (
                                                <button
                                                    className="btn"
                                                    onClick={() => handleDelete(p)}
                                                    style={{ padding: '0.4rem', border: 'none', backgroundColor: '#fee2e2', color: '#b91c1c' }}
                                                    title="Delete payment and its expense"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <UserCog size={15} /> Staff names and salaries are managed on <Link to="/staff/manage">Manage Staff</Link>.
            </div>

            {/* Advance / salary modal */}
            {paying && (
                <div style={modalBackdrop}>
                    <form onSubmit={handleSavePayment} className="card animate-slide-up" style={{ width: '100%', maxWidth: '460px', padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {paying.type === 'advance' ? <HandCoins size={20} style={{ color: '#b45309' }} /> : <Banknote size={20} className="text-success" />}
                                {paying.type === 'advance' ? 'Give Advance' : 'Pay Salary'} — {paying.member.name}
                            </h3>
                            <button type="button" onClick={() => setPaying(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '1.5rem' }}>
                            <div style={{ padding: '0.85rem 1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid var(--border)', marginBottom: '1.25rem', fontSize: '0.9rem', color: 'var(--text-light)' }}>
                                Salary month: <b style={{ color: 'var(--text)' }}>{monthLabel(month)}</b><br />
                                Remaining balance: <b style={{ color: 'var(--text)' }}>{lkr(Math.max(0, paying.balance))}</b>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Amount (LKR) *</label>
                                <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    className="form-control"
                                    value={paying.amount}
                                    onChange={e => setPaying({ ...paying, amount: e.target.value })}
                                    autoFocus
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Payment Date *</label>
                                <input
                                    type="date"
                                    className="form-control"
                                    value={paying.date}
                                    onChange={e => setPaying({ ...paying, date: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Notes (Optional)</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder={paying.type === 'advance' ? 'e.g. Medical, festival advance...' : 'e.g. Cash, bank transfer...'}
                                    value={paying.notes}
                                    onChange={e => setPaying({ ...paying, notes: e.target.value })}
                                />
                            </div>

                            <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', margin: 0 }}>
                                {paying.type === 'advance'
                                    ? 'The advance is deducted from the month-end salary and recorded now as a Salary expense.'
                                    : 'This payment is recorded as a Salary expense in Financials.'}
                            </p>

                            {formError && (
                                <div style={{ marginTop: '1rem', padding: '0.65rem 0.75rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', fontSize: '0.85rem' }}>
                                    {formError}
                                </div>
                            )}
                        </div>

                        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', backgroundColor: '#f8fafc' }}>
                            <button type="button" className="btn" onClick={() => setPaying(null)} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn"
                                disabled={isSaving}
                                style={{ backgroundColor: paying.type === 'advance' ? '#d97706' : '#10b981', color: 'white', fontWeight: 600 }}
                            >
                                {isSaving ? <ButtonSpinner /> : <CheckCircle2 size={16} />}
                                {isSaving ? 'Saving...' : paying.type === 'advance' ? 'Record Advance' : 'Record Salary Payment'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
