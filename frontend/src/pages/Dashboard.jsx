import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { addDays, format, parseISO, startOfDay, differenceInDays, isSameDay } from 'date-fns';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Maximize, Minimize, ChevronLeft, ChevronRight, LogIn, LogOut, BedDouble,
    Phone, MessageCircle, Pencil, CheckCircle2, Plus, HandCoins
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { groupReservations, STATUS_STYLES, whatsappLink, lkr, shortDate } from '../utils/bookings';
import SettleDialog from '../components/SettleDialog';
import { useIsNarrow } from '../utils/useMediaQuery';

// Day column width per view length, so short ranges are roomy and long ones still fit
const CELL_WIDTH = { 7: 128, 14: 84, 30: 56, 60: 42 };
const ROOM_COL = 150;

const SOURCE_BADGES = {
    'Booking.com': { letter: 'B', bg: '#003580', title: 'Booking.com' },
    Airbnb: { letter: 'A', bg: '#ff5a5f', title: 'Airbnb' }
};

function StatusPill({ status }) {
    const s = STATUS_STYLES[status];
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.15rem 0.55rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: 600, color: 'white', backgroundColor: s.color }}>
            {s.label}
        </span>
    );
}

function UpcomingPill({ color }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0.15rem 0.55rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: 600, color: 'white', backgroundColor: color }}>
            Upcoming
        </span>
    );
}

function ContactButtons({ phone, compact }) {
    if (!phone) return null;
    const wa = whatsappLink(phone);
    const style = { padding: compact ? '0.3rem 0.5rem' : '0.4rem 0.65rem', fontSize: '0.8rem', border: '1px solid var(--border)', backgroundColor: 'white', color: 'var(--text)', textDecoration: 'none' };
    return (
        <>
            <a href={`tel:${phone}`} className="btn" style={style} title={`Call ${phone}`} onClick={e => e.stopPropagation()}>
                <Phone size={14} /> {!compact && 'Call'}
            </a>
            {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className="btn" style={{ ...style, color: '#15803d' }} title="WhatsApp" onClick={e => e.stopPropagation()}>
                    <MessageCircle size={14} /> {!compact && 'WhatsApp'}
                </a>
            )}
        </>
    );
}

// Floating details card shown while hovering a booking bar
function HoverCard({ booking, rect, onEnter, onLeave, onEdit, onSettle }) {
    const width = 320;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = rect.bottom + 8;
    const placeAbove = below + 260 > window.innerHeight && rect.top > 280;

    return createPortal(
        <div
            className="booking-hover-card"
            style={{ left, width, ...(placeAbove ? { bottom: window.innerHeight - rect.top + 8 } : { top: below }) }}
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1rem' }}>{booking.guestName}</div>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {booking.upcoming && <UpcomingPill color={booking.color} />}
                    <StatusPill status={booking.status} />
                </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: '0.25rem' }}>
                {booking.rooms.join(', ')} · {booking.bookingSource}{booking.breakfast ? ' · 🍳 Breakfast' : ''}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text)', marginTop: '0.4rem' }}>
                {shortDate(booking.checkIn)} → {shortDate(booking.checkOut)} · <b>{booking.nights} night{booking.nights === 1 ? '' : 's'}</b>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem', marginTop: '0.75rem' }}>
                {[['Total', booking.total, 'var(--text)'], ['Paid', booking.paid, 'var(--success)'], ['Balance', Math.max(0, booking.pending), booking.pending > 0.05 ? '#b91c1c' : 'var(--success)']].map(([label, val, color]) => (
                    <div key={label} style={{ padding: '0.4rem 0.5rem', backgroundColor: '#f8fafc', borderRadius: '0.4rem', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color }}>{Number(val).toLocaleString()}</div>
                    </div>
                ))}
            </div>
            {booking.remarks && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginTop: '0.6rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={booking.remarks}>
                    📝 {booking.remarks}
                </div>
            )}
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.8rem' }} onClick={onEdit}>
                    <Pencil size={14} /> Edit
                </button>
                {booking.pending > 0.05 && (
                    <button className="btn" style={{ padding: '0.4rem 0.7rem', fontSize: '0.8rem', backgroundColor: '#10b981', color: 'white' }} onClick={onSettle}>
                        <HandCoins size={14} /> Settle
                    </button>
                )}
                <ContactButtons phone={booking.phoneNo} />
            </div>
        </div>,
        document.body
    );
}

