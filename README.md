### AI Cleaner WebApp 🤖
Hey there! This is a smart file cleaning app that uses AI to help you declutter your digital life. Think of it as Marie Kondo for your hard drive, but with a brain powered by Ollama.
Everything runs locally: no cloud, no upload, no tracking.

# What does it do?
It scans your folders and uses AI (via Ollama) to intelligently identify which files are safe to delete - like old screenshots, random downloads, temporary files, and duplicates. The AI analyzes each file and gives you recommendations, but you stay in control of what actually gets deleted.

# The cool part
Smart protection - automatically protects important stuff like medical docs, contracts, passwords, etc.
Category-based cleaning - bulk delete by file type (images, videos, docs, etc.)

# Quick start

Make sure you have Ollama running locally (default: http://localhost:11434)
Install the Python dependencies: pip install flask flask-cors flask-socketio requests
Run the backend: python webapp-backend-python314.py
Drop the index.html into the static/ folder it creates
Open http://localhost:5000 and start cleaning!

# Requirements

macOS or Linux
Python 3.10+
Node not required
Ollama installed (brew install ollama)
At least one model pulled, e.g.:  ollama pull llama3:8b

# How it works

Pick a folder to scan
The app finds potentially deletable files
AI analyzes each one (using Llama3 by default)
You review the suggestions
Delete with confidence!

The AI is pretty conservative - it'll mark files as "KEEP" if there's any doubt, and it absolutely won't touch anything with keywords like "medical", "contract", "password", etc.

# Tech stack

Backend: Flask + SocketIO for real-time updates
Frontend: React (via CDN) with Tailwind CSS
AI: Ollama with Llama3:8b model (configurable)
Storage: Everything runs locally, no cloud needed

That's it! Happy cleaning! 🧹✨
