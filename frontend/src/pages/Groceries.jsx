import { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingBasket, Plus, ChevronLeft, ChevronRight, Pencil, Trash2, X, CheckCircle2, Receipt, ListChecks, Tags, TrendingUp, TrendingDown, EyeOff, Eye, Upload, FileText, Sparkles, AlertTriangle } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ProcessingOverlay, { ButtonSpinner } from '../components/ProcessingOverlay';
import SearchSelect, { focusNext } from '../components/SearchSelect';

export const GROCERY_GROUPS = {
    kitchen: { label: 'Breakfast & Kitchen', color: '#f59e0b' },
    cleaning: { label: 'Cleaning & Laundry', color: '#06b6d4' },
    amenities: { label: 'Guest Amenities', color: '#8b5cf6' },
    gas: { label: 'Gas', color: '#ef4444' },
    other: { label: 'Other', color: '#64748b' }
};
const UNITS = ['pcs', 'kg', 'g', 'L', 'ml', 'pack', 'bottle', 'loaf', 'bunch', 'box', 'cylinder'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthLabel = (key) => `${MONTHS[parseInt(key.slice(5, 7), 10) - 1]} ${key.slice(0, 4)}`;
const shiftMonth = (key, delta) => {
    const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const lkr = (val) => `LKR ${Number(val || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round(n * 100) / 100;
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const readJson = async (res) => {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Server returned an unexpected response (HTTP ${res.status}).${res.status === 404 ? ' The backend may need a restart to pick up new routes.' : ''}`);
    }
};

const modalBackdrop = {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem'
};

// Phone photos are large; shrink them before upload (faster, and cheaper to read)
const shrinkImage = (file) => new Promise((resolve) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 1.5 * 1024 * 1024) return resolve(file);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(b => resolve(b ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
});

// Open a purchase's saved bill in a new tab (the request needs the login token, so fetch it first)
const openSavedBill = async (purchaseId) => {
    const tab = window.open('', '_blank');
    try {
        const res = await fetchWithAuth(`/api/groceries/purchases/${purchaseId}/bill`);
        if (!res.ok) throw new Error((await readJson(res)).error || 'Could not open the bill');
        const url = URL.createObjectURL(await res.blob());
        if (tab) tab.location.href = url; else window.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
        if (tab) tab.close();
        alert(err.message);
    }
};

function GroupBadge({ groupKey }) {
    const g = GROCERY_GROUPS[groupKey] || (groupKey === 'mixed' ? { label: 'Mixed', color: '#475569' } : GROCERY_GROUPS.other);
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.15rem 0.55rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: 600, backgroundColor: `${g.color}1f`, color: g.color, whiteSpace: 'nowrap' }}>
            {g.label}
        </span>
    );
}

// itemId: catalogue id, 'new' (typed name, added to the item list on save) or 'custom' (old line without a catalogue item)
const derivedStyle = { backgroundColor: '#f8fafc', color: 'var(--text-light)' };

// priceFrom: which of unit price / total the user typed; the other one is calculated from it
const emptyLine = () => ({ itemId: '', itemName: '', groupKey: 'kitchen', unit: 'pcs', quantity: '1', unitPrice: '', amount: '', priceFrom: 'unit', addToCatalogue: false, billText: '' });

