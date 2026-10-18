import { useState, useEffect, useMemo } from 'react';
import { Boxes, Plus, Search, Pencil, Trash2, X, CheckCircle2, Wrench, ShieldCheck, AlertCircle, ListPlus, Layers, History, Save } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { notifyDataChanged } from '../utils/notifications';
import ProcessingOverlay, { ButtonSpinner } from '../components/ProcessingOverlay';
import SearchSelect from '../components/SearchSelect';

const CATEGORIES = {
    appliance: { label: 'Appliances', color: '#2563eb' },
    kitchenware: { label: 'Kitchenware', color: '#f59e0b' },
    gas: { label: 'Gas', color: '#ef4444' },
    furniture: { label: 'Furniture', color: '#8b5cf6' },
    linen: { label: 'Linen', color: '#06b6d4' },
    other: { label: 'Other', color: '#64748b' }
};
const CONDITIONS = {
    working: { label: 'Working', bg: '#dcfce7', fg: '#15803d' },
    needs_repair: { label: 'Needs repair', bg: '#fef3c7', fg: '#b45309' },
    broken: { label: 'Broken', bg: '#fee2e2', fg: '#b91c1c' },
    disposed: { label: 'Disposed', bg: '#f1f5f9', fg: '#64748b' }
};
const SERVICE_TYPES = { service: 'Service', repair: 'Repair', part: 'Part replaced' };

// Suggestions for the item name: [name, category, service interval in months]
const COMMON_ITEMS = [
    ['Air conditioner', 'appliance', 6], ['Fridge', 'appliance', null], ['Hot water machine', 'appliance', 12], ['Solar hot water system', 'appliance', 12],
    ['Kettle', 'appliance', null], ['Cooker hob', 'appliance', null], ['Microwave', 'appliance', null], ['Rice cooker', 'appliance', null],
    ['Blender', 'appliance', null], ['Toaster', 'appliance', null], ['Coffee maker', 'appliance', null], ['Washing machine', 'appliance', 12],
    ['Iron', 'appliance', null], ['Hair dryer', 'appliance', null], ['Ceiling fan', 'appliance', null], ['Standing fan', 'appliance', null],
    ['TV', 'appliance', null], ['Mosquito repellent machine', 'appliance', null], ['Water pump', 'appliance', 12], ['Water filter', 'appliance', 6],
    ['Generator', 'appliance', 6], ['Vacuum cleaner', 'appliance', null], ['Wi-Fi router', 'appliance', null], ['CCTV camera', 'appliance', null],
    ['Inverter / UPS', 'appliance', 12], ['Electric oven', 'appliance', null],
    ['Gas cylinder', 'gas', null], ['Gas regulator', 'gas', 12],
    ['Plates', 'kitchenware', null], ['Bowls', 'kitchenware', null], ['Cups & saucers', 'kitchenware', null], ['Mugs', 'kitchenware', null],
    ['Glasses', 'kitchenware', null], ['Spoons', 'kitchenware', null], ['Forks', 'kitchenware', null], ['Butter knives', 'kitchenware', null],
    ['Knives', 'kitchenware', null], ['Cooking pots', 'kitchenware', null], ['Frying pan', 'kitchenware', null], ['Chopping board', 'kitchenware', null],
    ['Serving trays', 'kitchenware', null], ['Jugs', 'kitchenware', null],
    ['Bed', 'furniture', null], ['Mattress', 'furniture', null], ['Wardrobe', 'furniture', null], ['Bedside table', 'furniture', null],
    ['Dining table', 'furniture', null], ['Chairs', 'furniture', null], ['Sun loungers', 'furniture', null], ['Sofa', 'furniture', null], ['Mirror', 'furniture', null],
    ['Bed sheets', 'linen', null], ['Pillows', 'linen', null], ['Pillow cases', 'linen', null], ['Duvet', 'linen', null],
    ['Bath towels', 'linen', null], ['Hand towels', 'linen', null], ['Pool towels', 'linen', null], ['Curtains', 'linen', null], ['Bath mats', 'linen', null],
    ['Fire extinguisher', 'other', 12], ['First aid kit', 'other', 6], ['Safe box', 'other', null], ['Bicycle', 'other', 6]
];

// Common replaceable parts by kind of item; the first ones are shown as columns in the parts grid
const PART_SETS = [
    [/air ?con|a\/c|\bac\b/i, ['Compressor', 'Condenser', 'Fan motor', 'Capacitor', 'PCB / control board', 'Gas top-up', 'Filter', 'Remote', 'Evaporator coil']],
    [/fridge|freezer|refrigerator/i, ['Compressor', 'Thermostat', 'Door seal', 'Gas top-up', 'Fan motor', 'Relay']],
    [/hot water|heater|solar/i, ['Heating element', 'Thermostat', 'Pressure valve', 'Pump', 'Tank']],
    [/pump|generator|washing/i, ['Motor', 'Capacitor', 'Pressure switch', 'Belt', 'Control board']],
    [/fan/i, ['Motor', 'Capacitor', 'Regulator', 'Blades']],
    [/.*/, ['Motor', 'Switch', 'Power cord', 'Remote', 'Battery']]
];
const partsFor = (name) => (PART_SETS.find(([re]) => re.test(name || '')) || PART_SETS[PART_SETS.length - 1])[1];
const defaultPartColumns = (name) => /air ?con|a\/c|\bac\b/i.test(name || '') ? partsFor(name).slice(0, 3) : /fridge|freezer|refrigerator/i.test(name || '') ? partsFor(name).slice(0, 2) : [];

