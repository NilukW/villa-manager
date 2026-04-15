import React, { useState } from 'react';

export default function EarningsLedger({ earningsList }) {
    const [earningSourceFilter, setEarningSourceFilter] = useState('');
    const [earningSortConfig, setEarningSortConfig] = useState({ key: 'date', direction: 'desc' });

    const handleEarningSort = (key) => {
        let direction = 'desc';
        if (earningSortConfig.key === key && earningSortConfig.direction === 'desc') direction = 'asc';
        setEarningSortConfig({ key, direction });
    };

    const getEarningSortIndicator = (key) => earningSortConfig.key === key ? (earningSortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

    const filteredEarnings = (earningsList || [])
        .filter(e => earningSourceFilter ? e.source === earningSourceFilter : true)
        .sort((a, b) => {
            let valA = a[earningSortConfig.key];
            let valB = b[earningSortConfig.key];
            if (earningSortConfig.key === 'amount') {
                valA = Number(valA);
                valB = Number(valB);
            }
            if (valA < valB) return earningSortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return earningSortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

    return (
        <div className="card animate-slide-up" style={{ padding: '0', overflow: 'hidden', marginBottom: '2rem' }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f0fdf4' }}>
                <h3 style={{ margin: 0, color: 'var(--success)' }}>Confirmed Earnings Ledger</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-light)', cursor: 'pointer', userSelect: 'none' }}>
                            <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleEarningSort('date')}>Paid Date{getEarningSortIndicator('date')}</th>
                            <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleEarningSort('guestName')}>Guest{getEarningSortIndicator('guestName')}</th>
                            <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleEarningSort('source')}>Source{getEarningSortIndicator('source')}</th>
                            <th style={{ padding: '1rem', fontWeight: 600 }} onClick={() => handleEarningSort('amount')}>Amount{getEarningSortIndicator('amount')}</th>
                            <th style={{ padding: '1rem', fontWeight: 600 }}>Rooms</th>
                        </tr>
                        <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
                            <td style={{ padding: '0.5rem' }}></td>
                            <td style={{ padding: '0.5rem' }}></td>
                            <td style={{ padding: '0.5rem' }}>
                                <select 
                                    className="form-control" 
                                    value={earningSourceFilter} 
                                    onChange={e => setEarningSourceFilter(e.target.value)} 
                                    style={{ width: '100%', padding: '0.3rem', fontSize: '0.85rem' }}
                                >
                                    <option value="">All Sources</option>
                                    <option value="Direct">Direct / Walk-in</option>
                                    <option value="Booking.com">Booking.com</option>
                                    <option value="Airbnb">Airbnb</option>
                                    <option value="Other">Other</option>
                                </select>
                            </td>
                            <td style={{ padding: '0.5rem' }}></td>
                            <td style={{ padding: '0.5rem' }}></td>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredEarnings.length === 0 && (
                            <tr>
                                <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-light)' }}>
                                    No fully settled earnings match this filter.
                                </td>
                            </tr>
                        )}
                        {filteredEarnings.map((earn, i) => (
                            <tr key={`${earn.id}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>{new Date(earn.date).toLocaleDateString()}</td>
                                <td style={{ padding: '1rem', fontWeight: 500 }}>{earn.guestName}</td>
                                <td style={{ padding: '1rem' }}>
                                    <span style={{ padding: '0.25rem 0.5rem', backgroundColor: earn.source === 'Booking.com' ? '#003580' : '#f1f5f9', color: earn.source === 'Booking.com' ? 'white' : 'var(--text)', borderRadius: '1rem', fontSize: '0.85rem' }}>
                                        {earn.source}
                                    </span>
                                </td>
                                <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--success)' }}>
                                    + {(earn.amount || 0).toLocaleString()}
                                </td>
                                <td style={{ padding: '1rem', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                                    {earn.rooms || '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
