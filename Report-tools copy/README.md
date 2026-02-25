# Parking Data Analyzer

A Flask web application for analyzing parking data from Excel files. Upload your parking data and get insights on vehicle counts, hourly patterns, and threshold analysis.

## Features

- **File Upload**: Upload Excel (.xlsx) files containing parking data
- **Date/Time Filtering**: Filter data by start and end date/time
- **Hourly Analysis**: View vehicle counts aggregated by hour
- **Threshold Monitoring**: Set a threshold and identify hours that exceed it
- **Summary Statistics**: 
  - Total transactions
  - Unique vehicles
  - Date range of data
  - Breakdown by action type (Entry/Exit)
  - Breakdown by location/permit type
- **Interactive Visualization**: Line chart showing hourly vehicle counts with optional threshold line

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Create the uploads directory (automatically created when running the app)

## Usage

1. Start the Flask application:
```bash
python app.py
```

2. Open your browser and navigate to `http://localhost:5000`

3. Upload an Excel file with parking data

4. Optional: Set filters:
   - Start Date/Time: Filter transactions from this date/time
   - End Date/Time: Filter transactions up to this date/time
   - Vehicle Count Threshold: Highlight hours exceeding this count

5. Click "Analyze Data" to process the file

## Excel File Format

The application expects Excel files with the following structure:
- Headers should be in row 4
- Required columns:
  - Location/User Name
  - User
  - Lane
  - Plate
  - Action (Entry/Exit)
  - Date/Time
  - Perm Rate/Group

## Example

The application was tested with parking access activity reports that track vehicle entries and exits with timestamps.

## Notes

- Maximum file size: 16MB
- Supported formats: .xlsx, .xls
- Uploaded files are temporarily stored and deleted after processing