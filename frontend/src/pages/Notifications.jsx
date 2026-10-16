import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Save, Settings } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { useNotifications, notifyDataChanged } from '../utils/notifications';
import { NotificationItem } from '../components/NotificationBell';
import { ButtonSpinner } from '../components/ProcessingOverlay';

const readJson = async (res) => {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Server returned an unexpected response (HTTP ${res.status}).${res.status === 404 ? ' The backend may need a restart to pick up new routes.' : ''}`);
    }
};

export default function Notifications() {
    const { items, loaded } = useNotifications();
    const [settings, setSettings] = useState(null);
    const [billTypes, setBillTypes] = useState({});
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null); // { type: 'ok' | 'error', text }

    useEffect(() => {
        (async () => {
            try {
                const res = await fetchWithAuth('/api/notifications/settings');
                const json = await readJson(res);
                if (!res.ok) throw new Error(json.error || 'Failed to load settings');
                const { billTypes: types, ...rest } = json.data;
                setBillTypes(types || {});
                setSettings(rest);
            } catch (err) {
                setMessage({ type: 'error', text: err.message });
            }
        })();
    }, []);

    const updateBill = (type, field, value) => setSettings(s => ({
        ...s,
        bills: { ...s.bills, [type]: { ...s.bills[type], [field]: value } }
    }));

    const save = async (e) => {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        setMessage(null);
        try {
            const payload = {
                bills: Object.fromEntries(Object.entries(settings.bills).map(([t, c]) => [t, { enabled: c.enabled, day: Number(c.day) }])),
                dueSoonDays: Number(settings.dueSoonDays),
                bonus: settings.bonus,
                checkouts: settings.checkouts
            };
            const res = await fetchWithAuth('/api/notifications/settings', { method: 'PUT', body: JSON.stringify(payload) });
            const json = await readJson(res);
            if (!res.ok) throw new Error(json.error || 'Failed to save settings');
            setMessage({ type: 'ok', text: 'Reminder settings saved.' });
            notifyDataChanged();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="animate-slide-up" style={{ paddingBottom: '3rem' }}>
            <div className="page-header" style={{ marginBottom: '1.5rem' }}>
                <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Bell className="text-primary" size={28} />
                    Notifications
                </h1>
                <p style={{ color: 'var(--text-light)', marginTop: '0.25rem', fontSize: '0.95rem' }}>
                    Things that need your attention. Each one clears by itself once it's done.
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
                {/* Current notifications */}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', fontWeight: 700, color: 'var(--text)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>To action</span>
                        <span style={{ color: 'var(--text-light)', fontWeight: 500 }}>{items.length}</span>
                    </div>
                    {!loaded ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>Loading...</div>
                    ) : items.length === 0 ? (
                        <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-light)' }}>
                            <CheckCheck size={32} style={{ color: 'var(--success)', marginBottom: '0.5rem' }} />
                            <div style={{ fontWeight: 600, color: 'var(--text)' }}>All caught up</div>
                            <div style={{ fontSize: '0.85rem' }}>Nothing needs your attention right now.</div>
                        </div>
                    ) : items.map(item => <NotificationItem key={item.id} item={item} />)}
                </div>

                {/* Settings */}
                <form className="card" onSubmit={save} style={{ padding: '1.25rem 1.5rem' }}>
                    <h3 style={{ margin: '0 0 0.25rem 0', color: 'var(--text)', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Settings size={18} className="text-primary" /> Reminder settings
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', margin: '0 0 1.25rem 0' }}>
                        Remind me if a month's bill hasn't been uploaded by this day. Bills with more than one account (e.g. two electricity meters) are checked per account.
                    </p>

                    {!settings ? (
                        <div style={{ color: 'var(--text-light)' }}>Loading...</div>
                    ) : (
                        <>
                            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.25rem' }}>
                                <thead>
                                    <tr style={{ fontSize: '0.8rem', color: 'var(--text-light)', textTransform: 'uppercase', textAlign: 'left' }}>
                                        <th style={{ padding: '0.4rem 0' }}>Bill</th>
                                        <th style={{ padding: '0.4rem 0' }}>Remind</th>
                                        <th style={{ padding: '0.4rem 0' }}>If not uploaded by day</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(billTypes).map(([type, label]) => {
                                        const cfg = settings.bills[type];
                                        return (
                                            <tr key={type} style={{ borderTop: '1px solid var(--border)' }}>
                                                <td style={{ padding: '0.55rem 0', fontWeight: 600 }}>{label}</td>
                                                <td style={{ padding: '0.55rem 0' }}>
                                                    <input type="checkbox" checked={!!cfg.enabled} onChange={e => updateBill(type, 'enabled', e.target.checked)} />
                                                </td>
                                                <td style={{ padding: '0.55rem 0' }}>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max="31"
                                                        className="form-control"
                                                        value={cfg.day}
                                                        disabled={!cfg.enabled}
                                                        onChange={e => updateBill(type, 'day', e.target.value)}
                                                        style={{ width: '80px', padding: '0.35rem 0.5rem' }}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>

                            <div className="form-group">
                                <label className="form-label">Warn about unpaid bills this many days before their due date</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="30"
                                    className="form-control"
                                    value={settings.dueSoonDays}
                                    onChange={e => setSettings(s => ({ ...s, dueSoonDays: e.target.value }))}
                                    style={{ width: '100px' }}
                                />
                            </div>

                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={!!settings.checkouts?.enabled}
                                    onChange={e => setSettings(s => ({ ...s, checkouts: { ...s.checkouts, enabled: e.target.checked } }))}
                                />
                                <span>Remind me to confirm each day's guest checkouts and settle their balance</span>
                            </label>

                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={!!settings.bonus.enabled}
                                    onChange={e => setSettings(s => ({ ...s, bonus: { ...s.bonus, enabled: e.target.checked } }))}
                                />
                                <span>Remind me to decide the monthly <Link to="/staff/bonus">staff bonus</Link></span>
                            </label>

                            {message && (
                                <div style={{
                                    marginBottom: '1rem', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.85rem',
                                    backgroundColor: message.type === 'ok' ? '#dcfce7' : '#fee2e2', color: message.type === 'ok' ? '#15803d' : '#b91c1c'
                                }}>
                                    {message.text}
                                </div>
                            )}

                            <button type="submit" className="btn btn-primary" disabled={saving}>
                                {saving ? <ButtonSpinner /> : <Save size={16} />}
                                {saving ? 'Saving...' : 'Save Settings'}
                            </button>
                        </>
                    )}
                </form>
            </div>
        </div>
    );
}
