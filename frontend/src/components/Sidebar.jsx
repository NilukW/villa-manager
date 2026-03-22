import { NavLink } from 'react-router-dom';
import { Home, CalendarDays, PlusCircle, List } from 'lucide-react';

export default function Sidebar() {
    return (
        <div className="sidebar">
            <div className="brand">
                <Home color="var(--primary)" size={28} />
                <span>VillaManager</span>
            </div>
            <div className="nav-links mt-8">
                <NavLink to="/" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
                    <CalendarDays size={20} />
                    <span>Dashboard</span>
                </NavLink>
                <NavLink to="/bookings" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
                    <List size={20} />
                    <span>All Bookings</span>
                </NavLink>
                <NavLink to="/add" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
                    <PlusCircle size={20} />
                    <span>Add Booking</span>
                </NavLink>
            </div>
        </div>
    );
}
