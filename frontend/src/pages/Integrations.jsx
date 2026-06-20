import React, { useState, useEffect } from 'react';
import { RefreshCw, Check, Copy, Save, Link2, AlertCircle, CalendarRange } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

export default function Integrations() {
    const [rooms, setRooms] = useState([]);
    const [syncStatus, setSyncStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [editingUrls, setEditingUrls] = useState({});
    const [copiedId, setCopiedId] = useState(null);

    const fetchData = async () => {
        try {
            const [roomsRes, statusRes] = await Promise.all([
                fetchWithAuth('/api/rooms'),
                fetchWithAuth('/api/sync-status')
            ]);
            const roomsData = await roomsRes.json();
            const statusData = await statusRes.json();

            setRooms(roomsData.data || []);
            setSyncStatus(statusData.stats || null);

            // Initialize editing state
            const urls = {};
            (roomsData.data || []).forEach(r => {
                urls[r.id] = r.icalUrl || '';
            });
            setEditingUrls(urls);
        } catch (err) {
            console.error("Failed to load integrations data", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleSaveUrl = async (roomId) => {
        try {
            const url = editingUrls[roomId];
            const res = await fetchWithAuth(`/api/rooms/${roomId}/ical`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ icalUrl: url })
            });

            if (!res.ok) throw new Error("Failed to update link");
            alert("Room import feed link saved successfully!");
            fetchData();
        } catch (err) {
            alert(err.message);
        }
    };

    const handleSyncAll = async () => {
        setSyncing(true);
        try {
            const res = await fetchWithAuth('/api/rooms/sync', { method: 'POST' });
            if (!res.ok) throw new Error("Synchronization run failed");
            const data = await res.json();
            setSyncStatus(data.stats);
            alert("Calendar synchronization completed successfully!");
        } catch (err) {
            alert(err.message);
        } finally {
            setSyncing(false);
            fetchData();
        }
    };

    const copyToClipboard = (text, id) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const getExportUrl = (roomId) => {
        // Build export url pointing to backend public endpoint via current client origin
        return `${window.location.origin}/api/ical/room/${roomId}.ics`;
    };

    if (loading) return <div style={{ padding: '2rem' }}>Loading Channel Sync Dashboard...</div>;

    return (
        <div className="animate-slide-up">
            <div className="page-header" style={{ marginBottom: '1.5rem' }}>
                <div>
                    <h1 className="page-title">Channel Integrations</h1>
                    <p style={{ color: 'var(--text-light)', margin: '0.25rem 0 0 0', fontSize: '0.95rem' }}>
                        Synchronize room availability with Booking.com and other calendars via standard iCal feeds.
                    </p>
                </div>
                <button 
                    className="btn btn-primary" 
                    onClick={handleSyncAll} 
                    disabled={syncing}
                    style={{ gap: '0.75rem', padding: '0.75rem 1.25rem' }}
                >
                    <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
                    {syncing ? 'Syncing Channels...' : 'Sync All Channels Now'}
                </button>
            </div>

            {/* Sync Status Banner */}
            {syncStatus && (
                <div 
                    className="card" 
                    style={{ 
                        padding: '1.25rem', 
                        marginBottom: '2rem', 
                        borderLeft: `4px solid ${syncStatus.status === 'success' ? 'var(--success)' : 'var(--danger)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '1rem'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {syncStatus.status === 'success' ? (
                            <CalendarRange size={24} style={{ color: 'var(--success)' }} />
                        ) : (
                            <AlertCircle size={24} style={{ color: 'var(--danger)' }} />
                        )}
                        <div>
                            <strong style={{ display: 'block', color: 'var(--text-dark)' }}>
                                {syncStatus.status === 'success' ? 'Last Synchronization Successful' : 'Last Sync Attempt Failed'}
                            </strong>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                                Ran on: {new Date(syncStatus.time).toLocaleString()}
                            </span>
                        </div>
                    </div>

                    {syncStatus.status === 'success' && (
                        <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.9rem' }}>
                            <div>
                                <span style={{ color: 'var(--text-light)' }}>Rooms Synced:</span>{' '}
                                <strong style={{ color: 'var(--text)' }}>{syncStatus.roomsSynced || 0}</strong>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-light)' }}>New Bookings:</span>{' '}
                                <strong style={{ color: 'var(--success)' }}>+{syncStatus.bookingsCreated || 0}</strong>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-light)' }}>Updated:</span>{' '}
                                <strong style={{ color: 'var(--primary)' }}>{syncStatus.bookingsUpdated || 0}</strong>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-light)' }}>Linked:</span>{' '}
                                <strong style={{ color: 'var(--warning)' }}>{syncStatus.bookingsLinked || 0}</strong>
                            </div>
                        </div>
                    )}

                    {syncStatus.status === 'failed' && (
                        <div style={{ color: 'var(--danger)', fontSize: '0.9rem', fontWeight: 500 }}>
                            Error: {syncStatus.error || 'Unknown error occurred'}
                        </div>
                    )}
                </div>
            )}

            {/* Explanatory Alert */}
            <div className="card" style={{ padding: '1.5rem', marginBottom: '2rem', backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }}>
                <h4 style={{ margin: 0, color: '#1e40af', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Link2 size={18} />
                    How to set up Two-Way Sync with Booking.com
                </h4>
                <ol style={{ margin: '0.75rem 0 0 1.25rem', padding: 0, fontSize: '0.9rem', color: '#1e3a8a', lineHeight: '1.6' }}>
                    <li><strong>Export to Booking.com:</strong> Copy the <em>Export URL</em> of a room below. Log into your Booking.com Extranet, navigate to <strong>Calendar/Pricing</strong> &gt; <strong>Sync Calendars</strong>, click <strong>Add Calendar Connection</strong>, select "Import calendar", and paste the link.</li>
                    <li><strong>Import to Villa Manager:</strong> Copy the Booking.com Export Link (iCal URL) provided by the Extranet. Paste it into the <em>iCal Import URL</em> field for the matching room below, and click <strong>Save Feed</strong>.</li>
                </ol>
            </div>

            {/* Rooms Management Table */}
            <div className="card" style={{ padding: '0', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid var(--border)', backgroundColor: '#f8fafc', color: 'var(--text-light)' }}>
                            <th style={{ padding: '1rem', fontWeight: 600, width: '180px' }}>Room details</th>
                            <th style={{ padding: '1rem', fontWeight: 600 }}>Import from Booking.com (iCal Link)</th>
                            <th style={{ padding: '1rem', fontWeight: 600, width: '380px' }}>Export to Booking.com (Export Link)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rooms.map(room => {
                            const exportUrl = getExportUrl(room.id);
                            return (
                                <tr key={room.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    {/* Room name/type */}
                                    <td style={{ padding: '1.25rem 1rem' }}>
                                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{room.name}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>{room.type} Room</div>
                                    </td>

                                    {/* Import Link setup */}
                                    <td style={{ padding: '1.25rem 1rem' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <input 
                                                type="url" 
                                                className="form-control" 
                                                placeholder="https://ical.booking.com/v1/..."
                                                value={editingUrls[room.id] || ''}
                                                onChange={e => setEditingUrls({ ...editingUrls, [room.id]: e.target.value })}
                                                style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
                                            />
                                            <button 
                                                className="btn btn-primary"
                                                onClick={() => handleSaveUrl(room.id)}
                                                style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', gap: '0.35rem', backgroundColor: 'var(--primary)' }}
                                            >
                                                <Save size={14} />
                                                Save
                                            </button>
                                        </div>
                                    </td>

                                    {/* Export Link setup */}
                                    <td style={{ padding: '1.25rem 1rem' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <input 
                                                type="text" 
                                                className="form-control" 
                                                readOnly 
                                                value={exportUrl}
                                                style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.85rem', backgroundColor: '#f1f5f9', color: 'var(--text-light)', borderStyle: 'dashed' }}
                                                onClick={(e) => e.target.select()}
                                            />
                                            <button 
                                                className="btn"
                                                onClick={() => copyToClipboard(exportUrl, room.id)}
                                                style={{ 
                                                    padding: '0.5rem 0.75rem', 
                                                    backgroundColor: copiedId === room.id ? 'var(--success)' : '#e2e8f0', 
                                                    color: copiedId === room.id ? 'white' : 'var(--text)', 
                                                    border: 'none',
                                                    fontSize: '0.85rem',
                                                    display: 'flex',
                                                    gap: '0.35rem',
                                                    cursor: 'pointer'
                                                }}
                                                title="Copy Export Link"
                                            >
                                                {copiedId === room.id ? <Check size={14} /> : <Copy size={14} />}
                                                {copiedId === room.id ? 'Copied' : 'Copy'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
