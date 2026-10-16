const { PDFParse } = require('pdf-parse');

// Generic best-effort extraction shared by all utility bill types.
// Provider-specific parsers can be layered on top once sample bills are available;
// every field stays editable in the review form, so a miss here is never fatal.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toNumber = (str) => {
    if (str === undefined || str === null) return null;
    const n = parseFloat(String(str).replace(/,/g, ''));
    return isNaN(n) ? null : n;
};

// Accepts YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY and "12 Oct 2026" / "Oct 12, 2026"
const normalizeDate = (raw) => {
    if (!raw) return '';
    const s = raw.trim();
    let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) {
        let d = parseInt(m[1], 10);
        let mo = parseInt(m[2], 10);
        // Sri Lankan bills are day-first; swap only when that is impossible
        if (mo > 12 && d <= 12) [d, mo] = [mo, d];
        return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    m = s.match(/^(\d{1,2})\s*[\-\s]?\s*([A-Za-z]{3})[a-z]*\.?\s*[\-\s,]?\s*(\d{4})$/);
    if (m) {
        const mo = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
        if (mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m) {
        const mo = MONTHS.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
        if (mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
    return '';
};

const DATE_PATTERN = '(\\d{4}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{1,2}|\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{4}|\\d{1,2}[\\s\\-]?[A-Za-z]{3,9}\\.?[\\s\\-,]*\\d{4}|[A-Za-z]{3,9}\\.?\\s+\\d{1,2},?\\s+\\d{4})';
const AMOUNT_PATTERN = '(?:Rs\\.?|LKR)?\\s*([\\d,]+(?:\\.\\d{1,2})?)';

const findDate = (text, labels) => {
    for (const label of labels) {
        const m = text.match(new RegExp(`${label}\\s*[:\\-]?\\s*${DATE_PATTERN}`, 'i'));
        if (m) {
            const d = normalizeDate(m[1]);
            if (d) return d;
        }
    }
    return '';
};

const findAmount = (text, labels) => {
    for (const label of labels) {
        const m = text.match(new RegExp(`${label}\\s*(?:\\(\\s*(?:Rs\\.?|LKR)\\s*\\))?\\s*[:\\-]?\\s*${AMOUNT_PATTERN}`, 'i'));
        if (m) {
            const n = toNumber(m[1]);
            if (n !== null) return n;
        }
    }
    return null;
};

const findText = (text, labels) => {
    for (const label of labels) {
        const m = text.match(new RegExp(`${label}\\s*[:\\-#]?\\s*([A-Za-z0-9\\-\\/]{4,})`, 'i'));
        if (m) return m[1].trim();
    }
    return '';
};

const TYPE_CONFIG = {
    electricity: {
        providers: [
            [/Ceylon\s+Electricity\s+Board|\bCEB\b/i, 'Ceylon Electricity Board'],
            [/Lanka\s+Electricity\s+Company|\bLECO\b/i, 'LECO']
        ],
        unitLabels: ['Units\\s*Consumed', 'Consumption', 'No\\.?\\s*of\\s*Units', 'Units', 'kWh']
    },
    water: {
        providers: [
            [/National\s+Water\s+Supply|\bNWSDB\b|Water\s+Board/i, 'NWSDB']
        ],
        unitLabels: ['Units\\s*Consumed', 'Consumption', 'No\\.?\\s*of\\s*Units', 'Units', 'Cubic\\s*Meters?', 'm3']
    },
    telecom: {
        providers: [
            [/Sri\s*Lanka\s+Telecom|\bSLT\b|SLT-?MOBITEL/i, 'SLT-Mobitel'],
            [/\bDialog\b/i, 'Dialog'],
            [/\bHutch\b/i, 'Hutch'],
            [/\bAirtel\b/i, 'Airtel']
        ],
        unitLabels: []
    },
    booking: {
        providers: [
            [/Booking\.com/i, 'Booking.com']
        ],
        unitLabels: []
    }
};

// --- Electricity Distribution Lanka (EDL) e-bills ---
// The PDF text layer is positional: several values carry no label and table cells
// come out tab-joined in either order, so fields are anchored on stable markers
// (Bill Ref, reading dates, "x ... =" charge lines) rather than label/value pairs.

const isEdlBill = (text) => /ebill-edl|Monthly Statement of Electricity Account/i.test(text);

const EDL_MONTH = /(\d{4})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i;
const CHARGE_LINE = /([\d,]+\.\d{2})\s*x\s*([\d,]+(?:\.\d+)?)\s*=\s*([\d,]+\.\d{2})/;

function parseEdlBill(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const result = {
        type: 'electricity',
        provider: 'EDL',
        billNo: '',
        accountNo: '',
        tariff: '',
        premises: '',
        date: '',
        month: '',
        periodFrom: '',
        periodTo: '',
        dueDate: '',
        previousReading: null,
        currentReading: null,
        unitsUsed: null,
        totalAmount: 0,
        charges: []
    };

    // Bill Ref: 457-<account>-<yyyymmddhhmmss> is unique per statement and dates it
    const ref = text.match(/Bill\s*Ref:\s*([\d]+-(\d{6,12})-(\d{8})\d*)/i);
    if (ref) {
        result.billNo = ref[1];
        result.accountNo = ref[2];
        result.date = `${ref[3].slice(0, 4)}-${ref[3].slice(4, 6)}-${ref[3].slice(6, 8)}`;
    }
    const acc = text.match(/A\/C\s*No\.?:?\s*(\d{6,12})/i);
    if (acc) result.accountNo = acc[1];

    const monthLine = lines.find(l => /Month:/i.test(l) && EDL_MONTH.test(l));
    if (monthLine) {
        const [, y, mon] = monthLine.match(EDL_MONTH);
        result.month = `${mon.charAt(0).toUpperCase()}${mon.slice(1).toLowerCase()} ${y}`;
    }

    const tariff = text.match(/Tariff:\s*([A-Za-z][A-Za-z ]*?)\s*-?\s*$/im);
    if (tariff) result.tariff = tariff[1].trim();

    // Premises address: the upper-case lines between the mobile number and "Connection:"
    const mobileIdx = lines.findIndex(l => /Reg\.?\s*Mobile/i.test(l));
    const connIdx = lines.findIndex(l => /^Connection:/i.test(l));
    if (mobileIdx >= 0 && connIdx > mobileIdx) {
        result.premises = lines.slice(mobileIdx + 1, connIdx)
            .filter(l => /^[A-Z0-9 ,.\/\-]+$/.test(l))
            .map(l => l.replace(/,\s*$/, ''))
            .join(', ');
    }

    // Meter readings appear as "<reading>\t<date>" (or reversed); the earlier date is the previous reading
    const readings = [];
    lines.forEach(l => {
        const m = l.match(/^(\d{1,7})\s+(\d{4}-\d{2}-\d{2})$/) || l.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,7})$/);
        if (!m) return;
        const [reading, date] = /-/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
        readings.push({ date, reading: Number(reading) });
    });
    readings.sort((a, b) => a.date.localeCompare(b.date));
    if (readings.length >= 2) {
        const prev = readings[readings.length - 2];
        const curr = readings[readings.length - 1];
        result.previousReading = prev.reading;
        result.currentReading = curr.reading;
        result.periodFrom = prev.date;
        result.periodTo = curr.date;
    }

    const units = text.match(/No\.?\s*of\s*Units\s*Consumed\s*\(kWh\)\s*([\d,]+(?:\.\d+)?)/i);
    if (units) result.unitsUsed = toNumber(units[1]);
    else if (result.previousReading !== null) result.unitsUsed = result.currentReading - result.previousReading;

    // Account summary: Previous Due - Payments - Credits + Debits + This Month Charge = Total Due.
    // The six numbers come out in layout order, so accept whichever ordering balances.
    // Only This Month Charge is kept: EDL's Previous Due lags behind real payments, so
    // arrears are worked out from the app's own unpaid bills instead.
    const summaryIdx = lines.findIndex(l => /Previous\s*Due\s*Payments/i.test(l));
    let thisMonthCharge = null;
    if (summaryIdx >= 0) {
        const nums = (lines[summaryIdx + 1] || '').match(/[\d,]+\.\d{2}/g)?.map(toNumber) || [];
        if (nums.length === 6) {
            const orderings = [
                ([pay, cred, deb, cur, total, prev]) => ({ prev, pay, cred, deb, cur, total }),
                ([prev, pay, cred, deb, cur, total]) => ({ prev, pay, cred, deb, cur, total })
            ];
            for (const order of orderings) {
                const s = order(nums);
                if (Math.abs(s.prev - s.pay - s.cred + s.deb + s.cur - s.total) < 0.05) {
                    thisMonthCharge = s.cur;
                    break;
                }
            }
        }
    }

    // Charge lines: "rate x qty = amount" — energy tiers come before the "Fixed Charge" header
    let section = null;
    let energyTotal = 0;
    let fixedTotal = 0;
    lines.forEach(l => {
        if (/^Charge for Units Consumed$/i.test(l)) section = 'energy';
        else if (/^Fixed Charge$/i.test(l)) section = 'fixed';
        const m = l.match(CHARGE_LINE);
        if (!m || !section) return;
        const rate = m[1];
        const qty = toNumber(m[2]);
        const amount = toNumber(m[3]);
        if (section === 'energy') {
            energyTotal += amount;
            result.charges.push({ description: `Energy ${qty} kWh @ Rs. ${rate}`, amount });
        } else {
            fixedTotal += amount;
            result.charges.push({ description: 'Fixed charge', amount });
        }
    });

    const consumed = text.match(/([\d,]+\.\d{2})\s+Charge for Electricity Consumed|Charge for Electricity Consumed\s*\(Rs\.\)\s*([\d,]+\.\d{2})/i);
    const consumedAmount = consumed ? toNumber(consumed[1] || consumed[2]) : energyTotal + fixedTotal;

    // The SSCL levy has no label in the text layer; it is the gap between the taxed and untaxed charge
    if (thisMonthCharge !== null) {
        const levy = Math.round((thisMonthCharge - consumedAmount) * 100) / 100;
        if (levy > 0) result.charges.push({ description: 'SSCL levy', amount: levy });
        result.totalAmount = thisMonthCharge;
    } else {
        result.totalAmount = consumedAmount;
    }

    if (!result.date) result.date = result.periodTo || new Date().toISOString().split('T')[0];
    return result;
}

