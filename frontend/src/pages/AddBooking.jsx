import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { differenceInDays, parseISO, startOfDay, format } from 'date-fns';
import { Plus, X } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

export default function AddBooking() {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        guestName: '', phoneNo: '', nicOrPassport: '', checkInDate: '', checkOutDate: '',
        roomName: 'Standard 1', unitPrice: '', totalAmount: '',
        remarks: '', bookingSource: 'Manual'
    });

    const [advancedPayments, setAdvancedPayments] = useState([]);
    const [submitError, setSubmitError] = useState('');

    // Auto-calculate total amount
    useEffect(() => {
        if (formData.checkInDate && formData.checkOutDate && formData.unitPrice) {
            const checkIn = startOfDay(parseISO(formData.checkInDate));
            const checkOut = startOfDay(parseISO(formData.checkOutDate));
            const days = differenceInDays(checkOut, checkIn);
            if (days > 0) {
                const newTotal = (days * parseFloat(formData.unitPrice)).toString();
                if (formData.totalAmount !== newTotal) {
                    setFormData(prev => ({ ...prev, totalAmount: newTotal }));
                }
            }
        }
    }, [formData.checkInDate, formData.checkOutDate, formData.unitPrice]);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
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
            advancedAmount: totalPaid,
            advancedPayments: JSON.stringify(advancedPayments)
        };

        try {
            const res = await fetchWithAuth('http://localhost:3001/api/reservations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok) {
                setSubmitError(data.error || 'Failed to save booking');
            } else {
                navigate('/bookings');
            }
        } catch (err) {
            setSubmitError(err.message);
        }
    };

    return (
        <div className="animate-slide-up">
            <div className="page-header">
                <h1 className="page-title">Add New Reservation</h1>
            </div>

            <div className="card" style={{ maxWidth: '800px', margin: '0 auto' }}>
                {submitError && (
                    <div className="animate-slide-up" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 9999, padding: '2rem 3rem', backgroundColor: 'white', color: '#b91c1c', borderRadius: '0.75rem', fontWeight: 600, border: '2px solid #ef4444', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 9999px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '3rem', lineHeight: 1 }}>⚠️</div>
                        <span style={{ fontSize: '1.25rem' }}>{submitError}</span>
                        <button type="button" onClick={() => setSubmitError('')} style={{ marginTop: '0.5rem', background: '#fee2e2', border: 'none', color: '#b91c1c', cursor: 'pointer', fontWeight: 'bold', padding: '0.5rem 2.5rem', borderRadius: '0.5rem', fontSize: '1.05rem' }}>Dismiss</button>
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
                        <input required type="text" className="form-control" name="nicOrPassport" value={formData.nicOrPassport} onChange={handleChange} />
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
                        <label className="form-label">Assign Room</label>
                        <select className="form-control" name="roomName" onChange={handleChange} value={formData.roomName}>
                            <option value="Standard 1">Standard 1</option>
                            <option value="Standard 2">Standard 2</option>
                            <option value="Standard 3">Standard 3</option>
                            <option value="Standard 4">Standard 4</option>
                            <option value="Family Studio">Family Studio</option>
                        </select>
                    </div>
                    <div style={{ gridColumn: 'span 1' }}></div>

                    <div className="form-group" style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                        <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>Billing & Payments</h3>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Unit Price / Night (LKR)</label>
                        <input required type="number" className="form-control" name="unitPrice" value={formData.unitPrice} onChange={handleChange} />
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
                        <input required type="number" className="form-control" name="totalAmount" value={formData.totalAmount} onChange={handleChange} />
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
                        <textarea className="form-control" name="remarks" value={formData.remarks} onChange={handleChange} rows="3"></textarea>
                    </div>

                    <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                        <button type="submit" className="btn btn-primary" style={{ padding: '0.75rem 2rem', fontSize: '1.05rem' }}>
                            Save Reservation
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
