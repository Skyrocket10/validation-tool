const { app, BrowserWindow } = require('electron');
const path = require('path');
const url = require('url');
const express = require('express');
const backend = require('./backend');
const { setupParkingRoutes } = require('./parking-backend');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadURL('http://localhost:3232/');

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

function startServer() {
    const serverApp = express();
    backend(serverApp);
    setupParkingRoutes(serverApp);
    const PORT = process.env.PORT || 3232;
    serverApp.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        createWindow();
    });
}

app.on('ready', startServer);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});