// Add / edit a purchase: itemised lines, or a single total for small no-bill buys
function PurchaseModal({ purchase, catalogue, onClose, onSaved }) {
    const editing = !!purchase?.id;
    const startItemised = purchase ? purchase.items.length > 0 : true;
    const [mode, setMode] = useState(startItemised ? 'items' : 'total');
    const [form, setForm] = useState({
        date: purchase?.date || today(),
        shop: purchase?.shop || '',
        billNo: purchase?.billNo || '',
        notes: purchase?.notes || '',
        groupKey: purchase && purchase.items.length === 0 ? purchase.groupKey : 'kitchen',
        totalAmount: purchase && purchase.items.length === 0 ? String(purchase.totalAmount) : ''
    });
    const [lines, setLines] = useState(
        purchase && purchase.items.length > 0
            ? purchase.items.map(l => ({
                ...emptyLine(), itemId: l.itemId ? String(l.itemId) : 'custom', itemName: l.itemName, groupKey: l.groupKey || 'other', unit: l.unit || 'pcs',
                quantity: String(l.quantity), unitPrice: String(l.unitPrice), amount: String(l.amount),
                priceFrom: Math.abs(round2(l.quantity * l.unitPrice) - l.amount) > 0.01 ? 'total' : 'unit'
            }))
            : [emptyLine()]
    );
    // Bill file: the one already saved with the purchase, and/or a new upload
    const [bill, setBill] = useState({ saved: !!purchase?.billFileId, removeSaved: false, uploadedId: null, fileName: '' });
    const [reading, setReading] = useState(null); // { count, billTotal, itemsTotalAtRead }
    const [readNote, setReadNote] = useState('');
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef(null);
    const linesRef = useRef(null);
    const [focusLine, setFocusLine] = useState(null); // line whose item box should get focus once drawn
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const catById = useMemo(() => Object.fromEntries(catalogue.map(c => [String(c.id), c])), [catalogue]);
    const itemOptions = useMemo(() => catalogue
        .filter(i => i.active || lines.some(l => String(l.itemId) === String(i.id)))
        .map(i => ({ value: String(i.id), label: i.name, hint: i.unit, group: i.groupKey })), [catalogue, lines]);

    const lineAmount = (l) => round2(Number(l.amount || 0));

    // Qty, unit price and total: typing unit price works out the total, typing the total works out the
    // unit price, and changing qty keeps whichever price the user typed
    const setNumber = (idx, field, value) => setLines(ls => ls.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, [field]: value };
        const qty = Number(field === 'quantity' ? value : l.quantity);
        const calc = (n) => (qty > 0 && n !== '' ? String(n) : '');
        if (field === 'unitPrice') {
            next.priceFrom = 'unit';
            next.amount = calc(value === '' ? '' : round2(qty * Number(value)));
        } else if (field === 'amount') {
            next.priceFrom = 'total';
            next.unitPrice = calc(value === '' ? '' : round2(Number(value) / qty));
        } else if (l.priceFrom === 'total' && l.amount !== '') {
            next.unitPrice = calc(round2(Number(l.amount) / qty));
        } else if (l.unitPrice !== '') {
            next.amount = calc(round2(qty * Number(l.unitPrice)));
        }
        return next;
    }));
    const itemsTotal = lines.reduce((s, l) => s + lineAmount(l), 0);

    const updateLine = (idx, patch) => setLines(ls => ls.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, ...patch };
        const cat = catById[String(patch.itemId)];
        if (cat) Object.assign(next, { itemName: cat.name, groupKey: cat.groupKey, unit: cat.unit, addToCatalogue: false });
        return next;
    }));

    // Add a line and put the cursor in its item box
    const addLine = () => {
        setLines(ls => [...ls, emptyLine()]);
        setFocusLine(lines.length);
    };
    useEffect(() => {
        if (focusLine === null) return;
        linesRef.current?.querySelector(`[data-line="${focusLine}"] input[role="combobox"]`)?.focus();
        setFocusLine(null);
    }, [focusLine, lines.length]);

    // Enter moves on instead of saving. After a price (unit or total) the line is done: Enter goes to the
    // next line's item box, or starts a new line on the last one.
    const onNumberKey = (idx, isPrice) => (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (!isPrice) focusNext(e.target);
        else if (idx === lines.length - 1) addLine();
        else linesRef.current?.querySelector(`[data-line="${idx + 1}"] input[role="combobox"]`)?.focus();
    };

    // A typed name that isn't in the item list becomes a new item (saved to the list with the purchase)
    const createItem = (idx, text) => {
        const prevGroup = lines.slice(0, idx).reverse().find(l => l.itemId)?.groupKey;
        updateLine(idx, { itemId: 'new', itemName: capitalise(text.trim()), groupKey: prevGroup || 'kitchen', unit: 'pcs', addToCatalogue: true });
    };

    const uploadBill = async (file) => {
        if (!file) return;
        setError('');
        setReadNote('');
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', await shrinkImage(file));
            if (editing) fd.append('purchaseId', purchase.id);
            const res = await fetchWithAuth('/api/groceries/parse-bill', { method: 'POST', body: fd });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to upload the bill');
            const { billFileId, reading: r, readError } = json.data;
            setBill(b => ({ ...b, uploadedId: billFileId, fileName: file.name }));
            if (!r) {
                setReadNote(readError || '');
                return;
            }
            setForm(f => ({ ...f, shop: r.shop || f.shop, billNo: r.billNo || f.billNo, date: r.date || f.date }));
            if (r.items.length > 0) {
                const newLines = r.items.map(it => {
                    const cat = it.catalogueId ? catById[String(it.catalogueId)] : null;
                    const prices = { quantity: String(it.quantity), unitPrice: String(round2(it.lineTotal / it.quantity)), amount: String(it.lineTotal), priceFrom: 'total' };
                    return cat
                        ? { ...emptyLine(), itemId: String(cat.id), itemName: cat.name, groupKey: cat.groupKey, unit: cat.unit, ...prices, billText: it.billText }
                        : { ...emptyLine(), itemId: 'new', itemName: it.name, groupKey: it.groupKey, unit: it.unit, ...prices, addToCatalogue: true, billText: it.billText };
                });
                setLines(newLines);
                setMode('items');
                setReading({ count: newLines.length, newCount: newLines.filter(l => l.itemId === 'new').length, billTotal: r.billTotal });
            } else if (r.billTotal > 0) {
                setMode('total');
                setForm(f => ({ ...f, totalAmount: String(r.billTotal) }));
                setReadNote('No item lines could be read, so the bill total was filled in.');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const save = async (e) => {
        e.preventDefault();
        if (saving) return;
        setError('');
        const body = { date: form.date, shop: form.shop, billNo: form.billNo, notes: form.notes };
        if (mode === 'items') {
            const filled = lines.filter(l => l.itemId);
            if (filled.length === 0) return setError('Add at least one item.');
            const missing = filled.find(l => !(lineAmount(l) > 0) || (!catById[l.itemId] && !l.itemName.trim()));
            if (missing) return setError('Each item needs a name, quantity and a unit price or total.');
            // The total is sent as entered, so e.g. 3 for LKR 1,000 stays 1,000 (unit price 333.33)
            const prices = (l) => ({ quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), amount: lineAmount(l) });
            body.items = filled.map(l => catById[l.itemId]
                ? { itemId: Number(l.itemId), ...prices(l) }
                : { itemName: l.itemName.trim(), groupKey: l.groupKey, unit: l.unit, ...prices(l), addToCatalogue: l.addToCatalogue });
        } else {
            if (!(Number(form.totalAmount) > 0)) return setError('Enter the total amount.');
            body.groupKey = form.groupKey;
            body.totalAmount = Number(form.totalAmount);
        }
        if (bill.uploadedId) body.billFileId = bill.uploadedId;
        else if (bill.removeSaved) body.removeBill = true;
        setSaving(true);
        try {
            const res = await fetchWithAuth(editing ? `/api/groceries/purchases/${purchase.id}` : '/api/groceries/purchases', {
                method: editing ? 'PUT' : 'POST',
                body: JSON.stringify(body)
            });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to save purchase');
            onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const total = mode === 'items' ? itemsTotal : Number(form.totalAmount || 0);
    const billMismatch = reading && reading.billTotal > 0 && mode === 'items' && Math.abs(reading.billTotal - itemsTotal) >= 1;
    const hasBill = bill.uploadedId || (bill.saved && !bill.removeSaved);

    return (
        <div className="modal-backdrop" style={modalBackdrop}>
            <ProcessingOverlay show={uploading} message="Reading the bill... this can take up to a minute" />
            <form onSubmit={save} className="card animate-slide-up" style={{ width: '100%', maxWidth: '760px', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Receipt size={19} className="text-primary" /> {editing ? 'Edit Purchase' : 'New Purchase'}
                    </h3>
                    <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}><X size={20} /></button>
                </div>

                <div style={{ padding: '1.25rem 1.5rem', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                    {/* Bill upload */}
                    <div style={{ border: '1px dashed #a5b4fc', backgroundColor: '#f5f7ff', borderRadius: '0.6rem', padding: '0.75rem 0.9rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={e => uploadBill(e.target.files[0])} />
                        {hasBill ? (
                            <>
                                <FileText size={20} style={{ color: 'var(--primary)' }} />
                                <span style={{ flex: 1, minWidth: '160px', fontSize: '0.88rem' }}>
                                    <b>Bill attached</b>{bill.fileName ? ` · ${bill.fileName}` : ''}
                                    {bill.saved && !bill.uploadedId && <> · <button type="button" onClick={() => openSavedBill(purchase.id)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit' }}>view</button></>}
                                </span>
                                <button type="button" className="btn" onClick={() => fileRef.current?.click()} style={{ padding: '0.35rem 0.7rem', fontSize: '0.82rem', border: '1px solid var(--border)', backgroundColor: 'white' }}><Upload size={14} /> Replace</button>
                                <button type="button" className="btn" onClick={() => { setBill(b => ({ ...b, uploadedId: null, fileName: '', removeSaved: b.saved })); setReading(null); setReadNote(''); }} style={{ padding: '0.35rem 0.7rem', fontSize: '0.82rem', border: 'none', backgroundColor: '#fee2e2', color: '#b91c1c' }}><X size={14} /> Remove</button>
                            </>
                        ) : (
                            <>
                                <Sparkles size={20} style={{ color: 'var(--primary)' }} />
                                <span style={{ flex: 1, minWidth: '160px', fontSize: '0.88rem' }}>
                                    <b>Have the bill?</b> Upload a photo or PDF and the items will be filled in for you to check.
                                </span>
                                <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading} style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}><Upload size={15} /> Upload bill</button>
                            </>
                        )}
                    </div>
                    {reading && (
                        <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', backgroundColor: '#ecfdf5', color: '#065f46', fontSize: '0.85rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                            <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                            <span>
                                Read {reading.count} item(s) from the bill{reading.newCount > 0 ? `, ${reading.newCount} of them new (marked New, will be added to the item list)` : ''}. Please check names, quantities and prices before saving.
                                {reading.billTotal > 0 && <> Bill total: <b>{lkr(reading.billTotal)}</b>.</>}
                            </span>
                        </div>
                    )}
                    {billMismatch && (
                        <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', backgroundColor: '#fffbeb', color: '#92400e', fontSize: '0.85rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                            <span>The items add up to <b>{lkr(itemsTotal)}</b> but the bill total is <b>{lkr(reading.billTotal)}</b>. There may be a discount, or a line was missed or misread.</span>
                        </div>
                    )}
                    {readNote && <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', backgroundColor: '#f1f5f9', color: '#334155', fontSize: '0.85rem' }}>{readNote}</div>}

                    <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr', gap: '0.75rem' }}>
                        <div className="form-group">
                            <label className="form-label">Date *</label>
                            <input type="date" className="form-control" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Shop</label>
                            <input type="text" className="form-control" placeholder="e.g. Keells, local shop" value={form.shop} onChange={e => setForm({ ...form, shop: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Bill no. (optional)</label>
                            <input type="text" className="form-control" value={form.billNo} onChange={e => setForm({ ...form, billNo: e.target.value })} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', margin: '0.25rem 0 1rem' }}>
                        {[['items', 'Itemised'], ['total', 'Total only (no bill)']].map(([m, label]) => (
                            <button key={m} type="button" className="btn" onClick={() => setMode(m)} style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem', border: `1px solid ${mode === m ? 'var(--primary)' : 'var(--border)'}`, backgroundColor: mode === m ? '#eef2ff' : 'white', color: mode === m ? 'var(--primary)' : 'var(--text-light)' }}>
                                {label}
                            </button>
                        ))}
                    </div>

                    {mode === 'items' ? (
                        <div ref={linesRef}>
                            <div className="hide-on-mobile" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 80px 110px 110px 32px', gap: '0.5rem', padding: '0 0.65rem 0.3rem', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase' }}>
                                <span>Item</span><span>Qty</span><span>Unit price</span><span>Total</span><span />
                            </div>
                            {lines.map((l, idx) => {
                                const cat = catById[l.itemId];
                                const isNew = l.itemId && !cat;
                                return (
                                    <div key={idx} data-line={idx} style={{ border: `1px solid ${isNew ? '#c7d2fe' : 'var(--border)'}`, borderRadius: '0.5rem', padding: '0.6rem', marginBottom: '0.5rem' }}>
                                        {/* Fields are in typing order (item, new-item details, qty, price); the grid draws the details on a second row */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 80px 110px 110px 32px', gap: '0.5rem', alignItems: 'center' }} className="stack-on-mobile">
                                            <SearchSelect
                                                options={itemOptions}
                                                groups={GROCERY_GROUPS}
                                                value={l.itemId}
                                                selectedLabel={cat ? `${cat.name} (${cat.unit})` : l.itemName}
                                                placeholder="Type an item, e.g. sugar"
                                                onSelect={o => updateLine(idx, { itemId: o.value })}
                                                onCreate={text => createItem(idx, text)}
                                                createLabel={text => `Add "${capitalise(text)}" as a new item`}
                                                inputStyle={{ padding: '0.45rem 1.8rem 0.45rem 0.45rem' }}
                                            />
                                            {isNew && (
                                                <div style={{ gridColumn: '1 / -1', gridRow: 2 }}>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 2fr 1.3fr 0.9fr', gap: '0.5rem', alignItems: 'center' }} className="stack-on-mobile">
                                                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--primary)', backgroundColor: '#eef2ff', padding: '0.15rem 0.5rem', borderRadius: '1rem', textTransform: 'uppercase', justifySelf: 'start' }}>New</span>
                                                        {/* Name was just typed in the item box, so Tab skips it; click to correct it */}
                                                        <input type="text" tabIndex={-1} className="form-control" placeholder="Item name" value={l.itemName} onChange={e => updateLine(idx, { itemName: e.target.value })} style={{ padding: '0.4rem' }} />
                                                        <select className="form-control" value={l.groupKey} onChange={e => updateLine(idx, { groupKey: e.target.value })} style={{ padding: '0.4rem' }} title="Group">
                                                            {Object.entries(GROCERY_GROUPS).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}
                                                        </select>
                                                        <select className="form-control" value={l.unit} onChange={e => updateLine(idx, { unit: e.target.value })} style={{ padding: '0.4rem' }} title="Unit">
                                                            {[...new Set([...UNITS, l.unit])].map(u => <option key={u} value={u}>{u}</option>)}
                                                        </select>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--text-light)' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                                                            <input type="checkbox" tabIndex={-1} checked={l.addToCatalogue} onChange={e => updateLine(idx, { addToCatalogue: e.target.checked })} />
                                                            Add to the item list for next time
                                                        </label>
                                                        {l.billText && <span title="As printed on the bill">Bill: {l.billText}</span>}
                                                    </div>
                                                </div>
                                            )}
                                            <input type="number" step="any" min="0" className="form-control" placeholder="Qty" aria-label="Quantity" value={l.quantity} onChange={e => setNumber(idx, 'quantity', e.target.value)} onFocus={e => e.target.select()} onKeyDown={onNumberKey(idx, false)} style={{ padding: '0.45rem' }} />
                                            {/* Whichever of the two prices was worked out is shown in grey */}
                                            <input type="number" step="any" min="0" className="form-control" placeholder="Unit price" aria-label="Unit price" value={l.unitPrice} onChange={e => setNumber(idx, 'unitPrice', e.target.value)} onFocus={e => e.target.select()} onKeyDown={onNumberKey(idx, true)}
                                                title="Price for one. The total is worked out." style={{ padding: '0.45rem', ...(l.priceFrom === 'total' && l.unitPrice ? derivedStyle : {}) }} />
                                            <input type="number" step="any" min="0" className="form-control" placeholder="Total" aria-label="Line total" value={l.amount} onChange={e => setNumber(idx, 'amount', e.target.value)} onFocus={e => e.target.select()} onKeyDown={onNumberKey(idx, true)}
                                                title="Total for this line. The unit price is worked out." style={{ padding: '0.45rem', fontWeight: 700, ...(l.priceFrom === 'unit' && l.amount ? derivedStyle : {}) }} />
                                            <button type="button" tabIndex={-1} onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, i) => i !== idx) : [emptyLine()])} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer' }} title="Remove line"><X size={16} /></button>
                                        </div>
                                        {!isNew && l.billText && <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: 'var(--text-light)' }}>Bill: {l.billText}</div>}
                                    </div>
                                );
                            })}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <button type="button" className="btn" onClick={addLine} style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', border: '1px dashed var(--border)', backgroundColor: 'white' }}>
                                    <Plus size={14} /> Add item
                                </button>
                                <span className="hide-on-mobile" style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>Enter a unit price <i>or</i> a total; the other is worked out · Tab picks the highlighted item · Enter after a price goes to the next line</span>
                            </div>
                        </div>
                    ) : (
                        <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <div className="form-group">
                                <label className="form-label">Group *</label>
                                <select className="form-control" value={form.groupKey} onChange={e => setForm({ ...form, groupKey: e.target.value })}>
                                    {Object.entries(GROCERY_GROUPS).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Total amount (LKR) *</label>
                                <input type="number" step="any" min="0" className="form-control" value={form.totalAmount} onChange={e => setForm({ ...form, totalAmount: e.target.value })} />
                            </div>
                        </div>
                    )}

                    <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                        <label className="form-label">Notes (optional)</label>
                        <input type="text" className="form-control" placeholder={mode === 'total' ? 'e.g. bread, bananas, coconut' : ''} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                    </div>

                    {error && <div style={{ marginTop: '0.9rem', padding: '0.6rem 0.75rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', fontSize: '0.85rem' }}>{error}</div>}
                </div>

                <div style={{ padding: '0.9rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', backgroundColor: '#f8fafc', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                        Total <b style={{ fontSize: '1.1rem', color: 'var(--text)' }}>{lkr(total)}</b> · added to Financials as <b>Supplies</b>
                    </div>
                    <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <button type="button" className="btn" onClick={onClose} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving || uploading}>
                            {saving ? <ButtonSpinner /> : <CheckCircle2 size={16} />} {saving ? 'Saving...' : editing ? 'Save Changes' : 'Save Purchase'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}

// Add / edit a catalogue item
function ItemModal({ item, onClose, onSaved }) {
    const [form, setForm] = useState({ name: item?.name || '', groupKey: item?.groupKey || 'kitchen', unit: item?.unit || 'pcs' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const save = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) return setError('Enter a name.');
        setSaving(true);
        try {
            const res = await fetchWithAuth(item ? `/api/groceries/items/${item.id}` : '/api/groceries/items', { method: item ? 'PUT' : 'POST', body: JSON.stringify(form) });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to save item');
            onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <div className="modal-backdrop" style={modalBackdrop}>
            <form onSubmit={save} className="card animate-slide-up" style={{ width: '100%', maxWidth: '420px' }}>
                <h3 style={{ margin: '0 0 1rem 0' }}>{item ? 'Edit Item' : 'Add Item'}</h3>
                <div className="form-group">
                    <label className="form-label">Name *</label>
                    <input type="text" className="form-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
                </div>
                <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group">
                        <label className="form-label">Group</label>
                        <select className="form-control" value={form.groupKey} onChange={e => setForm({ ...form, groupKey: e.target.value })}>
                            {Object.entries(GROCERY_GROUPS).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}
                        </select>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Unit</label>
                        <select className="form-control" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                            {[...new Set([...UNITS, form.unit])].map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                    </div>
                </div>
                {error && <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.75rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', fontSize: '0.85rem' }}>{error}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                    <button type="button" className="btn" onClick={onClose} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <ButtonSpinner /> : <CheckCircle2 size={16} />} Save</button>
                </div>
            </form>
        </div>
    );
}

export default function Groceries() {
    const [month, setMonth] = useState(today().slice(0, 7));
    const [tab, setTab] = useState('purchases'); // purchases | items | catalogue
    const [purchases, setPurchases] = useState([]);
    const [summary, setSummary] = useState(null);
    const [catalogue, setCatalogue] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingPurchase, setEditingPurchase] = useState(null); // {} for new
    const [editingItem, setEditingItem] = useState(null); // {} for new
    const [busy, setBusy] = useState(false);
    const [groupFilter, setGroupFilter] = useState('ALL');

    const load = async (forMonth = month) => {
        try {
            setLoading(true);
            const [pRes, sRes, cRes] = await Promise.all([
                fetchWithAuth(`/api/groceries/purchases?month=${forMonth}`),
                fetchWithAuth(`/api/groceries/summary?month=${forMonth}`),
                fetchWithAuth('/api/groceries/items')
            ]);
            const [p, s, c] = await Promise.all([readJson(pRes), readJson(sRes), readJson(cRes)]);
            setPurchases(p.data || []);
            setSummary(s.data || null);
            setCatalogue(c.data || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(month); }, [month]);

    const visiblePurchases = useMemo(() => groupFilter === 'ALL' ? purchases : purchases.filter(p =>
        p.items.length > 0 ? p.items.some(l => l.groupKey === groupFilter) : p.groupKey === groupFilter), [purchases, groupFilter]);

    const deletePurchase = async (p) => {
        if (!window.confirm(`Delete this purchase of ${lkr(p.totalAmount)}${p.shop ? ` at ${p.shop}` : ''}? Its expense will also be removed.`)) return;
        setBusy(true);
        try {
            const res = await fetchWithAuth(`/api/groceries/purchases/${p.id}`, { method: 'DELETE' });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to delete');
            await load();
        } catch (err) {
            alert(err.message);
        } finally {
            setBusy(false);
        }
    };

    const toggleItemActive = async (item) => {
        try {
            const res = item.active
                ? await fetchWithAuth(`/api/groceries/items/${item.id}`, { method: 'DELETE' })
                : await fetchWithAuth(`/api/groceries/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ active: true }) });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to update item');
            await load();
        } catch (err) {
            alert(err.message);
        }
    };

    const change = summary && summary.prevTotal > 0 ? Math.round(((summary.total - summary.prevTotal) / summary.prevTotal) * 100) : null;
    const tabs = [
        ['purchases', `Purchases (${purchases.length})`, Receipt],
        ['items', 'Spend by item', ListChecks],
        ['catalogue', `Item list (${catalogue.filter(i => i.active).length})`, Tags]
    ];

    return (
        <div className="animate-slide-up" style={{ paddingBottom: '3rem' }}>
            <ProcessingOverlay show={busy} message="Deleting purchase..." />

            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <ShoppingBasket className="text-primary" size={28} /> Groceries & Supplies
                    </h1>
                    <p style={{ color: 'var(--text-light)', marginTop: '0.25rem', fontSize: '0.95rem' }}>
                        Daily purchases for breakfast, cleaning, guest amenities and gas. Each purchase is added to Financials as Supplies.
                    </p>
                </div>
                <button className="btn btn-primary" onClick={() => setEditingPurchase({})}><Plus size={18} /> New Purchase</button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => setMonth(m => shiftMonth(m, -1))} style={{ padding: '0.5rem', border: '1px solid var(--border)', backgroundColor: 'white' }}><ChevronLeft size={18} /></button>
                <input type="month" className="form-control" value={month} onChange={e => e.target.value && setMonth(e.target.value)} style={{ width: 'auto', fontWeight: 600 }} />
                <button className="btn" onClick={() => setMonth(m => shiftMonth(m, 1))} style={{ padding: '0.5rem', border: '1px solid var(--border)', backgroundColor: 'white' }}><ChevronRight size={18} /></button>
            </div>

            {/* Month summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="card" style={{ padding: '1rem 1.15rem', borderLeft: '4px solid var(--primary)' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase' }}>Total · {monthLabel(month)}</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.25rem 0' }}>{lkr(summary?.total)}</div>
                    {change !== null && (
                        <div style={{ fontSize: '0.8rem', color: change > 0 ? '#b91c1c' : 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            {change > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {Math.abs(change)}% vs {monthLabel(shiftMonth(month, -1))}
                        </div>
                    )}
                </div>
                {(summary?.groups || []).map(g => (
                    <button key={g.groupKey} className="card" onClick={() => { setGroupFilter(f => f === g.groupKey ? 'ALL' : g.groupKey); setTab('purchases'); }} style={{ padding: '1rem 1.15rem', borderLeft: `4px solid ${GROCERY_GROUPS[g.groupKey].color}`, textAlign: 'left', cursor: 'pointer', outline: groupFilter === g.groupKey ? `2px solid ${GROCERY_GROUPS[g.groupKey].color}` : 'none' }} title="Show purchases in this group">
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase' }}>{g.label}</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '0.25rem', color: g.total > 0 ? 'var(--text)' : 'var(--text-light)' }}>{lkr(g.total)}</div>
                    </button>
                ))}
            </div>

            <div className="tab-bar" style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid var(--border)', marginBottom: '1.25rem' }}>
                {tabs.map(([id, label, Icon]) => (
                    <button key={id} onClick={() => setTab(id)} style={{ padding: '0.65rem 1rem', fontWeight: 600, backgroundColor: 'transparent', border: 'none', borderBottom: tab === id ? '3px solid var(--primary)' : '3px solid transparent', color: tab === id ? 'var(--primary)' : 'var(--text-light)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '-2px' }}>
                        <Icon size={16} /> {label}
                    </button>
                ))}
            </div>

            {tab === 'purchases' && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {groupFilter !== 'ALL' && (
                        <div style={{ padding: '0.6rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            Showing <GroupBadge groupKey={groupFilter} /> <button className="btn" onClick={() => setGroupFilter('ALL')} style={{ padding: '0.15rem 0.5rem', fontSize: '0.78rem', border: '1px solid var(--border)', backgroundColor: 'white' }}>Show all</button>
                        </div>
                    )}
                    <div style={{ overflowX: 'auto' }}>
                        <table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '720px' }}>
                            <thead>
                                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)', color: 'var(--text-light)', fontSize: '0.82rem', textTransform: 'uppercase' }}>
                                    <th style={{ padding: '0.85rem 1rem' }}>Date / Shop</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Group</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Items</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Amount</th>
                                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={5} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-light)' }}>Loading...</td></tr>
                                ) : visiblePurchases.length === 0 ? (
                                    <tr><td colSpan={5} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-light)' }}>No purchases recorded for {monthLabel(month)}.</td></tr>
                                ) : visiblePurchases.map(p => (
                                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.92rem' }}>
                                        <td className="cell-title" style={{ padding: '0.85rem 1rem' }}>
                                            <div style={{ fontWeight: 600 }}>{p.shop || 'Purchase'}</div>
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>{p.date}{p.billNo ? ` · Bill ${p.billNo}` : p.billFileId ? '' : ' · no bill'}</div>
                                        </td>
                                        <td data-label="Group" style={{ padding: '0.85rem 1rem' }}>
                                            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                                                {(p.items.length > 0 ? [...new Set(p.items.map(l => l.groupKey))] : [p.groupKey]).map(g => <GroupBadge key={g} groupKey={g} />)}
                                            </div>
                                        </td>
                                        <td data-label="Items" style={{ padding: '0.85rem 1rem', fontSize: '0.85rem', color: 'var(--text-light)', maxWidth: '320px' }}>
                                            {p.items.length > 0 ? p.items.map(l => `${l.itemName} ${Number(l.quantity)}${l.unit && l.unit !== 'pcs' ? ` ${l.unit}` : ''}`).join(', ') : (p.notes || 'Total only')}
                                        </td>
                                        <td data-label="Amount" style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>{lkr(p.totalAmount)}</td>
                                        <td className="cell-actions" style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                                                {p.billFileId && <button className="btn" onClick={() => openSavedBill(p.id)} style={{ padding: '0.35rem', border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--primary)' }} title="View bill"><FileText size={15} /></button>}
                                                <button className="btn" onClick={() => setEditingPurchase(p)} style={{ padding: '0.35rem', border: '1px solid var(--border)', backgroundColor: 'white' }} title="Edit"><Pencil size={15} /></button>
                                                <button className="btn" onClick={() => deletePurchase(p)} style={{ padding: '0.35rem', border: 'none', backgroundColor: '#fee2e2', color: '#b91c1c' }} title="Delete"><Trash2 size={15} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {tab === 'items' && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '640px' }}>
                            <thead>
                                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)', color: 'var(--text-light)', fontSize: '0.82rem', textTransform: 'uppercase' }}>
                                    <th style={{ padding: '0.85rem 1rem' }}>Item</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Bought</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Spent</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Avg price</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>vs last month</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(summary?.items || []).length === 0 ? (
                                    <tr><td colSpan={5} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-light)' }}>No itemised purchases in {monthLabel(month)}. Total-only purchases count in the group totals above.</td></tr>
                                ) : summary.items.map(i => {
                                    const diff = i.prevAvgPrice ? Math.round(((i.avgPrice - i.prevAvgPrice) / i.prevAvgPrice) * 100) : null;
                                    return (
                                        <tr key={`${i.itemId}-${i.itemName}`} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.92rem' }}>
                                            <td className="cell-title" style={{ padding: '0.8rem 1rem' }}>
                                                <div style={{ fontWeight: 600 }}>{i.itemName}</div>
                                                <div><GroupBadge groupKey={i.groupKey} /></div>
                                            </td>
                                            <td data-label="Bought" style={{ padding: '0.8rem 1rem' }}>{Number(i.quantity).toLocaleString()} {i.unit} <span style={{ color: 'var(--text-light)', fontSize: '0.8rem' }}>({i.purchases}×)</span></td>
                                            <td data-label="Spent" style={{ padding: '0.8rem 1rem', fontWeight: 700 }}>{lkr(i.total)}</td>
                                            <td data-label="Avg price" style={{ padding: '0.8rem 1rem' }}>{i.avgPrice !== null ? `${lkr(i.avgPrice)} / ${i.unit}` : '-'}</td>
                                            <td data-label="vs last month" style={{ padding: '0.8rem 1rem' }}>
                                                {diff === null ? <span style={{ color: 'var(--text-light)' }}>-</span> : diff === 0 ? 'Same price' : (
                                                    <span style={{ color: diff > 0 ? '#b91c1c' : 'var(--success)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                                        {diff > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {diff > 0 ? '+' : ''}{diff}% (was {lkr(i.prevAvgPrice)})
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {tab === 'catalogue' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.88rem', color: 'var(--text-light)' }}>Items you buy regularly, shown in the purchase form. New items typed in a purchase are added here too. Hidden items stay on old purchases.</span>
                        <button className="btn" onClick={() => setEditingItem({})} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}><Plus size={16} /> Add Item</button>
                    </div>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        {Object.entries(GROCERY_GROUPS).map(([g, meta]) => {
                            const items = catalogue.filter(i => i.groupKey === g);
                            if (items.length === 0) return null;
                            return (
                                <div key={g}>
                                    <div style={{ padding: '0.55rem 1rem', backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: '0.82rem', color: meta.color, textTransform: 'uppercase' }}>{meta.label}</div>
                                    {items.map(i => (
                                        <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 1rem', borderBottom: '1px solid var(--border)', opacity: i.active ? 1 : 0.5 }}>
                                            <span style={{ flex: 1, fontWeight: 500 }}>{i.name}{!i.active && <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}> (hidden)</span>}</span>
                                            <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{i.unit}</span>
                                            <button className="btn" onClick={() => setEditingItem(i)} style={{ padding: '0.3rem', border: '1px solid var(--border)', backgroundColor: 'white' }} title="Edit"><Pencil size={14} /></button>
                                            <button className="btn" onClick={() => toggleItemActive(i)} style={{ padding: '0.3rem', border: '1px solid var(--border)', backgroundColor: 'white' }} title={i.active ? 'Hide (or delete if never used)' : 'Show again'}>
                                                {i.active ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {editingPurchase && (
                <PurchaseModal
                    purchase={editingPurchase.id ? editingPurchase : null}
                    catalogue={catalogue}
                    onClose={() => setEditingPurchase(null)}
                    onSaved={async () => {
                        const saved = editingPurchase;
                        setEditingPurchase(null);
                        await load();
                        if (!saved.id) setTab('purchases');
                    }}
                />
            )}
            {editingItem && (
                <ItemModal item={editingItem.id ? editingItem : null} onClose={() => setEditingItem(null)} onSaved={async () => { setEditingItem(null); await load(); }} />
            )}
        </div>
    );
}