const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const lkr = (val) => `LKR ${Number(val || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '';

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

const Pill = ({ bg, fg, children }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.15rem 0.55rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: 600, backgroundColor: bg, color: fg, whiteSpace: 'nowrap' }}>{children}</span>
);

const emptyItem = { name: '', category: 'appliance', quantity: '1', location: '', purchaseDate: '', purchaseCost: '', supplier: '', billNo: '', warrantyUntil: '', condition: 'working', serviceIntervalMonths: '', notes: '' };

function ItemModal({ item, allItems, onClose, onSaved }) {
    const editing = !!item?.id;
    const [form, setForm] = useState(() => {
        if (!editing) return { ...emptyItem };
        const f = { ...emptyItem };
        Object.keys(emptyItem).forEach(k => { if (item[k] !== null && item[k] !== undefined) f[k] = String(item[k]); });
        return f;
    });
    const hasExpense = editing && !!item.expenseId;
    const unitsTracked = editing && item.unitCount > 0;
    const [recordExpense, setRecordExpense] = useState(!editing);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
    const cost = Number(form.purchaseCost || 0);

    // Name suggestions: what's already in the inventory, then common villa items
    const nameOptions = useMemo(() => {
        const owned = allItems.filter(i => !editing || i.id !== item.id);
        const ownedNames = new Set(owned.map(i => i.name.toLowerCase()));
        return [
            ...owned.map(i => ({ value: `own-${i.id}`, label: i.name, hint: `already have ${i.quantity}${i.location ? ` · ${i.location}` : ''}`, group: i.category, own: i })),
            ...COMMON_ITEMS.filter(([n]) => !ownedNames.has(n.toLowerCase())).map(([n, c, interval]) => ({ value: `common-${n}`, label: n, group: c, category: c, interval }))
        ];
    }, [allItems, editing, item]);
    const duplicate = allItems.find(i => i.name.toLowerCase() === form.name.trim().toLowerCase() && (!editing || i.id !== item.id));

    const pickName = (o) => {
        if (o.own) return setForm(f => ({ ...f, name: o.own.name, category: o.own.category }));
        setForm(f => ({ ...f, name: o.label, category: o.category, serviceIntervalMonths: f.serviceIntervalMonths || (o.interval ? String(o.interval) : '') }));
    };

    const save = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) return setError('Enter the item name.');
        if (recordExpense && !hasExpense && cost > 0 && !form.purchaseDate) return setError('Enter the purchase date to record the cost as an expense.');
        setSaving(true);
        setError('');
        try {
            const body = { ...form, name: form.name.trim(), recordExpense: !hasExpense && recordExpense && cost > 0 };
            const res = await fetchWithAuth(editing ? `/api/inventory/${item.id}` : '/api/inventory', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(body) });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to save item');
            notifyDataChanged();
            onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-backdrop" style={modalBackdrop}>
            <form onSubmit={save} className="card animate-slide-up" style={{ width: '100%', maxWidth: '640px', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0 }}>{editing ? 'Edit Item' : 'Add Inventory Item'}</h3>
                    <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}><X size={20} /></button>
                </div>
                <div style={{ padding: '1.25rem 1.5rem', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                    <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.8fr', gap: '0.75rem' }}>
                        <div className="form-group">
                            <label className="form-label">Item *</label>
                            <SearchSelect
                                freeText
                                text={form.name}
                                onTextChange={v => setForm(f => ({ ...f, name: v }))}
                                options={nameOptions}
                                groups={CATEGORIES}
                                onSelect={pickName}
                                onCreate={() => {}}
                                createLabel={t => `Use "${t}" as a new item`}
                                placeholder="Type, e.g. air conditioner"
                                autoFocus={!editing}
                            />
                            {duplicate && <div style={{ fontSize: '0.78rem', color: '#b45309', marginTop: '0.25rem' }}>You already have "{duplicate.name}" (x{duplicate.quantity}). To add more, edit that item's quantity instead.</div>}
                        </div>
                        <div className="form-group"><label className="form-label">Category</label>
                            <select className="form-control" value={form.category} onChange={set('category')}>{Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Quantity</label>
                            <input type="number" min="0" className="form-control" value={form.quantity} onChange={set('quantity')} disabled={unitsTracked} title={unitsTracked ? 'Follows the number of units' : ''} />
                            {unitsTracked && <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.2rem' }}>Follows the {item.unitCount} unit(s)</div>}
                        </div>
                    </div>
                    <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '0.75rem' }}>
                        <div className="form-group"><label className="form-label">Location</label><input className="form-control" value={form.location} onChange={set('location')} placeholder={unitsTracked ? 'Rooms are set per unit' : 'e.g. Standard 1, Kitchen, All rooms'} /></div>
                        <div className="form-group"><label className="form-label">Condition</label>
                            <select className="form-control" value={form.condition} onChange={set('condition')}>{Object.entries(CONDITIONS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select>
                        </div>
                    </div>

                    <h4 style={{ margin: '0.5rem 0 0.75rem', fontSize: '0.95rem' }}>Purchase</h4>
                    <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                        <div className="form-group"><label className="form-label">Purchase date</label><input type="date" className="form-control" value={form.purchaseDate} onChange={set('purchaseDate')} /></div>
                        <div className="form-group"><label className="form-label">Total cost (LKR)</label><input type="number" step="any" min="0" className="form-control" value={form.purchaseCost} onChange={set('purchaseCost')} /></div>
                        <div className="form-group"><label className="form-label">Warranty until</label><input type="date" className="form-control" value={form.warrantyUntil} onChange={set('warrantyUntil')} /></div>
                    </div>
                    <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '0.75rem' }}>
                        <div className="form-group"><label className="form-label">Supplier / shop</label><input className="form-control" value={form.supplier} onChange={set('supplier')} /></div>
                        <div className="form-group"><label className="form-label">Bill no.</label><input className="form-control" value={form.billNo} onChange={set('billNo')} /></div>
                    </div>
                    {cost > 0 && (hasExpense ? (
                        <div style={{ fontSize: '0.85rem', color: 'var(--success)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <CheckCircle2 size={15} /> Cost is recorded in Financials as Equipment; changes to cost or date update it.
                        </div>
                    ) : (
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.88rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={recordExpense} onChange={e => setRecordExpense(e.target.checked)} style={{ marginTop: '0.2rem' }} />
                            <span>Add {lkr(cost)} to Financials as an <b>Equipment</b> expense on the purchase date. <span style={{ color: 'var(--text-light)' }}>Untick for things bought before you started using the app.</span></span>
                        </label>
                    ))}

                    <h4 style={{ margin: '0.5rem 0 0.75rem', fontSize: '0.95rem' }}>Maintenance</h4>
                    <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
                        <div className="form-group"><label className="form-label">Service every (months)</label><input type="number" min="0" className="form-control" value={form.serviceIntervalMonths} onChange={set('serviceIntervalMonths')} placeholder="e.g. 6" /></div>
                        <div className="form-group"><label className="form-label">Notes</label><input className="form-control" value={form.notes} onChange={set('notes')} placeholder="Model, serial no., etc." /></div>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>With a service interval you'll get a reminder in the bell when a service is due.</div>

                    {error && <div style={{ marginTop: '0.9rem', padding: '0.6rem 0.75rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', fontSize: '0.85rem' }}>{error}</div>}
                </div>
                <div style={{ padding: '0.9rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', backgroundColor: '#f8fafc' }}>
                    <button type="button" className="btn" onClick={onClose} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <ButtonSpinner /> : <CheckCircle2 size={16} />} {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Item'}</button>
                </div>
            </form>
        </div>
    );
}

const emptyLog = () => ({ date: today(), type: 'service', unitId: '', part: '', description: '', vendor: '', cost: '', markWorking: true });

// Service log and per-unit tracking for one item
function ServiceModal({ item, rooms, onClose, onChanged }) {
    const [tab, setTab] = useState(item.unitCount > 0 ? 'units' : 'log');
    const [services, setServices] = useState([]);
    const [unitData, setUnitData] = useState({ units: [], allUnits: null, partNames: [] });
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState(emptyLog);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [editUnit, setEditUnit] = useState(null); // unit being edited, or { new: true }
    const [busy, setBusy] = useState('');

    const load = async () => {
        setLoading(true);
        try {
            const [sRes, uRes] = await Promise.all([fetchWithAuth(`/api/inventory/${item.id}/services`), fetchWithAuth(`/api/inventory/${item.id}/units`)]);
            setServices((await readJson(sRes)).data || []);
            setUnitData((await readJson(uRes)).data || { units: [], allUnits: null, partNames: [] });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, [item.id]);

    const changed = async () => {
        await load();
        notifyDataChanged();
        onChanged();
    };

    const units = unitData.units;
    const liveUnits = units.filter(u => u.condition !== 'disposed');
    const selectedUnit = units.find(u => String(u.id) === String(form.unitId));
    const partOptions = useMemo(() => [...new Set([...unitData.partNames, ...partsFor(item.name)])].map(p => ({ value: p, label: p })), [unitData.partNames, item.name]);
    const partColumns = useMemo(() => [...new Set([...defaultPartColumns(item.name), ...unitData.partNames])], [item.name, unitData.partNames]);
    const roomOptions = useMemo(() => [...new Set([...rooms, 'Kitchen', 'Dining area', 'Lobby', 'Garden', 'Store room'])], [rooms]);

    const add = async (e) => {
        e.preventDefault();
        if (!form.date) return setError('Choose the date.');
        if (form.type === 'part' && !form.part.trim()) return setError('Enter which part was replaced.');
        setSaving(true);
        setError('');
        try {
            const res = await fetchWithAuth(`/api/inventory/${item.id}/services`, { method: 'POST', body: JSON.stringify({ ...form, unitId: form.unitId || null }) });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to log service');
            setForm(emptyLog());
            await changed();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (s) => {
        if (!window.confirm(`Delete this ${SERVICE_TYPES[s.type].toLowerCase()} record${s.cost ? ` and its ${lkr(s.cost)} expense` : ''}?`)) return;
        const res = await fetchWithAuth(`/api/inventory/services/${s.id}`, { method: 'DELETE' });
        const json = await readJson(res);
        if (!res.ok) return alert(json.error || 'Failed to delete');
        await changed();
    };

    const split = async () => {
        setBusy('Creating units...');
        try {
            const res = await fetchWithAuth(`/api/inventory/${item.id}/units/split`, { method: 'POST' });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to create units');
            await changed();
        } catch (err) {
            alert(err.message);
        } finally {
            setBusy('');
        }
    };

    const saveUnit = async (u) => {
        if (!u.label.trim()) return alert('Give the unit a name.');
        setBusy('Saving...');
        try {
            const res = await fetchWithAuth(u.id ? `/api/inventory/units/${u.id}` : `/api/inventory/${item.id}/units`, { method: u.id ? 'PUT' : 'POST', body: JSON.stringify(u) });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to save unit');
            setEditUnit(null);
            await changed();
        } catch (err) {
            alert(err.message);
        } finally {
            setBusy('');
        }
    };

    const deleteUnit = async (u) => {
        if (!window.confirm(`Delete ${u.label}? Only do this for a unit added by mistake.`)) return;
        const res = await fetchWithAuth(`/api/inventory/units/${u.id}`, { method: 'DELETE' });
        const json = await readJson(res);
        if (!res.ok) return alert(json.error || 'Failed to delete');
        setEditUnit(null);
        await changed();
    };

    // Clicking a cell of the parts grid starts a log entry for that unit and part
    const logPart = (unit, part) => {
        setForm({ ...emptyLog(), type: 'part', unitId: unit ? String(unit.id) : '', part });
        setTab('log');
    };

    const fixable = selectedUnit ? ['needs_repair', 'broken'].includes(selectedUnit.condition) : ['needs_repair', 'broken'].includes(item.condition);

    const unitRow = (u) => {
        const cond = CONDITIONS[u.condition] || CONDITIONS.working;
        return (
            <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', opacity: u.condition === 'disposed' ? 0.55 : 1 }}>
                <td style={{ padding: '0.55rem 0.7rem', position: 'sticky', left: 0, backgroundColor: 'white' }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{u.label}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', whiteSpace: 'nowrap' }}>{u.location || 'No room set'}{u.serialNo ? ` · ${u.serialNo}` : ''}</div>
                </td>
                <td style={{ padding: '0.55rem 0.7rem' }}><Pill bg={cond.bg} fg={cond.fg}>{cond.label}</Pill></td>
                <td style={{ padding: '0.55rem 0.7rem', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{u.lastServiceDate ? shortDate(u.lastServiceDate) : <span style={{ color: 'var(--text-light)' }}>-</span>}</td>
                {partColumns.map(p => {
                    const r = u.parts[p];
                    return (
                        <td key={p} style={{ padding: '0.4rem 0.5rem' }}>
                            <button type="button" onClick={() => logPart(u, p)} title={r ? `Replaced ${r.count}× · log another` : `Log a ${p.toLowerCase()} replacement`} className="parts-cell" style={{
                                width: '100%', border: 'none', borderRadius: '0.35rem', padding: '0.3rem 0.4rem', fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap',
                                backgroundColor: r ? '#dbeafe' : '#f8fafc', color: r ? '#1e40af' : '#94a3b8', fontWeight: r ? 600 : 400
                            }}>
                                {r ? `${shortDate(r.lastDate)}${r.count > 1 ? ` (${r.count}×)` : ''}` : 'Original'}
                            </button>
                        </td>
                    );
                })}
                <td style={{ padding: '0.55rem 0.7rem', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{u.repairCount > 0 ? `${u.repairCount} · ${lkr(u.spent)}` : <span style={{ color: 'var(--text-light)' }}>-</span>}</td>
                <td style={{ padding: '0.55rem 0.7rem', textAlign: 'right' }}>
                    <button type="button" className="btn" onClick={() => setEditUnit({ ...u })} style={{ padding: '0.3rem', border: '1px solid var(--border)', backgroundColor: 'white' }} title="Edit unit"><Pencil size={13} /></button>
                </td>
            </tr>
        );
    };

    return (
        <div className="modal-backdrop" style={modalBackdrop}>
            <ProcessingOverlay show={!!busy} message={busy} />
            <div className="card animate-slide-up" style={{ width: '100%', maxWidth: '900px', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Wrench size={18} className="text-primary" /> {item.name}{item.quantity > 1 ? ` (x${item.quantity})` : ''}</h3>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
                            {item.serviceIntervalMonths ? `Service every ${item.serviceIntervalMonths} month(s)` : 'No service interval set'}
                            {item.nextServiceDue ? ` · next due ${item.nextServiceDue}` : ''}
                        </div>
                    </div>
                    <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}><X size={20} /></button>
                </div>

                <div className="tab-bar" style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)', padding: '0 1.5rem' }}>
                    {[['units', `Units & parts${liveUnits.length ? ` (${liveUnits.length})` : ''}`, Layers], ['log', `Service log (${services.length})`, History]].map(([id, label, Icon]) => (
                        <button key={id} type="button" onClick={() => setTab(id)} style={{ padding: '0.6rem 0.75rem', fontWeight: 600, backgroundColor: 'transparent', border: 'none', borderBottom: tab === id ? '3px solid var(--primary)' : '3px solid transparent', color: tab === id ? 'var(--primary)' : 'var(--text-light)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '-1px' }}>
                            <Icon size={15} /> {label}
                        </button>
                    ))}
                </div>

                <div style={{ padding: '1.25rem 1.5rem', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                    {loading ? <div style={{ color: 'var(--text-light)' }}>Loading...</div> : tab === 'units' ? (
                        units.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
                                <Layers size={32} style={{ color: 'var(--primary)', marginBottom: '0.5rem' }} />
                                <h4 style={{ margin: '0 0 0.4rem' }}>Track each {item.name.toLowerCase()} separately</h4>
                                <p style={{ color: 'var(--text-light)', fontSize: '0.9rem', maxWidth: '520px', margin: '0 auto 1rem' }}>
                                    Give each unit its room, then log services, repairs and replaced parts (e.g. a condenser) against the right one.
                                    You'll see which units have had which parts replaced and which are still original, so you can plan ahead.
                                </p>
                                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                                    {item.quantity > 0 && <button type="button" className="btn btn-primary" onClick={split}><Layers size={16} /> Create {item.quantity} unit{item.quantity > 1 ? 's' : ''}</button>}
                                    <button type="button" className="btn" onClick={() => setEditUnit({ new: true, label: `${item.name} 1`, location: '', serialNo: '', condition: 'working', notes: '' })} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}><Plus size={16} /> Add one unit</button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                                        Blue = replaced (latest date), grey = original part. Click a cell to log a replacement.
                                    </span>
                                    <button type="button" className="btn" onClick={() => setEditUnit({ new: true, label: `${item.name} ${units.length + 1}`, location: '', serialNo: '', condition: 'working', notes: '' })} style={{ padding: '0.35rem 0.7rem', fontSize: '0.82rem', border: '1px solid var(--border)', backgroundColor: 'white' }}><Plus size={14} /> Add unit</button>
                                </div>
                                <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '0.5rem' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                                        <thead>
                                            <tr style={{ backgroundColor: '#f8fafc', color: 'var(--text-light)', fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'left' }}>
                                                <th style={{ padding: '0.55rem 0.7rem', position: 'sticky', left: 0, backgroundColor: '#f8fafc' }}>Unit / room</th>
                                                <th style={{ padding: '0.55rem 0.7rem' }}>Condition</th>
                                                <th style={{ padding: '0.55rem 0.7rem', whiteSpace: 'nowrap' }}>Last service</th>
                                                {partColumns.map(p => <th key={p} style={{ padding: '0.55rem 0.5rem', whiteSpace: 'nowrap' }}>{p}</th>)}
                                                <th style={{ padding: '0.55rem 0.7rem', whiteSpace: 'nowrap' }}>Repairs · spent</th>
                                                <th style={{ padding: '0.55rem 0.7rem' }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>{units.map(unitRow)}</tbody>
                                    </table>
                                </div>
                                {partColumns.length === 0 && <div style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginTop: '0.6rem' }}>No parts replaced yet. Log a "Part replaced" and it will appear as a column here.</div>}
                                {unitData.allUnits && (unitData.allUnits.repairCount > 0 || unitData.allUnits.lastServiceDate) && (
                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginTop: '0.6rem' }}>
                                        Logged for all units together: {[unitData.allUnits.lastServiceDate && `last service ${shortDate(unitData.allUnits.lastServiceDate)}`, unitData.allUnits.repairCount > 0 && `${unitData.allUnits.repairCount} repair(s)`].filter(Boolean).join(', ')}.
                                    </div>
                                )}
                            </>
                        )
                    ) : (
                        <>
                            <form onSubmit={add} style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.85rem', marginBottom: '1.25rem' }}>
                                <div style={{ fontWeight: 600, marginBottom: '0.6rem' }}>Log a service, repair or replaced part</div>
                                <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: liveUnits.length ? '1fr 1fr 1.3fr 1fr' : '1fr 1fr 1fr', gap: '0.6rem' }}>
                                    <input type="date" className="form-control" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                                    <select className="form-control" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                                        {Object.entries(SERVICE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                                    </select>
                                    {liveUnits.length > 0 && (
                                        <select className="form-control" value={form.unitId} onChange={e => setForm({ ...form, unitId: e.target.value })} title="Which unit">
                                            <option value="">All units / whole item</option>
                                            {units.filter(u => u.condition !== 'disposed' || String(u.id) === String(form.unitId)).map(u => <option key={u.id} value={u.id}>{u.label}{u.location ? ` (${u.location})` : ''}</option>)}
                                        </select>
                                    )}
                                    <input type="number" step="any" min="0" className="form-control" placeholder="Cost (LKR)" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} />
                                </div>
                                <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: form.type === 'part' ? '1.2fr 1.6fr 1fr' : '2fr 1fr', gap: '0.6rem', marginTop: '0.6rem' }}>
                                    {form.type === 'part' && (
                                        <SearchSelect
                                            freeText
                                            text={form.part}
                                            onTextChange={v => setForm(f => ({ ...f, part: v }))}
                                            options={partOptions}
                                            onSelect={o => setForm(f => ({ ...f, part: o.label }))}
                                            onCreate={() => {}}
                                            createLabel={t => `Use "${t}"`}
                                            placeholder="Part, e.g. condenser"
                                        />
                                    )}
                                    <input className="form-control" placeholder={form.type === 'part' ? 'Notes (e.g. brand, warranty)' : 'What was done (e.g. gas top-up, cleaning)'} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                                    <input className="form-control" placeholder="Technician / shop" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} />
                                </div>
                                {fixable && form.type !== 'service' && (
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', marginTop: '0.6rem', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={form.markWorking} onChange={e => setForm({ ...form, markWorking: e.target.checked })} /> Mark {selectedUnit ? selectedUnit.label : 'the item'} as working again
                                    </label>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.7rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>Any cost is added to Financials as <b>Maintenance</b>.</span>
                                    <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <ButtonSpinner /> : <Plus size={15} />} Log it</button>
                                </div>
                                {error && <div style={{ marginTop: '0.6rem', padding: '0.5rem 0.7rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', fontSize: '0.85rem' }}>{error}</div>}
                            </form>

                            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>History ({services.length})</div>
                            {services.length === 0 ? (
                                <div style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>No services or repairs logged yet.</div>
                            ) : (
                                <div style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden' }}>
                                    {services.map(s => (
                                        <div key={s.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', padding: '0.6rem 0.85rem', borderBottom: '1px solid var(--border)', fontSize: '0.9rem', flexWrap: 'wrap' }}>
                                            <span style={{ whiteSpace: 'nowrap', color: 'var(--text-light)' }}>{s.date}</span>
                                            <Pill bg="#eef2ff" fg="var(--primary)">{SERVICE_TYPES[s.type]}{s.part ? `: ${s.part}` : ''}</Pill>
                                            {liveUnits.length > 0 || s.unitLabel ? <Pill bg="#f1f5f9" fg="#334155">{s.unitLabel ? `${s.unitLabel}${s.unitLocation ? ` · ${s.unitLocation}` : ''}` : 'All units'}</Pill> : null}
                                            <span style={{ flex: 1, minWidth: '120px' }}>{s.description || (s.part ? '' : '-')}{s.vendor ? <span style={{ color: 'var(--text-light)' }}>{s.description ? ' · ' : ''}{s.vendor}</span> : ''}</span>
                                            <b style={{ whiteSpace: 'nowrap' }}>{s.cost ? lkr(s.cost) : '—'}</b>
                                            <button onClick={() => remove(s)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer' }} title="Delete record"><Trash2 size={15} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {editUnit && (
                <div className="modal-backdrop" style={{ ...modalBackdrop, zIndex: 1100 }}>
                    <form onSubmit={e => { e.preventDefault(); saveUnit(editUnit); }} className="card animate-slide-up" style={{ width: '100%', maxWidth: '440px' }}>
                        <h3 style={{ margin: '0 0 1rem 0' }}>{editUnit.id ? `Edit ${editUnit.label}` : 'Add unit'}</h3>
                        <div className="form-group"><label className="form-label">Name *</label><input className="form-control" value={editUnit.label} onChange={e => setEditUnit({ ...editUnit, label: e.target.value })} autoFocus /></div>
                        <div className="form-group">
                            <label className="form-label">Room / location</label>
                            <SearchSelect freeText text={editUnit.location || ''} onTextChange={v => setEditUnit(u => ({ ...u, location: v }))} options={roomOptions.map(r => ({ value: r, label: r }))} onSelect={o => setEditUnit(u => ({ ...u, location: o.label }))} placeholder="e.g. Standard 1" />
                        </div>
                        <div className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <div className="form-group"><label className="form-label">Condition</label>
                                <select className="form-control" value={editUnit.condition} onChange={e => setEditUnit({ ...editUnit, condition: e.target.value })}>{Object.entries(CONDITIONS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select>
                            </div>
                            <div className="form-group"><label className="form-label">Serial / model no.</label><input className="form-control" value={editUnit.serialNo || ''} onChange={e => setEditUnit({ ...editUnit, serialNo: e.target.value })} /></div>
                        </div>
                        <div className="form-group"><label className="form-label">Notes</label><input className="form-control" value={editUnit.notes || ''} onChange={e => setEditUnit({ ...editUnit, notes: e.target.value })} /></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem' }}>
                            <div>{editUnit.id && <button type="button" className="btn" onClick={() => deleteUnit(editUnit)} style={{ border: 'none', backgroundColor: '#fee2e2', color: '#b91c1c' }}><Trash2 size={15} /> Delete</button>}</div>
                            <div style={{ display: 'flex', gap: '0.6rem' }}>
                                <button type="button" className="btn" onClick={() => setEditUnit(null)} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>Cancel</button>
                                <button type="submit" className="btn btn-primary"><Save size={15} /> Save</button>
                            </div>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}

export default function Inventory() {
    const [items, setItems] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('ALL');
    const [showDisposed, setShowDisposed] = useState(false);
    const [editing, setEditing] = useState(null); // {} for new
    const [servicing, setServicing] = useState(null);
    const [busy, setBusy] = useState(null);

    const load = async () => {
        try {
            setLoading(true);
            const res = await fetchWithAuth('/api/inventory');
            setItems((await readJson(res)).data || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        load();
        fetchWithAuth('/api/rooms').then(readJson).then(j => setRooms((j.data || []).map(r => r.name))).catch(() => {});
    }, []);

    const t = today();
    const visible = useMemo(() => items.filter(i =>
        (showDisposed || i.condition !== 'disposed') &&
        (category === 'ALL' || i.category === category) &&
        (!search || `${i.name} ${i.location} ${i.supplier}`.toLowerCase().includes(search.toLowerCase()))
    ), [items, showDisposed, category, search]);

    const active = items.filter(i => i.condition !== 'disposed');
    const totalValue = active.reduce((s, i) => s + Number(i.purchaseCost || 0), 0);
    const needAttention = active.filter(i => ['needs_repair', 'broken'].includes(i.condition)).length + active.reduce((s, i) => s + (i.unitsNeedingAttention || 0), 0);
    const servicesDue = active.filter(i => i.nextServiceDue && i.nextServiceDue <= t).length;

    const addStarter = async () => {
        setBusy('starter');
        try {
            const res = await fetchWithAuth('/api/inventory/starter', { method: 'POST' });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to add the starter list');
            await load();
            notifyDataChanged();
        } catch (err) {
            alert(err.message);
        } finally {
            setBusy(null);
        }
    };

    const remove = async (i) => {
        if (!window.confirm(`Delete "${i.name}"? This also removes its units, purchase and service expenses. To keep the history of something thrown away or sold, set its condition to Disposed instead.`)) return;
        setBusy('delete');
        try {
            const res = await fetchWithAuth(`/api/inventory/${i.id}`, { method: 'DELETE' });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to delete');
            await load();
            notifyDataChanged();
        } catch (err) {
            alert(err.message);
        } finally {
            setBusy(null);
        }
    };

    const card = (label, value, sub, color, Icon) => (
        <div className="card" style={{ padding: '1rem 1.15rem', borderLeft: `4px solid ${color}` }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>{Icon && <Icon size={14} />} {label}</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 700, margin: '0.25rem 0' }}>{value}</div>
            {sub && <div style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>{sub}</div>}
        </div>
    );

    return (
        <div className="animate-slide-up" style={{ paddingBottom: '3rem' }}>
            <ProcessingOverlay show={!!busy} message={busy === 'starter' ? 'Adding items...' : 'Deleting item...'} />

            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}><Boxes className="text-primary" size={28} /> Inventory</h1>
                    <p style={{ color: 'var(--text-light)', marginTop: '0.25rem', fontSize: '0.95rem' }}>
                        Appliances, kitchenware and other things the villa owns, with their condition, warranty and service history.
                    </p>
                </div>
                <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={18} /> Add Item</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {card('Items', active.reduce((s, i) => s + Number(i.quantity || 0), 0), `${active.length} kinds of item`, 'var(--primary)', Boxes)}
                {card('Recorded value', lkr(totalValue), 'Purchase cost entered', '#10b981')}
                {card('Needs attention', needAttention, 'Items or units needing repair / broken', needAttention > 0 ? '#ef4444' : '#94a3b8', AlertCircle)}
                {card('Services due', servicesDue, 'Overdue for a service', servicesDue > 0 ? '#f59e0b' : '#94a3b8', Wrench)}
            </div>

            <div className="card" style={{ padding: '0.85rem 1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', backgroundColor: '#f8fafc' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '200px' }}>
                    <Search size={17} style={{ color: 'var(--text-light)' }} />
                    <input className="form-control" placeholder="Search item, location, supplier..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {[['ALL', 'All'], ...Object.entries(CATEGORIES).map(([k, c]) => [k, c.label])].map(([k, l]) => (
                        <button key={k} className="btn" onClick={() => setCategory(k)} style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem', border: `1px solid ${category === k ? 'var(--primary)' : 'var(--border)'}`, backgroundColor: category === k ? '#eef2ff' : 'white', color: category === k ? 'var(--primary)' : 'var(--text-light)' }}>{l}</button>
                    ))}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-light)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={showDisposed} onChange={e => setShowDisposed(e.target.checked)} /> Show disposed
                </label>
            </div>

            {!loading && items.length === 0 ? (
                <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
                    <Boxes size={36} style={{ color: 'var(--primary)', marginBottom: '0.75rem' }} />
                    <h3 style={{ margin: '0 0 0.5rem' }}>No inventory yet</h3>
                    <p style={{ color: 'var(--text-light)', maxWidth: '520px', margin: '0 auto 1.25rem' }}>
                        Start with a ready list of what the villa has — 2 fridges, 5 A/Cs, 4 hot water machines, solar hot water, kettles, cooker hobs, iron, hair dryer,
                        mosquito repellent machines, gas cylinders and kitchenware — then fill in quantities, locations and costs. No expenses are added for it.
                    </p>
                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button className="btn btn-primary" onClick={addStarter}><ListPlus size={17} /> Add starter list</button>
                        <button className="btn" onClick={() => setEditing({})} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}><Plus size={17} /> Add one item</button>
                    </div>
                </div>
            ) : (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '880px' }}>
                            <thead>
                                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)', color: 'var(--text-light)', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                                    <th style={{ padding: '0.85rem 1rem' }}>Item</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Qty</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Location</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Condition</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Purchase</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Warranty</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Next service</th>
                                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={8} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-light)' }}>Loading...</td></tr>
                                ) : visible.length === 0 ? (
                                    <tr><td colSpan={8} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-light)' }}>No items match.</td></tr>
                                ) : visible.map(i => {
                                    const cat = CATEGORIES[i.category] || CATEGORIES.other;
                                    const cond = CONDITIONS[i.condition] || CONDITIONS.working;
                                    const warrantyActive = i.warrantyUntil && i.warrantyUntil >= t;
                                    const serviceOverdue = i.nextServiceDue && i.nextServiceDue <= t;
                                    return (
                                        <tr key={i.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.92rem', opacity: i.condition === 'disposed' ? 0.55 : 1 }}>
                                            <td className="cell-title" style={{ padding: '0.8rem 1rem' }}>
                                                <div style={{ fontWeight: 600 }}>{i.name}</div>
                                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: cat.color }}>{cat.label}{i.notes ? <span style={{ color: 'var(--text-light)', fontWeight: 400 }}> · {i.notes}</span> : ''}</div>
                                            </td>
                                            <td data-label="Qty" style={{ padding: '0.8rem 1rem' }}>
                                                <b>{i.quantity}</b>
                                                {i.unitCount > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}><Layers size={12} /> tracked per unit</div>}
                                            </td>
                                            <td data-label="Location" style={{ padding: '0.8rem 1rem' }}>{i.unitCount > 0 ? <span style={{ color: 'var(--text-light)' }}>Per unit</span> : (i.location || '-')}</td>
                                            <td data-label="Condition" style={{ padding: '0.8rem 1rem' }}>
                                                <Pill bg={cond.bg} fg={cond.fg}>{cond.label}</Pill>
                                                {i.unitsNeedingAttention > 0 && <div style={{ marginTop: '0.25rem' }}><Pill bg="#fef3c7" fg="#b45309">{i.unitsNeedingAttention} unit(s) need repair</Pill></div>}
                                            </td>
                                            <td data-label="Purchase" style={{ padding: '0.8rem 1rem', fontSize: '0.85rem' }}>
                                                {i.purchaseCost ? <b>{lkr(i.purchaseCost)}</b> : <span style={{ color: 'var(--text-light)' }}>-</span>}
                                                {(i.purchaseDate || i.supplier) && <div style={{ color: 'var(--text-light)' }}>{[i.purchaseDate, i.supplier].filter(Boolean).join(' · ')}</div>}
                                            </td>
                                            <td data-label="Warranty" style={{ padding: '0.8rem 1rem', fontSize: '0.85rem' }}>
                                                {!i.warrantyUntil ? <span style={{ color: 'var(--text-light)' }}>-</span> : warrantyActive
                                                    ? <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><ShieldCheck size={14} /> until {i.warrantyUntil}</span>
                                                    : <span style={{ color: 'var(--text-light)' }}>ended {i.warrantyUntil}</span>}
                                            </td>
                                            <td data-label="Next service" style={{ padding: '0.8rem 1rem', fontSize: '0.85rem' }}>
                                                {i.nextServiceDue
                                                    ? <span style={{ color: serviceOverdue ? '#b91c1c' : 'var(--text)', fontWeight: serviceOverdue ? 700 : 400 }}>{serviceOverdue ? 'Due ' : ''}{i.nextServiceDue}</span>
                                                    : <span style={{ color: 'var(--text-light)' }}>{i.serviceIntervalMonths ? 'Set purchase date' : '-'}</span>}
                                                {i.unitCount > 0 && i.unitsDue?.length > 0 && i.nextServiceDue && <div style={{ color: 'var(--text-light)' }}>{i.unitsDue.filter(u => u.nextServiceDue === i.nextServiceDue).map(u => u.label).join(', ')}</div>}
                                                {i.serviceCount > 0 && <div style={{ color: 'var(--text-light)' }}>{i.serviceCount} logged · {lkr(i.serviceCost)}</div>}
                                            </td>
                                            <td className="cell-actions" style={{ padding: '0.8rem 1rem', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                                                    <button className="btn" onClick={() => setServicing(i)} style={{ padding: '0.35rem 0.6rem', border: '1px solid var(--border)', backgroundColor: serviceOverdue ? '#fffbeb' : 'white', fontSize: '0.8rem' }} title="Units, services & repairs"><Wrench size={14} /> Service</button>
                                                    <button className="btn" onClick={() => setEditing(i)} style={{ padding: '0.35rem', border: '1px solid var(--border)', backgroundColor: 'white' }} title="Edit"><Pencil size={14} /></button>
                                                    <button className="btn" onClick={() => remove(i)} style={{ padding: '0.35rem', border: 'none', backgroundColor: '#fee2e2', color: '#b91c1c' }} title="Delete"><Trash2 size={14} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {editing && <ItemModal item={editing.id ? editing : null} allItems={items} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
            {/* Look the item up again so the header reflects the reloaded next-service date */}
            {servicing && <ServiceModal item={items.find(x => x.id === servicing.id) || servicing} rooms={rooms} onClose={() => setServicing(null)} onChanged={load} />}
        </div>
    );
}
