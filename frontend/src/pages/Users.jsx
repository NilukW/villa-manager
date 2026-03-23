import { useState, useEffect } from 'react';
import { fetchWithAuth } from '../utils/api';
import { Trash2, KeyRound, UserPlus } from 'lucide-react';

export default function Users() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [error, setError] = useState('');

    const loadUsers = () => {
        fetchWithAuth('/api/users')
            .then(res => res.json())
            .then(data => { setUsers(data.data || []); setLoading(false); })
            .catch(err => { console.error(err); setLoading(false); });
    };

    useEffect(() => { loadUsers(); }, []);

    const handleAddUser = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const res = await fetchWithAuth('/api/users', {
                method: 'POST',
                body: JSON.stringify({ username: newUsername, password: newPassword })
            });
            const data = await res.json();
            if (res.ok) {
                setNewUsername('');
                setNewPassword('');
                loadUsers();
            } else {
                setError(data.error || 'Failed to add user');
            }
        } catch (err) { setError(err.message); }
    };

    const handleResetPassword = async (id, username) => {
        const newPass = window.prompt(`Enter new password for ${username}:`);
        if (!newPass) return;
        try {
            const res = await fetchWithAuth(`/api/users/${id}/password`, {
                method: 'PUT',
                body: JSON.stringify({ password: newPass })
            });
            if (res.ok) alert("Password updated successfully!");
            else {
                const data = await res.json();
                alert(data.error || "Failed to update password.");
            }
        } catch (err) { alert(err.message); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this user?")) return;
        try {
            const res = await fetchWithAuth(`/api/users/${id}`, { method: 'DELETE' });
            if (res.ok) loadUsers();
            else {
                const data = await res.json();
                alert(data.error || 'Failed to delete');
            }
        } catch (err) { alert(err.message); }
    };

    return (
        <div className="animate-slide-up">
            <div className="page-header">
                <h1 className="page-title">Manage Logins</h1>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: '2rem' }}>
                <div className="card" style={{ height: 'fit-content' }}>
                    <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <UserPlus size={20} /> Add New User
                    </h3>
                    {error && <div style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}
                    <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <label className="form-label">Username</label>
                            <input type="text" className="form-control" value={newUsername} onChange={e => setNewUsername(e.target.value)} required />
                        </div>
                        <div>
                            <label className="form-label">Password</label>
                            <input type="password" className="form-control" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                        </div>
                        <button type="submit" className="btn btn-primary" style={{ marginTop: '0.5rem' }}>Create User</button>
                    </form>
                </div>

                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc' }}>
                        <h3 style={{ margin: 0 }}>Active Users</h3>
                    </div>
                    {loading ? <p style={{ padding: '1.5rem' }}>Loading...</p> : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                                    <th style={{ padding: '1rem 1.25rem' }}>ID</th>
                                    <th style={{ padding: '1rem 1.25rem' }}>Username</th>
                                    <th style={{ padding: '1rem 1.25rem', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(u => (
                                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '1rem 1.25rem', color: 'var(--text-light)' }}>#{u.id}</td>
                                        <td style={{ padding: '1rem 1.25rem', fontWeight: 600 }}>{u.username} {u.id === 1 && <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: '#e2e8f0', marginLeft: '0.5rem', borderRadius: '1rem' }}>Admin</span>}</td>
                                        <td style={{ padding: '1rem 1.25rem', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                <button onClick={() => handleResetPassword(u.id, u.username)} className="btn" style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', color: '#0284c7', backgroundColor: '#e0f2fe', border: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }} title="Change Password"><KeyRound size={16} /> Reset</button>
                                                {u.id !== 1 && (
                                                    <button onClick={() => handleDelete(u.id)} className="btn" style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', color: 'var(--danger)', backgroundColor: '#fef2f2', border: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }} title="Delete Account"><Trash2 size={16} /> Delete</button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
