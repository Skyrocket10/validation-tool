const express = require('express');
const multer = require('multer');
const Excel = require('exceljs');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const moment = require('moment');
const { hotels, customItems } = require('./database');

const uploadDir = path.join(os.homedir(), 'validation-report-uploads');
fs.mkdir(uploadDir, { recursive: true }).catch(console.error);

const upload = multer({ dest: uploadDir });
let globalProcessedData = {};
let globalArchivedData = {};

function backend(app) {
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Upload Excel file
    app.post('/upload', upload.single('file'), async (req, res) => {
        try {
            const { processedData, archivedData } = await readAndUpdateExcelFile(req.file.path);
            globalProcessedData = processedData;
            globalArchivedData = archivedData;

            // Ensure all hotels exist in database
            for (const hotelName in processedData) {
                hotels.getOrCreate(hotelName);
            }

            res.json(processedData);
        } catch (error) {
            console.error('Upload error:', error);
            res.status(500).send('Error processing the Excel file.');
        }
    });

    // Get hotel data with saved settings
    app.get('/hotel/:hotelName', (req, res) => {
        const hotelName = req.params.hotelName;
        const processedData = globalProcessedData[hotelName] || [];
        const archivedData = globalArchivedData[hotelName] || [];

        // Get saved settings from database
        const hotelSettings = hotels.getOrCreate(hotelName);
        const savedCustomItems = customItems.getByHotel(hotelName);

        // Apply saved ticket price if exists
        if (hotelSettings.ticket_price && processedData.length > 0) {
            processedData.forEach(ticket => {
                const match = ticket.E && ticket.E.match(/^\d+/);
                if (match) {
                    const quantity = parseInt(match[0], 10);
                    ticket.D = formatCurrency(hotelSettings.ticket_price * quantity);
                }
            });
        }

        res.json({
            processedData,
            archivedData,
            settings: {
                ticketPrice: hotelSettings.ticket_price,
                licensingFee: hotelSettings.licensing_fee,
                setupFee: hotelSettings.setup_fee,
                siteName: hotelSettings.site_name,
                isActive: hotelSettings.is_active === 1
            },
            customItems: savedCustomItems
        });
    });

    // Update ticket price
    app.put('/hotel/:hotelName/price', (req, res) => {
        const hotelName = req.params.hotelName;
        const ticketPrice = parseFloat(req.body.price);

        if (hotelName && !isNaN(ticketPrice)) {
            // Save to database
            hotels.update(hotelName, { ticket_price: ticketPrice });

            const hotelData = globalProcessedData[hotelName];
            if (hotelData) {
                hotelData.forEach(ticket => {
                    const match = ticket.E && ticket.E.match(/^\d+/);
                    if (match) {
                        const quantity = parseInt(match[0], 10);
                        ticket.D = formatCurrency(ticketPrice * quantity);
                    }
                });
                res.json(hotelData);
            } else {
                res.status(404).send('Hotel not found.');
            }
        } else {
            res.status(400).send('Invalid hotel name or ticket price.');
        }
    });

    // ============ Hotel Settings API ============

    // Get all hotels with their settings
    app.get('/api/hotels', (req, res) => {
        const includeInactive = req.query.includeInactive === 'true';
        const allHotels = includeInactive ? hotels.getAll() : hotels.getActive();
        res.json(allHotels);
    });

    // Get settings for a specific hotel
    app.get('/api/hotels/:hotelName/settings', (req, res) => {
        const hotel = hotels.getOrCreate(req.params.hotelName);
        const items = customItems.getByHotel(req.params.hotelName);
        res.json({
            ...hotel,
            customItems: items
        });
    });

    // Update hotel settings
    app.put('/api/hotels/:hotelName/settings', (req, res) => {
        const hotelName = req.params.hotelName;
        const { ticketPrice, licensingFee, setupFee, siteName, isActive } = req.body;

        const updated = hotels.update(hotelName, {
            ticket_price: ticketPrice,
            licensing_fee: licensingFee,
            setup_fee: setupFee,
            site_name: siteName,
            is_active: isActive
        });

        res.json(updated);
    });

    // Toggle hotel active status
    app.put('/api/hotels/:hotelName/toggle-active', (req, res) => {
        const updated = hotels.toggleActive(req.params.hotelName);
        res.json(updated);
    });

    // ============ Custom Line Items API ============

    // Get custom items for a hotel
    app.get('/api/hotels/:hotelName/custom-items', (req, res) => {
        const items = customItems.getByHotel(req.params.hotelName);
        res.json(items);
    });

    // Add custom item
    app.post('/api/hotels/:hotelName/custom-items', (req, res) => {
        const { description, amount } = req.body;
        if (!description || amount === undefined) {
            return res.status(400).send('Description and amount are required.');
        }
        const item = customItems.add(req.params.hotelName, description, parseFloat(amount));
        res.json(item);
    });

    // Delete custom item
    app.delete('/api/custom-items/:itemId', (req, res) => {
        customItems.remove(parseInt(req.params.itemId, 10));
        res.json({ success: true });
    });

    // Replace all custom items for a hotel
    app.put('/api/hotels/:hotelName/custom-items', (req, res) => {
        const items = req.body.items || [];
        const updated = customItems.replaceAll(req.params.hotelName, items);
        res.json(updated);
    });

    // ============ Bulk Save ============

    // Save all settings for a hotel at once
    app.post('/api/hotels/:hotelName/save-all', (req, res) => {
        const hotelName = req.params.hotelName;
        const { ticketPrice, licensingFee, setupFee, siteName, customLineItems } = req.body;

        // Update hotel settings
        const updatedHotel = hotels.update(hotelName, {
            ticket_price: ticketPrice,
            licensing_fee: licensingFee,
            setup_fee: setupFee,
            site_name: siteName
        });

        // Update custom items
        const updatedItems = customItems.replaceAll(hotelName, customLineItems || []);

        res.json({
            hotel: updatedHotel,
            customItems: updatedItems
        });
    });
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'AUD',
        minimumFractionDigits: 2
    }).format(amount);
}

