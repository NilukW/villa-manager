/**
 * Lightweight, zero-dependency iCal parser and generator
 */

function parseICalDate(dateStr) {
    if (!dateStr) return '';
    const match = dateStr.match(/\d{8}/);
    if (match) {
        const d = match[0];
        return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
    }
    return '';
}

/**
 * Parses iCal (.ics) format string into an array of event objects
 */
function parseICS(icsText) {
    const events = [];
    const lines = icsText.split(/\r?\n/);
    let currentEvent = null;
    
    for (let line of lines) {
        // Handle line folding: lines starting with space or tab are continuations
        if (line.startsWith(' ') || line.startsWith('\t')) {
            if (currentEvent && currentEvent._lastProp) {
                currentEvent[currentEvent._lastProp] += line.substring(1);
            }
            continue;
        }
        
        const index = line.indexOf(':');
        if (index === -1) continue;
        
        const keyPart = line.substring(0, index);
        const value = line.substring(index + 1);
        
        // Remove parameters (e.g. DTSTART;VALUE=DATE -> DTSTART)
        const key = keyPart.split(';')[0].trim();
        
        if (key === 'BEGIN' && value.trim() === 'VEVENT') {
            currentEvent = {};
            events.push(currentEvent);
        } else if (key === 'END' && value.trim() === 'VEVENT') {
            currentEvent = null;
        } else if (currentEvent) {
            currentEvent[key] = value.trim();
            currentEvent._lastProp = key;
        }
    }
    
    // Format parsed events into structured reservations
    return events.map(event => {
        let guestName = (event.SUMMARY || '').trim();
        // Clean summary: "Booking.com - John Doe" -> "John Doe"
        guestName = guestName.replace(/^Booking\.com\s*-\s*/i, '').trim();
        if (!guestName || guestName === 'Reserved') {
            guestName = 'Booking.com Guest';
        }
        
        const description = (event.DESCRIPTION || '').replace(/\\n/g, '\n').replace(/\\,/g, ',');
        
        // Match Booking ID
        const idMatch = description.match(/Booking ID:\s*(\d+)/i) || description.match(/ID:\s*(\d+)/i);
        const bookingId = idMatch ? idMatch[1] : '';
        
        // Match price
        const priceMatch = description.match(/Total amount:\s*([\d,.]+)/i) || description.match(/Price:\s*([\d,.]+)/i);
        let totalAmount = 0;
        if (priceMatch) {
            totalAmount = parseFloat(priceMatch[1].replace(/,/g, ''));
        }
        
        return {
            uid: event.UID || `${event.DTSTART}-${Math.random().toString(36).substring(2, 7)}`,
            checkInDate: parseICalDate(event.DTSTART),
            checkOutDate: parseICalDate(event.DTEND),
            guestName,
            bookingId,
            totalAmount,
            remarks: description.trim() || 'Imported via iCal Sync'
        };
    }).filter(e => e.checkInDate && e.checkOutDate);
}

/**
 * Generates an iCal (.ics) format string from an array of reservation rows
 */
function generateICS(reservations, roomName) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//VillaManager//NONSGML Calendar Export//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH'
    ];
    
    reservations.forEach(res => {
        const start = res.checkInDate.replace(/-/g, '');
        const end = res.checkOutDate.replace(/-/g, '');
        const uid = res.uid || `reservation_${res.id}@villamanager`;
        
        // Format description
        let desc = `Guest: ${res.guestName}\\n`;
        desc += `Room: ${res.roomName}\\n`;
        desc += `Check-in: ${res.checkInDate}\\n`;
        desc += `Check-out: ${res.checkOutDate}\\n`;
        if (res.bookingSource) {
            desc += `Source: ${res.bookingSource}\\n`;
        }
        if (res.remarks) {
            desc += `Remarks: ${res.remarks.replace(/\r?\n/g, '\\n')}`;
        }
        
        lines.push('BEGIN:VEVENT');
        lines.push(`DTSTART;VALUE=DATE:${start}`);
        lines.push(`DTEND;VALUE=DATE:${end}`);
        lines.push(`UID:${uid}`);
        lines.push(`SUMMARY:${res.guestName} (${roomName})`);
        lines.push(`DESCRIPTION:${desc}`);
        lines.push('END:VEVENT');
    });
    
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
}

module.exports = {
    parseICS,
    generateICS
};
