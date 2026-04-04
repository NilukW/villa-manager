import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchWithAuth } from '../utils/api';

export default function Bookings() {
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);

    const [filters, setFilters] = useState({
        guestInfo: '', checkInDate: '', checkOutDate: '', roomName: '', remarks: ''
    });

    const [sortConfig, setSortConfig] = useState({ key: 'checkInDate', direction: 'asc' });
    const [deletingId, setDeletingId] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);

    const fetchBookings = () => {
        fetchWithAuth('/api/reservations')
            .then(res => res.json())
            .then(data => {
                setBookings(data.data || []);
                setLoading(false);
            })
            .catch(err => { console.error(err); setLoading(false); });
    };

    useEffect(() => { fetchBookings(); }, []);

    const executeDelete = async (id) => {
        try {
            const res = await fetchWithAuth(`/api/reservations/group/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to delete booking from database');
            }
            setDeletingId(null);
            fetchBookings();
        } catch (err) {
            alert("Error deleting booking: " + err.message);
            console.error(err);
        }
    };

    const handleFilterChange = (e) => {
        setFilters({ ...filters, [e.target.name]: e.target.value });
        setCurrentPage(1);
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
        setCurrentPage(1);
    };

    const groupedBookings = useMemo(() => {
        const groups = {};
        bookings.forEach(b => {
            const gid = b.groupId || b.id; // Fallback for old data
            if (!groups[gid]) {
                groups[gid] = { ...b, groupId: gid, totalAmount: 0, advancedAmount: 0, roomNamesList: [] };
            }
            groups[gid].totalAmount += Number(b.totalAmount || 0);
            groups[gid].advancedAmount += Number(b.advancedAmount || 0);
            groups[gid].roomNamesList.push(b.roomName);
        });
        
        return Object.values(groups).map(g => ({
            ...g,
            roomName: g.roomNamesList.join(', ')
        }));
    }, [bookings]);

    const filteredBookings = groupedBookings.filter(book => {
        if (filters.guestInfo && !book.guestName.toLowerCase().includes(filters.guestInfo.toLowerCase()) && !(book.nicOrPassport || '').toLowerCase().includes(filters.guestInfo.toLowerCase())) return false;
        if (filters.checkInDate && book.checkInDate !== filters.checkInDate) return false;
        if (filters.checkOutDate && book.checkOutDate !== filters.checkOutDate) return false;
        if (filters.roomName && book.roomName !== filters.roomName) return false;
        if (filters.remarks && !(book.remarks || '').toLowerCase().includes(filters.remarks.toLowerCase())) return false;
        return true;
    });

    const sortedBookings = [...filteredBookings].sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];
        if (sortConfig.key === 'totalAmount' || sortConfig.key === 'advancedAmount') {
            valA = parseFloat(valA || 0);
            valB = parseFloat(valB || 0);
        }
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const totalItems = sortedBookings.length;
    const totalPages = itemsPerPage === 'All' ? 1 : Math.ceil(totalItems / itemsPerPage) || 1;
    const safePage = Math.min(Math.max(1, currentPage), totalPages);
    
    let paginatedBookings = sortedBookings;
    if (itemsPerPage !== 'All') {
        const startIndex = (safePage - 1) * itemsPerPage;
        paginatedBookings = sortedBookings.slice(startIndex, startIndex + itemsPerPage);
    }

    const downloadCSV = () => {
        const listToExport = sortedBookings.length > 0 ? sortedBookings : bookings;
        if (listToExport.length === 0) return;

        const headers = ["ID", "Guest Name", "Phone", "NIC", "Check-in", "Check-out", "Room Name", "Unit Price", "Total Amount", "Total Paid", "Pending Balance", "Source", "Remarks"];
        const csvRows = [headers.join(',')];

        listToExport.forEach(b => {
            let paid = b.advancedAmount || 0;
            try {
                if (b.advancedPayments) {
                    const parsed = JSON.parse(b.advancedPayments);
                    if (parsed.length > 0) {
                        paid = parsed.reduce((sum, p) => sum + Number(p.amount || 0), 0);
                    }
                }
            } catch (e) { }
            const pending = Number(b.totalAmount || 0) - paid;

            const row = [
                b.id, `"${b.guestName}"`, `"${b.phoneNo || ''}"`, `"${b.nicOrPassport}"`,
                b.checkInDate, b.checkOutDate, `"${b.roomName}"`,
                b.unitPrice, b.totalAmount, paid, pending, `"${b.bookingSource}"`, `"${b.remarks || ''}"`
            ];
            csvRows.push(row.join(','));
        });

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reservations-detailed-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    };

    const getSortIndicator = (col) => sortConfig.key === col ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

    return (
        <div className="animate-slide-up">
            {deletingId && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="animate-slide-up" style={{ padding: '2rem 3rem', backgroundColor: 'white', borderRadius: '0.75rem', fontWeight: 600, border: '1px solid var(--border)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', textAlign: 'center', maxWidth: '400px' }}>
                        <div style={{ fontSize: '3.5rem', lineHeight: 1, marginBottom: '0.5rem' }}>🗑️</div>
                        <span style={{ fontSize: '1.25rem', color: 'var(--text-dark)' }}>Delete this booking?</span>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-light)', margin: 0, fontWeight: 'normal' }}>This action cannot be undone and will permanently remove the record from your database.</p>
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', width: '100%' }}>
                            <button type="button" onClick={() => setDeletingId(null)} className="btn" style={{ flex: 1, padding: '0.75rem', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 'bold' }}>Cancel</button>
                            <button type="button" onClick={() => executeDelete(deletingId)} className="btn" style={{ flex: 1, padding: '0.75rem', backgroundColor: 'var(--danger)', border: 'none', color: 'white', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 'bold' }}>Yes, Delete</button>
                        </div>
                    </div>
                </div>
            )}
            <div className="page-header">
                <h1 className="page-title">All Bookings</h1>
                <button className="btn btn-primary" onClick={downloadCSV}>⭳ Export CSV</button>
            </div>

            <div className="card" style={{ padding: '1rem', overflowX: 'auto' }}>
                {loading ? <p>Loading bookings...</p> : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '1000px' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-light)', cursor: 'pointer', userSelect: 'none' }}>
                                <th style={{ padding: '0.75rem', fontWeight: 600 }} onClick={() => handleSort('guestName')}>Guest Info{getSortIndicator('guestName')}</th>
                                <th style={{ padding: '0.75rem', fontWeight: 600 }} onClick={() => handleSort('checkInDate')}>Check-in{getSortIndicator('checkInDate')}</th>
                                <th style={{ padding: '0.75rem', fontWeight: 600 }} onClick={() => handleSort('checkOutDate')}>Check-out{getSortIndicator('checkOutDate')}</th>
                                <th style={{ padding: '0.75rem', fontWeight: 600 }} onClick={() => handleSort('roomName')}>Room{getSortIndicator('roomName')}</th>
                                <th style={{ padding: '0.75rem', fontWeight: 600 }} onClick={() => handleSort('totalAmount')}>Payment{getSortIndicator('totalAmount')}</th>
                                <th style={{ padding: '0.75rem', fontWeight: 600 }} onClick={() => handleSort('remarks')}>Remarks{getSortIndicator('remarks')}</th>
                                <th style={{ padding: '0.75rem', fontWeight: 600 }}>Actions</th>
                            </tr>
                            {/* Filter Row */}
                            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
                                <td style={{ padding: '0.5rem' }}>
                                    <input type="text" name="guestInfo" placeholder="Search Guest..." className="form-control" style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem' }} value={filters.guestInfo} onChange={handleFilterChange} />
                                </td>
                                <td style={{ padding: '0.5rem' }}>
                                    <input type="date" name="checkInDate" className="form-control" style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem' }} value={filters.checkInDate} onChange={handleFilterChange} />
                                </td>
                                <td style={{ padding: '0.5rem' }}>
                                    <input type="date" name="checkOutDate" className="form-control" style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem' }} value={filters.checkOutDate} onChange={handleFilterChange} />
                                </td>
                                <td style={{ padding: '0.5rem' }}>
                                    <select name="roomName" className="form-control" style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem' }} value={filters.roomName} onChange={handleFilterChange}>
                                        <option value="">All Rooms</option>
                                        <option value="Standard 1">Standard 1</option>
                                        <option value="Standard 2">Standard 2</option>
                                        <option value="Standard 3">Standard 3</option>
                                        <option value="Standard 4">Standard 4</option>
                                        <option value="Family Studio">Family Studio</option>
                                    </select>
                                </td>
                                <td style={{ padding: '0.5rem' }}></td>
                                <td style={{ padding: '0.5rem' }}>
                                    <input type="text" name="remarks" placeholder="Search Remarks..." className="form-control" style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem' }} value={filters.remarks} onChange={handleFilterChange} />
                                </td>
                                <td style={{ padding: '0.5rem' }}>
                                    <button className="btn" style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', backgroundColor: 'transparent', border: '1px solid var(--border)', color: 'var(--text-light)' }} onClick={() => setFilters({ guestInfo: '', checkInDate: '', checkOutDate: '', roomName: '', remarks: '' })}>Clear</button>
                                </td>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedBookings.length === 0 && <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center' }}>No bookings found</td></tr>}
                            {paginatedBookings.map(book => {
                                let paid = book.advancedAmount || 0;
                                try {
                                    if (book.advancedPayments) {
                                        const parsed = JSON.parse(book.advancedPayments);
                                        if (parsed.length > 0) {
                                            paid = parsed.reduce((sum, p) => sum + Number(p.amount || 0), 0);
                                        }
                                    }
                                } catch (e) { }
                                const pending = Number(book.totalAmount || 0) - paid;

                                return (
                                    <tr key={book.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '0.75rem' }}>
                                            <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                {book.guestName}
                                                {book.bookingSource === 'Booking.com' && (
                                                    <span style={{ backgroundColor: '#003580', color: 'white', fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: 'bold' }}>Booking.com</span>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ padding: '0.75rem', fontWeight: 500 }}>
                                            {new Date(book.checkInDate).toLocaleDateString()}
                                        </td>
                                        <td style={{ padding: '0.75rem', fontWeight: 500 }}>
                                            {new Date(book.checkOutDate).toLocaleDateString()}
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <span style={{
                                                padding: '0.25rem 0.5rem',
                                                backgroundColor: book.roomName === 'Family Studio' ? '#dbeafe' : '#f1f5f9',
                                                color: book.roomName === 'Family Studio' ? '#1e40af' : 'var(--text-light)',
                                                borderRadius: '1rem', fontSize: '0.85rem', whiteSpace: 'nowrap'
                                            }}>
                                                {book.roomName}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <div style={{ fontWeight: 600 }}>Total: {(book.totalAmount || 0).toLocaleString()}</div>
                                            <div style={{ fontSize: '0.85rem', color: paid > 0 ? 'var(--success)' : 'var(--text-light)' }}>
                                                Paid: {paid.toLocaleString()}
                                            </div>
                                            <div style={{ fontSize: '0.85rem', color: pending > 0 ? 'var(--warning)' : (pending < 0 ? 'var(--danger)' : 'var(--success)'), fontWeight: 500 }}>
                                                Pending: {pending.toLocaleString()}
                                            </div>
                                        </td>
                                        <td style={{ padding: '0.75rem', maxWidth: '200px', fontSize: '0.9rem', color: 'var(--text-light)', wordWrap: 'break-word', overflow: 'hidden' }}>
                                            {book.remarks || '-'}
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                <Link to={`/edit/${book.groupId || book.id}`} className="btn" style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', backgroundColor: '#eef2ff', color: 'var(--primary)', textDecoration: 'none', fontWeight: 500, border: '1px solid #c7d2fe' }}>Edit</Link>
                                                <button className="btn" style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', backgroundColor: '#fef2f2', color: 'var(--danger)', border: '1px solid #fecaca', cursor: 'pointer', fontWeight: 500 }} onClick={() => setDeletingId(book.groupId || book.id)}>Delete</button>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
                {!loading && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', padding: '0.5rem 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                            <span>Items per page:</span>
                            <select 
                                className="form-control" 
                                style={{ padding: '0.2rem', width: 'auto' }} 
                                value={itemsPerPage} 
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setItemsPerPage(val === 'All' ? 'All' : Number(val));
                                    setCurrentPage(1);
                                }}
                            >
                                <option value={20}>20</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                                <option value="All">All</option>
                            </select>
                        </div>
                        
                        {itemsPerPage !== 'All' && totalPages > 1 && (
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <button 
                                    className="btn" 
                                    style={{ padding: '0.3rem 0.6rem', border: '1px solid var(--border)', background: 'var(--surface)', cursor: safePage === 1 ? 'not-allowed' : 'pointer', opacity: safePage === 1 ? 0.5 : 1 }}
                                    disabled={safePage === 1}
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                >
                                    Previous
                                </button>
                                <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                                    Page {safePage} of {totalPages}
                                </span>
                                <button 
                                    className="btn" 
                                    style={{ padding: '0.3rem 0.6rem', border: '1px solid var(--border)', background: 'var(--surface)', cursor: safePage === totalPages ? 'not-allowed' : 'pointer', opacity: safePage === totalPages ? 0.5 : 1 }}
                                    disabled={safePage === totalPages}
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
