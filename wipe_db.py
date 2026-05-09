from app import create_app
from models import db, User, Message, AuditLog

app = create_app()
with app.app_context():
    print("Deleting all data from database...")
    # Delete in order of dependencies
    Message.query.delete()
    AuditLog.query.delete()
    User.query.delete()
    
    db.session.commit()
    print("Database wiped successfully. You can now start with a fresh slate.")
