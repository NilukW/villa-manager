import { parseISO, startOfDay, differenceInDays, format } from 'date-fns';

export const isBreakfast = (v) => v === 1 || v === true || v === '1' || v === 'true';

// Payment status colours used on the calendar, legend and cards
export const STATUS_STYLES = {
    paid: { label: 'Fully paid', color: '#16a34a' },
    partial: { label: 'Advance paid', color: '#d97706' },
    unpaid: { label: 'Not paid', color: '#dc2626' },
    checkedOut: { label: 'Checked out', color: '#94a3b8' }
};

// Collapse per-room reservation rows into one entry per booking (group), with payment totals.
// Payments are stored split per room on every row, so the first row's list × rooms is the group total,
// matching Financials. Older rows may only carry advancedAmount.
export function groupReservations(reservations) {
    const groups = {};
    reservations.forEach(r => {
        const key = r.groupId || String(r.id);
        if (!groups[key]) groups[key] = { key, rows: [] };
        groups[key].rows.push(r);
    });

    return Object.values(groups).map(({ key, rows }) => {
        const first = rows[0];
        let payments = [];
        try { payments = first.advancedPayments ? JSON.parse(first.advancedPayments) : []; } catch { payments = []; }
        const total = rows.reduce((s, r) => s + Number(r.totalAmount || 0), 0);
        const paid = payments.length > 0
            ? payments.reduce((s, p) => s + Number(p.amount || 0), 0) * rows.length
            : rows.reduce((s, r) => s + Number(r.advancedAmount || 0), 0);
        const pending = Math.round((total - paid) * 100) / 100;
        const checkIn = startOfDay(parseISO(first.checkInDate));
        const checkOut = startOfDay(parseISO(first.checkOutDate));
        const checkedOutAt = rows.map(r => r.checkedOutAt).find(Boolean) || null;
        const status = checkedOutAt ? 'checkedOut' : pending <= 0.05 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

        return {
            key,
            rows,
            guestName: first.guestName || '',
            phoneNo: first.phoneNo || '',
            bookingSource: first.bookingSource || 'Manual',
            breakfast: isBreakfast(first.breakfastIncluded),
            remarks: first.remarks || '',
            rooms: rows.map(r => r.roomName),
            checkInDate: first.checkInDate,
            checkOutDate: first.checkOutDate,
            checkIn,
            checkOut,
            nights: Math.max(0, differenceInDays(checkOut, checkIn)),
            total,
            paid,
            pending,
            checkedOutAt,
            status
        };
    });
}

// wa.me needs the number in international form; local Sri Lankan numbers start with 0
export function whatsappLink(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return null;
    const intl = digits.startsWith('0') ? `94${digits.slice(1)}` : digits;
    return `https://wa.me/${intl}`;
}

export const lkr = (val) => `LKR ${Number(val || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const shortDate = (d) => format(d instanceof Date ? d : parseISO(d), 'EEE d MMM');
