const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Configure multer for file uploads
const uploadDir = path.join(__dirname, 'parking-uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls') {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files are allowed'));
        }
    }
});

/**
 * Extract carpark name from row 6 of Excel file
 */
function extractCarparkName(workbook, filename) {
    try {
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Try row 6 (cell A6)
        const cellA6 = sheet['A6'];
        if (cellA6 && cellA6.v) {
            const name = String(cellA6.v).trim();
            if (name && !name.toLowerCase().startsWith('date') &&
                !name.toLowerCase().startsWith('time') &&
                !name.toLowerCase().startsWith('location') &&
                !name.toLowerCase().startsWith('user')) {
                return name;
            }
        }

        // Fallback: search first 8 rows
        for (let i = 1; i <= 8; i++) {
            const cell = sheet[`A${i}`];
            if (cell && cell.v) {
                const potential = String(cell.v).trim();
                if (potential &&
                    !potential.toLowerCase().startsWith('date') &&
                    !potential.toLowerCase().startsWith('time') &&
                    !potential.toLowerCase().startsWith('location') &&
                    !potential.toLowerCase().startsWith('user') &&
                    !potential.toLowerCase().startsWith('lane') &&
                    !potential.toLowerCase().startsWith('plate') &&
                    !potential.toLowerCase().startsWith('action') &&
                    !potential.toLowerCase().startsWith('cost') &&
                    potential.length > 3) {
                    return potential;
                }
            }
        }
    } catch (e) {
        console.log('Warning: Could not extract carpark name:', e.message);
    }

    // Fallback to filename
    return filename ? filename.replace(/\.(xlsx|xls)$/i, '') : 'Unknown Carpark';
}

/**
 * Parse Excel file and extract parking data
 */
function parseExcelFile(filepath, filename) {
    const workbook = XLSX.readFile(filepath, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Get carpark name
    const carparkName = extractCarparkName(workbook, filename);

    // Convert to JSON, skipping first 3 rows (header info)
    const rawData = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        dateNF: 'yyyy-mm-dd hh:mm:ss'
    });

    // Skip first 4 rows (3 header rows + column names row)
    const dataRows = rawData.slice(4);

    // Column indices based on Python code: [0, 2, 3, 4, 5, 7, 8, 9, 10, 12]
    // 0: Location/UserName, 2: User, 3: Lane, 4: Plate, 5: Action
    // 7: Cost, 8: DateTime, 9: Notes, 10: Overflow, 12: PermRate/Group

    const transactions = [];
    const emails = new Set();

    for (const row of dataRows) {
        if (!row || row.length < 13) continue;

        const locationUserName = row[0];
        const user = row[2];
        const lane = row[3];
        const plate = row[4];
        const action = row[5];
        const cost = row[7];
        const dateTimeRaw = row[8];
        const notes = row[9];
        const overflow = row[10];
        const permRateGroup = row[12];

        // Skip rows without datetime
        if (!dateTimeRaw) continue;

        // Parse datetime
        let dateTime;
        if (dateTimeRaw instanceof Date) {
            dateTime = dateTimeRaw;
        } else {
            dateTime = new Date(dateTimeRaw);
        }

        if (isNaN(dateTime.getTime())) continue;

        // Track emails
        if (locationUserName && typeof locationUserName === 'string' && locationUserName.includes('@')) {
            emails.add(locationUserName);
        }

        // Calculate vehicle change
        let vehicleChange = 0;
        if (action === 'Entry') vehicleChange = 1;
        else if (action === 'Exit') vehicleChange = -1;

        transactions.push({
            datetime: dateTime,
            hour: new Date(dateTime.getFullYear(), dateTime.getMonth(), dateTime.getDate(), dateTime.getHours()),
            email: locationUserName || '',
            user: user || '',
            plate: plate || '',
            action: action || '',
            cost: parseFloat(cost) || 0,
            lane: lane || '',
            notes: notes || '',
            group: permRateGroup || '',
            vehicleChange
        });
    }

    return {
        carparkName,
        transactions,
        emails: Array.from(emails).sort()
    };
}

/**
 * Process parking data and generate summary
 */
