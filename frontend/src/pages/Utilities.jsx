import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import {
    Zap, Droplets, Wifi, Hotel, UploadCloud, FileText, CheckCircle2, Clock,
    AlertCircle, Trash2, Eye, Plus, Search, Calendar, ArrowRight,
    RotateCcw, BarChart3, X, Pencil
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ProcessingOverlay, { ButtonSpinner } from '../components/ProcessingOverlay';
import { notifyDataChanged } from '../utils/notifications';

const UTILITY_TYPES = {
    electricity: { label: 'Electricity', icon: Zap, color: '#f59e0b', unit: 'kWh', hasMeter: true, providerHint: 'e.g. EDL, CEB, LECO' },
    water: { label: 'Water', icon: Droplets, color: '#06b6d4', unit: 'm³', hasMeter: true, providerHint: 'e.g. NWSDB' },
    telecom: { label: 'Telecom', icon: Wifi, color: '#8b5cf6', unit: '', hasMeter: false, providerHint: 'e.g. SLT-Mobitel, Dialog' },
    booking: { label: 'Booking.com', icon: Hotel, color: '#003580', unit: '', hasMeter: false, providerHint: 'Booking.com', expenseCategory: 'Commission' }
};

const today = () => new Date().toISOString().split('T')[0];

const emptyBill = (type) => ({
    type,
    provider: '',
    billNo: '',
    accountNo: '',
    tariff: '',
    premises: '',
    date: today(),
    month: '',
    periodFrom: '',
    periodTo: '',
    dueDate: '',
    previousReading: '',
    currentReading: '',
    unitsUsed: '',
    totalAmount: '',
    charges: []
});

// Short name for an account, e.g. "General · GAJANAYAKA WATTA"
const accountLabel = (bill) => [bill.tariff, (bill.premises || '').split(',')[0].trim()].filter(Boolean).join(' · ');

const lkr = (val) => `LKR ${Number(val || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Null readings from the API become empty strings so inputs stay controlled
const toFormBill = (bill) => {
    // previousDue / totalDue are derived by the server from unpaid bills, never edited
    const { previousDue, totalDue, ...rest } = bill;
    const form = { ...emptyBill(bill.type), ...rest };
    ['previousReading', 'currentReading', 'unitsUsed', 'periodFrom', 'periodTo', 'dueDate'].forEach(k => {
        if (form[k] === null || form[k] === undefined) form[k] = '';
    });
    return form;
};

// Error pages (404 from a stale backend, proxy errors) come back as HTML, not JSON
const readJson = async (res) => {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        const hint = res.status === 404 ? ' The backend may need a restart to pick up new routes.' : '';
        throw new Error(`Server returned an unexpected response (HTTP ${res.status}).${hint}`);
    }
};

const isOverdue = (bill) => bill.status !== 'Paid' && bill.dueDate && bill.dueDate < today();

const StatusBadge = ({ bill }) => {
    const styles = bill.status === 'Paid'
        ? { bg: '#dcfce7', fg: '#15803d', Icon: CheckCircle2, text: 'Paid' }
        : isOverdue(bill)
            ? { bg: '#fee2e2', fg: '#b91c1c', Icon: AlertCircle, text: 'Overdue' }
            : { bg: '#fef3c7', fg: '#b45309', Icon: Clock, text: 'Pending' };
    const { Icon } = styles;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
            padding: '0.25rem 0.6rem', borderRadius: '1rem',
            backgroundColor: styles.bg, color: styles.fg,
            fontSize: '0.8rem', fontWeight: 600
        }}>
            <Icon size={13} /> {styles.text}
        </span>
    );
};

export default function Utilities() {
    const { type } = useParams();
    if (!UTILITY_TYPES[type]) return <Navigate to="/utilities/laundry" replace />;
    // Keyed by type so each sub-menu page starts with fresh tabs, filters and form state
    return <UtilityBillsPage key={type} utilityType={type} />;
}

function UtilityBillsPage({ utilityType }) {
    const [bills, setBills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'ledger' | 'upload'

    // Ledger filters
    const [accountFilter, setAccountFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [searchQuery, setSearchQuery] = useState('');

    // Upload / review form
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [formBill, setFormBill] = useState(null);
    const [formFile, setFormFile] = useState(null);
    const [editingId, setEditingId] = useState(null); // set when the form edits an existing bill
    const [isSaving, setIsSaving] = useState(false);
    const [savingAs, setSavingAs] = useState(null); // 'pending' | 'paid' | 'edit' — which save button is in progress

    // Modals
    const [viewingBill, setViewingBill] = useState(null);
    const [payingBill, setPayingBill] = useState(null);
    const [paymentData, setPaymentData] = useState({ paidDate: today(), paymentNotes: '' });
    const [isPaying, setIsPaying] = useState(false);

    const config = UTILITY_TYPES[utilityType];
    const TypeIcon = config.icon;

    const fetchBills = async () => {
        try {
            setLoading(true);
            const res = await fetchWithAuth(`/api/utilities/bills?type=${utilityType}`);
            if (!res.ok) throw new Error('Failed to load utility bills');
            const data = await readJson(res);
            setBills(data.data || []);
            // Bills changed (uploaded, paid, deleted...) — let notifications re-check
            notifyDataChanged();
        } catch (err) {
            console.error('Error fetching utility bills:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBills();
    }, []);

    const resetForm = () => {
        setFormBill(null);
        setFormFile(null);
        setEditingId(null);
        setUploadError('');
    };

    // Handle File Upload & Parse
    const handleFileUpload = async (file) => {
        if (!file) return;
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            setUploadError('Please select a valid PDF bill.');
            return;
        }

        setIsUploading(true);
        setUploadError('');
        const formData = new FormData();
        formData.append('type', utilityType);
        formData.append('file', file);

        try {
            const res = await fetchWithAuth('/api/utilities/upload-preview', {
                method: 'POST',
                body: formData
            });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to parse bill PDF');

            setFormBill(toFormBill(json.data));
            setFormFile(json.file);
            setEditingId(null);
        } catch (err) {
            console.error('Upload error:', err);
            setUploadError(err.message || 'An error occurred while uploading.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleFileDrop = (e) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    };

    const startManualEntry = () => {
        setFormBill(emptyBill(utilityType));
        setFormFile(null);
        setEditingId(null);
        setUploadError('');
        setActiveTab('upload');
    };

    const startEdit = (bill) => {
        setFormBill(toFormBill(bill));
        setFormFile(null);
        setEditingId(bill.id);
        setViewingBill(null);
        setActiveTab('upload');
    };

    const updateForm = (field, value) => {
        const next = { ...formBill, [field]: value };
        // Keep units in step with the meter readings when both are filled in
        if ((field === 'previousReading' || field === 'currentReading') && next.previousReading !== '' && next.currentReading !== '') {
            const diff = Number(next.currentReading) - Number(next.previousReading);
            if (!isNaN(diff) && diff >= 0) next.unitsUsed = String(Math.round(diff * 100) / 100);
        }
        setFormBill(next);
    };

    const updateCharge = (index, field, value) => {
        const charges = formBill.charges.map((c, i) => i === index ? { ...c, [field]: value } : c);
        setFormBill({ ...formBill, charges });
    };

    const chargesTotal = (formBill?.charges || []).reduce((s, c) => s + Number(c.amount || 0), 0);

    // Save Bill (create as Pending/Paid, or update an existing one)
    const handleSaveBill = async (asPaid = false) => {
        if (isSaving) return;
        if (!formBill.billNo || !formBill.date || formBill.totalAmount === '') {
            alert('Please fill in the bill number, bill date and total amount before saving.');
            return;
        }

        // Duplicate checks (same file, bill number, or account + month) are enforced by the server

        setIsSaving(true);
        setSavingAs(editingId ? 'edit' : asPaid ? 'paid' : 'pending');
        try {
            const payload = {
                ...formBill,
                charges: (formBill.charges || []).filter(c => c.description || c.amount)
            };
            let res;
            if (editingId) {
                res = await fetchWithAuth(`/api/utilities/bills/${editingId}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetchWithAuth('/api/utilities/bills', {
                    method: 'POST',
                    body: JSON.stringify({
                        ...payload,
                        status: asPaid ? 'Paid' : 'Pending',
                        paidDate: asPaid ? today() : null,
                        originalFileName: formFile ? formFile.originalName : '',
                        fileHash: formFile ? formFile.hash : null
                    })
                });
            }

            if (!res.ok) {
                const errData = await readJson(res);
                throw new Error(errData.error || 'Failed to save utility bill');
            }

            await fetchBills();
            resetForm();
            setActiveTab('ledger');
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            setIsSaving(false);
            setSavingAs(null);
        }
    };

    const handleConfirmPayment = async () => {
        if (!payingBill || isPaying) return;
        setIsPaying(true);
        try {
            const res = await fetchWithAuth(`/api/utilities/bills/${payingBill.id}/pay`, {
                method: 'POST',
                body: JSON.stringify(paymentData)
            });
            if (!res.ok) {
                const errData = await readJson(res);
                throw new Error(errData.error || 'Failed to mark bill as paid');
            }
            await fetchBills();
            setPayingBill(null);
        } catch (err) {
            alert('Payment failed: ' + err.message);
        } finally {
            setIsPaying(false);
        }
    };

    const openPayModal = (bill) => {
        setViewingBill(null);
        setPayingBill(bill);
        setPaymentData({ paidDate: today(), paymentNotes: '' });
    };

    const handleRevertToPending = async (billId) => {
        if (!window.confirm("Revert this bill back to Pending? This will also remove the corresponding expense record from Financials.")) return;
        try {
            const res = await fetchWithAuth(`/api/utilities/bills/${billId}/unpay`, { method: 'POST' });
            if (!res.ok) throw new Error('Failed to revert bill');
            await fetchBills();
        } catch (err) {
            alert('Revert failed: ' + err.message);
        }
    };

    const handleDeleteBill = async (billId) => {
        if (!window.confirm("Are you sure you want to delete this bill? Any associated expense record will also be removed.")) return;
        try {
            const res = await fetchWithAuth(`/api/utilities/bills/${billId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete bill');
            await fetchBills();
            if (viewingBill && viewingBill.id === billId) setViewingBill(null);
        } catch (err) {
            alert('Delete failed: ' + err.message);
        }
    };

    // One entry per account number, summarised from its most recent bill
    const accounts = useMemo(() => {
        const map = {};
        bills.forEach(b => {
            if (!b.accountNo) return;
            if (!map[b.accountNo]) map[b.accountNo] = { accountNo: b.accountNo, latest: b, billCount: 0, pendingCount: 0, pendingAmount: 0 };
            const acc = map[b.accountNo];
            acc.billCount++;
            if (b.status !== 'Paid') {
                acc.pendingCount++;
                acc.pendingAmount += Number(b.totalAmount || 0);
            }
            if ((b.periodTo || b.date) > (acc.latest.periodTo || acc.latest.date)) acc.latest = b;
        });
        return Object.values(map).sort((a, b) => a.accountNo.localeCompare(b.accountNo));
    }, [bills]);

    const scopedBills = useMemo(
        () => accountFilter === 'ALL' ? bills : bills.filter(b => b.accountNo === accountFilter),
        [bills, accountFilter]
    );

    // Dashboard metrics for the selected utility type and account
    const metrics = useMemo(() => {
        let totalSpend = 0, pendingAmount = 0, paidAmount = 0;
        let pendingCount = 0, paidCount = 0, overdueCount = 0;
        let totalUnits = 0, billsWithUnits = 0;
        const monthlyStats = {};

        scopedBills.forEach(bill => {
            const amt = Number(bill.totalAmount || 0);
            totalSpend += amt;
            if (bill.status === 'Paid') {
                paidAmount += amt;
                paidCount++;
            } else {
                pendingAmount += amt;
                pendingCount++;
                if (isOverdue(bill)) overdueCount++;
            }
            if (bill.unitsUsed !== null && bill.unitsUsed !== undefined) {
                totalUnits += Number(bill.unitsUsed);
                billsWithUnits++;
            }

            const m = bill.month || (bill.date ? bill.date.slice(0, 7) : 'Unknown');
            if (!monthlyStats[m]) monthlyStats[m] = { month: m, amount: 0, units: 0, paid: 0, pending: 0 };
            monthlyStats[m].amount += amt;
            monthlyStats[m].units += Number(bill.unitsUsed || 0);
            if (bill.status === 'Paid') monthlyStats[m].paid += amt;
            else monthlyStats[m].pending += amt;
        });

        const monthCount = Object.keys(monthlyStats).length;
        return {
            totalSpend, pendingAmount, paidAmount,
            pendingCount, paidCount, overdueCount,
            totalUnits, billsWithUnits,
            avgMonthly: monthCount > 0 ? totalSpend / monthCount : 0,
            avgCostPerUnit: totalUnits > 0 ? totalSpend / totalUnits : 0,
            monthlyStats: Object.values(monthlyStats),
            maxMonthly: Math.max(0, ...Object.values(monthlyStats).map(s => s.amount))
        };
    }, [scopedBills]);

    const filteredBills = useMemo(() => {
        return scopedBills.filter(b => {
            if (statusFilter === 'Overdue' && !isOverdue(b)) return false;
            if (statusFilter !== 'ALL' && statusFilter !== 'Overdue' && b.status !== statusFilter) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const haystack = [b.billNo, b.provider, b.accountNo, b.month, b.tariff, b.premises].map(v => (v || '').toLowerCase());
                if (!haystack.some(v => v.includes(q))) return false;
            }
            return true;
        });
    }, [scopedBills, statusFilter, searchQuery]);

    const formatUnits = (val) => (val === null || val === undefined || val === '') ? '-' : `${Number(val).toLocaleString()}${config.unit ? ` ${config.unit}` : ''}`;

    const modalBackdrop = {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem'
    };
    const infoTile = { padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid var(--border)' };
    const infoLabel = { fontSize: '0.75rem', color: 'var(--text-light)', textTransform: 'uppercase' };

    return (
        <div className="animate-slide-up" style={{ paddingBottom: '3rem' }}>
            <ProcessingOverlay
                show={isUploading || isSaving || isPaying}
                message={
                    isUploading ? `Reading ${config.label.toLowerCase()} bill...`
                        : isPaying ? 'Recording payment...'
                        : savingAs === 'edit' ? 'Saving changes...'
                        : savingAs === 'paid' ? 'Saving bill & posting expense...'
                        : 'Saving bill...'
                }
                detail={isUploading ? 'Extracting details and checking for duplicates.' : 'Please wait, this can take a few seconds.'}
            />

            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <TypeIcon size={28} style={{ color: config.color }} />
                        {config.label} Bills
                    </h1>
                    <p style={{ color: 'var(--text-light)', marginTop: '0.25rem', fontSize: '0.95rem' }}>
                        Track {config.label.toLowerCase()} bills{config.hasMeter ? ', consumption' : ''} and payments.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="btn" onClick={startManualEntry} style={{ border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--text)' }}>
                        <Plus size={18} />
                        Add Manually
                    </button>
                    <button className="btn btn-primary" onClick={() => { resetForm(); setActiveTab('upload'); }}>
                        <UploadCloud size={18} />
                        Upload {config.label} Bill
                    </button>
                </div>
            </div>

            {/* Account switcher (only when there is more than one account) */}
            {accounts.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-light)' }}>Account:</span>
                    {[{ accountNo: 'ALL' }, ...accounts].map(acc => {
                        const active = accountFilter === acc.accountNo;
                        return (
                            <button
                                key={acc.accountNo}
                                onClick={() => setAccountFilter(acc.accountNo)}
                                style={{
                                    padding: '0.4rem 0.85rem', borderRadius: '1rem', cursor: 'pointer',
                                    fontSize: '0.85rem', fontWeight: 600,
                                    border: `1px solid ${active ? config.color : 'var(--border)'}`,
                                    backgroundColor: active ? `${config.color}1a` : 'white',
                                    color: active ? 'var(--text)' : 'var(--text-light)'
                                }}
                            >
                                {acc.accountNo === 'ALL' ? 'All accounts' : `${acc.accountNo}${accountLabel(acc.latest) ? ` · ${accountLabel(acc.latest)}` : ''}`}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Section Tabs */}
            <div className="tab-bar" style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid var(--border)', marginBottom: '2rem' }}>
                {[
                    { id: 'dashboard', label: 'Overview', icon: BarChart3 },
                    { id: 'ledger', label: `Bills Ledger (${bills.length})`, icon: FileText },
                    { id: 'upload', label: editingId ? 'Edit Bill' : 'Upload & Review', icon: editingId ? Pencil : UploadCloud }
                ].map(t => {
                    const Icon = t.icon;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            style={{
                                padding: '0.75rem 1.5rem',
                                fontWeight: 600,
                                fontSize: '1rem',
                                backgroundColor: 'transparent',
                                border: 'none',
                                borderBottom: activeTab === t.id ? '3px solid var(--primary)' : '3px solid transparent',
                                color: activeTab === t.id ? 'var(--primary)' : 'var(--text-light)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                marginBottom: '-2px',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            <Icon size={18} />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {/* TAB 1: OVERVIEW */}
            {activeTab === 'dashboard' && (
                <div>
                    {/* Per-account summary from each account's latest bill */}
                    {accounts.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
                            {accounts.filter(acc => accountFilter === 'ALL' || acc.accountNo === accountFilter).map(acc => {
                                const b = acc.latest;
                                // Outstanding = every bill on this account still Pending in the app
                                const arrears = acc.pendingAmount - (b.status !== 'Paid' ? Number(b.totalAmount || 0) : 0);
                                return (
                                    <div key={acc.accountNo} className="card" style={{ padding: '1.25rem', borderTop: `4px solid ${config.color}` }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                                            <div>
                                                <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1.05rem' }}>A/C {acc.accountNo}</div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                                                    {[b.tariff, b.premises].filter(Boolean).join(' • ') || b.provider || '—'}
                                                </div>
                                            </div>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-light)', whiteSpace: 'nowrap' }}>{b.month || b.date}</span>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: config.hasMeter ? '1fr 1fr 1fr' : '1fr 1fr', gap: '0.75rem', marginTop: '1rem' }}>
                                            {config.hasMeter && (
                                                <div>
                                                    <div style={infoLabel}>Usage</div>
                                                    <div style={{ fontWeight: 700, color: 'var(--text)' }}>{formatUnits(b.unitsUsed)}</div>
                                                </div>
                                            )}
                                            <div>
                                                <div style={infoLabel}>This Month</div>
                                                <div style={{ fontWeight: 700, color: 'var(--text)' }}>{lkr(b.totalAmount)}</div>
                                            </div>
                                            <div>
                                                <div style={infoLabel}>Outstanding</div>
                                                <div style={{ fontWeight: 700, color: arrears > 0.01 ? '#b91c1c' : acc.pendingAmount > 0 ? '#b45309' : 'var(--success)' }}>
                                                    {lkr(acc.pendingAmount)}
                                                </div>
                                            </div>
                                        </div>
                                        {arrears > 0.01 && (
                                            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.4rem', fontSize: '0.8rem', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                <AlertCircle size={14} />
                                                Includes {lkr(arrears)} from earlier unpaid bills ({acc.pendingCount - (b.status !== 'Paid' ? 1 : 0)} bill(s)).
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
                        <div className="card" style={{ padding: '1.25rem', borderLeft: `4px solid ${config.color}` }}>
                            <div style={{ color: 'var(--text-light)', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase' }}>
                                Total {config.label} Billed
                            </div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text)', margin: '0.35rem 0' }}>
                                LKR {metrics.totalSpend.toLocaleString()}
                            </div>
                            <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                                Avg LKR {Math.round(metrics.avgMonthly).toLocaleString()} / month
                            </div>
                        </div>

                        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--warning)' }}>
                            <div style={{ color: 'var(--warning)', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <Clock size={16} /> Pending Payment
                            </div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#b45309', margin: '0.35rem 0' }}>
                                LKR {metrics.pendingAmount.toLocaleString()}
                            </div>
                            <div style={{ color: metrics.overdueCount > 0 ? '#b91c1c' : 'var(--text-light)', fontSize: '0.85rem' }}>
                                {metrics.pendingCount} unpaid{metrics.overdueCount > 0 ? ` • ${metrics.overdueCount} overdue` : ''}
                            </div>
                        </div>

                        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--success)' }}>
                            <div style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <CheckCircle2 size={16} /> Paid & Accounted
                            </div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--success)', margin: '0.35rem 0' }}>
                                LKR {metrics.paidAmount.toLocaleString()}
                            </div>
                            <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                                {metrics.paidCount} settled {metrics.paidCount === 1 ? 'bill' : 'bills'}
                            </div>
                        </div>

                        {config.hasMeter && (
                            <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #8b5cf6' }}>
                                <div style={{ color: '#8b5cf6', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase' }}>
                                    Total Consumption
                                </div>
                                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#6d28d9', margin: '0.35rem 0' }}>
                                    {metrics.totalUnits.toLocaleString()} <span style={{ fontSize: '1rem', fontWeight: 500 }}>{config.unit}</span>
                                </div>
                                <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                                    {metrics.totalUnits > 0 ? `Avg LKR ${metrics.avgCostPerUnit.toFixed(2)} / ${config.unit}` : 'No readings recorded yet'}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="card" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
                        <h3 style={{ margin: '0 0 1.25rem 0', color: 'var(--text)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Calendar size={18} className="text-primary" />
                            Monthly {config.label} Spending{config.hasMeter ? ' & Consumption' : ''}
                        </h3>

                        {metrics.monthlyStats.length === 0 ? (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                No {config.label.toLowerCase()} bills recorded yet. Upload a bill or add one manually to get started.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                                {metrics.monthlyStats.map(stat => (
                                    <div key={stat.month}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', fontSize: '0.9rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                            <strong style={{ color: 'var(--text)' }}>{stat.month}</strong>
                                            <span style={{ color: 'var(--text-light)' }}>
                                                {config.hasMeter && stat.units > 0 && <span style={{ marginRight: '0.75rem' }}>{stat.units.toLocaleString()} {config.unit}</span>}
                                                <b style={{ color: 'var(--text)' }}>LKR {stat.amount.toLocaleString()}</b>
                                                {stat.pending > 0 && (
                                                    <span style={{ color: 'var(--warning)', marginLeft: '0.5rem' }}>
                                                        (Pending: LKR {stat.pending.toLocaleString()})
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                        <div style={{ width: '100%', height: '9px', backgroundColor: '#e2e8f0', borderRadius: '5px', overflow: 'hidden' }}>
                                            <div style={{
                                                width: `${metrics.maxMonthly > 0 ? (stat.amount / metrics.maxMonthly) * 100 : 0}%`,
                                                height: '100%',
                                                backgroundColor: config.color,
                                                borderRadius: '5px',
                                                transition: 'width 0.4s ease'
                                            }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {metrics.pendingCount > 0 && (
                        <div style={{ padding: '1.25rem', backgroundColor: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 'var(--radius)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <AlertCircle size={24} style={{ color: '#d97706' }} />
                                <div>
                                    <h4 style={{ margin: 0, color: '#92400e' }}>
                                        You have {metrics.pendingCount} pending {config.label.toLowerCase()} bill(s) totaling LKR {metrics.pendingAmount.toLocaleString()}
                                    </h4>
                                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#b45309' }}>
                                        Mark bills as paid once settled to automatically reflect them in Financials under "{config.expenseCategory || 'Utilities'}".
                                    </p>
                                </div>
                            </div>
                            <button className="btn" style={{ backgroundColor: '#d97706', color: 'white' }} onClick={() => { setStatusFilter(metrics.overdueCount > 0 ? 'Overdue' : 'Pending'); setActiveTab('ledger'); }}>
                                Review Pending Bills <ArrowRight size={16} />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 2: BILLS LEDGER */}
            {activeTab === 'ledger' && (
                <div>
                    <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', backgroundColor: '#f8fafc' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '220px' }}>
                            <Search size={18} style={{ color: 'var(--text-light)' }} />
                            <input
                                type="text"
                                className="form-control"
                                placeholder="Search bill #, account #, provider, month..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-light)' }}>Status:</span>
                            <div style={{ display: 'flex', borderRadius: '0.5rem', overflow: 'hidden', border: '1px solid var(--border)' }}>
                                {['ALL', 'Pending', 'Overdue', 'Paid'].map(s => (
                                    <button
                                        key={s}
                                        onClick={() => setStatusFilter(s)}
                                        style={{
                                            padding: '0.4rem 0.85rem',
                                            fontSize: '0.85rem',
                                            fontWeight: 600,
                                            border: 'none',
                                            cursor: 'pointer',
                                            backgroundColor: statusFilter === s ? 'var(--primary)' : 'white',
                                            color: statusFilter === s ? 'white' : 'var(--text-light)'
                                        }}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            className="btn"
                            onClick={() => { setSearchQuery(''); setStatusFilter('ALL'); }}
                            style={{ backgroundColor: 'transparent', border: '1px solid var(--border)', color: 'var(--text-light)', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
                        >
                            Reset
                        </button>
                    </div>

                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '750px' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)', color: 'var(--text-light)', fontSize: '0.85rem', textTransform: 'uppercase' }}>
                                        <th style={{ padding: '1rem' }}>Account / Bill</th>
                                        <th style={{ padding: '1rem' }}>Bill Date</th>
                                        <th style={{ padding: '1rem' }}>Month</th>
                                        {config.hasMeter && <th style={{ padding: '1rem' }}>Usage</th>}
                                        <th style={{ padding: '1rem' }}>Due Date</th>
                                        <th style={{ padding: '1rem' }}>Amount (LKR)</th>
                                        <th style={{ padding: '1rem' }}>Status</th>
                                        <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr>
                                            <td colSpan={8} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                                Loading utility bills...
                                            </td>
                                        </tr>
                                    ) : filteredBills.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                                No {config.label.toLowerCase()} bills found matching your criteria.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredBills.map(bill => {
                                            const isPaid = bill.status === 'Paid';
                                            return (
                                                <tr key={bill.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.95rem' }}>
                                                    <td className="cell-title" style={{ padding: '1rem', fontWeight: 600, color: 'var(--text)' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                            <TypeIcon size={16} style={{ color: config.color }} />
                                                            {bill.accountNo ? `A/C ${bill.accountNo}` : bill.billNo}
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.15rem' }}>
                                                            {[accountLabel(bill) || bill.provider, bill.accountNo && `Ref ${bill.billNo}`].filter(Boolean).join(' • ')}
                                                        </div>
                                                    </td>
                                                    <td data-label="Bill date" style={{ padding: '1rem', whiteSpace: 'nowrap' }}>{bill.date}</td>
                                                    <td data-label="Month" style={{ padding: '1rem', fontWeight: 500 }}>{bill.month || '-'}</td>
                                                    {config.hasMeter && (
                                                        <td data-label="Usage" style={{ padding: '1rem', fontWeight: 600 }}>{formatUnits(bill.unitsUsed)}</td>
                                                    )}
                                                    <td data-label="Due date" style={{ padding: '1rem', whiteSpace: 'nowrap', color: isOverdue(bill) ? '#b91c1c' : 'inherit' }}>
                                                        {bill.dueDate || '-'}
                                                    </td>
                                                    <td data-label="Amount" style={{ padding: '1rem', fontWeight: 700, color: 'var(--text)' }}>
                                                        {(bill.totalAmount || 0).toLocaleString()}
                                                        {!isPaid && Number(bill.previousDue) > 0 && (
                                                            <div style={{ fontSize: '0.75rem', fontWeight: 500, color: '#b91c1c', marginTop: '0.15rem' }} title={`Previous due ${lkr(bill.previousDue)}`}>
                                                                Total due {Number(bill.totalDue).toLocaleString()}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td data-label="Status" style={{ padding: '1rem' }}>
                                                        <StatusBadge bill={bill} />
                                                        {isPaid && bill.paidDate && (
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.2rem' }}>
                                                                Paid on {bill.paidDate}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="cell-actions" style={{ padding: '1rem', textAlign: 'right' }}>
                                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                            <button
                                                                className="btn"
                                                                onClick={() => setViewingBill(bill)}
                                                                style={{ padding: '0.4rem', border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--text)' }}
                                                                title="View Details"
                                                            >
                                                                <Eye size={16} />
                                                            </button>
                                                            <button
                                                                className="btn"
                                                                onClick={() => startEdit(bill)}
                                                                style={{ padding: '0.4rem', border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--text)' }}
                                                                title="Edit Bill"
                                                            >
                                                                <Pencil size={16} />
                                                            </button>
                                                            {!isPaid ? (
                                                                <button
                                                                    className="btn"
                                                                    onClick={() => openPayModal(bill)}
                                                                    style={{ padding: '0.4rem 0.75rem', backgroundColor: '#10b981', color: 'white', fontSize: '0.85rem' }}
                                                                    title="Mark as Paid"
                                                                >
                                                                    <CheckCircle2 size={15} /> Pay
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    className="btn"
                                                                    onClick={() => handleRevertToPending(bill.id)}
                                                                    style={{ padding: '0.4rem 0.6rem', border: '1px solid var(--border)', backgroundColor: '#f1f5f9', color: 'var(--text-light)', fontSize: '0.8rem' }}
                                                                    title="Revert to Pending"
                                                                >
                                                                    <RotateCcw size={14} />
                                                                </button>
                                                            )}
                                                            <button
                                                                className="btn"
                                                                onClick={() => handleDeleteBill(bill.id)}
                                                                style={{ padding: '0.4rem', border: 'none', backgroundColor: '#fee2e2', color: '#b91c1c' }}
                                                                title="Delete Bill"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 3: UPLOAD & REVIEW / EDIT */}
            {activeTab === 'upload' && (
                <div>
                    {!formBill ? (
                        <div className="card" style={{ padding: '3rem 2rem', textAlign: 'center', border: '2px dashed #cbd5e1' }}
                            onDragOver={e => e.preventDefault()}
                            onDrop={handleFileDrop}
                        >
                            <div style={{ width: '64px', height: '64px', margin: '0 auto 1.5rem', backgroundColor: `${config.color}22`, color: config.color, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <TypeIcon size={32} />
                            </div>
                            <h2 style={{ fontSize: '1.35rem', marginBottom: '0.5rem', color: 'var(--text)' }}>
                                Upload {config.label} Bill PDF
                            </h2>
                            <p style={{ color: 'var(--text-light)', maxWidth: '520px', margin: '0 auto 1.5rem', fontSize: '0.95rem' }}>
                                Drop the PDF bill here (or click browse). Bill number, dates{config.hasMeter ? ', meter readings' : ''} and the total are extracted automatically for your review.
                            </p>

                            <input
                                type="file"
                                id="utility-pdf-input"
                                accept="application/pdf,.pdf"
                                style={{ display: 'none' }}
                                onChange={e => {
                                    if (e.target.files && e.target.files[0]) {
                                        handleFileUpload(e.target.files[0]);
                                        e.target.value = '';
                                    }
                                }}
                            />

                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                                <label
                                    htmlFor="utility-pdf-input"
                                    className="btn btn-primary"
                                    style={{ padding: '0.75rem 1.75rem', cursor: 'pointer', fontSize: '1rem' }}
                                >
                                    {isUploading ? <><ButtonSpinner /> Reading Bill PDF...</> : 'Browse PDF File'}
                                </label>
                                <button
                                    className="btn"
                                    onClick={startManualEntry}
                                    style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--text)' }}
                                >
                                    Enter Manually
                                </button>
                            </div>

                            {uploadError && (
                                <div style={{ marginTop: '1.5rem', padding: '0.75rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                                    <AlertCircle size={18} /> {uploadError}
                                </div>
                            )}

                            <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)', color: 'var(--text-light)', fontSize: '0.85rem' }}>
                                💡 Tip: Paper bill or SMS only? Use <b>Enter Manually</b> — every field can be typed in directly.
                            </div>
                        </div>
                    ) : (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                                <div>
                                    <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text)' }}>
                                        {editingId ? `Edit ${config.label} Bill` : formFile ? 'Review Extracted Bill Details' : `New ${config.label} Bill`}
                                    </h2>
                                    <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                                        {formFile
                                            ? `Parsed from ${formFile.originalName}. Check every field against the PDF before saving.`
                                            : 'Fill in the bill details below.'}
                                    </p>
                                </div>
                                <button
                                    className="btn"
                                    onClick={() => { const wasEditing = editingId; resetForm(); if (wasEditing) setActiveTab('ledger'); }}
                                    style={{ border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--text)' }}
                                >
                                    {editingId ? 'Cancel Edit' : 'Start Over'}
                                </button>
                            </div>

                            <div style={{ maxWidth: '850px', margin: '0 auto' }}>
                                <div className="card" style={{ padding: '1.75rem' }}>
                                    <h3 style={{ margin: '0 0 1.25rem 0', color: 'var(--text)', fontSize: '1.1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                                        Bill Information
                                    </h3>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                                        <div className="form-group">
                                            <label className="form-label">Bill Number *</label>
                                            <input type="text" className="form-control" value={formBill.billNo} onChange={e => updateForm('billNo', e.target.value)} required />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Account Number</label>
                                            <input type="text" className="form-control" value={formBill.accountNo || ''} onChange={e => updateForm('accountNo', e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Provider</label>
                                            <input type="text" className="form-control" placeholder={config.providerHint} value={formBill.provider || ''} onChange={e => updateForm('provider', e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Tariff</label>
                                            <input type="text" className="form-control" placeholder="e.g. Domestic, General" value={formBill.tariff || ''} onChange={e => updateForm('tariff', e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Premises</label>
                                            <input type="text" className="form-control" placeholder="Supply address" value={formBill.premises || ''} onChange={e => updateForm('premises', e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Billing Month</label>
                                            <input type="text" className="form-control" placeholder="e.g. Oct 2026" value={formBill.month || ''} onChange={e => updateForm('month', e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Bill Date *</label>
                                            <input type="date" className="form-control" value={formBill.date} onChange={e => updateForm('date', e.target.value)} required />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Due Date</label>
                                            <input type="date" className="form-control" value={formBill.dueDate} onChange={e => updateForm('dueDate', e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Period From</label>
                                            <input type="date" className="form-control" value={formBill.periodFrom} onChange={e => updateForm('periodFrom', e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Period To</label>
                                            <input type="date" className="form-control" value={formBill.periodTo} onChange={e => updateForm('periodTo', e.target.value)} />
                                        </div>
                                    </div>

                                    {config.hasMeter && (
                                        <>
                                            <h3 style={{ margin: '0.5rem 0 1.25rem 0', color: 'var(--text)', fontSize: '1.1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                                                Meter Readings
                                            </h3>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                                                <div className="form-group">
                                                    <label className="form-label">Previous Reading</label>
                                                    <input type="number" step="any" className="form-control" value={formBill.previousReading} onChange={e => updateForm('previousReading', e.target.value)} />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">Current Reading</label>
                                                    <input type="number" step="any" className="form-control" value={formBill.currentReading} onChange={e => updateForm('currentReading', e.target.value)} />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">Units Used ({config.unit})</label>
                                                    <input type="number" step="any" className="form-control" value={formBill.unitsUsed} onChange={e => updateForm('unitsUsed', e.target.value)} />
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {/* Optional charge breakdown */}
                                    <div style={{ marginBottom: '1.5rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                            <label className="form-label" style={{ margin: 0, fontWeight: 600 }}>
                                                Charge Breakdown <span style={{ fontWeight: 400, color: 'var(--text-light)' }}>(optional)</span>
                                            </label>
                                            <button
                                                type="button"
                                                className="btn"
                                                onClick={() => setFormBill({ ...formBill, charges: [...(formBill.charges || []), { description: '', amount: '' }] })}
                                                style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem', border: '1px solid var(--border)', backgroundColor: '#f1f5f9' }}
                                            >
                                                <Plus size={14} /> Add Charge
                                            </button>
                                        </div>
                                        {(formBill.charges || []).length > 0 && (
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                                <tbody>
                                                    {formBill.charges.map((c, idx) => (
                                                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                                            <td style={{ padding: '0.4rem' }}>
                                                                <input
                                                                    type="text"
                                                                    className="form-control"
                                                                    placeholder="e.g. Fixed charge, VAT, SSCL"
                                                                    value={c.description}
                                                                    onChange={e => updateCharge(idx, 'description', e.target.value)}
                                                                    style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
                                                                />
                                                            </td>
                                                            <td style={{ padding: '0.4rem', width: '160px' }}>
                                                                <input
                                                                    type="number"
                                                                    step="any"
                                                                    className="form-control"
                                                                    placeholder="LKR"
                                                                    value={c.amount}
                                                                    onChange={e => updateCharge(idx, 'amount', e.target.value)}
                                                                    style={{ padding: '0.35rem 0.5rem', textAlign: 'right', fontSize: '0.85rem' }}
                                                                />
                                                            </td>
                                                            <td style={{ padding: '0.4rem', width: '40px', textAlign: 'center' }}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setFormBill({ ...formBill, charges: formBill.charges.filter((_, i) => i !== idx) })}
                                                                    style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.2rem' }}
                                                                >
                                                                    <X size={15} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                        {chargesTotal > 0 && Math.abs(chargesTotal - Number(formBill.totalAmount || 0)) > 0.01 && (
                                            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#b45309', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                <AlertCircle size={14} />
                                                Charges add up to LKR {chargesTotal.toLocaleString()}, which differs from the total.
                                                <button
                                                    type="button"
                                                    onClick={() => updateForm('totalAmount', String(chargesTotal))}
                                                    style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600, padding: 0 }}
                                                >
                                                    Use as total
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Total */}
                                    <div style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid var(--border)', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                        <div>
                                            <label className="form-label" style={{ margin: 0, fontWeight: 600 }}>This Month's Charge (LKR) *</label>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>Including taxes, excluding arrears — this is what gets posted to Financials.</div>
                                        </div>
                                        <input
                                            type="number"
                                            step="any"
                                            className="form-control"
                                            value={formBill.totalAmount}
                                            onChange={e => updateForm('totalAmount', e.target.value)}
                                            style={{ maxWidth: '220px', fontSize: '1.2rem', fontWeight: 700, textAlign: 'right', color: 'var(--primary)' }}
                                            required
                                        />
                                    </div>

                                    {editingId ? (
                                        <button
                                            className="btn btn-primary"
                                            disabled={isSaving}
                                            onClick={() => handleSaveBill()}
                                            style={{ width: '100%', padding: '0.75rem', fontWeight: 600 }}
                                        >
                                            {savingAs === 'edit' ? <ButtonSpinner /> : <CheckCircle2 size={18} />}
                                            {savingAs === 'edit' ? 'Saving Changes...' : 'Save Changes'}
                                        </button>
                                    ) : (
                                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                            <button
                                                className="btn"
                                                disabled={isSaving}
                                                onClick={() => handleSaveBill(false)}
                                                style={{ flex: 1, backgroundColor: '#f59e0b', color: 'white', padding: '0.75rem', fontWeight: 600 }}
                                            >
                                                {savingAs === 'pending' ? <ButtonSpinner /> : <Clock size={18} />}
                                                {savingAs === 'pending' ? 'Saving...' : 'Save as Pending Bill'}
                                            </button>
                                            <button
                                                className="btn"
                                                disabled={isSaving}
                                                onClick={() => handleSaveBill(true)}
                                                style={{ flex: 1, backgroundColor: '#10b981', color: 'white', padding: '0.75rem', fontWeight: 600 }}
                                            >
                                                {savingAs === 'paid' ? <ButtonSpinner /> : <CheckCircle2 size={18} />}
                                                {savingAs === 'paid' ? 'Saving & Posting Expense...' : 'Save & Mark as Paid'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* MODAL 1: VIEW BILL DETAILS */}
            {viewingBill && (
                <div className="modal-backdrop" style={modalBackdrop}>
                    <div className="card animate-slide-up" style={{ width: '100%', maxWidth: '650px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
                            <div>
                                <h3 style={{ margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <TypeIcon size={20} style={{ color: config.color }} />
                                    {config.label} Bill {viewingBill.billNo}
                                </h3>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: '0.2rem' }}>
                                    {[viewingBill.provider, viewingBill.accountNo && `A/C ${viewingBill.accountNo}`, viewingBill.tariff, viewingBill.month].filter(Boolean).join(' • ')}
                                    {viewingBill.premises && <div>{viewingBill.premises}</div>}
                                </div>
                            </div>
                            <button onClick={() => setViewingBill(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                                <div style={infoTile}>
                                    <div style={infoLabel}>Status</div>
                                    <div style={{ marginTop: '0.3rem' }}><StatusBadge bill={viewingBill} /></div>
                                </div>
                                <div style={infoTile}>
                                    <div style={infoLabel}>This Month's Charge</div>
                                    <div style={{ fontWeight: 700, marginTop: '0.2rem', color: 'var(--primary)' }}>
                                        {lkr(viewingBill.totalAmount)}
                                    </div>
                                </div>
                                {Number(viewingBill.previousDue) > 0 && (
                                    <div style={infoTile}>
                                        <div style={infoLabel}>Total Due incl. Arrears</div>
                                        <div style={{ fontWeight: 700, marginTop: '0.2rem', color: '#b91c1c' }}>{lkr(viewingBill.totalDue)}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                                            Previous due {lkr(viewingBill.previousDue)} from earlier unpaid bills
                                        </div>
                                    </div>
                                )}
                                <div style={infoTile}>
                                    <div style={infoLabel}>Bill Date</div>
                                    <div style={{ fontWeight: 700, marginTop: '0.2rem', color: 'var(--text)' }}>{viewingBill.date}</div>
                                </div>
                                <div style={infoTile}>
                                    <div style={infoLabel}>Due Date</div>
                                    <div style={{ fontWeight: 700, marginTop: '0.2rem', color: isOverdue(viewingBill) ? '#b91c1c' : 'var(--text)' }}>{viewingBill.dueDate || '-'}</div>
                                </div>
                                {(viewingBill.periodFrom || viewingBill.periodTo) && (
                                    <div style={infoTile}>
                                        <div style={infoLabel}>Billing Period</div>
                                        <div style={{ fontWeight: 600, marginTop: '0.2rem', color: 'var(--text)', fontSize: '0.9rem' }}>
                                            {viewingBill.periodFrom || '?'} → {viewingBill.periodTo || '?'}
                                        </div>
                                    </div>
                                )}
                                {config.hasMeter && (
                                    <div style={infoTile}>
                                        <div style={infoLabel}>Units Used</div>
                                        <div style={{ fontWeight: 700, marginTop: '0.2rem', color: 'var(--text)' }}>{formatUnits(viewingBill.unitsUsed)}</div>
                                        {viewingBill.previousReading !== null && viewingBill.currentReading !== null && (
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                                                {viewingBill.previousReading} → {viewingBill.currentReading}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {viewingBill.paidDate && (
                                <div style={{ padding: '0.75rem', backgroundColor: '#f0fdf4', borderRadius: '0.5rem', border: '1px solid #bbf7d0', marginBottom: '1.25rem', fontSize: '0.85rem', color: '#166534' }}>
                                    Settled on: <b>{viewingBill.paidDate}</b>
                                    {viewingBill.paymentNotes && <span> • Notes: {viewingBill.paymentNotes}</span>}
                                </div>
                            )}

                            {(viewingBill.charges || []).length > 0 && (
                                <>
                                    <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text)' }}>Charge Breakdown</h4>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', marginBottom: '1rem' }}>
                                        <tbody>
                                            {viewingBill.charges.map((c, idx) => (
                                                <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                                    <td style={{ padding: '0.6rem 0.75rem' }}>{c.description}</td>
                                                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 600 }}>LKR {Number(c.amount || 0).toLocaleString()}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </>
                            )}

                            {viewingBill.originalFileName && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
                                    Imported from: {viewingBill.originalFileName}
                                </div>
                            )}
                        </div>

                        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', backgroundColor: '#f8fafc', flexWrap: 'wrap' }}>
                            <button className="btn" onClick={() => setViewingBill(null)} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>
                                Close
                            </button>
                            <button className="btn" onClick={() => startEdit(viewingBill)} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>
                                <Pencil size={15} /> Edit
                            </button>
                            {viewingBill.status !== 'Paid' ? (
                                <button className="btn" onClick={() => openPayModal(viewingBill)} style={{ backgroundColor: '#10b981', color: 'white' }}>
                                    <CheckCircle2 size={16} /> Mark as Paid
                                </button>
                            ) : (
                                <button
                                    className="btn"
                                    onClick={() => { handleRevertToPending(viewingBill.id); setViewingBill(null); }}
                                    style={{ border: '1px solid var(--border)', backgroundColor: '#f1f5f9' }}
                                >
                                    <RotateCcw size={15} /> Revert to Pending
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL 2: CONFIRM PAYMENT */}
            {payingBill && (
                <div className="modal-backdrop" style={modalBackdrop}>
                    <div className="card animate-slide-up" style={{ width: '100%', maxWidth: '480px', padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <CheckCircle2 className="text-success" size={20} />
                                Settle {UTILITY_TYPES[payingBill.type]?.label || 'Utility'} Bill
                            </h3>
                            <button onClick={() => setPayingBill(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '1.5rem' }}>
                            <div style={{ padding: '1rem', backgroundColor: '#f0fdf4', borderRadius: '0.5rem', border: '1px solid #bbf7d0', marginBottom: '1.25rem' }}>
                                <div style={{ fontSize: '0.85rem', color: '#166534' }}>Settling Bill</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#14532d', margin: '0.2rem 0' }}>
                                    {payingBill.billNo} — LKR {Number(payingBill.totalAmount).toLocaleString()}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: '#166534' }}>
                                    {[payingBill.provider, payingBill.month].filter(Boolean).join(' • ')}
                                </div>
                            </div>

                            <p style={{ fontSize: '0.9rem', color: 'var(--text-light)', marginBottom: '1.25rem' }}>
                                Marking this bill as paid will automatically record an expense of <b>LKR {Number(payingBill.totalAmount).toLocaleString()}</b> under category <b>"{UTILITY_TYPES[payingBill.type]?.expenseCategory || 'Utilities'}"</b> in your financial accounts.
                            </p>

                            <div className="form-group">
                                <label className="form-label">Payment Date</label>
                                <input
                                    type="date"
                                    className="form-control"
                                    value={paymentData.paidDate}
                                    onChange={e => setPaymentData({ ...paymentData, paidDate: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Payment Notes / Reference (Optional)</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="e.g. Online banking, Cash at counter..."
                                    value={paymentData.paymentNotes}
                                    onChange={e => setPaymentData({ ...paymentData, paymentNotes: e.target.value })}
                                />
                            </div>
                        </div>

                        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', backgroundColor: '#f8fafc' }}>
                            <button className="btn" onClick={() => setPayingBill(null)} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>
                                Cancel
                            </button>
                            <button
                                className="btn"
                                onClick={handleConfirmPayment}
                                disabled={isPaying}
                                style={{ backgroundColor: '#10b981', color: 'white', fontWeight: 600 }}
                            >
                                {isPaying ? <><ButtonSpinner /> Processing...</> : 'Confirm Payment & Post Expense'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
