import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { UserCog, UserPlus, Pencil, Trash2, X, Search, CheckCircle2, UserX, UserCheck, Wallet } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ProcessingOverlay, { ButtonSpinner } from '../components/ProcessingOverlay';

const lkr = (val) => `LKR ${Number(val || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const readJson = async (res) => {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Server returned an unexpected response (HTTP ${res.status}).${res.status === 404 ? ' The backend may need a restart to pick up new routes.' : ''}`);
    }
};

const modalBackdrop = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.6)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem'
};

export default function StaffManage() {
    const [staff, setStaff] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showInactive, setShowInactive] = useState(false);

    const [editing, setEditing] = useState(null); // { id?, name, monthlySalary } while the add/edit modal is open
    const [isSaving, setIsSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const fetchStaff = async () => {
        try {
            setLoading(true);
            const res = await fetchWithAuth('/api/staff');
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to load staff');
            setStaff(json.data || []);
        } catch (err) {
            console.error('Error fetching staff:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStaff();
    }, []);

    const visibleStaff = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return staff.filter(s => (showInactive || s.active) && (!q || s.name.toLowerCase().includes(q)));
    }, [staff, searchQuery, showInactive]);

    const activeStaff = staff.filter(s => s.active);
    const totalMonthlyPayroll = activeStaff.reduce((sum, s) => sum + Number(s.monthlySalary || 0), 0);
    const inactiveCount = staff.length - activeStaff.length;

    const openAdd = () => {
        setFormError('');
        setEditing({ name: '', monthlySalary: '' });
    };

    const openEdit = (member) => {
        setFormError('');
        setEditing({ id: member.id, name: member.name, monthlySalary: String(member.monthlySalary) });
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (isSaving) return;
        if (!editing.name.trim()) return setFormError('Please enter a name.');
        if (editing.monthlySalary === '' || Number(editing.monthlySalary) < 0) return setFormError('Please enter a valid monthly salary.');

        setIsSaving(true);
        setFormError('');
        try {
            const res = await fetchWithAuth(editing.id ? `/api/staff/${editing.id}` : '/api/staff', {
                method: editing.id ? 'PUT' : 'POST',
                body: JSON.stringify({ name: editing.name.trim(), monthlySalary: Number(editing.monthlySalary) })
            });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to save staff member');
            await fetchStaff();
            setEditing(null);
        } catch (err) {
            setFormError(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const toggleActive = async (member) => {
        const action = member.active ? 'Mark as inactive' : 'Reactivate';
        if (member.active && !window.confirm(`${action} ${member.name}? They will no longer appear on the salary page, but their payment history is kept.`)) return;
        try {
            const res = await fetchWithAuth(`/api/staff/${member.id}`, {
                method: 'PUT',
                body: JSON.stringify({ active: !member.active })
            });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to update staff member');
            await fetchStaff();
        } catch (err) {
            alert(err.message);
        }
    };

    const handleDelete = async (member) => {
        if (!window.confirm(`Delete ${member.name}? This cannot be undone.`)) return;
        try {
            const res = await fetchWithAuth(`/api/staff/${member.id}`, { method: 'DELETE' });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to delete staff member');
            await fetchStaff();
        } catch (err) {
            alert(err.message);
        }
    };

    return (
        <div className="animate-slide-up" style={{ paddingBottom: '3rem' }}>
            <ProcessingOverlay show={isSaving} message={editing?.id ? 'Saving changes...' : 'Adding staff member...'} />

            <div className="page-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <UserCog className="text-primary" size={28} />
                        Manage Staff
                    </h1>
                    <p style={{ color: 'var(--text-light)', marginTop: '0.25rem', fontSize: '0.95rem' }}>
                        Staff members and their monthly salaries.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <Link to="/staff/payments" className="btn" style={{ border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--text)', textDecoration: 'none' }}>
                        <Wallet size={18} />
                        Salaries & Advances
                    </Link>
                    <button className="btn btn-primary" onClick={openAdd}>
                        <UserPlus size={18} />
                        Add Staff Member
                    </button>
                </div>
            </div>

            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
                <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--primary)' }}>
                    <div style={{ color: 'var(--text-light)', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase' }}>Active Staff</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text)', margin: '0.35rem 0' }}>{activeStaff.length}</div>
                    <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{inactiveCount > 0 ? `${inactiveCount} inactive` : 'No inactive staff'}</div>
                </div>
                <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--success)' }}>
                    <div style={{ color: 'var(--text-light)', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase' }}>Monthly Payroll</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text)', margin: '0.35rem 0' }}>{lkr(totalMonthlyPayroll)}</div>
                    <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>Total salaries of active staff</div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', backgroundColor: '#f8fafc' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '220px' }}>
                    <Search size={18} style={{ color: 'var(--text-light)' }} />
                    <input
                        type="text"
                        className="form-control"
                        placeholder="Search staff by name..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        style={{ width: '100%' }}
                    />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text-light)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                    Show inactive staff
                </label>
            </div>

            {/* Staff grid */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '560px' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)', color: 'var(--text-light)', fontSize: '0.85rem', textTransform: 'uppercase' }}>
                                <th style={{ padding: '1rem' }}>Name</th>
                                <th style={{ padding: '1rem' }}>Monthly Salary</th>
                                <th style={{ padding: '1rem' }}>Status</th>
                                <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={4} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>Loading staff...</td></tr>
                            ) : visibleStaff.length === 0 ? (
                                <tr>
                                    <td colSpan={4} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                        {staff.length === 0 ? 'No staff added yet. Click "Add Staff Member" to get started.' : 'No staff match your search.'}
                                    </td>
                                </tr>
                            ) : visibleStaff.map(member => (
                                <tr key={member.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.95rem', opacity: member.active ? 1 : 0.6 }}>
                                    <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--text)' }}>{member.name}</td>
                                    <td style={{ padding: '1rem', fontWeight: 600 }}>{lkr(member.monthlySalary)}</td>
                                    <td style={{ padding: '1rem' }}>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                            padding: '0.25rem 0.6rem', borderRadius: '1rem', fontSize: '0.8rem', fontWeight: 600,
                                            backgroundColor: member.active ? '#dcfce7' : '#f1f5f9',
                                            color: member.active ? '#15803d' : 'var(--text-light)'
                                        }}>
                                            {member.active ? <CheckCircle2 size={13} /> : <UserX size={13} />}
                                            {member.active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                            <button
                                                className="btn"
                                                onClick={() => openEdit(member)}
                                                style={{ padding: '0.4rem 0.7rem', border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--text)', fontSize: '0.85rem' }}
                                                title="Edit"
                                            >
                                                <Pencil size={15} /> Edit
                                            </button>
                                            <button
                                                className="btn"
                                                onClick={() => toggleActive(member)}
                                                style={{ padding: '0.4rem', border: '1px solid var(--border)', backgroundColor: '#f1f5f9', color: 'var(--text-light)' }}
                                                title={member.active ? 'Mark as inactive' : 'Reactivate'}
                                            >
                                                {member.active ? <UserX size={16} /> : <UserCheck size={16} />}
                                            </button>
                                            {member.paymentCount === 0 && (
                                                <button
                                                    className="btn"
                                                    onClick={() => handleDelete(member)}
                                                    style={{ padding: '0.4rem', border: 'none', backgroundColor: '#fee2e2', color: '#b91c1c' }}
                                                    title="Delete (only possible before any payments are recorded)"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add / Edit modal */}
            {editing && (
                <div style={modalBackdrop}>
                    <form onSubmit={handleSave} className="card animate-slide-up" style={{ width: '100%', maxWidth: '440px', padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {editing.id ? <Pencil size={18} className="text-primary" /> : <UserPlus size={18} className="text-primary" />}
                                {editing.id ? 'Edit Staff Member' : 'Add Staff Member'}
                            </h3>
                            <button type="button" onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '1.5rem' }}>
                            <div className="form-group">
                                <label className="form-label">Name *</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={editing.name}
                                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                                    autoFocus
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Monthly Salary (LKR) *</label>
                                <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    className="form-control"
                                    value={editing.monthlySalary}
                                    onChange={e => setEditing({ ...editing, monthlySalary: e.target.value })}
                                    required
                                />
                                {editing.id && (
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginTop: '0.35rem' }}>
                                        A new salary applies from the next month with no payments yet; months already started keep their original salary.
                                    </div>
                                )}
                            </div>
                            {formError && (
                                <div style={{ padding: '0.65rem 0.75rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', fontSize: '0.85rem' }}>
                                    {formError}
                                </div>
                            )}
                        </div>

                        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', backgroundColor: '#f8fafc' }}>
                            <button type="button" className="btn" onClick={() => setEditing(null)} style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>
                                Cancel
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={isSaving} style={{ fontWeight: 600 }}>
                                {isSaving ? <ButtonSpinner /> : <CheckCircle2 size={16} />}
                                {isSaving ? 'Saving...' : editing.id ? 'Save Changes' : 'Add Staff Member'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