function SummaryCard({ icon: Icon, label, value, color, children }) {
    return (
        <div className="card" style={{ padding: '1rem 1.15rem', borderTop: `3px solid ${color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Icon size={15} style={{ color }} /> {label}
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
            </div>
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>{children}</div>
        </div>
    );
}

export default function Dashboard() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const isNarrow = useIsNarrow();
    const [rooms, setRooms] = useState([]);
    const [reservations, setReservations] = useState([]);
    const [loading, setLoading] = useState(true);
    const containerRef = useRef(null);
    const [isFullScreen, setIsFullScreen] = useState(false);

    const today = startOfDay(new Date());
    const [currentDate, setCurrentDate] = useState(today);
    const [daysCount, setDaysCount] = useState(30);
    const cellW = CELL_WIDTH[daysCount] || 56;
    const days = useMemo(() => Array.from({ length: daysCount }).map((_, i) => addDays(currentDate, i)), [currentDate, daysCount]);

    const [hover, setHover] = useState(null); // { booking, rect }
    const hoverTimer = useRef(null);
    const [settleBooking, setSettleBooking] = useState(null);
    const [drag, setDrag] = useState(null); // { room, start, end } as day indices

    const loadData = useCallback(() => {
        return Promise.all([
            fetchWithAuth('/api/rooms').then(res => res.json()),
            fetchWithAuth('/api/reservations').then(res => res.json())
        ]).then(([roomsData, resData]) => {
            const sortedRooms = (roomsData.data || []).sort((a, b) => {
                if (a.name === 'Family Studio') return 1;
                if (b.name === 'Family Studio') return -1;
                return a.name.localeCompare(b.name);
            });
            setRooms(sortedRooms);
            setReservations(resData.data || []);
        }).catch(err => console.error(err)).finally(() => setLoading(false));
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const bookings = useMemo(() => groupReservations(reservations), [reservations]);

    // Notification links open the settle dialog via ?settle=<booking key>
    useEffect(() => {
        const key = searchParams.get('settle');
        if (!key || loading) return;
        const target = bookings.find(b => b.key === key);
        if (target && target.pending > 0.05) setSettleBooking(target);
        setSearchParams({}, { replace: true });
    }, [searchParams, bookings, loading, setSearchParams]);

    // --- Today at a glance ---
    const arrivals = bookings.filter(b => isSameDay(b.checkIn, today));
    const departures = bookings.filter(b => isSameDay(b.checkOut, today));
    const inHouse = bookings.filter(b => b.checkIn <= today && b.checkOut > today);
    const roomsTonight = inHouse.reduce((n, b) => n + b.rooms.length, 0);
    // Guests who have checked in (staying or already left) and still owe money. Order: guests who have
    // already left first, then nothing-paid (red) before part-paid, then longest outstanding.
    const balancesDue = bookings
        .filter(b => b.checkIn <= today && b.pending > 0.05)
        .sort((a, b) =>
            (Number(b.ended) - Number(a.ended)) ||
            (Number(b.status === 'unpaid') - Number(a.status === 'unpaid')) ||
            (a.checkOut - b.checkOut));
    const totalDue = balancesDue.reduce((s, b) => s + b.pending, 0);

    // Nights occupied per room within the view (day index → booking), used for clicks, drag and occupancy
    const occupied = useMemo(() => {
        const map = {};
        rooms.forEach(r => { map[r.name] = {}; });
        bookings.forEach(b => {
            const from = Math.max(0, differenceInDays(b.checkIn, currentDate));
            const to = Math.min(daysCount, differenceInDays(b.checkOut, currentDate));
            b.rooms.forEach(room => {
                if (!map[room]) return;
                for (let i = from; i < to; i++) map[room][i] = b;
            });
        });
        return map;
    }, [bookings, rooms, currentDate, daysCount]);

    const occupancyPerDay = days.map((_, i) => rooms.reduce((n, r) => n + (occupied[r.name]?.[i] ? 1 : 0), 0));

    // --- Hover card (delay avoids flicker when moving between bar and card) ---
    const showHover = (booking, e) => {
        clearTimeout(hoverTimer.current);
        const rect = e.currentTarget.getBoundingClientRect();
        hoverTimer.current = setTimeout(() => setHover({ booking, rect }), 250);
    };
    const keepHover = () => clearTimeout(hoverTimer.current);
    const hideHover = () => {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setHover(null), 200);
    };
    useEffect(() => () => clearTimeout(hoverTimer.current), []);

    const openEdit = (b) => navigate(`/edit/${b.key}`);

    // --- Drag across free nights to create a booking ---
    const isFree = (room, i) => !occupied[room]?.[i];
    const startDrag = (room, i, e) => {
        if (e.button !== 0 || !isFree(room, i)) return;
        e.preventDefault();
        setDrag({ room, start: i, end: i });
    };
    const extendDrag = (room, i) => {
        if (!drag || drag.room !== room) return;
        const lo = Math.min(drag.start, i);
        const hi = Math.max(drag.start, i);
        for (let k = lo; k <= hi; k++) if (!isFree(room, k)) return; // stop at existing bookings
        setDrag(d => ({ ...d, end: i }));
    };
    useEffect(() => {
        if (!drag) return;
        const finish = () => {
            const lo = Math.min(drag.start, drag.end);
            const hi = Math.max(drag.start, drag.end);
            setDrag(null);
            navigate('/add', {
                state: {
                    checkInDate: format(days[lo], 'yyyy-MM-dd'),
                    checkOutDate: format(addDays(days[hi], 1), 'yyyy-MM-dd'),
                    roomName: drag.room
                }
            });
        };
        const cancel = (e) => { if (e.key === 'Escape') setDrag(null); };
        document.addEventListener('mouseup', finish);
        document.addEventListener('keydown', cancel);
        return () => {
            document.removeEventListener('mouseup', finish);
            document.removeEventListener('keydown', cancel);
        };
    }, [drag, days, navigate]);

    // --- Full screen ---
    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch(err => alert(err.message));
        } else {
            document.exitFullscreen();
        }
    };
    useEffect(() => {
        const onChange = () => setIsFullScreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    const afterSettle = () => {
        setSettleBooking(null);
        loadData();
    };

    // Settle button for the today cards, or a paid tick when nothing is owed
    const settleAction = (b) => b.pending > 0.05
        ? <span role="button" className="glance-action" onClick={(e) => { e.stopPropagation(); setSettleBooking(b); }} title={`${lkr(b.pending)} due`}>Settle</span>
        : <span style={{ fontSize: '0.75rem', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', whiteSpace: 'nowrap' }}><CheckCircle2 size={13} /> Paid</span>;

    // Month labels spanning their days
    const monthSegments = [];
    days.forEach((d, i) => {
        const label = format(d, 'MMMM yyyy');
        const last = monthSegments[monthSegments.length - 1];
        if (last && last.label === label) last.count++;
        else monthSegments.push({ label, count: 1, start: i });
    });

    const bookingLine = (b, extra) => (
        <button key={b.key} className="glance-item" onClick={() => openEdit(b)} title="Open booking">
            <span className="glance-dot" style={{ backgroundColor: b.color }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <b>{b.guestName}</b> <span style={{ color: 'var(--text-light)' }}>· {b.rooms.join(', ')}</span>
            </span>
            {extra}
        </button>
    );

    const summary = (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
            <SummaryCard icon={LogIn} label="Arriving today" value={arrivals.length} color="#2563eb">
                {arrivals.length === 0 ? <span className="glance-empty">No arrivals today</span> : arrivals.map(b => bookingLine(b, settleAction(b)))}
            </SummaryCard>
            <SummaryCard icon={LogOut} label="Leaving today" value={departures.length} color="#10b981">
                {departures.length === 0 ? <span className="glance-empty">No checkouts today</span> : departures.map(b => bookingLine(b, settleAction(b)))}
            </SummaryCard>
            <SummaryCard icon={BedDouble} label="In-house tonight" value={`${roomsTonight}/${rooms.length}`} color="#7c3aed">
                {inHouse.length === 0 ? <span className="glance-empty">No guests staying tonight</span> : inHouse.slice(0, 4).map(b => bookingLine(b,
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', whiteSpace: 'nowrap' }}>until {format(b.checkOut, 'd MMM')}</span>))}
                {inHouse.length > 4 && <span className="glance-empty">+{inHouse.length - 4} more</span>}
            </SummaryCard>
            <SummaryCard icon={HandCoins} label="Balance due" value={balancesDue.length > 0 ? lkr(totalDue) : '0'} color="#dc2626">
                {balancesDue.length === 0 ? <span className="glance-empty">Every guest has paid in full</span> : balancesDue.slice(0, 4).map(b => bookingLine(b,
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
                        {b.ended && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'white', backgroundColor: '#dc2626', padding: '0.05rem 0.35rem', borderRadius: '0.3rem' }} title={`Checked out on ${format(b.checkOut, 'd MMM')}`}>
                                Left {format(b.checkOut, 'd MMM')}
                            </span>
                        )}
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#b91c1c' }}>
                            {Number(b.pending).toLocaleString()}
                        </span>
                        {settleAction(b)}
                    </span>))}
                {balancesDue.length > 4 && <span className="glance-empty">+{balancesDue.length - 4} more</span>}
            </SummaryCard>
        </div>
    );

    const legend = (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-light)', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} title="Bookings that haven't started yet have a colour per guest">
                <span style={{ width: '14px', height: '10px', borderRadius: '3px', background: 'linear-gradient(90deg, #6366f1, #ec4899, #14b8a6)' }} /> Upcoming (colour per guest)
            </span>
            {Object.values(STATUS_STYLES).map(s => (
                <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ width: '14px', height: '10px', borderRadius: '3px', backgroundColor: s.color }} /> {s.label}
                </span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <span className="source-badge" style={{ backgroundColor: '#003580' }}>B</span> Booking.com
            </span>
            <span>🍳 Breakfast</span>
            {!isNarrow && <span style={{ fontStyle: 'italic' }}>Tip: drag across empty days to book several nights</span>}
        </div>
    );

    // --- Phone: list of upcoming stays instead of the wide grid ---
    const upcoming = bookings
        .filter(b => b.checkOut >= today && b.checkIn <= addDays(today, 30))
        .sort((a, b) => a.checkIn - b.checkIn);

    const mobileList = (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--border)', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Upcoming stays (30 days)</span>
                <Link to="/add" className="btn btn-primary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.8rem', textDecoration: 'none' }}><Plus size={14} /> Add</Link>
            </div>
            {upcoming.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>No upcoming stays.</div>
            ) : upcoming.map(b => {
                return (
                    <div key={b.key} onClick={() => openEdit(b)} style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--border)', borderLeft: `4px solid ${b.color}`, cursor: 'pointer' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                            <b>{b.guestName}</b>
                            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {b.upcoming && <UpcomingPill color={b.color} />}
                                <StatusPill status={b.status} />
                            </div>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: '0.2rem' }}>
                            {b.rooms.join(', ')} · {shortDate(b.checkIn)} → {shortDate(b.checkOut)} ({b.nights}n){b.breakfast ? ' · 🍳' : ''}
                        </div>
                        {b.pending > 0.05 && <div style={{ fontSize: '0.85rem', color: '#b45309', marginTop: '0.2rem' }}>Balance {lkr(b.pending)}</div>}
                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                            {b.pending > 0.05 && (
                                <button className="btn" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', backgroundColor: '#10b981', color: 'white' }} onClick={(e) => { e.stopPropagation(); setSettleBooking(b); }}>
                                    <HandCoins size={14} /> Settle
                                </button>
                            )}
                            <ContactButtons phone={b.phoneNo} compact />
                        </div>
                    </div>
                );
            })}
        </div>
    );

    // --- Desktop calendar grid ---
    const trackWidth = daysCount * cellW;
    const dayBg = (d) => isSameDay(d, today) ? '#eef2ff' : (d.getDay() === 0 || d.getDay() === 6) ? '#f8fafc' : 'white';
    const monthEdge = (d, i) => i > 0 && d.getDate() === 1 ? '2px solid #94a3b8' : '1px solid var(--border)';

    const calendar = (
        <div style={{ marginTop: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
            <div style={{ width: ROOM_COL + trackWidth, userSelect: drag ? 'none' : 'auto' }}>
                {/* Month row */}
                <div style={{ display: 'flex' }}>
                    <div className="cal-sticky" style={{ width: ROOM_COL }} />
                    {monthSegments.map(m => (
                        <div key={m.label} style={{ width: m.count * cellW, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-light)', padding: '0.2rem 0.4rem', borderLeft: m.start > 0 ? '2px solid #94a3b8' : 'none', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                            {m.count * cellW > 70 ? m.label : format(days[m.start], 'MMM')}
                        </div>
                    ))}
                </div>

                {/* Day header */}
                <div style={{ display: 'flex', borderBottom: '2px solid var(--border)' }}>
                    <div className="cal-sticky" style={{ width: ROOM_COL, padding: '0.5rem 0.75rem', fontWeight: 700, fontSize: '0.85rem' }}>Room</div>
                    {days.map((d, i) => {
                        const isToday = isSameDay(d, today);
                        return (
                            <div key={i} style={{ width: cellW, textAlign: 'center', padding: '0.35rem 0', fontSize: '0.78rem', backgroundColor: isToday ? 'var(--primary)' : dayBg(d), color: isToday ? 'white' : 'var(--text)', borderLeft: monthEdge(d, i), borderRadius: isToday ? '0.35rem 0.35rem 0 0' : 0 }}>
                                <div style={{ fontWeight: 600 }}>{format(d, cellW < 50 ? 'EEEEE' : 'EEE')}</div>
                                <div style={{ color: isToday ? 'rgba(255,255,255,0.9)' : 'var(--text-light)' }}>{format(d, 'd')}</div>
                            </div>
                        );
                    })}
                </div>

                {/* Room rows */}
                {rooms.map(room => {
                    const roomBookings = bookings.filter(b => b.rooms.includes(room.name) && b.checkOut > currentDate && b.checkIn < addDays(currentDate, daysCount));
                    const sel = drag && drag.room === room.name ? { lo: Math.min(drag.start, drag.end), hi: Math.max(drag.start, drag.end) } : null;
                    return (
                        <div key={room.id} style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                            <div className="cal-sticky" style={{ width: ROOM_COL, padding: '0.6rem 0.75rem', fontWeight: 600, fontSize: '0.9rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                {room.name}
                                {room.type && <span style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontWeight: 400 }}>{room.type}</span>}
                            </div>
                            <div style={{ position: 'relative', width: trackWidth, height: '52px' }}>
                                {/* Day cells: click or drag on free nights to book */}
                                <div style={{ display: 'flex', height: '100%' }}>
                                    {days.map((d, i) => {
                                        const free = isFree(room.name, i);
                                        return (
                                            <div
                                                key={i}
                                                className={free ? 'calendar-empty-slot' : ''}
                                                style={{ width: cellW, height: '100%', backgroundColor: dayBg(d), borderLeft: monthEdge(d, i), cursor: free ? 'cell' : 'default' }}
                                                onMouseDown={(e) => startDrag(room.name, i, e)}
                                                onMouseEnter={() => extendDrag(room.name, i)}
                                                title={free ? `Book ${room.name} from ${format(d, 'EEE d MMM')}` : undefined}
                                            />
                                        );
                                    })}
                                </div>

                                {/* Drag selection */}
                                {sel && (
                                    <div className="drag-selection" style={{ left: sel.lo * cellW + 2, width: (sel.hi - sel.lo + 1) * cellW - 4 }}>
                                        {sel.hi - sel.lo + 1} night{sel.hi === sel.lo ? '' : 's'}
                                    </div>
                                )}

                                {/* One bar per stay covering its nights only: check-in day up to (not including)
                                    the check-out day, so the check-out day reads as free for a new booking */}
                                {roomBookings.map(b => {
                                    const startIdx = differenceInDays(b.checkIn, currentDate);
                                    const endIdx = differenceInDays(b.checkOut, currentDate);
                                    const clippedStart = startIdx < 0;
                                    const clippedEnd = endIdx > daysCount;
                                    const from = clippedStart ? 0 : startIdx;
                                    const to = clippedEnd ? daysCount : endIdx;
                                    const width = (to - from) * cellW - 4;
                                    if (width <= 0) return null;
                                    const badge = SOURCE_BADGES[b.bookingSource];
                                    return (
                                        <div
                                            key={b.key}
                                            className="booking-bar"
                                            style={{
                                                left: from * cellW + 2,
                                                width,
                                                backgroundColor: b.color,
                                                borderTopLeftRadius: clippedStart ? 0 : 8,
                                                borderBottomLeftRadius: clippedStart ? 0 : 8,
                                                borderTopRightRadius: clippedEnd ? 0 : 8,
                                                borderBottomRightRadius: clippedEnd ? 0 : 8,
                                                opacity: b.status === 'completed' ? 0.75 : 1
                                            }}
                                            onClick={() => { setHover(null); openEdit(b); }}
                                            onMouseEnter={(e) => showHover(b, e)}
                                            onMouseLeave={hideHover}
                                        >
                                            {badge && <span className="source-badge" style={{ backgroundColor: badge.bg }} title={badge.title}>{badge.letter}</span>}
                                            {b.breakfast && <span title="Breakfast included">🍳</span>}
                                            <span className="booking-bar-name">{width > 70 ? b.guestName : b.guestName.split(' ')[0]}</span>
                                            {width > 150 && <span className="booking-bar-nights">{b.nights}n</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}

                {/* Occupancy per day */}
                <div style={{ display: 'flex' }}>
                    <div className="cal-sticky" style={{ width: ROOM_COL, padding: '0.45rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-light)' }}>Rooms booked</div>
                    {days.map((d, i) => {
                        const n = occupancyPerDay[i];
                        const pct = rooms.length ? n / rooms.length : 0;
                        return (
                            <div key={i} style={{ width: cellW, textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, padding: '0.45rem 0', borderLeft: monthEdge(d, i), color: pct >= 1 ? 'white' : pct > 0 ? '#92400e' : 'var(--text-light)', backgroundColor: pct >= 1 ? '#16a34a' : pct > 0 ? `rgba(251, 191, 36, ${0.2 + pct * 0.5})` : 'transparent' }}>
                                {n}/{rooms.length}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );

    return (
        <div id="dashboard-container" ref={containerRef} className="animate-slide-up" style={{ backgroundColor: isFullScreen ? 'var(--background)' : 'transparent', padding: isFullScreen ? '1.5rem' : '0', overflowY: isFullScreen ? 'auto' : 'visible' }}>
            {!isFullScreen && (
                <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <div>
                        <h1 className="page-title">Dashboard</h1>
                        <p style={{ color: 'var(--text-light)', marginTop: '0.25rem', fontSize: '0.95rem' }}>{format(today, 'EEEE, d MMMM yyyy')}</p>
                    </div>
                    <Link to="/add" className="btn btn-primary" style={{ textDecoration: 'none' }}><Plus size={18} /> New Booking</Link>
                </div>
            )}

            {!loading && summary}

            {isNarrow && !isFullScreen ? (loading ? <p>Loading...</p> : mobileList) : (
                <div className="card" style={{ minHeight: isFullScreen ? '100%' : 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button className="btn" style={{ padding: '0.4rem', border: '1px solid var(--border)', background: 'white' }} onClick={() => setCurrentDate(d => addDays(d, -7))} title="Back one week">
                                <ChevronLeft size={18} />
                            </button>
                            <button className="btn" style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--border)', background: isSameDay(currentDate, today) ? '#eef2ff' : 'white', fontWeight: 600 }} onClick={() => setCurrentDate(today)}>
                                Today
                            </button>
                            <button className="btn" style={{ padding: '0.4rem', border: '1px solid var(--border)', background: 'white' }} onClick={() => setCurrentDate(d => addDays(d, 7))} title="Forward one week">
                                <ChevronRight size={18} />
                            </button>
                            <h2 style={{ margin: '0 0 0 0.5rem', fontSize: '1.15rem' }}>
                                {format(days[0], 'd MMM')} – {format(days[days.length - 1], 'd MMM yyyy')}
                            </h2>
                        </div>

                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                            <input
                                type="date"
                                className="form-control"
                                style={{ padding: '0.4rem 0.5rem', fontSize: '0.9rem', width: 'auto' }}
                                value={format(currentDate, 'yyyy-MM-dd')}
                                onChange={(e) => { if (e.target.value) setCurrentDate(startOfDay(parseISO(e.target.value))); }}
                                title="Jump to date"
                            />
                            <select className="form-control" style={{ padding: '0.4rem 0.5rem', fontSize: '0.9rem', width: 'auto' }} value={daysCount} onChange={(e) => setDaysCount(Number(e.target.value))}>
                                <option value={7}>7 days</option>
                                <option value={14}>14 days</option>
                                <option value={30}>30 days</option>
                                <option value={60}>60 days</option>
                            </select>
                            <button className="btn" style={{ padding: '0.4rem', border: '1px solid var(--border)', background: 'white' }} onClick={toggleFullScreen} title="Toggle full screen">
                                {isFullScreen ? <Minimize size={20} /> : <Maximize size={20} />}
                            </button>
                        </div>
                    </div>

                    <div style={{ marginTop: '0.85rem' }}>{legend}</div>

                    {loading ? <p className="mt-4">Loading calendar...</p> : calendar}
                </div>
            )}

            {hover && !drag && (
                <HoverCard
                    booking={hover.booking}
                    rect={hover.rect}
                    onEnter={keepHover}
                    onLeave={hideHover}
                    onEdit={() => { setHover(null); openEdit(hover.booking); }}
                    onSettle={() => { setSettleBooking(hover.booking); setHover(null); }}
                />
            )}

            {settleBooking && (
                <SettleDialog booking={settleBooking} onClose={() => setSettleBooking(null)} onDone={afterSettle} />
            )}
        </div>
    );
}
