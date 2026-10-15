const { PDFParse } = require('pdf-parse');

/**
 * Parses raw text extracted from a laundry invoice PDF (specifically designed for Shiny Laundry and flexible for similar invoices).
 * @param {string} fullText 
 * @param {Array<{ text: string, num: number }>} pages 
 * @returns {object}
 */
function parseLaundryInvoiceText(fullText, pages = []) {
    const result = {
        vendor: 'Shiny Laundry',
        invoiceNo: '',
        date: new Date().toISOString().split('T')[0],
        billTo: 'Tiny house',
        month: '',
        items: [],
        totalQty: 0,
        totalAmount: 0,
        dailyBreakdown: {} // dayNumber (1-31) -> { total: number }
    };

    // 1. Vendor
    if (/Shiny\s+Laundry/i.test(fullText)) {
        result.vendor = 'Shiny Laundry';
    }

    // 2. Invoice Number
    const invMatch = fullText.match(/Invoice\s*No\.?\s*([A-Za-z0-9\-]+)/i) || fullText.match(/(INV-[0-9]+)/i);
    if (invMatch) {
        result.invoiceNo = invMatch[1].trim();
    }

    // 3. Bill To
    if (/Tiny\s*house/i.test(fullText)) {
        result.billTo = 'Tiny house';
    }

    // 4. Date (MM/DD/YYYY or DD/MM/YYYY)
    const dateMatch = fullText.match(/Date\s*[:\-]?\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{4})/i);
    if (dateMatch) {
        const rawDate = dateMatch[1];
        const parts = rawDate.split(/[\/\-]/);
        if (parts.length === 3) {
            // Shiny Laundry uses MM/DD/YYYY format (e.g. 10/14/2026)
            let m = parseInt(parts[0], 10);
            let d = parseInt(parts[1], 10);
            let y = parts[2];
            // If month > 12, swap month and day
            if (m > 12 && d <= 12) {
                const temp = m;
                m = d;
                d = temp;
            }
            result.date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }

    // 5. Billing Period / Month
    const monthMatch = fullText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-]+(\d{2,4})/i);
    if (monthMatch) {
        const mStr = monthMatch[1];
        const yStr = monthMatch[2].length === 2 ? `20${monthMatch[2]}` : monthMatch[2];
        result.month = `${mStr} ${yStr}`;
    }

    // 6. Extract Line Items and Daily Breakdown
    const page2 = pages && pages.length > 1 ? pages[1].text : '';
    const textToSearch = page2 || fullText;
    const lines = textToSearch.split('\n').map(l => l.trim()).filter(Boolean);

    // Attempt parsing Page 2 daily table rows:
    // Format: "Bed sheet 180 4 4 3 5 16 2,880.00"
    for (const line of lines) {
        const match = line.match(/^([A-Za-z\s]+?)\s+(\d+(?:\.\d+)?)\s+(.*?)([\d,]+(?:\.\d{2})?)$/);
        if (match) {
            const desc = match[1].trim();
            const unitPrice = parseFloat(match[2]);
            const amountStr = match[4].replace(/,/g, '');
            const amount = parseFloat(amountStr);
            const tokens = match[3].trim().split(/\s+/).filter(Boolean);

            if (tokens.length > 0 && !['BILL', 'SHINY', 'Item', 'Price', 'Description', 'Serial'].includes(desc)) {
                const qty = parseInt(tokens[tokens.length - 1], 10);
                if (!isNaN(unitPrice) && !isNaN(qty) && !isNaN(amount) && qty > 0) {
                    result.items.push({
                        description: desc,
                        unitPrice,
                        quantity: qty,
                        amount
                    });
                }
            }
        }
    }

    // Fallback: If page 2 extraction yielded no items, parse Page 1 summary invoice table
    if (result.items.length === 0) {
        const page1 = pages && pages.length > 0 ? pages[0].text : fullText;
        const p1Lines = page1.split('\n').map(l => l.trim()).filter(Boolean);
        const rows = [];
        for (const l of p1Lines) {
            const rowMatch = l.match(/^(\d{2})\s+(\d+)\s+(\d+(?:\.\d+)?)\s+([\d,]+(?:\.\d{2})?|-)$/);
            if (rowMatch) {
                const qty = parseInt(rowMatch[2], 10);
                const unitPrice = parseFloat(rowMatch[3]);
                const amt = rowMatch[4] === '-' ? 0 : parseFloat(rowMatch[4].replace(/,/g, ''));
                if (qty > 0) {
                    rows.push({ quantity: qty, unitPrice, amount: amt });
                }
            }
        }

        const known = ['Bed sheet', 'Pillow case', 'Bath towel', 'Hand towel', 'Duvet cover', 'Blanket'];
        const foundDescs = [];
        for (const l of p1Lines) {
            for (const k of known) {
                if (l.toLowerCase() === k.toLowerCase() && !foundDescs.includes(k)) {
                    foundDescs.push(k);
                }
            }
        }

        rows.forEach((r, idx) => {
            result.items.push({
                description: foundDescs[idx] || `Item ${idx + 1}`,
                quantity: r.quantity,
                unitPrice: r.unitPrice,
                amount: r.amount
            });
        });
    }

    // 7. Parse daily totals breakdown if available on page 2
    // Look for lines that contain sequence of 31 numbers followed by total Qty and total Amount:
    // e.g. "0 0 0 0 ... 13 ... 16 11 0 0 0 11 0 51 5,970.00"
    if (page2) {
        const p2Lines = page2.split('\n');
        for (const l of p2Lines) {
            const trimmed = l.trim();
            const tokens = trimmed.split(/\s+/).filter(Boolean);
            if (tokens.length >= 32) { // 31 days + totalQty + optional totalAmount
                const maybeDays = tokens.slice(0, 31).map(t => parseInt(t, 10));
                if (maybeDays.every(d => !isNaN(d))) {
                    maybeDays.forEach((qty, idx) => {
                        const dayNum = idx + 1;
                        if (qty > 0) {
                            result.dailyBreakdown[dayNum] = { total: qty };
                        }
                    });
                    break;
                }
            }
        }
    }

    // 8. Totals
    result.totalQty = result.items.reduce((s, it) => s + it.quantity, 0);
    result.totalAmount = result.items.reduce((s, it) => s + it.amount, 0);

    // If totalAmount is 0, check regex for Total Amount in fullText
    if (result.totalAmount === 0) {
        const totalMatch = fullText.match(/Total\s*Amount\s*[:\-]?\s*([\d,]+(?:\.\d{2})?)/i);
        if (totalMatch) {
            result.totalAmount = parseFloat(totalMatch[1].replace(/,/g, ''));
        }
    }

    return result;
}

/**
 * Parses a PDF buffer into structured laundry bill data.
 * @param {Buffer} buffer 
 * @returns {Promise<object>}
 */
async function parseLaundryPdf(buffer) {
    const parser = new PDFParse({ data: buffer });
    try {
        const textResult = await parser.getText();
        const parsed = parseLaundryInvoiceText(textResult.text, textResult.pages || []);
        return parsed;
    } finally {
        await parser.destroy();
    }
}

module.exports = {
    parseLaundryPdf,
    parseLaundryInvoiceText
};
