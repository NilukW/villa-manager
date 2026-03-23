import { useState, useEffect, useRef } from 'react';
import { addDays, format, parseISO, startOfDay } from 'date-fns';
import { Link } from 'react-router-dom';
import { Maximize, Minimize } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

export default function Dashboard() {
    const [rooms, setRooms] = useState([]);
    const [reservations, setReservations] = useState([]);
    const [loading, setLoading] = useState(true);
    const containerRef = useRef(null);
    const [isFullScreen, setIsFullScreen] = useState(false);

    const [currentDate, setCurrentDate] = useState(startOfDay(new Date()));
    const [daysCount, setDaysCount] = useState(14);

    const days = Array.from({ length: daysCount }).map((_, i) => addDays(currentDate, i));

    useEffect(() => {
        Promise.all([
            fetchWithAuth('http://localhost:3001/api/rooms').then(res => res.json()),
            fetchWithAuth('http://localhost:3001/api/reservations').then(res => res.json())
        ]).then(([roomsData, resData]) => {
            const sortedRooms = (roomsData.data || []).sort((a, b) => {
                if (a.name === 'Family Studio') return 1;
                if (b.name === 'Family Studio') return -1;
                return a.name.localeCompare(b.name);
            });
            setRooms(sortedRooms);
            setReservations(resData.data || []);
            setLoading(false);
        }).catch(err => {
            console.error(err);
            setLoading(false);
        });
    }, []);

    const getReservationForRoomAndDate = (roomName, date) => {
        return reservations.find(res => {
            if (res.roomName !== roomName) return false;
            const checkIn = startOfDay(parseISO(res.checkInDate));
            const checkOut = startOfDay(parseISO(res.checkOutDate));
            return date >= checkIn && date < checkOut;
        });
    };

    const getColorForBooking = (res) => {
        if (!res) return 'transparent';
        let hash = 0;
        for (let i = 0; i < (res.guestName || "").length; i++) {
            hash = res.guestName.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = Math.abs(hash % 360);
        return `hsl(${hue}, 65%, 45%)`;
    };

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch(err => alert(err.message));
            setIsFullScreen(true);
        } else {
            document.exitFullscreen();
            setIsFullScreen(false);
        }
    };

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullScreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    return (
        <div id="dashboard-container" ref={containerRef} className="animate-slide-up" style={{ backgroundColor: isFullScreen ? 'var(--background)' : 'transparent', padding: isFullScreen ? '2rem' : '0', overflowY: isFullScreen ? 'auto' : 'visible' }}>
            {!isFullScreen && (
                <div className="page-header">
                    <h1 className="page-title">Dashboard</h1>
                </div>
            )}

            <div className="card" style={{ minHeight: isFullScreen ? '100%' : 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <h2>{daysCount}-Day Calendar Schedule</h2>

                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-light)', fontWeight: 500 }}>Start Date:</span>
                            <input
                                type="date"
                                className="form-control"
                                style={{ padding: '0.4rem 0.5rem', fontSize: '0.9rem' }}
                                value={format(currentDate, 'yyyy-MM-dd')}
                                onChange={(e) => {
                                    if (e.target.value) setCurrentDate(startOfDay(parseISO(e.target.value)));
                                }}
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-light)', fontWeight: 500 }}>View:</span>
                            <select
                                className="form-control"
                                style={{ padding: '0.4rem 0.5rem', fontSize: '0.9rem' }}
                                value={daysCount}
                                onChange={(e) => setDaysCount(Number(e.target.value))}
                            >
                                <option value={7}>7 Days</option>
                                <option value={14}>14 Days</option>
                                <option value={30}>30 Days</option>
                            </select>
                        </div>

                        <button className="btn" style={{ padding: '0.4rem', border: '1px solid var(--border)', background: 'white' }} onClick={toggleFullScreen} title="Toggle Full Screen">
                            {isFullScreen ? <Minimize size={20} /> : <Maximize size={20} />}
                        </button>
                    </div>
                </div>

                {loading ? <p className="mt-4">Loading calendar...</p> : (
                    <div style={{ marginTop: '1.5rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: `${daysCount * 60 + 150}px` }}>
                            <thead>
                                <tr>
                                    <th style={{ padding: '0.75rem', borderBottom: '2px solid var(--border)', textAlign: 'left', minWidth: '150px', position: 'sticky', left: 0, backgroundColor: 'white', zIndex: 10 }}>Room</th>
                                    {days.map(day => {
                                        const isToday = day.getTime() === startOfDay(new Date()).getTime();
                                        return (
                                            <th key={day.toISOString()} style={{
                                                padding: '0.5rem',
                                                borderBottom: '2px solid var(--border)',
                                                textAlign: 'center',
                                                fontSize: '0.85rem',
                                                backgroundColor: isToday ? '#f0f9ff' : 'transparent',
                                                minWidth: '60px'
                                            }}>
                                                <div style={{ fontWeight: 600, color: isToday ? 'var(--primary)' : 'var(--text)' }}>{format(day, 'EEE')}</div>
                                                <div style={{ color: isToday ? 'var(--primary)' : 'var(--text-light)' }}>{format(day, 'MMM d')}</div>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {rooms.map(room => (
                                    <tr key={room.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '0.75rem', fontWeight: 500, position: 'sticky', left: 0, backgroundColor: 'white', zIndex: 10, borderRight: '1px solid var(--border)' }}>
                                            {room.name}
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontWeight: 400 }}>{room.type}</div>
                                        </td>
                                        {days.map(day => {
                                            const res = getReservationForRoomAndDate(room.name, day);
                                            const isToday = day.getTime() === startOfDay(new Date()).getTime();
                                            return (
                                                <td key={day.toISOString()} style={{
                                                    padding: '0.25rem',
                                                    borderLeft: '1px solid var(--border)',
                                                    backgroundColor: isToday && !res ? '#f0f9ff' : 'transparent',
                                                    height: '50px'
                                                }}>
                                                    {res ? (
                                                        <Link to={`/edit/${res.id}`} style={{ textDecoration: 'none' }}>
                                                            <div style={{
                                                                backgroundColor: getColorForBooking(res),
                                                                color: 'white',
                                                                padding: '0.5rem',
                                                                borderRadius: '0.25rem',
                                                                fontSize: '0.75rem',
                                                                textAlign: 'center',
                                                                whiteSpace: 'nowrap',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                boxShadow: 'var(--shadow-sm)',
                                                                cursor: 'pointer',
                                                                transition: 'transform 0.1s'
                                                            }}
                                                                title={`${res.guestName} - Click to Edit`}
                                                                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.03)'}
                                                                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem' }}>
                                                                    {res.bookingSource === 'Booking.com' && (
                                                                        <span style={{ backgroundColor: '#003580', color: 'white', fontSize: '0.55rem', padding: '0.1rem 0.2rem', borderRadius: '2px', fontWeight: 'bold' }} title="Booking.com generated">B</span>
                                                                    )}
                                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{res.guestName.split(' ')[0]}</span>
                                                                </div>
                                                            </div>
                                                        </Link>
                                                    ) : (
                                                        <div style={{ height: '32px', borderRadius: '2px' }}></div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
