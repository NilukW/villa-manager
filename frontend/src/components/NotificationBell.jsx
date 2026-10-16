import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, BellRing, Gift, FileWarning, CalendarClock, Settings, CheckCheck } from 'lucide-react';
import { useNotifications } from '../utils/notifications';

const KIND_ICONS = { bonus: Gift, 'bill-missing': FileWarning, 'bill-due': CalendarClock };
const SEVERITY_STYLES = {
    overdue: { color: '#b91c1c', bg: '#fef2f2', label: 'Overdue' },
    due: { color: '#b45309', bg: '#fffbeb', label: 'Due' },
    info: { color: 'var(--text-light)', bg: '#f8fafc', label: '' }
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const prettyDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

// One notification row; shared by the dropdown and the full Notifications page
export function NotificationItem({ item, onNavigate }) {
    const Icon = KIND_ICONS[item.kind] || Bell;
    const sev = SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.info;
    return (
        <Link to={item.link} onClick={onNavigate} className="notification-item" style={{ borderLeftColor: sev.color }}>
            <div className="notification-icon" style={{ color: sev.color, backgroundColor: sev.bg }}>
                <Icon size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div className="notification-title">{item.title}</div>
                <div className="notification-detail">{item.detail}</div>
                <div className="notification-meta" style={{ color: sev.color }}>
                    {sev.label}{item.date ? ` · ${prettyDate(item.date)}` : ''}
                </div>
            </div>
        </Link>
    );
}

export default function NotificationBell() {
    const { items } = useNotifications();
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const location = useLocation();
    const overdue = items.filter(i => i.severity === 'overdue').length;

    // Close on navigation and on clicks outside the panel
    useEffect(() => setOpen(false), [location.pathname, location.search]);
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const BellIcon = items.length > 0 ? BellRing : Bell;

    return (
        <div className="notification-bell" ref={wrapRef}>
            <button
                type="button"
                className={`notification-button ${items.length > 0 ? 'has-items' : ''}`}
                onClick={() => setOpen(o => !o)}
                aria-label={`Notifications (${items.length})`}
                aria-expanded={open}
                title={items.length > 0 ? `${items.length} notification(s)` : 'No notifications'}
            >
                <BellIcon size={20} />
                {items.length > 0 && (
                    <span className="notification-count" style={{ backgroundColor: overdue > 0 ? '#ef4444' : '#f59e0b' }}>
                        {items.length > 99 ? '99+' : items.length}
                    </span>
                )}
            </button>

            {open && (
                <div className="notification-panel" role="dialog" aria-label="Notifications">
                    <div className="notification-panel-header">
                        <span>Notifications</span>
                        {items.length > 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-light)', fontWeight: 500 }}>{items.length} to action</span>}
                    </div>
                    <div className="notification-panel-body">
                        {items.length === 0 ? (
                            <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                <CheckCheck size={28} style={{ color: 'var(--success)', marginBottom: '0.5rem' }} />
                                <div style={{ fontWeight: 600, color: 'var(--text)' }}>All caught up</div>
                                <div style={{ fontSize: '0.85rem' }}>Nothing needs your attention right now.</div>
                            </div>
                        ) : items.map(item => (
                            <NotificationItem key={item.id} item={item} onNavigate={() => setOpen(false)} />
                        ))}
                    </div>
                    <Link to="/notifications" className="notification-panel-footer" onClick={() => setOpen(false)}>
                        <Settings size={15} /> All notifications & reminder settings
                    </Link>
                </div>
            )}
        </div>
    );
}
