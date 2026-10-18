import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useContext, useState, useEffect } from 'react';
import { Menu } from 'lucide-react';
import { AuthProvider, AuthContext } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import NotificationBell from './components/NotificationBell';
import Notifications from './pages/Notifications';
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import AddBooking from './pages/AddBooking';
import EditBooking from './pages/EditBooking';
import Login from './pages/Login';
import Users from './pages/Users';
import Finance from './pages/Finance';
import Integrations from './pages/Integrations';
import Analytics from './pages/Analytics';
import Laundry from './pages/Laundry';
import Utilities from './pages/Utilities';
import StaffManage from './pages/StaffManage';
import StaffPayments from './pages/StaffPayments';
import StaffBonus from './pages/StaffBonus';
import Groceries from './pages/Groceries';
import Inventory from './pages/Inventory';

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated } = useContext(AuthContext);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // On phones the sidebar is a drawer: close it whenever the page changes
  useEffect(() => setMenuOpen(false), [location.pathname]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <div className="app-layout">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <main className="main-content">
        <div className="topbar">
          <button type="button" className="icon-button mobile-only" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <span className="topbar-brand mobile-only">Tiny house</span>
          <NotificationBell />
        </div>
        {children}
      </main>
    </div>
  );
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/bookings" element={<ProtectedRoute><Bookings /></ProtectedRoute>} />
      <Route path="/add" element={<ProtectedRoute><AddBooking /></ProtectedRoute>} />
      <Route path="/edit/:id" element={<ProtectedRoute><EditBooking /></ProtectedRoute>} />
      <Route path="/finance" element={<ProtectedRoute><Finance /></ProtectedRoute>} />
      <Route path="/utilities/laundry" element={<ProtectedRoute><Laundry /></ProtectedRoute>} />
      <Route path="/utilities/:type" element={<ProtectedRoute><Utilities /></ProtectedRoute>} />
      <Route path="/utilities" element={<Navigate to="/utilities/laundry" replace />} />
      <Route path="/laundry" element={<Navigate to="/utilities/laundry" replace />} />
      <Route path="/staff/manage" element={<ProtectedRoute><StaffManage /></ProtectedRoute>} />
      <Route path="/staff/payments" element={<ProtectedRoute><StaffPayments /></ProtectedRoute>} />
      <Route path="/staff/bonus" element={<ProtectedRoute><StaffBonus /></ProtectedRoute>} />
      <Route path="/staff" element={<Navigate to="/staff/manage" replace />} />
      <Route path="/supplies/groceries" element={<ProtectedRoute><Groceries /></ProtectedRoute>} />
      <Route path="/supplies/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
      <Route path="/supplies" element={<Navigate to="/supplies/groceries" replace />} />
      <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute><Users /></ProtectedRoute>} />
      <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
      <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