function processParkingData(transactions, emailFilter, threshold) {
    // Filter by email if specified
    let filtered = transactions;
    if (emailFilter) {
        filtered = transactions.filter(t => t.email === emailFilter);
    }

    if (filtered.length === 0) {
        return {
            success: true,
            summary: {
                total_transactions: 0,
                unique_vehicles: 0,
                date_range: { start: '', end: '' },
                action_breakdown: {},
                location_breakdown: {}
            },
            hourly_data: [],
            transaction_data: []
        };
    }

    // Sort by datetime
    filtered.sort((a, b) => a.datetime - b.datetime);

    // Calculate cumulative counts
    let cumulativeCount = 0;
    for (const t of filtered) {
        cumulativeCount += t.vehicleChange;
        t.cumulativeCount = Math.max(0, cumulativeCount);
    }

    // Fix negative counts by shifting
    const minCount = Math.min(...filtered.map(t => t.cumulativeCount));
    if (minCount < 0) {
        for (const t of filtered) {
            t.cumulativeCount = Math.max(0, t.cumulativeCount - minCount);
        }
    }

    // Aggregate by hour
    const hourlyMap = new Map();
    for (const t of filtered) {
        const hourKey = t.hour.toISOString();
        if (!hourlyMap.has(hourKey)) {
            hourlyMap.set(hourKey, {
                hour: t.hour,
                transactions: [],
                netChange: 0
            });
        }
        const hourData = hourlyMap.get(hourKey);
        hourData.transactions.push(t);
        hourData.netChange += t.vehicleChange;
    }

    // Build hourly data array
    const hourlyData = [];
    const thresholdVal = threshold ? parseInt(threshold) : null;

    const sortedHours = Array.from(hourlyMap.values()).sort((a, b) => a.hour - b.hour);
    for (const hourData of sortedHours) {
        const lastTransaction = hourData.transactions[hourData.transactions.length - 1];
        const count = Math.max(0, lastTransaction.cumulativeCount);

        hourlyData.push({
            hour: formatDateTime(hourData.hour),
            count,
            net_change: hourData.netChange,
            exceeds_threshold: thresholdVal ? count > thresholdVal : false
        });
    }

    // Calculate summary
    const uniquePlates = new Set(filtered.map(t => t.plate));
    const actionBreakdown = {};
    const locationBreakdown = {};

    for (const t of filtered) {
        actionBreakdown[t.action] = (actionBreakdown[t.action] || 0) + 1;
        if (t.group) {
            locationBreakdown[t.group] = (locationBreakdown[t.group] || 0) + 1;
        }
    }

    // Build transaction data for client
    const transactionData = filtered.map(t => ({
        datetime: t.datetime.toISOString(),
        hour: t.hour.toISOString(),
        email: t.email,
        user: t.user,
        plate: t.plate,
        action: t.action,
        cost: t.cost,
        lane: t.lane,
        notes: t.notes,
        group: t.group,
        vehicle_change: t.vehicleChange,
        cumulative_count: t.cumulativeCount
    }));

    return {
        success: true,
        summary: {
            total_transactions: filtered.length,
            unique_vehicles: uniquePlates.size,
            date_range: {
                start: formatDateTime(filtered[0].datetime),
                end: formatDateTime(filtered[filtered.length - 1].datetime)
            },
            action_breakdown: actionBreakdown,
            location_breakdown: locationBreakdown
        },
        hourly_data: hourlyData,
        transaction_data: transactionData
    };
}

function formatDateTime(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Setup parking routes on Express app
 */
function setupParkingRoutes(app) {
    const parkingTemplatesDir = path.join(__dirname, 'Report-tools copy', 'templates');

    // Serve parking tool index
    app.get('/parking', (req, res) => {
        res.sendFile(path.join(parkingTemplatesDir, 'index.html'));
    });

    // Also serve at root for iframe compatibility
    app.get('/parking/', (req, res) => {
        res.sendFile(path.join(parkingTemplatesDir, 'index.html'));
    });

    // Upload and process file
    app.post('/parking/upload', upload.single('file'), (req, res) => {
        if (!req.file) {
            return res.json({ success: false, error: 'No file provided' });
        }

        const filepath = req.file.path;
        const filename = req.file.originalname;

        try {
            const emailFilter = req.body.email_filter || null;
            const threshold = req.body.threshold || null;

            // Parse Excel file
            const { carparkName, transactions, emails } = parseExcelFile(filepath, filename);

            // Process data
            const result = processParkingData(transactions, emailFilter, threshold);
            result.carpark_name = carparkName;
            result.emails = emails;

            res.json(result);
        } catch (error) {
            console.error('Error processing parking file:', error);
            res.json({ success: false, error: error.message });
        } finally {
            // Clean up uploaded file
            try {
                fs.unlinkSync(filepath);
            } catch (e) {}
        }
    });

    console.log('Parking routes initialized at /parking');
}

module.exports = { setupParkingRoutes, upload };
