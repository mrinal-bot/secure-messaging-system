#!/usr/bin/env python
"""Initialize the database with all models."""

from app import create_app
from models import db

app = create_app()

with app.app_context():
    # Create all tables
    db.create_all()
    print("[SUCCESS] Database initialized successfully!")
    print("[SUCCESS] All tables created/updated")
