import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { differenceInDays, parseISO, startOfDay, format, addDays } from 'date-fns';
import { Plus, X, Trash2, CheckCircle2, Save, HandCoins } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { notifyDataChanged } from '../utils/notifications';
import { groupReservations, lkr } from '../utils/bookings';
import SettleDialog from '../components/SettleDialog';
import ProcessingOverlay from '../components/ProcessingOverlay';

export default function EditBooking() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [groupRows, setGroupRows] = useState([]);
    const [reloadKey, setReloadKey] = useState(0);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [settling, setSettling] = useState(false);
    const [busy, setBusy] = useState(null); // 'delete' while deleting
    const [formData, setFormData] = useState({
        guestName: '', phoneNo: '', nicOrPassport: '', checkInDate: '', checkOutDate: '',
        selectedRooms: [], unitPrice: '', totalAmount: '',
        remarks: '', bookingSource: 'Manual', usdAmount: '', conversionRate: '', breakfastIncluded: false
    });
    const [lastEditedAmount, setLastEditedAmount] = useState('unitPrice');
    const [advancedPayments, setAdvancedPayments] = useState([]);
    const [submitError, setSubmitError] = useState('');

    const [allRooms, setAllRooms] = useState([]);
    const [allReservations, setAllReservations] = useState([]);
    const [availableRooms, setAvailableRooms] = useState([]);

    useEffect(() => {
        Promise.all([
            fetchWithAuth(`/api/reservations/group/${id}`).then(res => res.json()),
            fetchWithAuth('/api/rooms').then(res => res.json()),
            fetchWithAuth('/api/reservations').then(res => res.json())
        ]).then(([bookingData, roomsData, allResData]) => {
            if (bookingData.data && bookingData.data.length > 0) {
                const group = bookingData.data;
                setGroupRows(group);
                const firstRow = group[0];
                const sanitizedData = { ...firstRow };
                Object.keys(sanitizedData).forEach(key => {
                    if (sanitizedData[key] === null) {
                        sanitizedData[key] = '';
                    }
                });
                
                const numRooms = group.length;
                sanitizedData.selectedRooms = group.map(r => r.roomName);
                
                let sumTotal = group.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
                sanitizedData.totalAmount = sumTotal.toString();
                sanitizedData.advancedAmount = group.reduce((sum, r) => sum + Number(r.advancedAmount || 0), 0);

                const sumUsd = group.reduce((sum, r) => sum + Number(r.usdAmount || 0), 0);
                sanitizedData.usdAmount = sumUsd ? sumUsd.toString() : '';
                sanitizedData.conversionRate = firstRow.conversionRate ? firstRow.conversionRate.toString() : '';
                sanitizedData.breakfastIncluded = (firstRow.breakfastIncluded === 1 || firstRow.breakfastIncluded === true || firstRow.breakfastIncluded === '1' || firstRow.breakfastIncluded === 'true');
                
                setFormData(sanitizedData);

                try {
                    const parsed = sanitizedData.advancedPayments ? JSON.parse(sanitizedData.advancedPayments) : [];
                    if (parsed.length === 0 && sanitizedData.advancedAmount) {
                        setAdvancedPayments([{ date: sanitizedData.checkInDate || format(new Date(), 'yyyy-MM-dd'), amount: sanitizedData.advancedAmount }]);
                    } else {
                        const scaledParsed = parsed.map(p => ({ ...p, amount: Number(p.amount || 0) * numRooms }));
                        setAdvancedPayments(scaledParsed);
                    }
                } catch (e) {
                    setAdvancedPayments([]);
                }
            }

            const sortedRooms = (roomsData.data || []).sort((a, b) => {
                if (a.name === 'Family Studio') return 1;
                if (b.name === 'Family Studio') return -1;
                return a.name.localeCompare(b.name);
            });
            setAllRooms(sortedRooms);
            setAvailableRooms(sortedRooms);
            setAllReservations(allResData.data || []);
            setLoading(false);
        }).catch(err => {
            console.error(err);
            setLoading(false);
        });
    }, [id, reloadKey]);

    const booking = groupRows.length > 0 ? groupReservations(groupRows)[0] : null;

    const handleDelete = async () => {
        setBusy('delete');
        try {
            const res = await fetchWithAuth(`/api/reservations/group/${id}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to delete reservation');
            notifyDataChanged();
            navigate('/');
        } catch (err) {
            setConfirmingDelete(false);
            setSubmitError(err.message);
        } finally {
            setBusy(null);
        }
    };


    useEffect(() => {
        if (!formData.checkInDate || !formData.checkOutDate) {
            setAvailableRooms(allRooms);
            return;
        }
        const checkIn = startOfDay(parseISO(formData.checkInDate));
        const checkOut = startOfDay(parseISO(formData.checkOutDate));

        const available = allRooms.filter(room => {
            const isBooked = allReservations.some(res => {
                if ((res.groupId && String(res.groupId) === String(id)) || String(res.id) === String(id)) return false;
                if (res.roomName !== room.name) return false;
                const resIn = startOfDay(parseISO(res.checkInDate));
                const resOut = startOfDay(parseISO(res.checkOutDate));
                return resIn < checkOut && resOut > checkIn;
            });
            return !isBooked;
        });

        setAvailableRooms(available);

        if (formData.selectedRooms && formData.selectedRooms.length > 0) {
            const newSelected = formData.selectedRooms.filter(r => available.some(ar => ar.name === r));
            if (newSelected.length !== formData.selectedRooms.length) {
                setFormData(prev => ({ ...prev, selectedRooms: newSelected }));
            }
        }
    }, [formData.checkInDate, formData.checkOutDate, allRooms, allReservations, id]);

    // Auto-calculate total amount or unit price
    useEffect(() => {
        if (formData.usdAmount && formData.conversionRate && !loading) {
            const calculatedTotal = parseFloat(formData.usdAmount) * parseFloat(formData.conversionRate);
            if (!isNaN(calculatedTotal) && calculatedTotal > 0) {
                if (parseFloat(formData.totalAmount) !== calculatedTotal) {
                    setFormData(prev => ({ ...prev, totalAmount: calculatedTotal.toString() }));
                    setLastEditedAmount('totalAmount');
                }
            }
        }

        if (formData.checkInDate && formData.checkOutDate && !loading) {
            const checkIn = startOfDay(parseISO(formData.checkInDate));
            const checkOut = startOfDay(parseISO(formData.checkOutDate));
            const days = differenceInDays(checkOut, checkIn);
            const numRooms = formData.selectedRooms && formData.selectedRooms.length > 0 ? formData.selectedRooms.length : 1;

            if (days > 0) {
                if (lastEditedAmount === 'unitPrice' && formData.unitPrice !== '') {
                    const expectedTotal = days * parseFloat(formData.unitPrice) * numRooms;
                    if (formData.totalAmount === '' || Math.abs(parseFloat(formData.totalAmount) - expectedTotal) > 0.01) {
                        setFormData(prev => ({ ...prev, totalAmount: parseFloat(expectedTotal.toFixed(2)).toString() }));
                    }
                } else if (lastEditedAmount === 'totalAmount' && formData.totalAmount !== '') {
                    const expectedUnit = parseFloat(formData.totalAmount) / (days * numRooms);
                    if (formData.unitPrice === '' || Math.abs(parseFloat(formData.unitPrice) - expectedUnit) > 0.01) {
                        setFormData(prev => ({ ...prev, unitPrice: parseFloat(expectedUnit.toFixed(2)).toString() }));
                    }
                }
            }
        }
    }, [formData.checkInDate, formData.checkOutDate, formData.unitPrice, formData.totalAmount, formData.selectedRooms, loading, lastEditedAmount]);

    const handleRoomChange = (e) => {
        const options = e.target.options;
        const selected = [];
        for (let i = 0; i < options.length; i++) {
            if (options[i].selected) {
                selected.push(options[i].value);
            }
        }
        setFormData({ ...formData, selectedRooms: selected });
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        const val = type === 'checkbox' ? checked : value;
        let updates = { [name]: val };
        
        if (name === 'checkInDate' && value) {
            const newCheckIn = startOfDay(parseISO(value));
            const currentCheckOut = formData.checkOutDate ? startOfDay(parseISO(formData.checkOutDate)) : null;
            
            if (!currentCheckOut || currentCheckOut <= newCheckIn) {
                updates.checkOutDate = format(addDays(newCheckIn, 1), 'yyyy-MM-dd');
            }
        }
        
        setFormData(prev => ({ ...prev, ...updates }));
    };

    const handleAmountChange = (e) => {
        setLastEditedAmount(e.target.name);
        handleChange(e);
    };

    const handleAddPayment = () => {
        setAdvancedPayments([...advancedPayments, { date: format(new Date(), 'yyyy-MM-dd'), amount: '' }]);
    };

    const handlePaymentChange = (index, field, value) => {
        const newP = [...advancedPayments];
        newP[index][field] = value;
        setAdvancedPayments(newP);
    };

    const handleRemovePayment = (index) => {
        setAdvancedPayments(advancedPayments.filter((_, i) => i !== index));
    };

    const totalPaid = advancedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const pendingAmount = Number(formData.totalAmount || 0) - totalPaid;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitError('');
        const payload = {
            ...formData,
            roomNames: formData.selectedRooms,
            advancedAmount: totalPaid,
            advancedPayments: JSON.stringify(advancedPayments),
            breakfastIncluded: (formData.breakfastIncluded === true || formData.breakfastIncluded === 1 || formData.breakfastIncluded === '1' || formData.breakfastIncluded === 'true') ? 1 : 0
        };
        delete payload.selectedRooms;

        try {
            const res = await fetchWithAuth(`/api/reservations/group/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok) {
                setSubmitError(data.error || 'Failed to update booking');
            } else {
                notifyDataChanged();
                navigate('/');
            }
        } catch (err) {
            setSubmitError(err.message);
        }
    };

    if (loading) return <div>Loading booking details...</div>;

    return (
        <div className="animate-slide-up">
            <ProcessingOverlay show={busy === 'delete'} message="Deleting reservation..." />

            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', maxWidth: '800px', margin: '0 auto 1.5rem' }}>
                <div>
                    <h1 className="page-title">Edit Reservation</h1>
                    {booking && (
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-light)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {booking.pending > 0.05 ? (
                                <span style={{ color: '#b45309', fontWeight: 600 }}>Balance due {lkr(booking.pending)}</span>
                            ) : (
                                <span style={{ color: 'var(--success)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                    <CheckCircle2 size={14} /> Fully paid{booking.ended ? ' · stay completed' : ''}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                {booking && (
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {/* Submits the form below via its id, so it can sit outside the form */}
                        <button type="submit" form="booking-form" className="btn btn-primary">
                            <Save size={16} /> Update
                        </button>
                        {booking.pending > 0.05 && (
                            <button type="button" className="btn" onClick={() => setSettling(true)} style={{ backgroundColor: '#10b981', color: 'white' }}>
                                <HandCoins size={16} /> Settle
                            </button>
                        )}
                        <button type="button" className="btn" onClick={() => setConfirmingDelete(true)} style={{ backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' }}>
                            <Trash2 size={16} /> Delete
                        </button>
                    </div>
                )}
            </div>

            {/* After a payment, reload so the form's payment list includes it (saving would otherwise drop it) */}
            {settling && booking && (
                <SettleDialog
                    booking={booking}
                    onClose={() => setSettling(false)}
                    onDone={() => { setSettling(false); setReloadKey(k => k + 1); }}
                />
            )}

            {confirmingDelete && booking && (
                <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 1700, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15, 23, 42, 0.6)', padding: '1.5rem' }}>
                    <div className="card animate-slide-up" style={{ maxWidth: '420px', width: '100%', textAlign: 'center' }}>
                        <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#fee2e2', color: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                            <Trash2 size={26} />
                        </div>
                        <h3 style={{ margin: '0 0 0.5rem 0' }}>Delete this reservation?</h3>
                        <p style={{ color: 'var(--text-light)', fontSize: '0.9rem', margin: '0 0 1.5rem 0' }}>
                            <b style={{ color: 'var(--text)' }}>{booking.guestName}</b> · {booking.rooms.join(', ')}<br />
                            {format(booking.checkIn, 'd MMM')} → {format(booking.checkOut, 'd MMM yyyy')}. This also removes its payment records and cannot be undone.
                        </p>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button type="button" className="btn" onClick={() => setConfirmingDelete(false)} style={{ flex: 1, border: '1px solid var(--border)', backgroundColor: 'white' }}>Cancel</button>
                            <button type="button" className="btn" onClick={handleDelete} disabled={busy === 'delete'} style={{ flex: 1, backgroundColor: 'var(--danger)', color: 'white', fontWeight: 600 }}>
                                Yes, Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="card" style={{ maxWidth: '800px', margin: '0 auto' }}>
                {submitError && (
                    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
                        <div className="animate-slide-up" style={{ padding: '2rem 3rem', backgroundColor: 'white', color: '#b91c1c', borderRadius: '0.75rem', fontWeight: 600, border: '2px solid #ef4444', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', textAlign: 'center' }}>
                            <div style={{ fontSize: '3rem', lineHeight: 1 }}>⚠️</div>
                            <span style={{ fontSize: '1.25rem' }}>{submitError}</span>
                            <button type="button" onClick={() => setSubmitError('')} style={{ marginTop: '0.5rem', background: '#fee2e2', border: 'none', color: '#b91c1c', cursor: 'pointer', fontWeight: 'bold', padding: '0.5rem 2.5rem', borderRadius: '0.5rem', fontSize: '1.05rem' }}>Dismiss</button>
                        </div>
                    </div>
                )}
                <form id="booking-form" onSubmit={handleSubmit} className="stack-on-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                        <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>Guest Information</h3>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Guest Name</label>
                        <input required type="text" className="form-control" name="guestName" value={formData.guestName} onChange={handleChange} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">NIC or Passport</label>
                        <input type="text" className="form-control" name="nicOrPassport" value={formData.nicOrPassport} onChange={handleChange} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Phone No</label>
                        <input type="text" className="form-control" name="phoneNo" value={formData.phoneNo} onChange={handleChange} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Booking Source</label>
                        <select className="form-control" name="bookingSource" onChange={handleChange} value={formData.bookingSource}>
                            <option value="Manual">Manual Entry</option>
                            <option value="Booking.com">Booking.com</option>
                        </select>
                    </div>

                    <div className="form-group" style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                        <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>Stay Details</h3>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Check-in Date</label>
                        <input required type="date" className="form-control" name="checkInDate" value={formData.checkInDate} onChange={handleChange} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Check-out Date</label>
                        <input required type="date" className="form-control" name="checkOutDate" value={formData.checkOutDate} onChange={handleChange} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Assign Room(s)</label>
                        <select multiple className="form-control" style={{ height: '120px' }} value={formData.selectedRooms} onChange={handleRoomChange}>
                            {availableRooms.map(room => (
                                <option key={room.id} value={room.name}>{room.name} ({room.type})</option>
                            ))}
                        </select>
                        {formData.checkInDate && formData.checkOutDate && availableRooms.length === 0 && (
                            <small style={{ color: 'var(--danger)', display: 'block', marginTop: '0.25rem', fontWeight: 600 }}>No rooms available for these dates!</small>
                        )}
                        <small style={{ color: 'var(--text-light)', display: 'block', marginTop: '0.25rem' }}>Hold Ctrl (Windows) or Cmd (Mac) to select multiple rooms</small>
                    </div>
                    <div className="form-group" style={{ gridColumn: 'span 1', display: 'flex', alignItems: 'center', marginTop: '1.5rem' }}>
                        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600, userSelect: 'none', backgroundColor: formData.breakfastIncluded ? '#fef3c7' : '#f8fafc', color: formData.breakfastIncluded ? '#92400e' : 'var(--text)', padding: '0.6rem 1rem', borderRadius: '0.5rem', border: '1px solid ' + (formData.breakfastIncluded ? '#f59e0b' : 'var(--border)'), width: '100%', transition: 'all 0.15s ease' }}>
                            <input
                                type="checkbox"
                                name="breakfastIncluded"
                                checked={formData.breakfastIncluded}
                                onChange={handleChange}
                                style={{ width: '1.2rem', height: '1.2rem', accentColor: '#d97706', cursor: 'pointer' }}
                            />
                            <span>🍳 Breakfast Included</span>
                        </label>
                    </div>

                    <div className="form-group" style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                        <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>Billing & Payments</h3>
                    </div>
                    {formData.bookingSource === 'Booking.com' && (
                        <>
                            <div className="form-group" style={{ gridColumn: 'span 2', marginTop: '0.5rem', marginBottom: '-0.5rem' }}>
                                <h4 style={{ margin: 0, color: 'var(--success)' }}>Foreign Currency Calculator (Optional)</h4>
                            </div>
                            <div className="form-group">
                                <label className="form-label" style={{ color: 'var(--success)' }}>USD Amount ($)</label>
                                <input type="number" step="any" className="form-control" name="usdAmount" value={formData.usdAmount || ''} onChange={handleAmountChange} placeholder="e.g. 100" style={{ borderColor: 'var(--success)' }} />
                            </div>
                            <div className="form-group">
                                <label className="form-label" style={{ color: 'var(--success)' }}>Conversion Rate (LKR / 1 USD)</label>
                                <input type="number" step="any" className="form-control" name="conversionRate" value={formData.conversionRate || ''} onChange={handleAmountChange} placeholder="e.g. 300" style={{ borderColor: 'var(--success)' }} />
                            </div>
                        </>
                    )}
                    <div className="form-group">
                        <label className="form-label">Unit Price / Night (LKR)</label>
                        <input required type="number" step="any" className="form-control" name="unitPrice" value={formData.unitPrice || ''} onChange={handleAmountChange} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">
                            Total Amount (LKR)
                            {formData.checkInDate && formData.checkOutDate && differenceInDays(startOfDay(parseISO(formData.checkOutDate)), startOfDay(parseISO(formData.checkInDate))) > 0 && (
                                <span style={{ fontWeight: 'normal', color: 'var(--text-light)', marginLeft: '0.5rem' }}>
                                    ({differenceInDays(startOfDay(parseISO(formData.checkOutDate)), startOfDay(parseISO(formData.checkInDate)))} nights)
                                </span>
                            )}
                        </label>
                        <input required type="number" step="any" className="form-control" name="totalAmount" value={formData.totalAmount || ''} onChange={handleAmountChange} />
                    </div>

                    <div className="form-group" style={{ gridColumn: 'span 2', backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <span style={{ fontWeight: 600 }}>Advanced Payments</span>
                            <button type="button" onClick={handleAddPayment} className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                                <Plus size={16} /> Add Payment
                            </button>
                        </div>

                        {advancedPayments.length === 0 && <div style={{ fontSize: '0.9rem', color: 'var(--text-light)', fontStyle: 'italic', marginBottom: '1rem' }}>No advanced payments recorded.</div>}

                        {advancedPayments.map((payment, index) => (
                            <div key={index} style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <input type="date" className="form-control" style={{ flex: 1, padding: '0.4rem' }} value={payment.date} onChange={(e) => handlePaymentChange(index, 'date', e.target.value)} required />
                                <input type="number" className="form-control" style={{ flex: 1, padding: '0.4rem' }} placeholder="Amount (LKR)" value={payment.amount} onChange={(e) => handlePaymentChange(index, 'amount', e.target.value)} required />
                                <button type="button" onClick={() => handleRemovePayment(index)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0.4rem' }} title="Remove Payment">
                                    <X size={20} />
                                </button>
                            </div>
                        ))}

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed var(--border)' }}>
                            <div>Total Paid: <strong style={{ color: 'var(--success)' }}>{totalPaid.toLocaleString()} LKR</strong></div>
                            <div>Pending Balance: <strong style={{ color: pendingAmount > 0 ? 'var(--warning)' : (pendingAmount < 0 ? 'var(--danger)' : 'var(--success)') }}>{pendingAmount.toLocaleString()} LKR</strong></div>
                        </div>
                    </div>

                    <div className="form-group" style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                        <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>Additional Info</h3>
                        <label className="form-label mt-2">Remarks</label>
                        <textarea className="form-control" name="remarks" value={formData.remarks || ''} onChange={handleChange} rows="3"></textarea>
                    </div>

                    <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                        <button type="submit" className="btn btn-primary" style={{ padding: '0.75rem 2rem', fontSize: '1.05rem' }}>
                            Update Reservation
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
