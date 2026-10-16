import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Gift, AlertCircle, CheckCircle2, XCircle, RotateCcw, Save, TrendingUp, TrendingDown, CalendarClock, Users } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ProcessingOverlay, { ButtonSpinner } from '../components/ProcessingOverlay';
import { usePendingBonuses, notifyBonusUpdated } from '../utils/bonusReminders';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const today = () => new Date().toISOString().split('T')[0];
const monthLabel = (key) => `${MONTHS[parseInt(key.slice(5, 7), 10) - 1]} ${key.slice(0, 4)}`;
const shiftMonth = (key, delta) => {
    const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const prettyDate = (iso) => {
    if (!iso) return '-';
    const [y, m, d] = iso.split('-');
    return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
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

const lastClosedMonth = () => shiftMonth(today().slice(0, 7), -1);

export default function StaffBonus() {
    const { pending, upcoming } = usePendingBonuses();
    const [searchParams] = useSearchParams();
    const monthParam = /^\d{4}-\d{2}$/.test(searchParams.get('month') || '') ? searchParams.get('month') : null;

    const [month, setMonth] = useState(null);
    const [preview, setPreview] = useState(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [staff, setStaff] = useState([]);
    const [history, setHistory] = useState([]);

    const [defaultPercent, setDefaultPercent] = useState(10);
    const [percentInput, setPercentInput] = useState('10');
    const [savingDefault, setSavingDefault] = useState(false);

    // Decision form
    const [percentage, setPercentage] = useState('10');
    const [selectedIds, setSelectedIds] = useState([]);
    const [paidDate, setPaidDate] = useState(today());
    const [notes, setNotes] = useState('');
    const [finalAmount, setFinalAmount] = useState(''); // user's override of the total to give
    const [amountEdited, setAmountEdited] = useState(false);
    const [working, setWorking] = useState(null); // 'pay' | 'skip' | 'undo'
    const [error, setError] = useState('');

    const activeStaff = useMemo(() => staff.filter(s => s.active), [staff]);

    const loadBase = async () => {
        try {
            const [settingsRes, staffRes, historyRes] = await Promise.all([
                fetchWithAuth('/api/staff-bonus/settings'),
                fetchWithAuth('/api/staff'),
                fetchWithAuth('/api/staff-bonus')
            ]);
            const settings = await readJson(settingsRes);
            const staffJson = await readJson(staffRes);
            const historyJson = await readJson(historyRes);
            const pct = settings.data?.percentage ?? 10;
            setDefaultPercent(pct);
            setPercentInput(String(pct));
            setPercentage(String(pct));
            setStaff(staffJson.data || []);
            setSelectedIds((staffJson.data || []).filter(s => s.active).map(s => s.id));
            setHistory(historyJson.data || []);
        } catch (err) {
            setError(err.message);
        }
    };

    const loadPreview = async (forMonth) => {
        if (!forMonth) return;
        setLoadingPreview(true);
        setError('');
        try {
            const res = await fetchWithAuth(`/api/staff-bonus/preview?month=${forMonth}`);
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to calculate bonus');
            setPreview(json.data);
        } catch (err) {
            setError(err.message);
            setPreview(null);
        } finally {
            setLoadingPreview(false);
        }
    };

    useEffect(() => {
        loadBase();
    }, []);

    // A notification link (?month=) wins; otherwise open on the oldest month waiting for a decision,
    // else the next one coming up, else last month
    useEffect(() => {
        if (monthParam && monthParam <= lastClosedMonth()) setMonth(monthParam);
    }, [monthParam]);

    useEffect(() => {
        if (month) return;
        const initial = (monthParam && monthParam <= lastClosedMonth() && monthParam) || pending[0]?.month || upcoming[0]?.month || lastClosedMonth();
        setMonth(initial);
    }, [pending, upcoming, month, monthParam]);

    useEffect(() => {
        loadPreview(month);
        setNotes('');
        setFinalAmount('');
        setAmountEdited(false);
        setPercentage(String(defaultPercent));
        setSelectedIds(activeStaff.map(s => s.id));
        setPaidDate(today());
    }, [month]);

    const pct = Number(percentage);
    const netProfit = preview?.netProfit ?? 0;
    const calculatedPool = netProfit > 0 && pct > 0 ? round2(netProfit * pct / 100) : 0;
    // The calculated pool is a suggestion; once the user types a final amount, that is what gets split
    const pool = amountEdited ? (Number(finalAmount) > 0 ? round2(Number(finalAmount)) : 0) : calculatedPool;
    const perStaff = selectedIds.length > 0 ? round2(pool / selectedIds.length) : 0;
    const poolChanged = amountEdited && Math.abs(pool - calculatedPool) > 0.009;
    const decision = preview?.decision;
    const isDue = preview && preview.dueDate <= today();

    const toggleStaff = (id) => setSelectedIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

    const saveDefault = async () => {
        const value = Number(percentInput);
        if (!(value >= 0 && value <= 100)) return alert('Enter a percentage between 0 and 100.');
        setSavingDefault(true);
        try {
            const res = await fetchWithAuth('/api/staff-bonus/settings', { method: 'PUT', body: JSON.stringify({ percentage: value }) });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to save');
            setDefaultPercent(value);
            if (!decision) setPercentage(String(value));
        } catch (err) {
            alert(err.message);
        } finally {
            setSavingDefault(false);
        }
    };

    const afterDecision = async () => {
        await Promise.all([loadPreview(month), loadBase()]);
        notifyBonusUpdated();
    };

    const decide = async (action) => {
        if (working) return;
        setError('');
        if (action === 'pay') {
            if (!amountEdited && !(pct > 0 && pct <= 100)) return setError('Enter a bonus percentage between 0 and 100.');
            if (!(pool > 0)) return setError('Enter the bonus amount to give.');
            if (selectedIds.length === 0) return setError('Select at least one staff member.');
            if (!paidDate) return setError('Choose the payment date.');
            if (!window.confirm(`Give a ${monthLabel(month)} bonus of ${lkr(perStaff)} each to ${selectedIds.length} staff (total ${lkr(round2(perStaff * selectedIds.length))})? It will be added to expenses.`)) return;
        } else if (!window.confirm(`Record that no staff bonus will be given for ${monthLabel(month)}?`)) {
            return;
        }

        setWorking(action);
        try {
            const res = await fetchWithAuth('/api/staff-bonus', {
                method: 'POST',
                body: JSON.stringify({
                    month, action, percentage: pct || 0, staffIds: selectedIds, paidDate, notes,
                    amount: action === 'pay' && amountEdited ? pool : undefined
                })
            });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to record decision');
            await afterDecision();
        } catch (err) {
            setError(err.message);
        } finally {
            setWorking(null);
        }
    };

    const undo = async (bonus) => {
        const what = bonus.status === 'paid'
            ? `This removes the ${lkr(bonus.pool)} bonus payments and their expenses.`
            : 'The month will need a decision again.';
        if (!window.confirm(`Undo the ${bonus.monthLabel || monthLabel(bonus.month)} bonus decision? ${what}`)) return;
        setWorking('undo');
        try {
            const res = await fetchWithAuth(`/api/staff-bonus/${bonus.id}`, { method: 'DELETE' });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to undo');
            if (bonus.month !== month) setMonth(bonus.month);
            await afterDecision();
        } catch (err) {
            alert(err.message);
        } finally {
            setWorking(null);
        }
    };

    const stat = (label, value, sub, color, Icon) => (
        <div style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                {Icon && <Icon size={14} />} {label}
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color, marginTop: '0.25rem' }}>{value}</div>
            {sub && <div style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>{sub}</div>}
        </div>
    );

    return (
        <div className="animate-slide-up" style={{ paddingBottom: '3rem' }}>
            <ProcessingOverlay
                show={!!working}
                message={working === 'pay' ? 'Paying bonus & posting expenses...' : working === 'skip' ? 'Recording decision...' : 'Undoing decision...'}
            />

            <div className="page-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Gift className="text-primary" size={28} />
                        Staff Bonus
                    </h1>
                    <p style={{ color: 'var(--text-light)', marginTop: '0.25rem', fontSize: '0.95rem' }}>
                        A share of each month's net profit, split equally between staff. Decided on the day before the last day of the following month.
                    </p>
                </div>
                <div className="card" style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-light)' }}>Default bonus</span>
                    <input
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        className="form-control"
                        value={percentInput}
                        onChange={e => setPercentInput(e.target.value)}
                        style={{ width: '80px', textAlign: 'right' }}
                    />
                    <span style={{ fontWeight: 600 }}>% of net profit</span>
                    <button
                        className="btn"
                        onClick={saveDefault}
                        disabled={savingDefault || Number(percentInput) === defaultPercent}
                        style={{ padding: '0.4rem 0.7rem', border: '1px solid var(--border)', backgroundColor: 'white', fontSize: '0.85rem' }}
                    >
                        {savingDefault ? <ButtonSpinner /> : <Save size={14} />} Save
                    </button>
                </div>
            </div>

            {/* Reminders */}
            {pending.length > 0 && (
                <div style={{ padding: '1rem 1.25rem', marginBottom: '1.25rem', backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 'var(--radius)' }}>
                    <div style={{ fontWeight: 700, color: '#5b21b6', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <AlertCircle size={18} /> Decision needed
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {pending.map(p => (
                            <button
                                key={p.month}
                                className="btn"
                                onClick={() => setMonth(p.month)}
                                style={{ backgroundColor: p.month === month ? '#7c3aed' : 'white', color: p.month === month ? 'white' : '#5b21b6', border: '1px solid #c4b5fd', fontSize: '0.85rem' }}
                            >
                                {p.monthLabel} bonus · due {prettyDate(p.dueDate)}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {pending.length === 0 && upcoming.length > 0 && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1.25rem', backgroundColor: '#f8fafc', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.9rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CalendarClock size={16} />
                    Next decision: <b style={{ color: 'var(--text)' }}>{upcoming[0].monthLabel}</b> bonus on <b style={{ color: 'var(--text)' }}>{prettyDate(upcoming[0].dueDate)}</b>. You'll get a reminder on that day.
                </div>
            )}

            {/* Calculation */}
            <div className="card" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
                    <h3 style={{ margin: 0, color: 'var(--text)', fontSize: '1.15rem' }}>
                        {month ? `${monthLabel(month)} Bonus` : 'Bonus'}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-light)', fontWeight: 600 }}>Profit month</span>
                        <input
                            type="month"
                            className="form-control"
                            value={month || ''}
                            max={lastClosedMonth()}
                            onChange={e => e.target.value && e.target.value <= lastClosedMonth() && setMonth(e.target.value)}
                            style={{ width: 'auto', fontWeight: 600 }}
                        />
                    </div>
                </div>

                {loadingPreview || !preview ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
                        {error || 'Calculating net profit...'}
                    </div>
                ) : (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                            {stat('Revenue', lkr(preview.revenue), `${preview.bookingCount} settled booking(s)`, 'var(--text)', TrendingUp)}
                            {stat('Expenses', lkr(preview.expenses), `${preview.expenseCount} expense record(s)`, 'var(--text)', TrendingDown)}
                            {stat('Net Profit', lkr(preview.netProfit), 'Revenue − expenses, as in Financials', preview.netProfit > 0 ? 'var(--success)' : 'var(--danger)')}
                            {stat('Decision Date', prettyDate(preview.dueDate), decision ? 'Decided' : isDue ? 'Due now' : 'Not due yet', decision ? 'var(--text)' : isDue ? '#7c3aed' : 'var(--text)', CalendarClock)}
                        </div>

                        {decision ? (
                            /* Already decided */
                            <div style={{ padding: '1.25rem', borderRadius: '0.5rem', border: `1px solid ${decision.status === 'paid' ? '#bbf7d0' : 'var(--border)'}`, backgroundColor: decision.status === 'paid' ? '#f0fdf4' : '#f8fafc' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '1.05rem', color: decision.status === 'paid' ? '#166534' : 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            {decision.status === 'paid' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                                            {decision.status === 'paid'
                                                ? `Bonus paid on ${prettyDate(decision.paidDate)}: ${lkr(decision.perStaff)} each to ${decision.staffCount} staff`
                                                : 'No bonus given for this month'}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: '0.35rem' }}>
                                            {decision.status === 'paid' && (
                                                decision.calculatedPool !== null && decision.calculatedPool !== undefined && Math.abs(decision.calculatedPool - decision.pool) > 0.01 * (decision.staffCount || 1)
                                                    ? `Calculated ${lkr(decision.calculatedPool)} (${decision.percentage}% of ${lkr(decision.netProfit)}); final amount given ${lkr(decision.pool)}. `
                                                    : `${decision.percentage}% of ${lkr(decision.netProfit)} net profit = ${lkr(decision.pool)} total. `
                                            )}
                                            {decision.status === 'skipped' && `Net profit at the time: ${lkr(decision.netProfit)}. `}
                                            Decided {decision.decidedAt ? prettyDate(String(decision.decidedAt).slice(0, 10)) : ''}.
                                            {decision.notes && ` Notes: ${decision.notes}`}
                                        </div>
                                        {decision.status === 'paid' && Math.abs(decision.netProfit - preview.netProfit) > 0.01 && (
                                            <div style={{ fontSize: '0.8rem', color: '#b45309', marginTop: '0.35rem' }}>
                                                Net profit has changed to {lkr(preview.netProfit)} since this bonus was paid (records for {monthLabel(month)} were edited).
                                            </div>
                                        )}
                                    </div>
                                    <button className="btn" onClick={() => undo({ ...decision, monthLabel: monthLabel(month) })} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>
                                        <RotateCcw size={15} /> Undo Decision
                                    </button>
                                </div>
                                {preview.payments.length > 0 && (
                                    <div style={{ marginTop: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        {preview.payments.map(p => (
                                            <span key={p.id} style={{ padding: '0.35rem 0.7rem', borderRadius: '1rem', backgroundColor: 'white', border: '1px solid #bbf7d0', fontSize: '0.85rem' }}>
                                                {p.staffName}: <b>{lkr(p.amount)}</b>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* Decision form */
                            <div>
                                {!isDue && (
                                    <div style={{ padding: '0.65rem 0.85rem', marginBottom: '1rem', backgroundColor: '#f8fafc', border: '1px solid var(--border)', borderRadius: '0.5rem', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                                        The decision for {monthLabel(month)} is due on {prettyDate(preview.dueDate)}. You can decide early, but late expenses for {monthLabel(month)} may still change the net profit.
                                    </div>
                                )}

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
                                    <div>
                                        <div className="form-group">
                                            <label className="form-label">Bonus percentage of net profit</label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="any"
                                                    className="form-control"
                                                    value={percentage}
                                                    onChange={e => setPercentage(e.target.value)}
                                                    style={{ width: '110px', textAlign: 'right' }}
                                                />
                                                <span style={{ fontWeight: 600 }}>%</span>
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Payment date</label>
                                            <input type="date" className="form-control" value={paidDate} onChange={e => setPaidDate(e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Notes (optional)</label>
                                            <input type="text" className="form-control" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Paid in cash" />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <Users size={15} /> Staff sharing the bonus ({selectedIds.length} of {activeStaff.length})
                                        </label>
                                        {activeStaff.length === 0 ? (
                                            <div style={{ fontSize: '0.9rem', color: 'var(--text-light)' }}>
                                                No active staff. <Link to="/staff/manage">Add staff</Link> first.
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
                                                {activeStaff.map(s => (
                                                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', padding: '0.25rem 0' }}>
                                                        <input type="checkbox" checked={selectedIds.includes(s.id)} onChange={() => toggleStaff(s.id)} />
                                                        <span style={{ flex: 1 }}>{s.name}</span>
                                                        {selectedIds.includes(s.id) && pool > 0 && <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>{lkr(perStaff)}</span>}
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div style={{ padding: '1rem 1.25rem', margin: '1.25rem 0', backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '0.5rem' }}>
                                    <div style={{ color: netProfit > 0 ? '#5b21b6' : '#b91c1c', fontSize: '0.9rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        {netProfit > 0
                                            ? <>Calculated: {pct || 0}% of {lkr(netProfit)} net profit = <b>{lkr(calculatedPool)}</b></>
                                            : <><AlertCircle size={15} /> {monthLabel(month)} made no net profit, so nothing is calculated. Enter an amount below to give a bonus anyway, or record that no bonus is given.</>}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
                                        <div>
                                            <label className="form-label" style={{ color: '#5b21b6', fontWeight: 600 }}>Final bonus to give (LKR)</label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="any"
                                                    className="form-control"
                                                    value={amountEdited ? finalAmount : (calculatedPool || '')}
                                                    onChange={e => { setAmountEdited(true); setFinalAmount(e.target.value); }}
                                                    placeholder="0"
                                                    style={{ width: '170px', fontSize: '1.1rem', fontWeight: 700, textAlign: 'right', color: '#5b21b6' }}
                                                />
                                                {amountEdited && (
                                                    <button
                                                        type="button"
                                                        onClick={() => { setAmountEdited(false); setFinalAmount(''); }}
                                                        style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, padding: 0, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                                                    >
                                                        <RotateCcw size={13} /> Use calculated amount
                                                    </button>
                                                )}
                                            </div>
                                            {poolChanged && (
                                                <div style={{ fontSize: '0.8rem', color: '#6d28d9', marginTop: '0.35rem' }}>
                                                    {pool > calculatedPool ? 'More' : 'Less'} than calculated by {lkr(Math.abs(round2(pool - calculatedPool)))}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#5b21b6', textAlign: 'right' }}>
                                            {selectedIds.length === 0 ? 'Select staff' : pool > 0 ? `${lkr(perStaff)} per staff member` : '—'}
                                            {selectedIds.length > 0 && pool > 0 && (
                                                <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>split equally between {selectedIds.length}</div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {error && (
                                    <div style={{ marginBottom: '1rem', padding: '0.65rem 0.75rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', fontSize: '0.85rem' }}>
                                        {error}
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                    <button
                                        className="btn"
                                        onClick={() => decide('skip')}
                                        disabled={!!working}
                                        style={{ flex: 1, minWidth: '200px', padding: '0.75rem', border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--text)', fontWeight: 600 }}
                                    >
                                        {working === 'skip' ? <ButtonSpinner /> : <XCircle size={18} />}
                                        Don't Give Bonus
                                    </button>
                                    <button
                                        className="btn"
                                        onClick={() => decide('pay')}
                                        disabled={!!working || pool <= 0 || selectedIds.length === 0}
                                        style={{ flex: 1, minWidth: '200px', padding: '0.75rem', backgroundColor: pool > 0 && selectedIds.length > 0 ? '#7c3aed' : '#cbd5e1', color: 'white', fontWeight: 600 }}
                                    >
                                        {working === 'pay' ? <ButtonSpinner /> : <Gift size={18} />}
                                        {working === 'pay' ? 'Paying Bonus...' : `Give Bonus${pool > 0 ? ` (${lkr(pool)})` : ''}`}
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* History */}
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text)', fontSize: '1.15rem' }}>Bonus History</h3>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '760px' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)', color: 'var(--text-light)', fontSize: '0.85rem', textTransform: 'uppercase' }}>
                                <th style={{ padding: '0.85rem 1rem' }}>Profit Month</th>
                                <th style={{ padding: '0.85rem 1rem' }}>Net Profit</th>
                                <th style={{ padding: '0.85rem 1rem' }}>Decision</th>
                                <th style={{ padding: '0.85rem 1rem' }}>Bonus Pool</th>
                                <th style={{ padding: '0.85rem 1rem' }}>Per Staff</th>
                                <th style={{ padding: '0.85rem 1rem' }}>Paid On</th>
                                <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.length === 0 ? (
                                <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>No bonus decisions yet.</td></tr>
                            ) : history.map(b => (
                                <tr key={b.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.92rem', cursor: 'pointer', backgroundColor: b.month === month ? '#faf5ff' : 'transparent' }} onClick={() => setMonth(b.month)}>
                                    <td className="cell-title" style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>{b.monthLabel}</td>
                                    <td data-label="Net profit" style={{ padding: '0.85rem 1rem' }}>{lkr(b.netProfit)}</td>
                                    <td data-label="Decision" style={{ padding: '0.85rem 1rem' }}>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.55rem', borderRadius: '1rem', fontSize: '0.8rem', fontWeight: 600,
                                            backgroundColor: b.status === 'paid' ? '#dcfce7' : '#f1f5f9', color: b.status === 'paid' ? '#15803d' : 'var(--text-light)'
                                        }}>
                                            {b.status === 'paid' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                                            {b.status === 'paid' ? `Paid (${b.percentage}%)` : 'Not given'}
                                        </span>
                                    </td>
                                    <td data-label="Bonus pool" style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>
                                        {b.status === 'paid' ? lkr(b.pool) : '-'}
                                        {b.status === 'paid' && b.calculatedPool !== null && b.calculatedPool !== undefined && Math.abs(b.calculatedPool - b.pool) > 0.01 * (b.staffCount || 1) && (
                                            <div style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)' }}>calculated {lkr(b.calculatedPool)}</div>
                                        )}
                                    </td>
                                    <td data-label="Per staff" style={{ padding: '0.85rem 1rem' }}>{b.status === 'paid' ? `${lkr(b.perStaff)} × ${b.staffCount}` : '-'}</td>
                                    <td data-label="Paid on" style={{ padding: '0.85rem 1rem' }}>{b.status === 'paid' ? prettyDate(b.paidDate) : '-'}</td>
                                    <td className="cell-actions" style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                                        <button
                                            className="btn"
                                            onClick={(e) => { e.stopPropagation(); undo(b); }}
                                            style={{ padding: '0.35rem 0.6rem', border: '1px solid var(--border)', backgroundColor: 'white', fontSize: '0.8rem' }}
                                            title="Undo this decision"
                                        >
                                            <RotateCcw size={13} /> Undo
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
