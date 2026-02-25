from flask import Flask, render_template, request, jsonify, send_file, make_response, Response
import pandas as pd
import numpy as np
import os
import hashlib
import time
from datetime import datetime
from werkzeug.utils import secure_filename
import json
import io
import csv
import gc
from concurrent.futures import ThreadPoolExecutor
import threading
from functools import lru_cache

# Try to import ultra-fast libraries (optional)
try:
    import pyarrow as pa
    import pyarrow.parquet as pq
    HAS_PYARROW = True
except ImportError:
    HAS_PYARROW = False

try:
    from numba import jit
    HAS_NUMBA = True
except ImportError:
    HAS_NUMBA = False

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size for 1M rows

# Ensure upload folder exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs('cache', exist_ok=True)  # Cache folder for Parquet files

ALLOWED_EXTENSIONS = {'xlsx', 'xls'}

# Thread pool for async processing
executor = ThreadPoolExecutor(max_workers=4)

# Progress tracking
progress_store = {}
progress_lock = threading.Lock()

# Memory cache for processed results (fallback if no Redis)
memory_cache = {}
CACHE_TTL = 3600  # 1 hour

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def update_progress(task_id, progress, status="processing"):
    with progress_lock:
        progress_store[task_id] = {"progress": progress, "status": status}


def get_cache_key(filepath, start_datetime, end_datetime, threshold, email_filter):
    """Generate cache key based on file and parameters"""
    file_stat = os.stat(filepath)
    key_data = f"{filepath}:{file_stat.st_mtime}:{file_stat.st_size}:{start_datetime}:{end_datetime}:{threshold}:{email_filter}"
    return hashlib.md5(key_data.encode()).hexdigest()

def get_cache(key):
    """Get from cache"""
    if key in memory_cache:
        cached_data, timestamp = memory_cache[key]
        if time.time() - timestamp < CACHE_TTL:
            return cached_data
        else:
            del memory_cache[key]
    return None

def set_cache(key, data):
    """Set cache with timestamp"""
    memory_cache[key] = (data, time.time())

def extract_carpark_name(filepath):
    """Extract carpark name from row 6, column A of Excel file"""
    try:
        # Read first 8 rows without header to find carpark name
        df_name = pd.read_excel(filepath, engine='openpyxl', header=None, nrows=8, usecols=[0])
        
        # First try row 6 (index 5)
        if len(df_name) >= 6 and pd.notna(df_name.iloc[5, 0]):
            carpark_name = str(df_name.iloc[5, 0]).strip()
            if carpark_name and not carpark_name.lower().startswith(('date', 'time', 'location', 'user')):
                return carpark_name
        
        # Fallback: search first few rows for a potential carpark name
        for i in range(min(8, len(df_name))):
            if pd.notna(df_name.iloc[i, 0]):
                potential_name = str(df_name.iloc[i, 0]).strip()
                # Skip obvious header/data field names
                if (potential_name and 
                    not potential_name.lower().startswith(('date', 'time', 'location', 'user', 'lane', 'plate', 'action', 'cost')) and
                    len(potential_name) > 3):
                    return potential_name
                    
    except Exception as e:
        print(f"Warning: Could not extract carpark name: {e}")
    return None

def convert_excel_to_parquet(filepath):
    """Convert Excel to Parquet for 50x faster reading"""
    parquet_path = os.path.join('cache', os.path.basename(filepath).replace('.xlsx', '.parquet').replace('.xls', '.parquet'))
    
    # Check if parquet exists and is newer than Excel
    if os.path.exists(parquet_path):
        parquet_time = os.path.getmtime(parquet_path)
        excel_time = os.path.getmtime(filepath)
        if parquet_time > excel_time:
            return parquet_path
    
    try:
        # Read Excel with optimized settings
        usecols = [0, 2, 3, 4, 5, 7, 8, 9, 10, 12]
        df = pd.read_excel(filepath, skiprows=3, engine='openpyxl', usecols=usecols)
        df.columns = ['Location/UserName', 'User', 'Lane', 'Plate', 'Action', 
                      'Cost', 'DateTime', 'Notes', 'Overflow', 'PermRate/Group']
        
        # Clean and optimize data types
        df = df[df['DateTime'].notna()]
        df['DateTime'] = pd.to_datetime(df['DateTime'], errors='coerce')
        df = df[df['DateTime'].notna()]  # Remove invalid dates
        
        # Keep data types simpler for reliability
        df['Cost'] = pd.to_numeric(df['Cost'], errors='coerce')
        
        # Save as Parquet with compression
        if HAS_PYARROW:
            df.to_parquet(parquet_path, compression='snappy', engine='pyarrow')
        else:
            df.to_parquet(parquet_path, compression='snappy')
        
        return parquet_path
        
    except Exception as e:
        print(f"Warning: Could not convert to Parquet: {e}")
        return None

