#!/bin/bash

echo "🚀 Installing dependencies for ultra-fast performance..."

# Check if pip3 is available
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 not found. Please install Python 3 first."
    exit 1
fi

# Install basic dependencies (current requirements)
echo "📦 Installing basic dependencies..."
pip3 install flask==3.0.0 pandas==2.1.4 openpyxl==3.1.2 werkzeug==3.0.1

# Install performance monitoring
echo "📊 Installing performance monitoring tools..."
pip3 install psutil==5.9.6

# Install ultra-fast dependencies (optional)
echo "🚀 Installing ultra-fast performance libraries..."
echo "This may take a few minutes..."

# Install core ultra-fast libraries
pip3 install polars==0.20.0
pip3 install pyarrow==14.0.0
pip3 install ujson==5.8.0

# Optional high-performance libraries
echo "⚡ Installing optional high-performance libraries..."
pip3 install numba==0.58.0 || echo "⚠️  Numba installation failed (optional)"
pip3 install fastparquet==0.8.3 || echo "⚠️  fastparquet installation failed (optional)"

# Redis for caching (optional)
echo "💾 Redis setup (optional for caching)..."
if command -v brew &> /dev/null; then
    echo "  To install Redis: brew install redis"
elif command -v apt &> /dev/null; then
    echo "  To install Redis: sudo apt install redis-server" 
else
    echo "  To install Redis: See https://redis.io/download"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📝 Next steps:"
echo "1. Run basic benchmark: python3 performance_benchmark.py"
echo "2. Test optimized version: python3 app_optimized.py"
echo "3. For ultra-fast version: python3 app_ultra_fast.py"
echo ""
echo "🔧 Optional: Install Redis for caching to get maximum performance"