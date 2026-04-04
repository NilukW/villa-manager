import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, PlusCircle, LogOut, Users as UsersIcon, PieChart } from 'lucide-react';
import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

export default function Sidebar() {
    const { logout, username } = useContext(AuthContext);

    return (
        <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100vh', justifyContent: 'space-between' }}>
            <div>
                <div className="sidebar-header">
                    <h2>VillaManager</h2>
                </div>
                <nav className="sidebar-nav">
                    <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
                        <LayoutDashboard size={20} />
                        <span>Dashboard</span>
                    </NavLink>
                    <NavLink to="/bookings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <CalendarDays size={20} />
                        <span>All Bookings</span>
                    </NavLink>
                    <NavLink to="/add" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <PlusCircle size={20} />
                        <span>Add Booking</span>
                    </NavLink>
                    <NavLink to="/finance" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <PieChart size={20} />
                        <span>Financials</span>
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