async function readAndUpdateExcelFile(filePath) {
    const processedData = {};
    const archivedData = {};

    try {
        await fs.access(filePath);
        const workbook = new Excel.Workbook();
        await workbook.xlsx.readFile(filePath);

        for (let i = 1; i < workbook.worksheets.length; i++) {
            const worksheet = workbook.worksheets[i];
            const duplicateMap = new Map();

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber >= 8) {
                    const rowData = {};
                    let hotelName = '';

                    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                        let cellValue = cell.value;

                        if (cellValue instanceof Date) {
                            cellValue = moment(cellValue).format('DD/MM/YYYY h:mm:ss a');
                        }

                        rowData[cell.address.match(/[A-Z]+/)[0]] = cellValue;

                        if (cell.address.match(/E/)) {
                            const match = cellValue.match(/\d+\s+Day'?s?\s+(.+)/i);
                            if (match) {
                                hotelName = match[1].trim().replace(/\//g, '_');
                            } else {
                                hotelName = cellValue.trim().replace(/\//g, '_');
                            }
                        }
                    });

                    const cellValueE = row.getCell('E').text;
                    const match = cellValueE.match(/^\d+/);

                    if (match) {
                        const numberAtStart = parseInt(match[0], 10);

                        // Check if hotel has saved price
                        const hotelSettings = hotels.getByName(hotelName);
                        const pricePerDay = hotelSettings ? hotelSettings.ticket_price : 10;
                        const newValue = numberAtStart * pricePerDay;

                        row.getCell('D').value = newValue;

                        const formattedValue = new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: 'AUD',
                            minimumFractionDigits: 2
                        }).format(newValue);

                        rowData['D'] = formattedValue;
                    }

                    const ticketNumber = rowData['C'];
                    const daysMatch = rowData['E'] && rowData['E'].match(/^\d+/);
                    const daysValue = daysMatch ? parseInt(daysMatch[0], 10) : 0;

                    if (!duplicateMap.has(ticketNumber)) {
                        duplicateMap.set(ticketNumber, rowData);
                    }

                    if (!processedData[hotelName]) {
                        processedData[hotelName] = [];
                    }
                    processedData[hotelName].push(rowData);
                }
            });

            for (const [hotel, entries] of Object.entries(processedData)) {
                const ticketNumberMap = new Map();
                entries.forEach(entry => {
                    const ticketNumber = entry['C'];
                    const daysMatch = entry['E'] && entry['E'].match(/^\d+/);
                    const daysValue = daysMatch ? parseInt(daysMatch[0], 10) : 0;

                    if (ticketNumberMap.has(ticketNumber)) {
                        const existingEntry = ticketNumberMap.get(ticketNumber);
                        const existingDaysMatch = existingEntry['E'] && existingEntry['E'].match(/^\d+/);
                        const existingDaysValue = existingDaysMatch ? parseInt(existingDaysMatch[0], 10) : 0;

                        if (daysValue > existingDaysValue) {
                            if (!archivedData[hotel]) {
                                archivedData[hotel] = [];
                            }
                            archivedData[hotel].push(existingEntry);
                            ticketNumberMap.set(ticketNumber, entry);
                        } else {
                            if (!archivedData[hotel]) {
                                archivedData[hotel] = [];
                            }
                            archivedData[hotel].push(entry);
                        }
                    } else {
                        ticketNumberMap.set(ticketNumber, entry);
                    }
                });

                processedData[hotel] = Array.from(ticketNumberMap.values());
            }
        }

        const newFilePath = filePath.replace(/(\\.xlsx)?$/, '.xlsx');
        await workbook.xlsx.writeFile(newFilePath);

        return { processedData, archivedData };
    } catch (error) {
        throw error;
    }
}

module.exports = backend;
