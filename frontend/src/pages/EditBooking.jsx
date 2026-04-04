import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { differenceInDays, parseISO, startOfDay, format, addDays } from 'date-fns';
import { Plus, X } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

export default function EditBooking() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [formData, setFormData] = useState({
        guestName: '', phoneNo: '', nicOrPassport: '', checkInDate: '', checkOutDate: '',
        selectedRooms: [], unitPrice: '', totalAmount: '',
        remarks: '', bookingSource: 'Manual'
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
    }, [id]);

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
        const { name, value } = e.target;
        let updates = { [name]: value };
        
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
            advancedPayments: JSON.stringify(advancedPayments)
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
                navigate('/bookings');
            }
        } catch (err) {
            setSubmitError(err.message);
        }
    };

    if (loading) return <div>Loading booking details...</div>;

    return (
        <div className="animate-slide-up">
            <div className="page-header">
                <h1 className="page-title">Edit Reservation #{id}</h1>
            </div>

            <div className="card" style={{ maxWidth: '800px', margin: '0 auto' }}>
                {submitError && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
                        <div className="animate-slide-up" style={{ padding: '2rem 3rem', backgroundColor: 'white', color: '#b91c1c', borderRadius: '0.75rem', fontWeight: 600, border: '2px solid #ef4444', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', textAlign: 'center' }}>
                            <div style={{ fontSize: '3rem', lineHeight: 1 }}>⚠️</div>
                            <span style={{ fontSize: '1.25rem' }}>{submitError}</span>
                            <button type="button" onClick={() => setSubmitError('')} style={{ marginTop: '0.5rem', background: '#fee2e2', border: 'none', color: '#b91c1c', cursor: 'pointer', fontWeight: 'bold', padding: '0.5rem 2.5rem', borderRadius: '0.5rem', fontSize: '1.05rem' }}>Dismiss</button>
                        </div>
                    </div>
                )}
                <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
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
                    <div style={{ gridColumn: 'span 1' }}></div>

                    <div className="form-group" style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                        <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>Billing & Payments</h3>
                    </div>
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
