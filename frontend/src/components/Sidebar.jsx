import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, LogOut, Users as UsersIcon, PieChart, Link2, BarChart3, Shirt, PlugZap, Zap, Droplets, Wifi, Hotel, ChevronDown, UserRound, UserCog, Wallet, Gift, X, ShoppingBasket, Boxes, Package } from 'lucide-react';
import { useContext, useState, useEffect } from 'react';
import { AuthContext } from '../context/AuthContext';
import { usePendingBonuses } from '../utils/bonusReminders';

const UTILITY_LINKS = [
    { to: '/utilities/laundry', label: 'Laundry', icon: Shirt },
    { to: '/utilities/electricity', label: 'Electricity', icon: Zap },
    { to: '/utilities/water', label: 'Water', icon: Droplets },
    { to: '/utilities/telecom', label: 'Telecom', icon: Wifi },
    { to: '/utilities/booking', label: 'Booking.com', icon: Hotel }
];

const SUPPLY_LINKS = [
    { to: '/supplies/groceries', label: 'Groceries & Supplies', icon: ShoppingBasket },
    { to: '/supplies/inventory', label: 'Inventory', icon: Boxes }
];

const STAFF_LINKS = [
    { to: '/staff/manage', label: 'Manage Staff', icon: UserCog },
    { to: '/staff/payments', label: 'Salaries & Advances', icon: Wallet },
    { to: '/staff/bonus', label: 'Staff Bonus', icon: Gift }
];

const Badge = ({ count, title }) => count > 0 ? <span className="nav-badge" title={title}>{count}</span> : null;

// Collapsible sidebar section; opens automatically while one of its pages is active.
// badges maps a link's path to a count shown beside it (and summed on the group header).
function NavGroup({ label, icon: Icon, basePath, links, badges = {}, badgeTitle }) {
    const location = useLocation();
    const inGroup = location.pathname.startsWith(basePath);
    const [open, setOpen] = useState(inGroup);
    const groupCount = Object.values(badges).reduce((a, b) => a + b, 0);

    useEffect(() => {
        if (inGroup) setOpen(true);
    }, [inGroup]);

    return (
        <>
            <button
                type="button"
                className={`nav-item nav-group-toggle ${inGroup ? 'active' : ''}`}
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
            >
                <Icon size={20} />
                <span>{label}</span>
                {!open && <Badge count={groupCount} title={badgeTitle} />}
                <ChevronDown size={16} className={`nav-group-chevron ${open ? 'open' : ''}`} />
            </button>
            {open && (
                <div className="nav-submenu">
                    {links.map(({ to, label: linkLabel, icon: LinkIcon }) => (
                        <NavLink key={to} to={to} className={({ isActive }) => `nav-item nav-subitem ${isActive ? 'active' : ''}`}>
                            <LinkIcon size={17} />
                            <span>{linkLabel}</span>
                            <Badge count={badges[to] || 0} title={badgeTitle} />
                        </NavLink>
                    ))}
                </div>
            )}
        </>
    );
}

export default function Sidebar({ open = false, onClose }) {
    const { logout, username } = useContext(AuthContext);
    const { pending: pendingBonuses } = usePendingBonuses();

    // In drawer mode, picking a page closes the drawer (group toggles are buttons, not links)
    const handleNavClick = (e) => {
        if (onClose && e.target.closest('a')) onClose();
    };

    return (
        <aside className={`sidebar ${open ? 'open' : ''}`} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
                <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2>Tiny house</h2>
                    <button type="button" className="icon-button mobile-only" onClick={onClose} aria-label="Close menu">
                        <X size={18} />
                    </button>
                </div>
                <nav className="sidebar-nav" onClick={handleNavClick}>
                    <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
                        <LayoutDashboard size={20} />
                        <span>Dashboard</span>
                    </NavLink>
                    <NavLink to="/bookings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <CalendarDays size={20} />
                        <span>All Bookings</span>
                    </NavLink>
                    <NavLink to="/finance" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <PieChart size={20} />
                        <span>Financials</span>
                    </NavLink>

                    <NavGroup label="Utility Bills" icon={PlugZap} basePath="/utilities" links={UTILITY_LINKS} />
                    <NavGroup label="Supplies & Inventory" icon={Package} basePath="/supplies" links={SUPPLY_LINKS} />
                    <NavGroup
                        label="Staff"
                        icon={UserRound}
                        basePath="/staff"
                        links={STAFF_LINKS}
                        badges={{ '/staff/bonus': pendingBonuses.length }}
                        badgeTitle="Staff bonus decision needed"
                    />

                    <NavLink to="/analytics" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <BarChart3 size={20} />
                        <span>Analytics</span>
                    </NavLink>
                    <NavLink to="/integrations" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <Link2 size={20} />
                        <span>Channel Sync</span>
                    </NavLink>
                    <NavLink to="/users" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <UsersIcon size={20} />
                        <span>Manage Logins</span>
                    </NavLink>
                </nav>
            </div>

            <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ marginBottom: '1rem', color: 'var(--text-light)', fontSize: '0.9rem', textAlign: 'center' }}>
                    Logged in as <b style={{ color: 'var(--text)' }}>{username}</b>
                </div>
                <button onClick={logout} className="btn" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', backgroundColor: '#fee2e2', color: '#b91c1c', border: 'none', padding: '0.75rem', cursor: 'pointer' }}>
                    <LogOut size={18} />
                    Logout
                </button>
            </div>
        </aside>
    );
}
