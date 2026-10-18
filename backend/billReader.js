// Reads a shop bill (photo or PDF) with Claude and returns its lines as purchase items.
// Needs ANTHROPIC_API_KEY in backend/.env. The bill image is sent to Anthropic's API for reading.
const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-opus-5-5';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const isConfigured = () => !!process.env.ANTHROPIC_API_KEY;

let client = null;
const getClient = () => {
    if (!client) client = new Anthropic();
    return client;
};

const BILL_SCHEMA = {
    type: 'object',
    properties: {
        readable: { type: 'boolean', description: 'false if this is not a shop bill/receipt or cannot be read' },
        shop: { type: 'string', description: 'Shop name, or empty' },
        date: { type: 'string', description: 'Bill date as YYYY-MM-DD, or empty' },
        billNo: { type: 'string', description: 'Bill/invoice/receipt number, or empty' },
        billTotal: { type: 'number', description: 'Final amount paid in LKR after discounts, or 0' },
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    billText: { type: 'string', description: 'The line as printed on the bill' },
                    name: { type: 'string', description: 'Short, plain item name, e.g. "Sugar", "Dishwash liquid"' },
                    catalogueId: { type: 'integer', description: 'id of the matching catalogue item, or 0 when none matches' },
                    group: { type: 'string', enum: ['kitchen', 'cleaning', 'amenities', 'gas', 'other'] },
                    unit: { type: 'string', enum: ['pcs', 'kg', 'g', 'L', 'ml', 'pack', 'bottle', 'loaf', 'bunch', 'box', 'cylinder'] },
                    quantity: { type: 'number' },
                    lineTotal: { type: 'number', description: 'Amount charged for this line in LKR, after any line discount' }
                },
                required: ['billText', 'name', 'catalogueId', 'group', 'unit', 'quantity', 'lineTotal'],
                additionalProperties: false
            }
        }
    },
    required: ['readable', 'shop', 'date', 'billNo', 'billTotal', 'items'],
    additionalProperties: false
};

const SYSTEM = `You read shop bills for a small guest villa in Sri Lanka and turn them into purchase lines for its expense tracker.
Bills may be in English, Sinhala or Tamil, printed or handwritten, and amounts are in LKR.

Groups: kitchen = breakfast and kitchen food and drink; cleaning = cleaning and laundry products; amenities = guest toiletries and room supplies (soap, shampoo, toilet paper, water bottles for rooms); gas = LPG cylinders and refills; other = anything else.

For each purchased line:
- name: a short generic name the owner would recognise ("Sugar", not "KEELLS WHITE SUGAR 1KG PKT").
- catalogueId: the id of the catalogue item that is the same product, even if worded differently; 0 if none fits. Do not force a match.
- quantity and unit: what was bought, e.g. 2 x 1kg packs of sugar is quantity 2, unit "pack" (or quantity 2, unit "kg"); prefer the catalogue item's unit when matched.
- lineTotal: the amount charged for the line.
Leave out subtotals, taxes shown separately, payments, change and loyalty points. If there is an overall bill discount, keep the lines as printed and give the final paid amount as billTotal.`;

const catalogueText = (catalogue) => catalogue.length
    ? catalogue.map(i => `${i.id}: ${i.name} (${i.groupKey}, ${i.unit})`).join('\n')
    : '(empty)';

// Returns { shop, date, billNo, billTotal, items: [{ billText, name, catalogueId, groupKey, unit, quantity, lineTotal }] }
const readBill = async ({ buffer, mimeType, catalogue }) => {
    const data = buffer.toString('base64');
    const fileBlock = mimeType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: mimeType, data } };

    const response = await getClient().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: BILL_SCHEMA } },
        system: SYSTEM,
        messages: [{
            role: 'user',
            content: [
                fileBlock,
                { type: 'text', text: `Catalogue of items the villa buys regularly (id: name (group, unit)):\n${catalogueText(catalogue)}\n\nRead this bill.` }
            ]
        }]
    });

    if (response.stop_reason === 'refusal') {
        throw Object.assign(new Error('The bill could not be read. Please enter the items by hand.'), { status: 422 });
    }
    if (response.stop_reason === 'max_tokens') {
        throw Object.assign(new Error('The bill is too long to read in one go. Please enter the items by hand.'), { status: 422 });
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw Object.assign(new Error('The bill reader returned an unexpected answer. Please try again.'), { status: 502 });
    }
    if (!parsed.readable) {
        throw Object.assign(new Error("This doesn't look like a readable bill. Try a clearer photo, or enter the items by hand."), { status: 422 });
    }
    return normaliseResult(parsed, catalogue);
};

// Keep only catalogue ids that exist and sensible numbers
const normaliseResult = (parsed, catalogue) => {
    const ids = new Set(catalogue.map(i => i.id));
    const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
    return {
        shop: (parsed.shop || '').trim(),
        date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date : '',
        billNo: (parsed.billNo || '').trim(),
        billTotal: round2(parsed.billTotal),
        items: (parsed.items || [])
            .filter(l => Number(l.lineTotal) > 0)
            .map(l => ({
                billText: (l.billText || '').trim(),
                name: (l.name || l.billText || 'Item').trim(),
                catalogueId: ids.has(Number(l.catalogueId)) ? Number(l.catalogueId) : null,
                groupKey: l.group || 'other',
                unit: l.unit || 'pcs',
                quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 1,
                lineTotal: round2(l.lineTotal)
            }))
    };
};

// Turn SDK errors into messages the owner can act on
const friendlyError = (err) => {
    if (err.status && err.status < 500 && !(err instanceof Anthropic.APIError)) return err;
    if (err instanceof Anthropic.AuthenticationError) return Object.assign(new Error('The ANTHROPIC_API_KEY on the server is not valid.'), { status: 503 });
    if (err instanceof Anthropic.RateLimitError) return Object.assign(new Error('The bill reader is busy. Please try again in a minute.'), { status: 503 });
    if (err instanceof Anthropic.BadRequestError) return Object.assign(new Error(`The bill could not be sent for reading: ${err.message}`), { status: 422 });
    if (err instanceof Anthropic.APIConnectionError) return Object.assign(new Error('Could not reach the bill reader. Check the server\'s internet connection.'), { status: 503 });
    if (err instanceof Anthropic.APIError) return Object.assign(new Error('The bill reader had a problem. Please try again.'), { status: 502 });
    return err;
};

module.exports = { readBill, isConfigured, friendlyError, normaliseResult, IMAGE_TYPES };
