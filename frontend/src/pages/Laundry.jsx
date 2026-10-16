import React, { useState, useEffect, useMemo } from 'react';
import { 
    Shirt, UploadCloud, FileText, CheckCircle2, Clock, 
    AlertCircle, Trash2, Eye, Download, Plus, Search, 
    Calendar, DollarSign, Layers, ArrowRight, RotateCcw, 
    BarChart3, RefreshCw, X, ExternalLink
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ProcessingOverlay, { ButtonSpinner } from '../components/ProcessingOverlay';
import { notifyDataChanged } from '../utils/notifications';

export default function Laundry() {
    const [bills, setBills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'ledger' | 'upload'
    
    // Filter & Search states for Ledger
    const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'Pending' | 'Paid'
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMonthFilter, setSelectedMonthFilter] = useState('ALL');

    // Upload & Preview states
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [previewBill, setPreviewBill] = useState(null); // Extracted data from upload
    const [previewFile, setPreviewFile] = useState(null); // File metadata { filename, pdfPath, ... }
    const [isSaving, setIsSaving] = useState(false);
    const [savingAs, setSavingAs] = useState(null); // 'pending' | 'paid' — which save button is in progress

    // Modal states
    const [viewingBill, setViewingBill] = useState(null);
    const [payingBill, setPayingBill] = useState(null);
    const [paymentData, setPaymentData] = useState({
        paidDate: new Date().toISOString().split('T')[0],
        paymentNotes: ''
    });
    const [isPaying, setIsPaying] = useState(false);

    // Fetch laundry bills on load
    const fetchBills = async () => {
        try {
            setLoading(true);
            const res = await fetchWithAuth('/api/laundry/bills');
            if (!res.ok) throw new Error('Failed to load laundry bills');
            const data = await res.json();
            setBills(data.data || []);
            // Bills changed (uploaded, paid, deleted...) — let notifications re-check
            notifyDataChanged();
        } catch (err) {
            console.error('Error fetching bills:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBills();
    }, []);

    // Handle File Upload & Parse
    const handleFileUpload = async (file) => {
        if (!file) return;
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            setUploadError('Please select a valid PDF invoice document.');
            return;
        }

        setIsUploading(true);
        setUploadError('');
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetchWithAuth('/api/laundry/upload-preview', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to parse invoice PDF');
            }

            const json = await res.json();
            setPreviewBill(json.data);
            setPreviewFile(json.file);
            setActiveTab('upload');
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

    // Save Bill (either as Pending or Paid)
    const handleSaveBill = async (asPaid = false) => {
        if (isSaving) return;
        if (!previewBill || !previewBill.invoiceNo || !previewBill.date) {
            alert('Please verify invoice number and date before saving.');
            return;
        }

        const duplicate = bills.find(b => (b.invoiceNo || '').toLowerCase().trim() === previewBill.invoiceNo.toLowerCase().trim());
        if (duplicate) {
            alert(`Invoice "${previewBill.invoiceNo}" has already been saved in the system (Status: ${duplicate.status}). Duplicate bills cannot be uploaded or saved.`);
            return;
        }

        setIsSaving(true);
        setSavingAs(asPaid ? 'paid' : 'pending');
        try {
            const payload = {
                ...previewBill,
                status: asPaid ? 'Paid' : 'Pending',
                paidDate: asPaid ? (previewBill.date || new Date().toISOString().split('T')[0]) : null,
                originalFileName: previewFile ? previewFile.originalName : '',
                fileHash: previewFile ? previewFile.hash : null,
                items: previewBill.items || [],
                dailyBreakdown: previewBill.dailyBreakdown || {}
            };

            const res = await fetchWithAuth('/api/laundry/bills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to save laundry bill');
            }

            await fetchBills();
            setPreviewBill(null);
            setPreviewFile(null);
            setActiveTab('ledger');
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            setIsSaving(false);
            setSavingAs(null);
        }
    };

    // Settle / Mark Bill as Paid
    const handleConfirmPayment = async () => {
        if (!payingBill || isPaying) return;
        setIsPaying(true);
        try {
            const res = await fetchWithAuth(`/api/laundry/bills/${payingBill.id}/pay`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(paymentData)
            });

            if (!res.ok) {
                const errData = await res.json();
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

    // Revert Paid Bill to Pending
    const handleRevertToPending = async (billId) => {
        if (!window.confirm("Revert this bill back to Pending? This will also remove the corresponding expense record from Financials.")) return;
        try {
            const res = await fetchWithAuth(`/api/laundry/bills/${billId}/unpay`, {
                method: 'POST'
            });
            if (!res.ok) throw new Error('Failed to revert bill');
            await fetchBills();
        } catch (err) {
            alert('Revert failed: ' + err.message);
        }
    };

    // Delete Bill
    const handleDeleteBill = async (billId) => {
        if (!window.confirm("Are you sure you want to delete this bill? Any associated expense record will also be removed.")) return;
        try {
            const res = await fetchWithAuth(`/api/laundry/bills/${billId}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error('Failed to delete bill');
            await fetchBills();
            if (viewingBill && viewingBill.id === billId) {
                setViewingBill(null);
            }
        } catch (err) {
            alert('Delete failed: ' + err.message);
        }
    };

    // Dashboard Metrics & Calculations
    const metrics = useMemo(() => {
        let totalSpend = 0;
        let pendingAmount = 0;
        let paidAmount = 0;
        let pendingCount = 0;
        let paidCount = 0;
        let totalPieces = 0;

        const itemUsageMap = {};
        const monthlyStats = {};

        bills.forEach(bill => {
            const amt = Number(bill.totalAmount || 0);
            const qty = Number(bill.totalQty || 0);
            totalSpend += amt;
            totalPieces += qty;

            if (bill.status === 'Paid') {
                paidAmount += amt;
                paidCount++;
            } else {
                pendingAmount += amt;
                pendingCount++;
            }

            // Month aggregation
            const m = bill.month || (bill.date ? bill.date.slice(0, 7) : 'Unknown');
            if (!monthlyStats[m]) {
                monthlyStats[m] = { month: m, amount: 0, pieces: 0, paid: 0, pending: 0 };
            }
            monthlyStats[m].amount += amt;
            monthlyStats[m].pieces += qty;
            if (bill.status === 'Paid') monthlyStats[m].paid += amt;
            else monthlyStats[m].pending += amt;

            // Line items aggregation
            (bill.items || []).forEach(it => {
                const key = it.description ? it.description.trim() : 'Other Linen';
                if (!itemUsageMap[key]) {
                    itemUsageMap[key] = {
                        name: key,
                        quantity: 0,
                        totalCost: 0,
                        unitPrices: new Set()
                    };
                }
                itemUsageMap[key].quantity += Number(it.quantity || 0);
                itemUsageMap[key].totalCost += Number(it.amount || 0);
                if (it.unitPrice) itemUsageMap[key].unitPrices.add(it.unitPrice);
            });
        });

        const itemUsageList = Object.values(itemUsageMap).map(it => ({
            ...it,
            avgUnitPrice: it.quantity > 0 ? (it.totalCost / it.quantity) : 0,
            percentOfTotal: totalPieces > 0 ? Math.round((it.quantity / totalPieces) * 100) : 0
        })).sort((a, b) => b.quantity - a.quantity);

        const avgCostPerPiece = totalPieces > 0 ? (totalSpend / totalPieces) : 0;

        return {
            totalSpend,
            pendingAmount,
            paidAmount,
            pendingCount,
            paidCount,
            totalPieces,
            avgCostPerPiece,
            itemUsageList,
            monthlyStats: Object.values(monthlyStats)
        };
    }, [bills]);

    // Available months for filtering
    const availableMonths = useMemo(() => {
        const set = new Set();
        bills.forEach(b => {
            if (b.month) set.add(b.month);
        });
        return Array.from(set);
    }, [bills]);

    // Filtered bills for ledger
    const filteredBills = useMemo(() => {
        return bills.filter(b => {
            if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
            if (selectedMonthFilter !== 'ALL' && b.month !== selectedMonthFilter) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const matchInv = (b.invoiceNo || '').toLowerCase().includes(q);
                const matchVendor = (b.vendor || '').toLowerCase().includes(q);
                const matchMonth = (b.month || '').toLowerCase().includes(q);
                if (!matchInv && !matchVendor && !matchMonth) return false;
            }
            return true;
        });
    }, [bills, statusFilter, selectedMonthFilter, searchQuery]);

    // Update line item in preview form
    const handleUpdatePreviewItem = (index, field, value) => {
        if (!previewBill || !previewBill.items) return;
        const newItems = [...previewBill.items];
        newItems[index] = { ...newItems[index], [field]: value };
        
        // Auto-recalculate line amount if quantity or unitPrice changed
        if (field === 'quantity' || field === 'unitPrice') {
            const q = Number(newItems[index].quantity || 0);
            const p = Number(newItems[index].unitPrice || 0);
            newItems[index].amount = q * p;
        }

        const newTotalQty = newItems.reduce((s, it) => s + Number(it.quantity || 0), 0);
        const newTotalAmt = newItems.reduce((s, it) => s + Number(it.amount || 0), 0);

        setPreviewBill({
            ...previewBill,
            items: newItems,
            totalQty: newTotalQty,
            totalAmount: newTotalAmt
        });
    };

    const handleAddPreviewItem = () => {
        if (!previewBill) return;
        const newItems = [...(previewBill.items || []), { description: 'New Item', quantity: 1, unitPrice: 100, amount: 100 }];
        const newTotalQty = newItems.reduce((s, it) => s + Number(it.quantity || 0), 0);
        const newTotalAmt = newItems.reduce((s, it) => s + Number(it.amount || 0), 0);
        setPreviewBill({
            ...previewBill,
            items: newItems,
            totalQty: newTotalQty,
            totalAmount: newTotalAmt
        });
    };

    const handleRemovePreviewItem = (index) => {
        if (!previewBill || !previewBill.items) return;
        const newItems = previewBill.items.filter((_, i) => i !== index);
        const newTotalQty = newItems.reduce((s, it) => s + Number(it.quantity || 0), 0);
        const newTotalAmt = newItems.reduce((s, it) => s + Number(it.amount || 0), 0);
        setPreviewBill({
            ...previewBill,
            items: newItems,
            totalQty: newTotalQty,
            totalAmount: newTotalAmt
        });
    };

    return (
        <div className="animate-slide-up" style={{ paddingBottom: '3rem' }}>
            <ProcessingOverlay
                show={isUploading || isSaving || isPaying}
                message={
                    isUploading ? 'Reading laundry invoice...'
                        : isPaying ? 'Recording payment...'
                        : savingAs === 'paid' ? 'Saving bill & posting expense...'
                        : 'Saving bill...'
                }
                detail={isUploading ? 'Extracting items and checking for duplicates.' : 'Please wait, this can take a few seconds.'}
            />

            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Shirt className="text-primary" size={28} />
                        Laundry Hub
                    </h1>
                    <p style={{ color: 'var(--text-light)', marginTop: '0.25rem', fontSize: '0.95rem' }}>
                        Manage supplier bills, parse PDF invoices, track linen usage & bill-wise payments.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button 
                        className="btn btn-primary"
                        onClick={() => {
                            setActiveTab('upload');
                            setPreviewBill(null);
                            setPreviewFile(null);
                        }}
                    >
                        <UploadCloud size={18} />
                        Upload Laundry Bill
                    </button>
                </div>
            </div>

            {/* Top Navigation Tabs */}
            <div className="tab-bar" style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid var(--border)', marginBottom: '2rem' }}>
                {[
                    { id: 'dashboard', label: 'Overview & Usage', icon: BarChart3 },
                    { id: 'ledger', label: `Bills Ledger (${bills.length})`, icon: FileText },
                    { id: 'upload', label: 'Upload & Review PDF', icon: UploadCloud }
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

            {/* TAB 1: DASHBOARD & USAGE */}
            {activeTab === 'dashboard' && (
                <div>
                    {/* KPI Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
                        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--primary)' }}>
                            <div style={{ color: 'var(--text-light)', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase' }}>
                                Total Laundry Invoiced
                            </div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text)', margin: '0.35rem 0' }}>
                                LKR {metrics.totalSpend.toLocaleString()}
                            </div>
                            <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                                Across {bills.length} bills total
                            </div>
                        </div>

                        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--warning)' }}>
                            <div style={{ color: 'var(--warning)', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <Clock size={16} /> Pending Payment
                            </div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#b45309', margin: '0.35rem 0' }}>
                                LKR {metrics.pendingAmount.toLocaleString()}
                            </div>
                            <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                                {metrics.pendingCount} unpaid {metrics.pendingCount === 1 ? 'bill' : 'bills'}
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

                        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #8b5cf6' }}>
                            <div style={{ color: '#8b5cf6', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase' }}>
                                Total Pieces Laundered
                            </div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#6d28d9', margin: '0.35rem 0' }}>
                                {metrics.totalPieces.toLocaleString()} <span style={{ fontSize: '1rem', fontWeight: 500 }}>pcs</span>
                            </div>
                            <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                                Avg LKR {Math.round(metrics.avgCostPerPiece)} / piece
                            </div>
                        </div>
                    </div>

                    {/* Breakdown by Item & Monthly Trends */}
                    <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(320px, 1fr)', gap: '1.5rem', marginBottom: '2rem' }}>
                        {/* Linen Usage Breakdown */}
                        <div className="card" style={{ padding: '1.5rem' }}>
                            <h3 style={{ margin: '0 0 1.25rem 0', color: 'var(--text)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Layers size={18} className="text-primary" />
                                Linen Usage by Item
                            </h3>

                            {metrics.itemUsageList.length === 0 ? (
                                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                    No laundry items recorded yet. Upload a bill to see item usage breakdown.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                    {metrics.itemUsageList.map((item, idx) => {
                                        const colors = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
                                        const color = colors[idx % colors.length];
                                        return (
                                            <div key={item.name}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', fontSize: '0.9rem' }}>
                                                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                                                        {item.name}
                                                    </span>
                                                    <span style={{ color: 'var(--text-light)' }}>
                                                        <b>{item.quantity} pcs</b> • LKR {item.totalCost.toLocaleString()} ({item.percentOfTotal}%)
                                                    </span>
                                                </div>
                                                <div style={{ width: '100%', height: '9px', backgroundColor: '#e2e8f0', borderRadius: '5px', overflow: 'hidden' }}>
                                                    <div 
                                                        style={{ 
                                                            width: `${item.percentOfTotal}%`, 
                                                            height: '100%', 
                                                            backgroundColor: color,
                                                            borderRadius: '5px',
                                                            transition: 'width 0.4s ease'
                                                        }} 
                                                    />
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.2rem' }}>
                                                    Average unit price: LKR {Math.round(item.avgUnitPrice)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Monthly Spending & Volume Overview */}
                        <div className="card" style={{ padding: '1.5rem' }}>
                            <h3 style={{ margin: '0 0 1.25rem 0', color: 'var(--text)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Calendar size={18} className="text-primary" />
                                Monthly Spending & Volume
                            </h3>

                            {metrics.monthlyStats.length === 0 ? (
                                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                    No monthly stats available yet.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {metrics.monthlyStats.map(stat => (
                                        <div key={stat.month} style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                                <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>{stat.month}</strong>
                                                <span style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '1.1rem' }}>
                                                    LKR {stat.amount.toLocaleString()}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                                                <span>Total Pieces: <b>{stat.pieces} pcs</b></span>
                                                <span>
                                                    Paid: <b style={{ color: 'var(--success)' }}>LKR {stat.paid.toLocaleString()}</b>
                                                    {stat.pending > 0 && (
                                                        <span style={{ color: 'var(--warning)', marginLeft: '0.5rem' }}>
                                                            (Pending: LKR {stat.pending.toLocaleString()})
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Quick action banner if pending bills exist */}
                    {metrics.pendingCount > 0 && (
                        <div style={{ padding: '1.25rem', backgroundColor: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 'var(--radius)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <AlertCircle size={24} style={{ color: '#d97706' }} />
                                <div>
                                    <h4 style={{ margin: 0, color: '#92400e' }}>You have {metrics.pendingCount} pending laundry bill(s) totaling LKR {metrics.pendingAmount.toLocaleString()}</h4>
                                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#b45309' }}>
                                        Mark bills as paid once bank transfer or cash payment is complete to automatically reflect them in Financials.
                                    </p>
                                </div>
                            </div>
                            <button className="btn" style={{ backgroundColor: '#d97706', color: 'white' }} onClick={() => { setStatusFilter('Pending'); setActiveTab('ledger'); }}>
                                Review Pending Bills <ArrowRight size={16} />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 2: BILLS LEDGER */}
            {activeTab === 'ledger' && (
                <div>
                    {/* Filters & Search Toolbar */}
                    <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', backgroundColor: '#f8fafc' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '220px' }}>
                            <Search size={18} style={{ color: 'var(--text-light)' }} />
                            <input 
                                type="text"
                                className="form-control"
                                placeholder="Search invoice #, vendor, month..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-light)' }}>Status:</span>
                            <div style={{ display: 'flex', borderRadius: '0.5rem', overflow: 'hidden', border: '1px solid var(--border)' }}>
                                {['ALL', 'Pending', 'Paid'].map(s => (
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

                        {availableMonths.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-light)' }}>Month:</span>
                                <select 
                                    className="form-control"
                                    value={selectedMonthFilter}
                                    onChange={e => setSelectedMonthFilter(e.target.value)}
                                    style={{ width: 'auto', padding: '0.4rem' }}
                                >
                                    <option value="ALL">All Months</option>
                                    {availableMonths.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <button 
                            className="btn"
                            onClick={() => { setSearchQuery(''); setStatusFilter('ALL'); setSelectedMonthFilter('ALL'); }}
                            style={{ backgroundColor: 'transparent', border: '1px solid var(--border)', color: 'var(--text-light)', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
                        >
                            Reset
                        </button>
                    </div>

                    {/* Bills Table */}
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '750px' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)', color: 'var(--text-light)', fontSize: '0.85rem', textTransform: 'uppercase' }}>
                                        <th style={{ padding: '1rem' }}>Invoice No</th>
                                        <th style={{ padding: '1rem' }}>Date</th>
                                        <th style={{ padding: '1rem' }}>Month</th>
                                        <th style={{ padding: '1rem' }}>Items</th>
                                        <th style={{ padding: '1rem' }}>Total Qty</th>
                                        <th style={{ padding: '1rem' }}>Amount (LKR)</th>
                                        <th style={{ padding: '1rem' }}>Status</th>
                                        <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr>
                                            <td colSpan={8} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                                Loading laundry records...
                                            </td>
                                        </tr>
                                    ) : filteredBills.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                                No laundry bills found matching your criteria.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredBills.map(bill => {
                                            const isPaid = bill.status === 'Paid';
                                            return (
                                                <tr key={bill.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.95rem' }}>
                                                    <td className="cell-title" style={{ padding: '1rem', fontWeight: 600, color: 'var(--text)' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                            <FileText size={16} className="text-primary" />
                                                            {bill.invoiceNo}
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.15rem' }}>
                                                            {bill.vendor}
                                                        </div>
                                                    </td>
                                                    <td data-label="Date" style={{ padding: '1rem', whiteSpace: 'nowrap' }}>
                                                        {bill.date}
                                                    </td>
                                                    <td data-label="Month" style={{ padding: '1rem', fontWeight: 500 }}>
                                                        {bill.month || '-'}
                                                    </td>
                                                    <td data-label="Items" style={{ padding: '1rem', color: 'var(--text-light)', fontSize: '0.85rem' }}>
                                                        {(bill.items || []).map(it => `${it.quantity} ${it.description}`).join(', ') || '-'}
                                                    </td>
                                                    <td data-label="Total qty" style={{ padding: '1rem', fontWeight: 600 }}>
                                                        {bill.totalQty || 0} pcs
                                                    </td>
                                                    <td data-label="Amount" style={{ padding: '1rem', fontWeight: 700, color: 'var(--text)' }}>
                                                        {(bill.totalAmount || 0).toLocaleString()}
                                                    </td>
                                                    <td data-label="Status" style={{ padding: '1rem' }}>
                                                        {isPaid ? (
                                                            <span style={{ 
                                                                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                                                padding: '0.25rem 0.6rem', borderRadius: '1rem', 
                                                                backgroundColor: '#dcfce7', color: '#15803d', 
                                                                fontSize: '0.8rem', fontWeight: 600 
                                                            }}>
                                                                <CheckCircle2 size={13} /> Paid
                                                            </span>
                                                        ) : (
                                                            <span style={{ 
                                                                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                                                padding: '0.25rem 0.6rem', borderRadius: '1rem', 
                                                                backgroundColor: '#fef3c7', color: '#b45309', 
                                                                fontSize: '0.8rem', fontWeight: 600 
                                                            }}>
                                                                <Clock size={13} /> Pending
                                                            </span>
                                                        )}
                                                        {isPaid && bill.paidDate && (
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.2rem' }}>
                                                                Paid on {bill.paidDate}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="cell-actions" style={{ padding: '1rem', textAlign: 'right' }}>
                                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                            {/* View Details */}
                                                            <button 
                                                                className="btn"
                                                                onClick={() => setViewingBill(bill)}
                                                                style={{ padding: '0.4rem', border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--text)' }}
                                                                title="View Details & PDF"
                                                            >
                                                                <Eye size={16} />
                                                            </button>

                                                            {/* Mark as Paid / Revert */}
                                                            {!isPaid ? (
                                                                <button 
                                                                    className="btn"
                                                                    onClick={() => {
                                                                        setPayingBill(bill);
                                                                        setPaymentData({
                                                                            paidDate: new Date().toISOString().split('T')[0],
                                                                            paymentNotes: ''
                                                                        });
                                                                    }}
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

                                                            {/* Delete */}
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

            {/* TAB 3: UPLOAD & REVIEW PDF */}
            {activeTab === 'upload' && (
                <div>
                    {!previewBill ? (
                        /* Upload Dropzone */
                        <div className="card" style={{ padding: '3rem 2rem', textAlign: 'center', border: '2px dashed #cbd5e1' }}
                            onDragOver={e => e.preventDefault()}
                            onDrop={handleFileDrop}
                        >
                            <div style={{ width: '64px', height: '64px', margin: '0 auto 1.5rem', backgroundColor: '#eef2ff', color: 'var(--primary)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <UploadCloud size={32} />
                            </div>
                            <h2 style={{ fontSize: '1.35rem', marginBottom: '0.5rem', color: 'var(--text)' }}>
                                Upload Laundry Invoice PDF
                            </h2>
                            <p style={{ color: 'var(--text-light)', maxWidth: '520px', margin: '0 auto 1.5rem', fontSize: '0.95rem' }}>
                                Drop your Shiny Laundry PDF bill here (or click browse). The system will automatically parse invoice number, date, line items, and totals for your review.
                            </p>

                            <input 
                                type="file" 
                                id="laundry-pdf-input" 
                                accept="application/pdf,.pdf" 
                                style={{ display: 'none' }}
                                onChange={e => {
                                    if (e.target.files && e.target.files[0]) {
                                        handleFileUpload(e.target.files[0]);
                                    }
                                }}
                            />

                            <label 
                                htmlFor="laundry-pdf-input" 
                                className="btn btn-primary"
                                style={{ padding: '0.75rem 1.75rem', cursor: 'pointer', fontSize: '1rem' }}
                            >
                                {isUploading ? <><ButtonSpinner /> Reading Invoice PDF...</> : 'Browse PDF File'}
                            </label>

                            {uploadError && (
                                <div style={{ marginTop: '1.5rem', padding: '0.75rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                                    <AlertCircle size={18} /> {uploadError}
                                </div>
                            )}

                            {/* Samples Notice */}
                            <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)', color: 'var(--text-light)', fontSize: '0.85rem' }}>
                                💡 Tip: You can upload invoices like <b>INV-028</b> (Sep 2026) or <b>INV-029</b> (Oct 2026). Both single-page summaries and 2-page detailed daily sheets are fully supported.
                            </div>
                        </div>
                    ) : (
                        /* Extracted Review Form & PDF Viewer */
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <div>
                                    <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text)' }}>
                                        Review Extracted Bill Details
                                    </h2>
                                    <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                                        Verify extracted items and totals against the PDF before saving.
                                    </p>
                                </div>
                                <button 
                                    className="btn" 
                                    onClick={() => { setPreviewBill(null); setPreviewFile(null); }}
                                    style={{ border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--text)' }}
                                >
                                    Upload Different Bill
                                </button>
                            </div>

                            <div style={{ maxWidth: '850px', margin: '0 auto' }}>
                                {/* Extracted Data Form */}
                                <div className="card" style={{ padding: '1.75rem' }}>
                                    <h3 style={{ margin: '0 0 1.25rem 0', color: 'var(--text)', fontSize: '1.1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                                        Invoice Information
                                    </h3>

                                    <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                        <div className="form-group">
                                            <label className="form-label">Invoice Number</label>
                                            <input 
                                                type="text" 
                                                className="form-control"
                                                value={previewBill.invoiceNo}
                                                onChange={e => setPreviewBill({ ...previewBill, invoiceNo: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Invoice Date</label>
                                            <input 
                                                type="date" 
                                                className="form-control"
                                                value={previewBill.date}
                                                onChange={e => setPreviewBill({ ...previewBill, date: e.target.value })}
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                                        <div className="form-group">
                                            <label className="form-label">Vendor Name</label>
                                            <input 
                                                type="text" 
                                                className="form-control"
                                                value={previewBill.vendor}
                                                onChange={e => setPreviewBill({ ...previewBill, vendor: e.target.value })}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Billing Month / Period</label>
                                            <input 
                                                type="text" 
                                                className="form-control"
                                                placeholder="e.g. Sep 2026"
                                                value={previewBill.month || ''}
                                                onChange={e => setPreviewBill({ ...previewBill, month: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    {/* Line Items Table */}
                                    <div style={{ marginBottom: '1.5rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                            <label className="form-label" style={{ margin: 0, fontWeight: 600 }}>
                                                Extracted Line Items ({previewBill.items ? previewBill.items.length : 0})
                                            </label>
                                            <button 
                                                type="button"
                                                className="btn"
                                                onClick={handleAddPreviewItem}
                                                style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem', border: '1px solid var(--border)', backgroundColor: '#f1f5f9' }}
                                            >
                                                <Plus size={14} /> Add Item
                                            </button>
                                        </div>

                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                            <thead>
                                                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border)', color: 'var(--text-light)' }}>
                                                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Item Description</th>
                                                    <th style={{ padding: '0.5rem', width: '80px', textAlign: 'center' }}>Qty</th>
                                                    <th style={{ padding: '0.5rem', width: '100px', textAlign: 'right' }}>Unit (LKR)</th>
                                                    <th style={{ padding: '0.5rem', width: '110px', textAlign: 'right' }}>Total (LKR)</th>
                                                    <th style={{ padding: '0.5rem', width: '40px' }}></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(previewBill.items || []).map((it, idx) => (
                                                    <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                                        <td style={{ padding: '0.4rem' }}>
                                                            <input 
                                                                type="text" 
                                                                className="form-control" 
                                                                value={it.description}
                                                                onChange={e => handleUpdatePreviewItem(idx, 'description', e.target.value)}
                                                                style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
                                                            />
                                                        </td>
                                                        <td style={{ padding: '0.4rem' }}>
                                                            <input 
                                                                type="number" 
                                                                className="form-control" 
                                                                value={it.quantity}
                                                                onChange={e => handleUpdatePreviewItem(idx, 'quantity', e.target.value)}
                                                                style={{ padding: '0.35rem 0.5rem', textAlign: 'center', fontSize: '0.85rem' }}
                                                            />
                                                        </td>
                                                        <td style={{ padding: '0.4rem' }}>
                                                            <input 
                                                                type="number" 
                                                                step="any"
                                                                className="form-control" 
                                                                value={it.unitPrice}
                                                                onChange={e => handleUpdatePreviewItem(idx, 'unitPrice', e.target.value)}
                                                                style={{ padding: '0.35rem 0.5rem', textAlign: 'right', fontSize: '0.85rem' }}
                                                            />
                                                        </td>
                                                        <td style={{ padding: '0.4rem', textAlign: 'right', fontWeight: 600 }}>
                                                            {Number(it.amount || 0).toLocaleString()}
                                                        </td>
                                                        <td style={{ padding: '0.4rem', textAlign: 'center' }}>
                                                            <button 
                                                                type="button" 
                                                                onClick={() => handleRemovePreviewItem(idx)}
                                                                style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.2rem' }}
                                                            >
                                                                <X size={15} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Totals Summary */}
                                    <div style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid var(--border)', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <span style={{ fontSize: '0.9rem', color: 'var(--text-light)' }}>Total Pieces: </span>
                                            <b style={{ fontSize: '1.1rem', color: 'var(--text)' }}>{previewBill.totalQty} pcs</b>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <span style={{ fontSize: '0.9rem', color: 'var(--text-light)' }}>Invoice Total: </span>
                                            <b style={{ fontSize: '1.35rem', color: 'var(--primary)' }}>LKR {Number(previewBill.totalAmount || 0).toLocaleString()}</b>
                                        </div>
                                    </div>

                                    {/* Daily Breakdown detected note */}
                                    {previewBill.dailyBreakdown && Object.keys(previewBill.dailyBreakdown).length > 0 && (
                                        <div style={{ padding: '0.75rem', backgroundColor: '#ecfdf5', borderRadius: '0.5rem', border: '1px solid #d1fae5', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#065f46' }}>
                                            ✓ Daily breakdown table detected ({Object.keys(previewBill.dailyBreakdown).length} active days recorded in bill).
                                        </div>
                                    )}

                                    {/* Action Buttons */}
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
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* MODAL 1: VIEW BILL DETAILS & ORIGINAL PDF */}
            {viewingBill && (
                <div className="modal-backdrop" style={{ 
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
                    backgroundColor: 'rgba(15, 23, 42, 0.6)', display: 'flex', 
                    alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem' 
                }}>
                    <div className="card animate-slide-up" style={{ 
                        width: '100%', maxWidth: '750px', maxHeight: '90vh', 
                        display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' 
                    }}>
                        {/* Modal Header */}
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
                            <div>
                                <h3 style={{ margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <FileText className="text-primary" size={20} />
                                    Invoice {viewingBill.invoiceNo} — {viewingBill.vendor}
                                </h3>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: '0.2rem' }}>
                                    Date: {viewingBill.date} {viewingBill.month ? `• Month: ${viewingBill.month}` : ''}
                                </div>
                            </div>
                            <button 
                                onClick={() => setViewingBill(null)} 
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                                <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>Status</div>
                                    <div style={{ fontWeight: 700, marginTop: '0.2rem', color: viewingBill.status === 'Paid' ? 'var(--success)' : '#b45309' }}>
                                        {viewingBill.status}
                                    </div>
                                </div>
                                <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>Total Pieces</div>
                                    <div style={{ fontWeight: 700, marginTop: '0.2rem', color: 'var(--text)' }}>
                                        {viewingBill.totalQty} pcs
                                    </div>
                                </div>
                                <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>Total Amount</div>
                                    <div style={{ fontWeight: 700, marginTop: '0.2rem', color: 'var(--primary)' }}>
                                        LKR {(viewingBill.totalAmount || 0).toLocaleString()}
                                    </div>
                                </div>
                            </div>

                            {viewingBill.paidDate && (
                                <div style={{ padding: '0.75rem', backgroundColor: '#f0fdf4', borderRadius: '0.5rem', border: '1px solid #bbf7d0', marginBottom: '1.25rem', fontSize: '0.85rem', color: '#166534' }}>
                                    Settled on: <b>{viewingBill.paidDate}</b>
                                    {viewingBill.paymentNotes && <span> • Notes: {viewingBill.paymentNotes}</span>}
                                </div>
                            )}

                            <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text)' }}>Itemized Breakdown</h4>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border)', color: 'var(--text-light)' }}>
                                        <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left' }}>Item Description</th>
                                        <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>Quantity</th>
                                        <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Unit Price</th>
                                        <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Total Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(viewingBill.items || []).map((it, idx) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '0.65rem 0.75rem', fontWeight: 500 }}>{it.description}</td>
                                            <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center' }}>{it.quantity}</td>
                                            <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>LKR {it.unitPrice}</td>
                                            <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', fontWeight: 600 }}>LKR {Number(it.amount).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Daily Usage Breakdown from Page 2 */}
                            {viewingBill.dailyBreakdown && Object.keys(viewingBill.dailyBreakdown).length > 0 && (
                                <div>
                                    <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text)' }}>Daily Laundry Breakdown</h4>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        {Object.entries(viewingBill.dailyBreakdown).map(([day, val]) => (
                                            <div key={day} style={{ padding: '0.4rem 0.6rem', backgroundColor: '#f1f5f9', borderRadius: '0.35rem', fontSize: '0.8rem', textAlign: 'center' }}>
                                                <div style={{ color: 'var(--text-light)', fontSize: '0.7rem' }}>Day {day}</div>
                                                <div style={{ fontWeight: 700, color: 'var(--text)' }}>{val.total} pcs</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', backgroundColor: '#f8fafc' }}>
                            <button className="btn" onClick={() => setViewingBill(null)} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>
                                Close
                            </button>
                            {viewingBill.status !== 'Paid' ? (
                                <button 
                                    className="btn"
                                    onClick={() => {
                                        const b = viewingBill;
                                        setViewingBill(null);
                                        setPayingBill(b);
                                        setPaymentData({ paidDate: new Date().toISOString().split('T')[0], paymentNotes: '' });
                                    }}
                                    style={{ backgroundColor: '#10b981', color: 'white' }}
                                >
                                    <CheckCircle2 size={16} /> Mark as Paid
                                </button>
                            ) : (
                                <button 
                                    className="btn"
                                    onClick={() => {
                                        handleRevertToPending(viewingBill.id);
                                        setViewingBill(null);
                                    }}
                                    style={{ border: '1px solid var(--border)', backgroundColor: '#f1f5f9' }}
                                >
                                    <RotateCcw size={15} /> Revert to Pending
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL 2: CONFIRM PAYMENT (SETTLE BILL) */}
            {payingBill && (
                <div className="modal-backdrop" style={{ 
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
                    backgroundColor: 'rgba(15, 23, 42, 0.6)', display: 'flex', 
                    alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem' 
                }}>
                    <div className="card animate-slide-up" style={{ width: '100%', maxWidth: '480px', padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <CheckCircle2 className="text-success" size={20} />
                                Settle Laundry Bill
                            </h3>
                            <button onClick={() => setPayingBill(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '1.5rem' }}>
                            <div style={{ padding: '1rem', backgroundColor: '#f0fdf4', borderRadius: '0.5rem', border: '1px solid #bbf7d0', marginBottom: '1.25rem' }}>
                                <div style={{ fontSize: '0.85rem', color: '#166534' }}>Settling Invoice</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#14532d', margin: '0.2rem 0' }}>
                                    {payingBill.invoiceNo} — LKR {Number(payingBill.totalAmount).toLocaleString()}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: '#166534' }}>
                                    {payingBill.vendor} • {payingBill.totalQty} items
                                </div>
                            </div>

                            <p style={{ fontSize: '0.9rem', color: 'var(--text-light)', marginBottom: '1.25rem' }}>
                                Marking this bill as paid will automatically record an expense of <b>LKR {Number(payingBill.totalAmount).toLocaleString()}</b> under category <b>"Laundry"</b> in your financial accounts.
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
                                    placeholder="e.g. Bank transfer, Cash settlement..."
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
