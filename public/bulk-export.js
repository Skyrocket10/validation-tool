document.addEventListener('DOMContentLoaded', function() {
    const bulkExportButton = document.getElementById('bulkExportButton');

    if (bulkExportButton) {
        bulkExportButton.addEventListener('click', handleBulkExport);
    } else {
        console.error('Bulk export button not found');
    }

    async function handleBulkExport() {
        const savedChanges = window.getSavedChanges();
        if (Object.keys(savedChanges).length === 0) {
            alert('No saved changes to export. Please save changes for at least one hotel before bulk exporting.');
            return;
        }

        const zip = new JSZip();

        for (const hotel in savedChanges) {
            const data = savedChanges[hotel];
            const excelBlob = await generateExcelReport(hotel, data);
            const pdfBlob = await generatePDFReport(hotel, data);

            const folder = zip.folder(hotel);
            folder.file(`${hotel}_report.xlsx`, excelBlob);
            folder.file(`${hotel}_report.pdf`, pdfBlob);
        }

        zip.generateAsync({ type: "blob" })
            .then(function(content) {
                const url = window.URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'bulk_export.zip';
                a.click();
                window.URL.revokeObjectURL(url);
            });
    }

    async function generateExcelReport(hotel, data) {
        console.log('Generating Excel Report for', hotel);
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Report');

        sheet.columns = [
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Ticket Number', key: 'ticketNumber', width: 20 },
            { header: 'Price', key: 'price', width: 15 },
            { header: 'Days', key: 'days', width: 10 }
        ];

        data.processedDataRows.forEach(row => {
            sheet.addRow({
                date: row.date,
                ticketNumber: row.ticketNumber,
                price: row.price,
                days: row.days
            });
        });

        try {
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            return blob;
        } catch (error) {
            alert('Error generating Excel file.');
            console.error('Error generating Excel file:', error);
            throw error;
        }
    }

    async function generatePDFReport(hotel, data) {
        console.log('Generating PDF Report for', hotel);
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const startY = 20;
    
        // Report Header
        doc.setFontSize(14);
        doc.text(`Validation Report: ${hotel}`, 10, 10);
        doc.text(`Site: ${data.exportSite || ''}`, 10, 20);
        doc.text(`Date: ${new Date().toLocaleDateString()}`, 10, 30);
    
        // Summary Section
        const totalValue = calculateTotal(data.processedDataRows, 'price');
        const customItemsTotal = calculateTotal(data.customLineItems, 'amount');
        const grandTotal = totalValue + customItemsTotal + data.licensingFee + data.setupFee;
    
        const summary = [
            { description: 'Validations', quantity: data.processedDataRows.length, amount: formatCurrency(totalValue) },
            ...data.customLineItems.map(item => ({ description: item.description, quantity: 1, amount: formatCurrency(item.amount) })),
            { description: 'Licensing Fee', quantity: 1, amount: formatCurrency(data.licensingFee) },
            { description: 'Setup Fee', quantity: 1, amount: formatCurrency(data.setupFee) },
            { description: 'Grand Total', quantity: '', amount: formatCurrency(grandTotal) },
        ];
    
        doc.autoTable({
            startY: startY + 20,
            head: [['Description', 'Quantity', 'Amount']],
            body: summary.map(item => [item.description, item.quantity, item.amount]),
        });
    
        // Transaction Count Section
        const profileCounts = data.processedDataRows.reduce((acc, row) => {
            acc[row.days] = (acc[row.days] || 0) + 1;
            return acc;
        }, {});
        const profileData = Object.entries(profileCounts).map(([profile, count]) => ({
            profile,
            count,
        }));
        
        doc.autoTable({
            startY: doc.autoTable.previous.finalY + 20,
            head: [['Profile', 'Transaction Count']],
            body: profileData.map(item => [item.profile, item.count]),
        });
    
        // Detailed Transactions Section
        doc.autoTable({
            startY: doc.autoTable.previous.finalY + 20,
            head: [['Date', 'Ticket', 'Amount', 'Profile']],
            body: data.processedDataRows.map(row => [row.date, row.ticketNumber, row.price, row.days]),
        });
    
        const pdfBlob = doc.output('blob');
        return pdfBlob;
    }
    
    function calculateTotal(data, key) {
        return data.reduce((sum, item) => sum + (typeof item[key] === 'string' ? parseFloat(item[key].replace(/[^0-9.-]+/g, "")) : item[key]), 0);
    }

    function formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'AUD',
            minimumFractionDigits: 2
        }).format(amount).replace('A$', '$');
    }
});
