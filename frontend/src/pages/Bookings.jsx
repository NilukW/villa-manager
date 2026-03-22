import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function Bookings() {
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);

    const [filters, setFilters] = useState({
        guestInfo: '', checkInDate: '', checkOutDate: '', roomName: '', remarks: ''
    });

    const [sortConfig, setSortConfig] = useState({ key: 'checkInDate', direction: 'asc' });

    const fetchBookings = () => {
        fetch('http://localhost:3001/api/reservations')
            .then(res => res.json())
            .then(data => {
                setBookings(data.data || []);
                setLoading(false);
            })
            .catch(err => { console.error(err); setLoading(false); });
    };

    useEffect(() => { fetchBookings(); }, []);

    const handleDelete = (id) => {
        if (window.confirm("Are you sure you want to delete this booking?")) {
            fetch(`http://localhost:3001/api/reservations/${id}`, { method: 'DELETE' })
                .then(() => fetchBookings());
        }
    };

    const handleFilterChange = (e) => {
        setFilters({ ...filters, [e.target.name]: e.target.value });
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
    };

    const filteredBookings = bookings.filter(book => {
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
                            {sortedBookings.length === 0 && <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center' }}>No bookings found</td></tr>}
                            {sortedBookings.map(book => {
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
                                            <div style={{ fontWeight: 500 }}>{book.guestName}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>{book.nicOrPassport}</div>
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
                                                <Link to={`/edit/${book.id}`} className="btn" style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', backgroundColor: '#eef2ff', color: 'var(--primary)', textDecoration: 'none', fontWeight: 500, border: '1px solid #c7d2fe' }}>Edit</Link>
                                                <button className="btn" style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', backgroundColor: '#fef2f2', color: 'var(--danger)', border: '1px solid #fecaca', cursor: 'pointer', fontWeight: 500 }} onClick={() => handleDelete(book.id)}>Delete</button>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
