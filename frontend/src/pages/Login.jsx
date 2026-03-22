import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const { login } = useContext(AuthContext);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch('http://localhost:3001/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (res.ok) {
                login(data.token, data.username);
                navigate('/');
            } else {
                setError(data.error || 'Login failed');
            }
        } catch (err) {
            setError('Unable to connect to server');
        }
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#f1f5f9' }}>
            <div className="card animate-slide-up" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem 2rem', borderTop: '4px solid var(--primary)' }}>
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <h1 style={{ color: 'var(--primary)', marginBottom: '0.5rem', fontSize: '1.75rem' }}>VillaManager</h1>
                    <p style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>Secure Login Gateway</p>
                </div>

                {error && <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1.5rem', fontSize: '0.85rem', textAlign: 'center', fontWeight: '500' }}>{error}</div>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <div>
                        <label className="form-label">Username</label>
                        <input type="text" className="form-control" value={username} onChange={e => setUsername(e.target.value)} required autoFocus placeholder="e.g. admin" />
                    </div>
                    <div>
                        <label className="form-label">Password</label>
                        <input type="password" className="form-control" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ marginTop: '0.5rem', padding: '0.85rem', fontSize: '1rem', fontWeight: 600 }}>
                        Authenticate
                    </button>
                </form>
            </div>
        </div>
    );
}