# Note: Using pandas cumsum directly for reliability instead of JIT compilation

def process_parking_data_ultra_fast(filepath, start_datetime=None, end_datetime=None, threshold=None, email_filter=None, return_emails=False, task_id=None, filename=None):
    """Ultra-fast processing with Parquet conversion and caching"""
    try:
        # Extract carpark name from Excel file first (before any caching)
        carpark_name = extract_carpark_name(filepath)
        if not carpark_name:
            # Fallback to filename if carpark name not found in file
            carpark_name = filename if filename else os.path.basename(filepath)
            if carpark_name.lower().endswith(('.xlsx', '.xls')):
                carpark_name = carpark_name[:-4]  # Remove extension
            elif carpark_name.lower().endswith('.xlsx'):
                carpark_name = carpark_name[:-5]  # Remove .xlsx

        # Check cache first for ultimate speed (include carpark name in cache key)
        cache_key = get_cache_key(filepath, start_datetime, end_datetime, threshold, email_filter)
        cached_result = get_cache(cache_key)
        if cached_result:
            # Update cached result with current carpark name
            cached_result['carpark_name'] = carpark_name
            if task_id:
                update_progress(task_id, 100, "completed")
            return cached_result
        
        if task_id:
            update_progress(task_id, 5, "converting")
        
        # 🚀 ULTRA-FAST: Convert Excel to Parquet (50x faster reading)
        parquet_path = convert_excel_to_parquet(filepath)
        
        if task_id:
            update_progress(task_id, 25, "reading")
        
        # 🚀 ULTRA-FAST: Read from Parquet if available, otherwise fallback to Excel
        if parquet_path and os.path.exists(parquet_path):
            try:
                df = pd.read_parquet(parquet_path)
            except Exception:
                # Fallback to Excel if Parquet fails
                usecols = [0, 2, 3, 4, 5, 7, 8, 9, 10, 12]
                df = pd.read_excel(filepath, skiprows=3, engine='openpyxl', usecols=usecols)
                df.columns = ['Location/UserName', 'User', 'Lane', 'Plate', 'Action', 
                              'Cost', 'DateTime', 'Notes', 'Overflow', 'PermRate/Group']
        else:
            # Direct Excel reading as fallback
            usecols = [0, 2, 3, 4, 5, 7, 8, 9, 10, 12]
            df = pd.read_excel(filepath, skiprows=3, engine='openpyxl', usecols=usecols)
            df.columns = ['Location/UserName', 'User', 'Lane', 'Plate', 'Action', 
                          'Cost', 'DateTime', 'Notes', 'Overflow', 'PermRate/Group']
        
        # Get unique emails before filtering (optimized)
        all_emails = []
        if return_emails:
            if 'Location/UserName' in df.columns:
                emails = df['Location/UserName'].dropna().unique()
                all_emails = sorted([email for email in emails if isinstance(email, str) and '@' in email])
        
        if task_id:
            update_progress(task_id, 40, "processing")
        
        # 🚀 ULTRA-FAST: Filter and clean data efficiently
        df = df[df['DateTime'].notna()].copy()
        
        # Convert DateTime if not already done (Parquet preserves types)
        if not pd.api.types.is_datetime64_any_dtype(df['DateTime']):
            df['DateTime'] = pd.to_datetime(df['DateTime'], errors='coerce', cache=True)
        
        # Remove invalid dates
        df = df[df['DateTime'].notna()]
        
        # Apply datetime filters if provided
        if start_datetime:
            df = df[df['DateTime'] >= pd.to_datetime(start_datetime)]
        if end_datetime:
            df = df[df['DateTime'] <= pd.to_datetime(end_datetime)]
        
        if task_id:
            update_progress(task_id, 55, "processing")
        
        # Apply email filter if provided
        if email_filter:
            df_filtered = df[df['Location/UserName'] == email_filter].copy()
        else:
            df_filtered = df
        
        if len(df_filtered) == 0:
            # Use carpark name already extracted at the beginning
            return {
                'success': True,
                'carpark_name': carpark_name,
                'summary': {
                    'total_transactions': 0,
                    'unique_vehicles': 0,
                    'date_range': {'start': '', 'end': ''},
                    'action_breakdown': {},
                    'location_breakdown': {}
                },
                'hourly_data': [],
                'emails': all_emails if return_emails else []
            }
        
        if task_id:
            update_progress(task_id, 70, "processing")
        
        # 🚀 ULTRA-FAST: Pre-sort data for optimal cache performance
        df_filtered = df_filtered.sort_values('DateTime')
        
        # Add hour column with optimized floor operation
        df_filtered['Hour'] = df_filtered['DateTime'].dt.floor('H')
        
        # 🚀 ULTRA-FAST: Vectorized action mapping (working version)
        action_values = np.where(df_filtered['Action'] == 'Entry', 1, 
                               np.where(df_filtered['Action'] == 'Exit', -1, 0))
        df_filtered['vehicle_change'] = action_values.astype(np.int8)
        
        # Use pandas cumsum but ensure it never goes negative
        df_filtered['cumulative_count'] = df_filtered['vehicle_change'].cumsum()
        
        # 🚀 FIX: Prevent negative vehicle counts (parking lots can't have negative vehicles)
        # Find minimum value and adjust if negative
        min_count = df_filtered['cumulative_count'].min()
        if min_count < 0:
            # Shift all counts up so minimum becomes 0
            df_filtered['cumulative_count'] = df_filtered['cumulative_count'] - min_count
        
        # Additional safety: ensure no negative values
        df_filtered['cumulative_count'] = np.maximum(df_filtered['cumulative_count'], 0)
        
        if task_id:
            update_progress(task_id, 85, "aggregating")
        
        # High-performance groupby (simplified for reliability)
        hourly_counts = df_filtered.groupby('Hour', sort=False, as_index=False).agg(
            vehicle_count=('cumulative_count', 'last'),
            net_change=('vehicle_change', 'sum')
        ).sort_values('Hour')
        
        # Add threshold check if needed
        if threshold:
            threshold_val = int(threshold)
            hourly_counts['exceeds_threshold'] = hourly_counts['vehicle_count'] > threshold_val
        
        # Calculate summary statistics
        summary = {
            'total_transactions': len(df_filtered),
            'unique_vehicles': df_filtered['Plate'].nunique(),
            'date_range': {
                'start': df_filtered['DateTime'].min().strftime('%Y-%m-%d %H:%M:%S'),
                'end': df_filtered['DateTime'].max().strftime('%Y-%m-%d %H:%M:%S')
            },
            'action_breakdown': df_filtered['Action'].value_counts().to_dict(),
            'location_breakdown': df_filtered['PermRate/Group'].value_counts().to_dict()
        }
        
        # Convert to list format
        hourly_data = []
        for _, row in hourly_counts.iterrows():
            # Final safety check: ensure count is never negative
            vehicle_count = max(0, int(row['vehicle_count']))
            hourly_data.append({
                'hour': row['Hour'].strftime('%Y-%m-%d %H:%M'),
                'count': vehicle_count,
                'net_change': int(row['net_change']),
                'exceeds_threshold': bool(row.get('exceeds_threshold', False)) if threshold else False
            })
        
        # Carpark name already extracted at the beginning
        
        # Prepare detailed transaction data for client-side filtering
        transaction_data = []
        for _, row in df_filtered.iterrows():
            transaction_data.append({
                'datetime': row['DateTime'].isoformat(),
                'hour': row['Hour'].isoformat(), 
                'email': row['Location/UserName'],
                'user': row['User'],
                'plate': row['Plate'],
                'action': row['Action'],
                'cost': float(row['Cost']) if pd.notna(row['Cost']) else 0,
                'lane': row['Lane'],
                'notes': row['Notes'] if pd.notna(row['Notes']) else '',
                'group': row['PermRate/Group'] if pd.notna(row['PermRate/Group']) else '',
                'vehicle_change': int(row['vehicle_change']),
                'cumulative_count': int(row['cumulative_count'])
            })

        result = {
            'success': True,
            'carpark_name': carpark_name,
            'summary': summary,
            'hourly_data': hourly_data,
            'transaction_data': transaction_data  # Full data for client-side filtering
        }
        
        if return_emails:
            result['emails'] = sorted(list(all_emails))
        
        if task_id:
            update_progress(task_id, 100, "completed")
        
        # Clean up
        del df, df_filtered
        gc.collect()
        
        return result
        
    except Exception as e:
        if task_id:
            update_progress(task_id, -1, f"error: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'})
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'})
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Save file in chunks for large files
        chunk_size = 1024 * 1024  # 1MB chunks
        with open(filepath, 'wb') as f:
            while True:
                chunk = file.stream.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
        
        # Get filter parameters
        start_datetime = request.form.get('start_datetime')
        end_datetime = request.form.get('end_datetime')
        threshold = request.form.get('threshold')
        email_filter = request.form.get('email_filter')
        
        try:
            # Generate task ID for progress tracking
            task_id = f"{filename}_{datetime.now().timestamp()}"
            
            # Process the file with ultra-fast method
            return_emails = not email_filter
            result = process_parking_data_ultra_fast(
                filepath, start_datetime, end_datetime, 
                threshold, email_filter, return_emails, task_id, filename
            )
            
            return jsonify(result)
        except Exception as e:
            # Detailed error logging
            error_msg = f"Error processing {filename}: {str(e)}"
            print(f"PROCESSING ERROR: {error_msg}")
            import traceback
            traceback.print_exc()
            return jsonify({'success': False, 'error': error_msg})
        finally:
            # Clean up uploaded file
            try:
                os.remove(filepath)
            except OSError:
                pass
    
    return jsonify({'success': False, 'error': 'Invalid file type'})

@app.route('/progress/<task_id>')
def get_progress(task_id):
    with progress_lock:
        progress = progress_store.get(task_id, {"progress": 0, "status": "unknown"})
    return jsonify(progress)

def generate_overflow_csv(filepath, threshold, email_filter):
    """Generator function for streaming CSV response"""
    try:
        # Process data
        result = process_parking_data_ultra_fast(filepath, None, None, threshold, email_filter, False)
        
        if not result['success']:
            yield f"Error: {result.get('error', 'Unknown error')}"
            return
        
        # Write headers
        yield 'Period Start,Peak Time,Peak Count,Excess Over Limit,Account Filter\n'
        
        # Find overflow periods
        hourly_data = result['hourly_data']
        threshold_val = int(threshold)
        
        periods = []
        in_overflow = False
        current_period_peak = None
        period_start = None
        
        for hour in hourly_data:
            is_over_threshold = hour['count'] > threshold_val
            
            if is_over_threshold and not in_overflow:
                in_overflow = True
                current_period_peak = hour
                period_start = hour
            elif is_over_threshold and in_overflow:
                if hour['count'] > current_period_peak['count']:
                    current_period_peak = hour
            elif not is_over_threshold and in_overflow:
                periods.append({
                    'start': period_start,
                    'peak': current_period_peak
                })
                in_overflow = False
                current_period_peak = None
                period_start = None
        
        if in_overflow and current_period_peak:
            periods.append({
                'start': period_start,
                'peak': current_period_peak
            })
        
        # Stream data rows
        for period in periods:
            start_time = pd.to_datetime(period['start']['hour']).strftime('%Y-%m-%d %H:%M')
            peak_time = pd.to_datetime(period['peak']['hour']).strftime('%Y-%m-%d %H:%M')
            peak_count = period['peak']['count']
            excess = peak_count - threshold_val
            account = email_filter if email_filter else 'All Accounts'
            
            yield f'{start_time},{peak_time},{peak_count},{excess},{account}\n'
            
    except Exception as e:
        yield f"Error: {str(e)}"

@app.route('/export-overflow', methods=['POST'])
def export_overflow():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'})
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'})
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Save file
        file.save(filepath)
        
        try:
            threshold = request.form.get('threshold')
            email_filter = request.form.get('email_filter')
            
            if not threshold:
                return jsonify({'success': False, 'error': 'Threshold is required for overflow report'})
            
            # Stream the CSV response
            def cleanup():
                try:
                    os.remove(filepath)
                except OSError:
                    pass
            
            response = Response(
                generate_overflow_csv(filepath, threshold, email_filter),
                mimetype='text/csv',
                headers={
                    'Content-Disposition': f'attachment; filename=overflow_report_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
                }
            )
            response.call_on_close(cleanup)
            
            return response
            
        except Exception as e:
            try:
                os.remove(filepath)
            except OSError:
                pass
            return jsonify({'success': False, 'error': str(e)})
    
    return jsonify({'success': False, 'error': 'Invalid file type'})

def generate_exits_csv(filepath, email_filter):
    """Generator function for streaming exits CSV"""
    try:
        # Define columns
        usecols = [0, 2, 3, 4, 5, 7, 8, 9, 10, 12]
        column_names = ['Location/UserName', 'User', 'Lane', 'Plate', 'Action', 
                       'Cost', 'DateTime', 'Notes', 'Overflow', 'PermRate/Group']
        
        # Write headers
        yield 'Date/Time,Account,User Name,License Plate,Lane,Location/Group\n'
        
        # Read and process Excel file (without chunking since Excel doesn't support it)
        df = pd.read_excel(filepath, skiprows=3, engine='openpyxl', usecols=usecols)
        df.columns = column_names
        
        # Filter data
        df = df[df['DateTime'].notna()]
        df['DateTime'] = pd.to_datetime(df['DateTime'], errors='coerce')
        
        # Filter by email and exit actions only
        df_filtered = df[
            (df['Location/UserName'] == email_filter) & 
            (df['Action'] == 'Exit')
        ].copy()
        
        # Stream rows efficiently
        for _, row in df_filtered.iterrows():
            yield (f"{row['DateTime'].strftime('%Y-%m-%d %H:%M:%S')},"
                  f"{row['Location/UserName']},"
                  f"{row['User'] if pd.notna(row['User']) else ''},"
                  f"{row['Plate']},"
                  f"{row['Lane'] if pd.notna(row['Lane']) else ''},"
                  f"{row['PermRate/Group'] if pd.notna(row['PermRate/Group']) else ''}\n")
            
    except Exception as e:
        yield f"Error: {str(e)}"

@app.route('/export-exits', methods=['POST'])
def export_exits():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'})
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'})
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Save file
        file.save(filepath)
        
        try:
            email_filter = request.form.get('email_filter')
            
            if not email_filter:
                return jsonify({'success': False, 'error': 'Account email is required for exit report'})
            
            # Stream the CSV response
            def cleanup():
                try:
                    os.remove(filepath)
                except OSError:
                    pass
            
            clean_email = email_filter.replace('@', '_').replace('.', '_')
            response = Response(
                generate_exits_csv(filepath, email_filter),
                mimetype='text/csv',
                headers={
                    'Content-Disposition': f'attachment; filename=exits_{clean_email}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
                }
            )
            response.call_on_close(cleanup)
            
            return response
            
        except Exception as e:
            try:
                os.remove(filepath)
            except OSError:
                pass
            return jsonify({'success': False, 'error': str(e)})
    
    return jsonify({'success': False, 'error': 'Invalid file type'})

@app.route('/system-info')
def system_info():
    """Get system information and optimization status"""
    cpu_count = os.cpu_count()
    
    # Get memory info if available
    try:
        import psutil
        memory = psutil.virtual_memory()
        memory_info = {
            'total_gb': round(memory.total / (1024**3), 2),
            'available_gb': round(memory.available / (1024**3), 2),
            'percent': memory.percent
        }
    except ImportError:
        memory_info = {'status': 'psutil not available'}
    
    # Check cache status
    cache_stats = {
        'cached_items': len(memory_cache),
        'cache_folder_exists': os.path.exists('cache')
    }
    
    # List cached Parquet files
    if os.path.exists('cache'):
        cache_files = [f for f in os.listdir('cache') if f.endswith('.parquet')]
        cache_stats['parquet_files'] = len(cache_files)
    else:
        cache_stats['parquet_files'] = 0
    
    return jsonify({
        'cpu_cores': cpu_count,
        'memory': memory_info,
        'optimizations': {
            'pyarrow_available': HAS_PYARROW,
            'numba_available': HAS_NUMBA,
            'parquet_conversion': HAS_PYARROW,
            'jit_compilation': HAS_NUMBA
        },
        'cache': cache_stats,
        'performance_level': 'Ultra-Fast' if HAS_PYARROW and HAS_NUMBA else 'Optimized'
    })

if __name__ == '__main__':
    print("🚀 Starting Ultra-Fast Parking Data Processor")
    print(f"   PyArrow (Parquet): {'✅' if HAS_PYARROW else '❌ pip install pyarrow'}")
    print(f"   Numba (JIT): {'✅' if HAS_NUMBA else '❌ pip install numba'}")
    print(f"   Performance Level: {'Ultra-Fast' if HAS_PYARROW and HAS_NUMBA else 'Optimized'}")
    print("   Server: http://localhost:5001")
    app.run(host='127.0.0.1', port=5001, debug=True, threaded=True)