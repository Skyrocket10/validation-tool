const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Database location in user's home directory
const dbDir = path.join(os.homedir(), '.validation-analyzer');
const dbPath = path.join(dbDir, 'settings.db');

// Ensure directory exists
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS hotels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        ticket_price REAL DEFAULT 10.00,
        licensing_fee REAL DEFAULT 50.00,
        setup_fee REAL DEFAULT 0.00,
        site_name TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS custom_line_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hotel_id INTEGER NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_hotels_name ON hotels(name);
    CREATE INDEX IF NOT EXISTS idx_custom_items_hotel ON custom_line_items(hotel_id);
`);

// Hotel operations
const hotelOps = {
    // Get or create hotel by name
    getOrCreate: (name) => {
        let hotel = db.prepare('SELECT * FROM hotels WHERE name = ?').get(name);
        if (!hotel) {
            const result = db.prepare(`
                INSERT INTO hotels (name) VALUES (?)
            `).run(name);
            hotel = db.prepare('SELECT * FROM hotels WHERE id = ?').get(result.lastInsertRowid);
        }
        return hotel;
    },

    // Get hotel by name
    getByName: (name) => {
        return db.prepare('SELECT * FROM hotels WHERE name = ?').get(name);
    },

    // Get all hotels
    getAll: () => {
        return db.prepare('SELECT * FROM hotels ORDER BY name').all();
    },

    // Get active hotels only
    getActive: () => {
        return db.prepare('SELECT * FROM hotels WHERE is_active = 1 ORDER BY name').all();
    },

    // Update hotel settings
    update: (name, settings) => {
        const hotel = hotelOps.getOrCreate(name);

        const updates = [];
        const values = [];

        if (settings.ticket_price !== undefined) {
            updates.push('ticket_price = ?');
            values.push(settings.ticket_price);
        }
        if (settings.licensing_fee !== undefined) {
            updates.push('licensing_fee = ?');
            values.push(settings.licensing_fee);
        }
        if (settings.setup_fee !== undefined) {
            updates.push('setup_fee = ?');
            values.push(settings.setup_fee);
        }
        if (settings.site_name !== undefined) {
            updates.push('site_name = ?');
            values.push(settings.site_name);
        }
        if (settings.is_active !== undefined) {
            updates.push('is_active = ?');
            values.push(settings.is_active ? 1 : 0);
        }

        if (updates.length > 0) {
            updates.push('updated_at = CURRENT_TIMESTAMP');
            values.push(hotel.id);

            db.prepare(`
                UPDATE hotels SET ${updates.join(', ')} WHERE id = ?
            `).run(...values);
        }

        return db.prepare('SELECT * FROM hotels WHERE id = ?').get(hotel.id);
    },

    // Toggle hotel active status
    toggleActive: (name) => {
        const hotel = hotelOps.getOrCreate(name);
        db.prepare(`
            UPDATE hotels SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(hotel.id);
        return db.prepare('SELECT * FROM hotels WHERE id = ?').get(hotel.id);
    },

    // Delete hotel and its custom items
    delete: (name) => {
        const hotel = hotelOps.getByName(name);
        if (hotel) {
            db.prepare('DELETE FROM hotels WHERE id = ?').run(hotel.id);
            return true;
        }
        return false;
    }
};

// Custom line item operations
const customItemOps = {
    // Get all items for a hotel
    getByHotel: (hotelName) => {
        const hotel = hotelOps.getByName(hotelName);
        if (!hotel) return [];
        return db.prepare(`
            SELECT * FROM custom_line_items WHERE hotel_id = ? ORDER BY created_at
        `).all(hotel.id);
    },

    // Add item to hotel
    add: (hotelName, description, amount) => {
        const hotel = hotelOps.getOrCreate(hotelName);
        const result = db.prepare(`
            INSERT INTO custom_line_items (hotel_id, description, amount) VALUES (?, ?, ?)
        `).run(hotel.id, description, amount);
        return db.prepare('SELECT * FROM custom_line_items WHERE id = ?').get(result.lastInsertRowid);
    },

    // Remove item
    remove: (itemId) => {
        db.prepare('DELETE FROM custom_line_items WHERE id = ?').run(itemId);
    },

    // Clear all items for a hotel
    clearByHotel: (hotelName) => {
        const hotel = hotelOps.getByName(hotelName);
        if (hotel) {
            db.prepare('DELETE FROM custom_line_items WHERE hotel_id = ?').run(hotel.id);
        }
    },

    // Replace all items for a hotel
    replaceAll: (hotelName, items) => {
        const hotel = hotelOps.getOrCreate(hotelName);

        // Use transaction for atomicity
        const transaction = db.transaction(() => {
            db.prepare('DELETE FROM custom_line_items WHERE hotel_id = ?').run(hotel.id);

            const insert = db.prepare(`
                INSERT INTO custom_line_items (hotel_id, description, amount) VALUES (?, ?, ?)
            `);

            for (const item of items) {
                insert.run(hotel.id, item.description, item.amount);
            }
        });

        transaction();
        return customItemOps.getByHotel(hotelName);
    }
};

// Close database on process exit
process.on('exit', () => db.close());
process.on('SIGINT', () => { db.close(); process.exit(); });
process.on('SIGTERM', () => { db.close(); process.exit(); });

module.exports = {
    db,
    hotels: hotelOps,
    customItems: customItemOps
};
