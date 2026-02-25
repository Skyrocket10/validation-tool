document.addEventListener('DOMContentLoaded', function () {
    let processedData = [];
    let archivedData = [];
    let customLineItems = [];
    let savedChanges = {};
    let allHotelsFromUpload = {};
    let currentHotelIsActive = true;

    // DOM Elements
    const uploadForm = document.getElementById('uploadForm');
    const hotelSelect = document.getElementById('hotelSelect');
    const setPriceButton = document.getElementById('setPriceButton');
    const priceInput = document.getElementById('priceInput');
    const searchInput = document.getElementById('searchInput');
    const clearSearchButton = document.getElementById('clearSearchButton');
    const customItemDescription = document.getElementById('customItemDescription');
    const customItemAmount = document.getElementById('customItemAmount');
    const addCustomItemButton = document.getElementById('addCustomItemButton');
    const customItemsList = document.getElementById('customItemsList');
    const saveChangesButton = document.getElementById('saveChangesButton');
    const reportTextButton = document.getElementById('reportTextButton');
    const reportModal = document.getElementById('reportModal');
    const reportContent = document.getElementById('reportContent');
    const closeModal = document.querySelector('.close');
    const copyReportButton = document.getElementById('copyReportButton');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadBtnText = document.getElementById('uploadBtnText');
    const uploadSpinner = document.getElementById('uploadSpinner');
    const currentHotelDisplay = document.getElementById('currentHotelDisplay');
    const showInactiveToggle = document.getElementById('showInactiveToggle');
    const hotelStatusSection = document.getElementById('hotelStatusSection');
    const toggleActiveBtn = document.getElementById('toggleActiveBtn');
    const uploadNewFileBtn = document.getElementById('uploadNewFileBtn');

    // Event Listeners
    if (uploadForm) uploadForm.addEventListener('submit', handleUpload);
    if (hotelSelect) hotelSelect.addEventListener('change', () => {
        if (hotelSelect.value) fetchHotelData();
    });
    if (setPriceButton) setPriceButton.addEventListener('click', updatePrice);
    if (searchInput) searchInput.addEventListener('input', searchData);
    if (clearSearchButton) clearSearchButton.addEventListener('click', clearSearch);
    if (addCustomItemButton) addCustomItemButton.addEventListener('click', addCustomLineItem);
    if (saveChangesButton) saveChangesButton.addEventListener('click', saveChanges);
    if (reportTextButton) reportTextButton.addEventListener('click', generateAndShowReport);
    if (closeModal) closeModal.addEventListener('click', () => closeModalFn());
    if (copyReportButton) copyReportButton.addEventListener('click', copyReportToClipboard);
    if (showInactiveToggle) showInactiveToggle.addEventListener('change', updateHotelSelectList);
    if (toggleActiveBtn) toggleActiveBtn.addEventListener('click', toggleHotelActive);
    if (uploadNewFileBtn) uploadNewFileBtn.addEventListener('click', showUploadScreen);

    // Close modal on background click
    if (reportModal) {
        reportModal.addEventListener('click', (event) => {
            if (event.target === reportModal) {
                closeModalFn();
            }
        });
    }

    // Close modal on Escape key
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && reportModal.classList.contains('active')) {
            closeModalFn();
        }
    });

    function closeModalFn() {
        reportModal.classList.remove('active');
    }

    function openModalFn() {
        reportModal.classList.add('active');
    }

    function showUploadScreen() {
        // Reset the file input
        const fileInput = document.getElementById('file-upload');
        const fileNameDisplay = document.getElementById('selectedFileName');
        if (fileInput) fileInput.value = '';
        if (fileNameDisplay) {
            fileNameDisplay.textContent = '';
            fileNameDisplay.classList.add('hidden');
        }

        // Hide main container, show upload container
        document.getElementById('mainContainer').classList.add('hidden');
        document.getElementById('uploadContainer').classList.remove('hidden');

        // Reset hotel status section
        if (hotelStatusSection) hotelStatusSection.classList.add('hidden');
    }

    async function handleUpload(event) {
        event.preventDefault();

        // Show loading state
        uploadBtn.disabled = true;
        uploadBtnText.textContent = 'Analyzing...';
        uploadSpinner.classList.remove('hidden');

        const formData = new FormData(uploadForm);
        try {
            const response = await fetch('/upload', { method: 'POST', body: formData });
            if (response.ok) {
                const data = await response.json();
                allHotelsFromUpload = data;
                showNotification('File uploaded successfully!', 'success');
                await updateHotelSelectList();
                document.getElementById('uploadContainer').classList.add('hidden');
                document.getElementById('mainContainer').classList.remove('hidden');
            } else {
                const errorText = await response.text();
                showNotification(`Error uploading the file: ${errorText}`, 'error');
            }
        } catch (error) {
            showNotification('An error occurred while uploading the file.', 'error');
        } finally {
            // Reset loading state
            uploadBtn.disabled = false;
            uploadBtnText.textContent = 'Upload and Analyze';
            uploadSpinner.classList.add('hidden');
        }
    }

    async function updateHotelSelectList() {
        const includeInactive = showInactiveToggle && showInactiveToggle.checked;

        hotelSelect.innerHTML = '<option value="">Choose a hotel...</option>';

        // Only show hotels from the uploaded file
        const uploadedHotelNames = Object.keys(allHotelsFromUpload).sort();

        if (uploadedHotelNames.length === 0) {
            return;
        }

        try {
            // Get hotel settings from database to check active status
            const response = await fetch(`/api/hotels?includeInactive=true`);
            const dbHotels = await response.json();
            const dbHotelMap = new Map(dbHotels.map(h => [h.name, h]));

            for (const hotelName of uploadedHotelNames) {
                const dbHotel = dbHotelMap.get(hotelName);
                const isActive = dbHotel ? dbHotel.is_active === 1 : true;

                // Skip inactive hotels if not showing them
                if (!includeInactive && !isActive) continue;

                const option = document.createElement('option');
                option.value = hotelName;

                // Add indicator for inactive hotels
                if (!isActive) {
                    option.textContent = `${hotelName} (hidden)`;
                    option.classList.add('text-slate-400');
                } else {
                    option.textContent = hotelName;
                }

                hotelSelect.appendChild(option);
            }
        } catch (error) {
            // Fallback to just showing uploaded hotels without status
            for (const hotelName of uploadedHotelNames) {
                const option = document.createElement('option');
                option.value = hotelName;
                option.textContent = hotelName;
                hotelSelect.appendChild(option);
            }
        }
    }

    async function fetchHotelData() {
        const selectedHotel = hotelSelect.value;
        if (!selectedHotel) {
            return;
        }

        // Update header
        if (currentHotelDisplay) {
            currentHotelDisplay.textContent = selectedHotel;
        }

        try {
            const response = await fetch(`/hotel/${encodeURIComponent(selectedHotel)}`);
            if (response.ok) {
                const data = await response.json();
                processedData = data.processedData || [];
                archivedData = data.archivedData || [];

                // Load saved settings from database
                if (data.settings) {
                    priceInput.value = data.settings.ticketPrice || '';
                    document.getElementById('licensingFee').value = data.settings.licensingFee || 50;
                    document.getElementById('setupFee').value = data.settings.setupFee || 0;
                    document.getElementById('siteNameSelect').value = data.settings.siteName || '';
                    currentHotelIsActive = data.settings.isActive !== false;
                }

                // Load saved custom items
                if (data.customItems && data.customItems.length > 0) {
                    customLineItems = data.customItems.map(item => ({
                        id: item.id,
                        description: item.description,
                        amount: item.amount
                    }));
                } else {
                    customLineItems = [];
                }

                updateUI(processedData, archivedData);
                updateCustomItemsList();
                updateHotelStatusUI();

                // Show hotel status section
                if (hotelStatusSection) {
                    hotelStatusSection.classList.remove('hidden');
                }

            } else {
                const errorText = await response.text();
                showNotification(`Error fetching hotel data: ${errorText}`, 'error');
            }
        } catch (error) {
            showNotification('An error occurred while fetching hotel data.', 'error');
        }
    }

    function updateHotelStatusUI() {
        if (!toggleActiveBtn) return;

        if (currentHotelIsActive) {
            toggleActiveBtn.textContent = 'Active';
            toggleActiveBtn.classList.remove('bg-slate-200', 'text-slate-600');
            toggleActiveBtn.classList.add('bg-emerald-100', 'text-emerald-700');
        } else {
            toggleActiveBtn.textContent = 'Hidden';
            toggleActiveBtn.classList.remove('bg-emerald-100', 'text-emerald-700');
            toggleActiveBtn.classList.add('bg-slate-200', 'text-slate-600');
        }
    }

    async function toggleHotelActive() {
        const selectedHotel = hotelSelect.value;
        if (!selectedHotel) return;

        try {
            const response = await fetch(`/api/hotels/${encodeURIComponent(selectedHotel)}/toggle-active`, {
                method: 'PUT'
            });

            if (response.ok) {
                const data = await response.json();
                currentHotelIsActive = data.is_active === 1;
                updateHotelStatusUI();
                await updateHotelSelectList();
                hotelSelect.value = selectedHotel;
                showNotification(currentHotelIsActive ? 'Hotel is now visible' : 'Hotel is now hidden', 'success');
            }
        } catch (error) {
            showNotification('Failed to update hotel status', 'error');
        }
    }

    function updateUI(processedData, archivedData) {
        displayData(processedData, 'processedDataTable');
        displayData(archivedData, 'archivedDataTable');
        displayStats(processedData, archivedData);

        // Update counts
        document.getElementById('processedCount').textContent = processedData.length;
        document.getElementById('duplicatesCount').textContent = archivedData.length;

        // Toggle empty states
        const processedEmpty = document.getElementById('processedEmptyState');
        const archivedEmpty = document.getElementById('archivedEmptyState');

        if (processedEmpty) {
            processedEmpty.classList.toggle('hidden', processedData.length > 0);
        }
        if (archivedEmpty) {
            archivedEmpty.classList.toggle('hidden', archivedData.length > 0);
        }
    }

    function displayData(data, tableId) {
        const tableBody = document.querySelector(`#${tableId} tbody`);
        if (!tableBody) return;

        const isArchived = tableId === 'archivedDataTable';

        tableBody.innerHTML = '';

        data.forEach((rowData, index) => {
            const row = document.createElement('tr');
            row.classList.add('data-row');

            ['A', 'C', 'D', 'E'].forEach(key => {
                const cell = document.createElement('td');
                cell.classList.add('px-6', 'py-4', 'whitespace-nowrap', 'text-sm', 'text-slate-700');
                cell.textContent = rowData[key];
                row.appendChild(cell);
            });

            // Add action cell with move button
            const actionCell = document.createElement('td');
            actionCell.classList.add('px-4', 'py-4', 'whitespace-nowrap', 'text-right');

            const moveBtn = document.createElement('button');
            moveBtn.classList.add('btn-press', 'px-3', 'py-1.5', 'text-xs', 'font-medium', 'rounded-lg', 'transition-colors');

            if (isArchived) {
                // Move to processed (bill it)
                moveBtn.classList.add('bg-emerald-100', 'text-emerald-700', 'hover:bg-emerald-200');
                moveBtn.innerHTML = `
                    <span class="flex items-center gap-1">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                        </svg>
                        Bill
                    </span>
                `;
                moveBtn.title = 'Move to Processed (bill this ticket)';
                moveBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    moveToProcessed(index);
                });
            } else {
                // Move to duplicates (don't bill)
                moveBtn.classList.add('bg-amber-100', 'text-amber-700', 'hover:bg-amber-200');
                moveBtn.innerHTML = `
                    <span class="flex items-center gap-1">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                        </svg>
                        Skip
                    </span>
                `;
                moveBtn.title = 'Move to Duplicates (do not bill)';
                moveBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    moveToDuplicates(index);
                });
            }

            actionCell.appendChild(moveBtn);
            row.appendChild(actionCell);

            // Click row to search
            row.addEventListener('click', function () {
                searchInput.value = rowData['C'];
                clearSearchButton.classList.remove('hidden');
                searchData();
            });

            tableBody.appendChild(row);
        });
    }

    function moveToProcessed(index) {
        if (index >= 0 && index < archivedData.length) {
            const item = archivedData.splice(index, 1)[0];
            processedData.push(item);
            updateUI(processedData, archivedData);
            showNotification('Ticket moved to Processed', 'success');
        }
    }

    function moveToDuplicates(index) {
        if (index >= 0 && index < processedData.length) {
            const item = processedData.splice(index, 1)[0];
            archivedData.push(item);
            updateUI(processedData, archivedData);
            showNotification('Ticket moved to Duplicates', 'success');
        }
    }

    function displayStats(processedData, archivedData) {
        const totalTickets = processedData.length;
        const totalValue = calculateTotal(processedData, 'D');
        const customItemsTotal = customLineItems.reduce((sum, item) => sum + item.amount, 0);
        const licensingFee = parseFloat(document.getElementById('licensingFee').value) || 0;
        const setupFee = parseFloat(document.getElementById('setupFee').value) || 0;
        const grandTotal = totalValue + customItemsTotal + licensingFee + setupFee;
        const totalDuplicates = archivedData.length;

        // Update stat cards
        const statTickets = document.getElementById('stat-tickets');
        const statDuplicates = document.getElementById('stat-duplicates');
        const statValue = document.getElementById('stat-value');
        const statGrand = document.getElementById('stat-grand');

        if (statTickets) statTickets.textContent = totalTickets;
        if (statDuplicates) statDuplicates.textContent = totalDuplicates;
        if (statValue) statValue.textContent = formatCurrency(totalValue);
        if (statGrand) statGrand.textContent = formatCurrency(grandTotal);
    }

    function calculateTotal(data, key) {
        return data.reduce((sum, item) => {
            const value = typeof item[key] === 'string' ? parseFloat(item[key].replace(/[^0-9.-]+/g, "")) : item[key];
            return sum + (isNaN(value) ? 0 : value);
        }, 0);
    }

    async function updatePrice() {
        const newPrice = priceInput.value;
        const selectedHotel = hotelSelect.value;

        if (!selectedHotel) {
            showNotification('Please select a hotel first.', 'warning');
            return;
        }

        if (newPrice && !isNaN(newPrice)) {
            // Show loading state
            setPriceButton.disabled = true;
            setPriceButton.textContent = 'Applying...';

            try {
                const response = await fetch(`/hotel/${encodeURIComponent(selectedHotel)}/price`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ price: newPrice })
                });

                if (response.ok) {
                    const updatedData = await response.json();
                    processedData = updatedData;
                    displayData(processedData, 'processedDataTable');
                    displayStats(processedData, archivedData);
                    showNotification('Price saved and applied.', 'success');
                } else {
                    const errorText = await response.text();
                    showNotification(`Error updating the price: ${errorText}`, 'error');
                }
            } catch (error) {
                showNotification('Error updating the price.', 'error');
            } finally {
                setPriceButton.disabled = false;
                setPriceButton.textContent = 'Apply Price';
            }
        } else {
            showNotification('Please enter a valid price.', 'warning');
        }
    }

    function searchData() {
        const searchQuery = searchInput.value.toLowerCase();
        const processedDataRows = document.querySelectorAll('#processedDataTable tbody tr');
        const archivedDataRows = document.querySelectorAll('#archivedDataTable tbody tr');

        [processedDataRows, archivedDataRows].forEach(rows => {
            rows.forEach(row => {
                const ticketNumber = row.cells[1].textContent.toLowerCase();
                row.style.display = ticketNumber.includes(searchQuery) ? '' : 'none';
            });
        });

        // Show/hide clear button
        clearSearchButton.classList.toggle('hidden', !searchQuery);
    }

    function clearSearch() {
        searchInput.value = '';
        clearSearchButton.classList.add('hidden');
        searchData();
    }

    function addCustomLineItem() {
        const description = customItemDescription.value.trim();
        const amount = parseFloat(customItemAmount.value);

        if (description && !isNaN(amount)) {
            customLineItems.push({ description, amount });
            updateCustomItemsList();
            customItemDescription.value = '';
            customItemAmount.value = '';
            displayStats(processedData, archivedData);
            showNotification('Custom item added.', 'success');
        } else {
            showNotification('Please enter a valid description and amount.', 'warning');
        }
    }

    function updateCustomItemsList() {
        if (!customItemsList) return;

        customItemsList.innerHTML = '';

        if (customLineItems.length === 0) {
            customItemsList.innerHTML = '<li class="text-sm text-slate-400 text-center py-2">No custom items</li>';
            return;
        }

        customLineItems.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between bg-slate-50 p-3 rounded-lg';
            li.innerHTML = `
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-700 truncate">${item.description}</p>
                    <p class="text-sm text-emerald-600 font-semibold">${formatCurrency(item.amount)}</p>
                </div>
                <button class="ml-2 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" onclick="removeCustomLineItem(${index})">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            `;
            customItemsList.appendChild(li);
        });
    }

    window.removeCustomLineItem = function (index) {
        customLineItems.splice(index, 1);
        updateCustomItemsList();
        displayStats(processedData, archivedData);
        showNotification('Item removed.', 'success');
    }

    async function saveChanges() {
        const selectedHotel = hotelSelect.value;
        if (!selectedHotel) {
            showNotification('Please select a hotel before saving.', 'warning');
            return;
        }

        const ticketPrice = parseFloat(priceInput.value) || 10;
        const licensingFee = parseFloat(document.getElementById('licensingFee').value) || 0;
        const setupFee = parseFloat(document.getElementById('setupFee').value) || 0;
        const siteName = document.getElementById('siteNameSelect').value;

        // Show loading on save button
        saveChangesButton.disabled = true;
        saveChangesButton.innerHTML = '<div class="spinner mx-auto" style="width:20px;height:20px;border-width:2px;"></div>';

        try {
            // Save to database
            const response = await fetch(`/api/hotels/${encodeURIComponent(selectedHotel)}/save-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticketPrice,
                    licensingFee,
                    setupFee,
                    siteName,
                    customLineItems: customLineItems.map(item => ({
                        description: item.description,
                        amount: item.amount
                    }))
                })
            });

            if (response.ok) {
                // Also keep in local savedChanges for report generation
                const processedDataRows = Array.from(document.querySelectorAll('#processedDataTable tbody tr')).map(row => ({
                    date: row.cells[0].textContent,
                    ticketNumber: row.cells[1].textContent,
                    price: row.cells[2].textContent,
                    days: row.cells[3].textContent
                }));

                savedChanges[selectedHotel] = {
                    processedData: [...processedData],
                    archivedData: [...archivedData],
                    customLineItems: [...customLineItems],
                    licensingFee,
                    setupFee,
                    processedDataRows,
                    exportSite: siteName
                };

                updateSavedChangesList();
                showNotification(`${selectedHotel} saved to database.`, 'success');
            } else {
                showNotification('Failed to save to database.', 'error');
            }
        } catch (error) {
            showNotification('Error saving settings.', 'error');
        } finally {
            saveChangesButton.disabled = false;
            saveChangesButton.innerHTML = `
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
                </svg>
                Save Changes
            `;
        }
    }

    function updateSavedChangesList() {
        const savedChangesList = document.getElementById('savedChangesList');
        if (!savedChangesList) return;

        savedChangesList.innerHTML = '';

        const hotels = Object.keys(savedChanges);
        if (hotels.length === 0) {
            savedChangesList.innerHTML = '<li class="text-sm text-slate-400 text-center py-4 pulse-subtle">No saved hotels yet</li>';
            return;
        }

        for (const hotel in savedChanges) {
            const hotelData = savedChanges[hotel];
            const totalValue = calculateTotal(hotelData.processedDataRows, 'price');
            const customItemsTotal = hotelData.customLineItems.reduce((sum, item) => sum + item.amount, 0);
            const grandTotal = totalValue + customItemsTotal + hotelData.licensingFee + hotelData.setupFee;

            const li = document.createElement('li');
            li.className = 'bg-slate-50 rounded-lg p-3 hover:bg-slate-100 transition-colors cursor-pointer';
            li.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="min-w-0 flex-1">
                        <p class="text-sm font-semibold text-slate-700 truncate">${hotel}</p>
                        <p class="text-xs text-slate-500">${hotelData.processedDataRows.length} tickets</p>
                    </div>
                    <div class="text-right">
                        <p class="text-sm font-bold text-emerald-600">${formatCurrency(grandTotal)}</p>
                        <p class="text-xs text-slate-400">${hotelData.exportSite || 'No site'}</p>
                    </div>
                </div>
            `;
            li.addEventListener('click', () => {
                hotelSelect.value = hotel;
                fetchHotelData();
            });
            savedChangesList.appendChild(li);
        }
    }

    window.loadSavedHotelData = function(hotel) {
        hotelSelect.value = hotel;
        fetchHotelData();
    }

    function formatCurrency(amount) {
        return new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD',
            minimumFractionDigits: 2
        }).format(amount);
    }

    function generateAndShowReport() {
        if (Object.keys(savedChanges).length === 0) {
            showNotification('Save at least one hotel before generating the report.', 'warning');
            return;
        }

        const htmlReport = generateReport(savedChanges);
        reportContent.innerHTML = htmlReport;
        openModalFn();
    }

    function generateReport(savedChanges) {
        // Get previous month
        const currentDate = new Date();
        currentDate.setMonth(currentDate.getMonth() - 1);
        const month = currentDate.toLocaleString('default', { month: 'long' });
        const year = currentDate.getFullYear();

        // Group hotels by site
        const siteTotals = {};
        let totalValidations = 0;
        let totalAmount = 0;

        for (const [hotel, data] of Object.entries(savedChanges)) {
            const validations = data.processedDataRows.length;
            const amount = data.processedDataRows.reduce((sum, row) => sum + parseFloat(row.price.replace(/[^0-9.-]+/g, "")), 0);
            const site = data.exportSite || 'Unassigned';

            if (!siteTotals[site]) {
                siteTotals[site] = { hotels: [], validations: 0, amount: 0 };
            }
            siteTotals[site].hotels.push({ name: hotel, validations, amount });
            siteTotals[site].validations += validations;
            siteTotals[site].amount += amount;

            totalValidations += validations;
            totalAmount += amount;
        }

        let htmlReport = `
            <p style="font-family: Arial, sans-serif; font-size: 14px; margin-bottom: 16px;">Hi,</p>
            <p style="font-family: Arial, sans-serif; font-size: 14px; margin-bottom: 16px;">Please find the Invoice Request for Hotel Validations for <b>${month} ${year}</b>.</p>

            <table style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 13px; margin-bottom: 20px;">
                <thead>
                    <tr style="background-color: #d1d5db;">
                        <th style="padding: 10px 12px; text-align: left; border: 1px solid #9ca3af; color: #111827; font-weight: bold;">Site</th>
                        <th style="padding: 10px 12px; text-align: left; border: 1px solid #9ca3af; color: #111827; font-weight: bold;">Hotel</th>
                        <th style="padding: 10px 12px; text-align: right; border: 1px solid #9ca3af; color: #111827; font-weight: bold;">Validations</th>
                        <th style="padding: 10px 12px; text-align: right; border: 1px solid #9ca3af; color: #111827; font-weight: bold;">Amount</th>
                    </tr>
                </thead>
                <tbody>`;

        // Sort sites alphabetically
        const sortedSites = Object.keys(siteTotals).sort();

        for (const site of sortedSites) {
            const siteData = siteTotals[site];
            const hotelCount = siteData.hotels.length;

            siteData.hotels.forEach((hotel, index) => {
                htmlReport += `
                    <tr style="background-color: ${index % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        ${index === 0 ? `<td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600; vertical-align: top;" rowspan="${hotelCount}">${site}</td>` : ''}
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${hotel.name}</td>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: right;">${hotel.validations}</td>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: right;">$${hotel.amount.toFixed(2)}</td>
                    </tr>`;
            });

            // Site subtotal row
            htmlReport += `
                <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                    <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;" colspan="2">${site} Total</td>
                    <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: right; font-weight: 600;">${siteData.validations}</td>
                    <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: right; font-weight: 600;">$${siteData.amount.toFixed(2)}</td>
                </tr>`;
        }

        // Grand total row
        htmlReport += `
                    <tr style="background-color: #d1d5db;">
                        <td style="padding: 10px 12px; border: 1px solid #9ca3af; color: #111827; font-weight: bold;" colspan="2">Grand Total</td>
                        <td style="padding: 10px 12px; border: 1px solid #9ca3af; color: #111827; text-align: right; font-weight: bold;">${totalValidations}</td>
                        <td style="padding: 10px 12px; border: 1px solid #9ca3af; color: #111827; text-align: right; font-weight: bold;">$${totalAmount.toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>

            <p style="font-family: Arial, sans-serif; font-size: 14px; margin-bottom: 8px;">Total of <b>$${totalAmount.toFixed(2)}</b> to be invoiced for <b>${month} ${year}</b>.</p>
            <p style="font-family: Arial, sans-serif; font-size: 14px; margin-bottom: 16px;">Validation reports are saved in the usual location.</p>
            <p style="font-family: Arial, sans-serif; font-size: 14px; margin-bottom: 8px;">Let me know if you have any questions.</p>
            <p style="font-family: Arial, sans-serif; font-size: 14px; margin-top: 16px;">Kind regards</p>`;

        return htmlReport;
    }

    function copyReportToClipboard() {
        const htmlContent = reportContent.innerHTML;

        // Copy as HTML so styles are preserved when pasting into email
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const clipboardItem = new ClipboardItem({
            'text/html': blob,
            'text/plain': new Blob([reportContent.innerText], { type: 'text/plain' })
        });

        navigator.clipboard.write([clipboardItem]).then(() => {
            showNotification('Report copied with formatting!', 'success');
        }).catch(() => {
            // Fallback to plain text if HTML copy fails
            navigator.clipboard.writeText(reportContent.innerText).then(() => {
                showNotification('Report copied (plain text)', 'success');
            }).catch(() => {
                showNotification('Failed to copy report.', 'error');
            });
        });
    }

    function showNotification(message, type = 'info') {
        const container = document.getElementById('notificationContainer');
        if (!container) return;

        const icons = {
            success: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
            error: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
            warning: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
            info: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
        };

        const colors = {
            success: 'bg-emerald-500',
            error: 'bg-red-500',
            warning: 'bg-amber-500',
            info: 'bg-blue-500'
        };

        const notification = document.createElement('div');
        notification.className = `notification flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white ${colors[type] || colors.info}`;
        notification.innerHTML = `
            ${icons[type] || icons.info}
            <span class="text-sm font-medium">${message}</span>
        `;

        container.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Expose savedChanges to other scripts
    window.getSavedChanges = function () {
        return savedChanges;
    }
});