// --- National Water Supply & Drainage Board (NWSDB) e-bills ---
// Header cells come out as "LABEL :" on one line and the value on the following line(s);
// the charge table is clean "Label amount" lines.

const isNwsdbBill = (text) => /National Water Supply\s*&\s*Drainage Board|N\.W\.S\.\s*&\s*D\.B\./i.test(text);

// Value lines that follow a "LABEL :" line, up to the next "LABEL :" line
const valueAfter = (lines, labelPattern) => {
    const idx = lines.findIndex(l => labelPattern.test(l));
    if (idx < 0) return [];
    const values = [];
    for (let i = idx + 1; i < lines.length && !/:\s*$/.test(lines[i]); i++) values.push(lines[i]);
    return values;
};

function parseNwsdbBill(text) {
    // Bullets in the charge table come through as C1 control characters (e.g. U+0087)
    const lines = text.split('\n').map(l => l.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').trim()).filter(Boolean);
    const result = {
        type: 'water',
        provider: 'NWSDB',
        billNo: '',
        accountNo: '',
        tariff: '',
        premises: '',
        date: '',
        month: '',
        periodFrom: '',
        periodTo: '',
        dueDate: '',
        previousReading: null,
        currentReading: null,
        unitsUsed: null,
        totalAmount: 0,
        charges: []
    };

    result.accountNo = (valueAfter(lines, /^ACCT NO\s*:/i)[0] || '').trim();
    // Invoice number wraps across lines, e.g. "26OCT_3348" + "_605873"
    result.billNo = valueAfter(lines, /^INVOICE NO\s*:/i).join('').replace(/\s+/g, '');

    const category = valueAfter(lines, /^CATEGORY\s*:/i)[0];
    if (category) result.tariff = `Category ${category}`;

    // Address block starts with the account holder's name, which is not part of the premises
    result.premises = valueAfter(lines, /^ADDRESS\s*:/i)
        .filter(l => !/^(MR|MRS|MS|MISS|REV|DR|DRS)\.?\s/i.test(l))
        .join(', ');

    // Due date is the rebate deadline (paying by then earns a discount); the later
    // "Final date for payment" is only used when no rebate date is printed
    const rebate = text.match(/For Rebate Pay on or before this Date\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    result.dueDate = normalizeDate(rebate ? rebate[1] : (valueAfter(lines, /^PAYMENT\s*:/i)[0] || ''));

    // Bill date is printed under the "e-Bill" heading
    const eBillIdx = lines.findIndex(l => /e-Bill$/i.test(l));
    if (eBillIdx >= 0) result.date = normalizeDate(lines[eBillIdx + 1] || '');

    const period = text.match(/From\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+To\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (period) {
        result.periodFrom = normalizeDate(period[1]);
        result.periodTo = normalizeDate(period[2]);
    }

    const num = (pattern) => {
        const m = text.match(pattern);
        return m ? toNumber(m[1]) : null;
    };
    result.currentReading = num(/Current Reading\s+([\d,]+(?:\.\d+)?)/i);
    result.previousReading = num(/Previous Reading\s+([\d,]+(?:\.\d+)?)/i);
    result.unitsUsed = num(/Consumption \(m3\)\s+([\d,]+(?:\.\d+)?)/i);
    if (result.unitsUsed === null && result.currentReading !== null && result.previousReading !== null) {
        result.unitsUsed = result.currentReading - result.previousReading;
    }

    // Charge table rows between the consumption figures and "Charges This Month"; zero rows are dropped
    const startIdx = lines.findIndex(l => /^Extra Consumption/i.test(l));
    const endIdx = lines.findIndex(l => /^Charges This Month/i.test(l));
    if (startIdx >= 0 && endIdx > startIdx) {
        lines.slice(startIdx + 1, endIdx).forEach(l => {
            const m = l.match(/^([A-Za-z][A-Za-z \/]*?)\s+(-?[\d,]+\.\d{2,4})$/);
            if (!m) return;
            const amount = toNumber(m[2]);
            if (amount) result.charges.push({ description: m[1].trim(), amount: Math.round(amount * 100) / 100 });
        });
    }

    // Only this month's charge counts; "Dues Previous Month" mirrors NWSDB's own ledger and
    // arrears are worked out from the app's unpaid bills instead
    const thisMonth = num(/Charges This Month\s+(-?[\d,]+\.\d{2})/i);
    result.totalAmount = thisMonth !== null ? thisMonth : result.charges.reduce((s, c) => s + c.amount, 0);

    // Billing month from the payment slip ("... 2026/10"), else from the period end
    const slipMonth = text.match(/\b(\d{4})\/(\d{2})\s*$/m);
    const monthSource = slipMonth ? `${slipMonth[1]}-${slipMonth[2]}` : (result.periodTo || result.date);
    if (monthSource) {
        const [y, mo] = monthSource.split('-');
        result.month = `${MONTHS[parseInt(mo, 10) - 1]} ${y}`;
    }

    if (!result.date) result.date = result.periodTo || new Date().toISOString().split('T')[0];
    return result;
}

// --- SLT-Mobitel e-bills ---
// The header is printed as images, so the text layer has bare values with no labels.
// Fields are recognised by shape: invoice no "26SEP_SLTNA..._0285", account "005 208 3922",
// phone "0912283743", dates as MM/DD/YYYY or DD-MON-YYYY.

const SLT_INVOICE = /\b(\d{2}[A-Z]{3}_SLT[A-Z]*\d+_\d+)\b/;

const isSltBill = (text) => SLT_INVOICE.test(text) || /SLT\s*eBill|Sri\s*Lanka\s*Telecom/i.test(text);

// SLT prints numeric dates US-style (MM/DD/YYYY)
const usDate = (s) => {
    const m = (s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};

function parseSltBill(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const result = {
        type: 'telecom',
        provider: 'SLT-Mobitel',
        billNo: '',
        accountNo: '',
        tariff: '',
        premises: '',
        date: '',
        month: '',
        periodFrom: '',
        periodTo: '',
        dueDate: '',
        previousReading: null,
        currentReading: null,
        unitsUsed: null,
        totalAmount: 0,
        charges: []
    };

    const inv = text.match(SLT_INVOICE);
    if (inv) result.billNo = inv[1];

    const acc = lines.find(l => /^\d{3} \d{3} \d{4}$/.test(l));
    if (acc) result.accountNo = acc;

    // Tariff shows the connection type and phone number, e.g. "FTTH 0912283743"
    const phone = lines.find(l => /^0\d{9}$/.test(l));
    const connection = lines.find(l => /^(FTTH|ADSL|LTE|4G|PSTN|VDSL|CDMA)$/i.test(l));
    result.tariff = [connection, phone].filter(Boolean).join(' ');

    // Invoice date is the first MM/DD/YYYY value (the later one is the date of supply)
    const firstUsDate = lines.find(l => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(l));
    result.date = usDate(firstUsDate);

    const dueLine = lines.find(l => /^\d{1,2}-[A-Z]{3}-\d{4}$/i.test(l));
    if (dueLine) result.dueDate = normalizeDate(dueLine);

    const period = text.match(/(\d{1,2}-[A-Z]{3}-\d{4})\s*-\s*(\d{1,2}-[A-Z]{3}-\d{4})/i);
    if (period) {
        result.periodFrom = normalizeDate(period[1]);
        result.periodTo = normalizeDate(period[2]);
    }

    // Address: the lines after the last customer-name line, minus the postal code
    const nameIdxs = lines.map((l, i) => /^(Mr|Mrs|Ms|Miss|Rev|Dr)\.?\s/i.test(l) ? i : -1).filter(i => i >= 0);
    const endIdx = lines.findIndex(l => /^Invoice \d+ of \d+/i.test(l));
    if (nameIdxs.length > 0) {
        const start = nameIdxs[nameIdxs.length - 1] + 1;
        result.premises = lines.slice(start, endIdx > start ? endIdx : start + 4)
            .filter(l => !/^\d{5}$/.test(l))
            .join(', ');
    }

    // Charge lines sit between the phone number and "Total Charges for the Period",
    // as "amount\tdescription" or "description amount"; lines without an amount are headings
    const chargeStart = phone ? lines.indexOf(phone) : -1;
    const chargeEnd = lines.findIndex(l => /^Total Charges for the Period/i.test(l));
    if (chargeStart >= 0 && chargeEnd > chargeStart) {
        lines.slice(chargeStart + 1, chargeEnd).forEach(l => {
            const m = l.match(/^([\d,]+\.\d{2})\s+(.+)$/) || l.match(/^(.+?)\s+([\d,]+\.\d{2})$/);
            if (!m) return;
            const [amountStr, desc] = /^[\d,]+\.\d{2}$/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
            const description = desc
                .replace(/\[[^\]]*\]/g, '')                 // [Rental], [One Time], [1 ]
                .replace(/\([^)]*\d{2}:\d{2}[^)]*\)/g, '')   // event timestamps
                .replace(/\s+/g, ' ')
                .trim();
            result.charges.push({ description, amount: toNumber(amountStr) });
        });
    }

    // Only this period's charges; Balance B/F and payments mirror SLT's own ledger
    const total = text.match(/Total Charges for the Period\s+([\d,]+\.\d{2})/i);
    result.totalAmount = total ? toNumber(total[1]) : result.charges.reduce((s, c) => s + c.amount, 0);

    const monthSource = result.periodTo || result.date;
    if (monthSource) {
        const [y, mo] = monthSource.split('-');
        result.month = `${MONTHS[parseInt(mo, 10) - 1]} ${y}`;
    }

    if (!result.date) result.date = result.periodTo || new Date().toISOString().split('T')[0];
    return result;
}

// --- Booking.com commission invoices ---
// Clean "Label: value" text; commission is billed in USD and converted to LKR on the invoice.

const isBookingInvoice = (text) => /Booking\.com B\.V\.|Accommodation number:/i.test(text);

function parseBookingInvoice(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const field = (label) => {
        const m = text.match(new RegExp(`${label}\\s*:\\s*(.+)`, 'i'));
        return m ? m[1].trim() : '';
    };
    const result = {
        type: 'booking',
        provider: 'Booking.com',
        billNo: field('Invoice number'),
        accountNo: field('Accommodation number'),
        tariff: '',
        premises: '',
        date: normalizeDate(field('Date')),
        month: '',
        periodFrom: '',
        periodTo: '',
        dueDate: '',
        previousReading: null,
        currentReading: null,
        unitsUsed: null,
        totalAmount: 0,
        charges: []
    };

    const period = field('Period').match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (period) {
        result.periodFrom = normalizeDate(period[1]);
        result.periodTo = normalizeDate(period[2]);
    }

    const due = text.match(/Payment due:\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
    if (due) result.dueDate = normalizeDate(due[1]);

    // Property block: the lines before Booking.com's own address, minus country and postcode lines
    const vendorIdx = lines.findIndex(l => /^Booking\.com B\.V\./i.test(l));
    if (vendorIdx > 0) {
        const seen = new Set();
        result.premises = lines.slice(0, vendorIdx)
            .filter(l => !/^\d+\/\d+$/.test(l) && !/^Sri Lanka$/i.test(l) && !/^\d{5}\s/.test(l))
            .filter(l => !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
            .join(', ');
    }

    const usd = (s) => toNumber((s || '').replace(/USD\s*/i, ''));
    const reservations = text.match(/Reservations\s+USD\s*([\d,]+\.\d{2})\s+USD\s*([\d,]+\.\d{2})/i);
    const roomSales = reservations ? usd(reservations[1]) : null;
    const commissionUsd = reservations ? usd(reservations[2]) : usd((text.match(/Total amount due\s+USD\s*([\d,]+\.\d{2})/i) || [])[1]);
    const rate = toNumber((text.match(/exchange rate\s*([\d.]+)/i) || [])[1]);
    const lkr = text.match(/Total amount due for payment[^\n]*?LKR\s*([\d,]+\.\d{2})\s*$/im);

    result.totalAmount = lkr ? toNumber(lkr[1]) : (commissionUsd && rate ? Math.round(commissionUsd * rate * 100) / 100 : 0);
    if (roomSales && commissionUsd) {
        result.tariff = `${Math.round((commissionUsd / roomSales) * 1000) / 10}% commission`;
    }
    if (commissionUsd) {
        const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2 });
        const parts = [`Commission USD ${fmt(commissionUsd)}`];
        if (roomSales) parts.push(`on room sales USD ${fmt(roomSales)}`);
        if (rate) parts.push(`@ ${rate} LKR/USD`);
        result.charges.push({ description: parts.join(' '), amount: result.totalAmount });
    }

    const monthSource = result.periodTo || result.date;
    if (monthSource) {
        const [y, mo] = monthSource.split('-');
        result.month = `${MONTHS[parseInt(mo, 10) - 1]} ${y}`;
    }

    if (!result.date) result.date = result.periodTo || new Date().toISOString().split('T')[0];
    return result;
}

function parseUtilityBillText(type, fullText) {
    if (type === 'electricity' && isEdlBill(fullText)) return parseEdlBill(fullText);
    if (type === 'water' && isNwsdbBill(fullText)) return parseNwsdbBill(fullText);
    if (type === 'telecom' && isSltBill(fullText)) return parseSltBill(fullText);
    if (type === 'booking' && isBookingInvoice(fullText)) return parseBookingInvoice(fullText);

    const config = TYPE_CONFIG[type];
    const text = fullText.replace(/[ \t]+/g, ' ');

    const result = {
        type,
        provider: '',
        billNo: '',
        accountNo: '',
        tariff: '',
        premises: '',
        date: '',
        month: '',
        periodFrom: '',
        periodTo: '',
        dueDate: '',
        previousReading: null,
        currentReading: null,
        unitsUsed: null,
        totalAmount: 0,
        charges: []
    };

    for (const [pattern, name] of config.providers) {
        if (pattern.test(text)) {
            result.provider = name;
            break;
        }
    }

    result.accountNo = findText(text, ['Account\\s*(?:No|Number)\\.?', 'Acc(?:t)?\\.?\\s*No\\.?', 'Contract\\s*(?:Account\\s*)?No\\.?', 'Customer\\s*(?:No|ID)\\.?']);
    result.billNo = findText(text, ['Bill\\s*(?:No|Number)\\.?', 'Invoice\\s*(?:No|Number)\\.?', 'Reference\\s*(?:No|Number)\\.?', 'Ref\\.?\\s*No\\.?']);

    result.date = findDate(text, ['Bill(?:ing)?\\s*Date', 'Invoice\\s*Date', 'Date\\s*of\\s*(?:Bill|Issue)', 'Issued?\\s*(?:Date|On)', 'Date']);
    result.dueDate = findDate(text, ['Due\\s*Date', 'Pay(?:ment)?\\s*(?:Due\\s*)?(?:Date|Before|By)', 'Last\\s*Date']);

    const periodMatch = text.match(new RegExp(`(?:Billing\\s*)?Period[^\\n]*?${DATE_PATTERN}\\s*(?:-|to|–)\\s*${DATE_PATTERN}`, 'i'))
        || text.match(new RegExp(`From\\s*[:\\-]?\\s*${DATE_PATTERN}\\s*To\\s*[:\\-]?\\s*${DATE_PATTERN}`, 'i'));
    if (periodMatch) {
        result.periodFrom = normalizeDate(periodMatch[1]);
        result.periodTo = normalizeDate(periodMatch[2]);
    }

    if (config.unitLabels.length > 0) {
        const prev = text.match(/Previous\s*(?:Meter\s*)?Reading\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i);
        const curr = text.match(/(?:Current|Present)\s*(?:Meter\s*)?Reading\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i);
        if (prev) result.previousReading = toNumber(prev[1]);
        if (curr) result.currentReading = toNumber(curr[1]);

        for (const label of config.unitLabels) {
            const m = text.match(new RegExp(`${label}\\s*[:\\-]?\\s*([\\d,]+(?:\\.\\d+)?)`, 'i'));
            if (m) {
                result.unitsUsed = toNumber(m[1]);
                break;
            }
        }
        if (result.unitsUsed === null && result.previousReading !== null && result.currentReading !== null) {
            result.unitsUsed = result.currentReading - result.previousReading;
        }
    }

    const total = findAmount(text, [
        'Total\\s*Amount\\s*(?:Due|Payable)',
        'Amount\\s*(?:Due|Payable)',
        'Total\\s*(?:Due|Payable)',
        'Net\\s*Amount',
        'Total\\s*Amount',
        'Grand\\s*Total',
        'Total'
    ]);
    if (total !== null) result.totalAmount = total;

    // Billing month from the period end, then the bill date
    const monthSource = result.periodTo || result.date;
    if (monthSource) {
        const [y, mo] = monthSource.split('-');
        result.month = `${MONTHS[parseInt(mo, 10) - 1]} ${y}`;
    }

    if (!result.date) result.date = new Date().toISOString().split('T')[0];
    if (!result.billNo && result.accountNo && result.month) {
        result.billNo = `${result.accountNo}-${result.month.replace(' ', '')}`;
    }

    return result;
}

async function parseUtilityPdf(type, buffer) {
    const parser = new PDFParse({ data: buffer });
    try {
        const textResult = await parser.getText();
        return parseUtilityBillText(type, textResult.text);
    } finally {
        await parser.destroy();
    }
}

module.exports = {
    UTILITY_TYPES: Object.keys(TYPE_CONFIG),
    parseUtilityPdf,
    parseUtilityBillText
};
