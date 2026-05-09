from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import json

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    public_key = db.Column(db.Text, nullable=True)
    # Phase 1: Online status tracking
    is_online = db.Column(db.Boolean, default=False)
    last_seen = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default='offline')  # online, away, offline
    
    # Phase 2: Security & Identity
    phone = db.Column(db.String(20), nullable=True)
    is_verified = db.Column(db.Boolean, default=False)
    display_name = db.Column(db.String(80), nullable=True)
    profile_photo = db.Column(db.Text, nullable=True)
    otp_code = db.Column(db.String(128), nullable=True)
    otp_expiry = db.Column(db.DateTime, nullable=True)
    otp_attempts = db.Column(db.Integer, default=0)
    otp_last_sent_at = db.Column(db.DateTime, nullable=True)
    otp_locked_until = db.Column(db.DateTime, nullable=True)

    def __repr__(self):
        return f'<User {self.username}>'
    
    def to_dict(self, include_key=False):
        data = {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'phone': self.phone,
            'display_name': self.display_name,
            'profile_photo': self.profile_photo,
            'is_verified': self.is_verified,
            'is_online': self.is_online,
            'last_seen': self.last_seen.isoformat() if self.last_seen else None,
            'status': self.status
        }
        if include_key:
            data['public_key'] = self.public_key
        return data




class Message(db.Model):
    __tablename__ = 'messages'
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    encrypted_message = db.Column(db.Text, nullable=False)
    # Phase 3: Quoted replies
    quoted_message_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    # Added for 1-on-1 chats and security
    receiver_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    is_read = db.Column(db.Boolean, default=False)
    encrypted_key_sender = db.Column(db.Text, nullable=True)
    message_hash = db.Column(db.Text, nullable=True)
    hmac_signature = db.Column(db.Text, nullable=True)

    sender = db.relationship('User', foreign_keys=[sender_id], backref='sent_messages')
    receiver = db.relationship('User', foreign_keys=[receiver_id], backref='received_messages')
    recipients = db.relationship('MessageRecipient', backref='message', lazy=True, cascade='all, delete-orphan')
    reactions = db.relationship('MessageReaction', backref='message', lazy=True, cascade='all, delete-orphan')
    mentions = db.relationship('Mention', backref='message', lazy=True, cascade='all, delete-orphan')
    
    # Self-referential relationship for quoted messages
    quoted_message = db.relationship('Message', remote_side=[id], foreign_keys=[quoted_message_id])

    def to_dict(self):
        return {
            'id': self.id,
            'sender_id': self.sender_id,
            'encrypted_message': self.encrypted_message,
            'quoted_message_id': self.quoted_message_id,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
        }

class MessageRecipient(db.Model):
    __tablename__ = 'message_recipients'
    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    encrypted_key = db.Column(db.Text, nullable=False) # AES key encrypted with receiver's RSA public key

    receiver = db.relationship('User', foreign_keys=[receiver_id])


# Phase 2: Typing indicator tracking
class TypingIndicator(db.Model):
    __tablename__ = 'typing_indicators'
    id = db.Column(db.Integer, primary_key=True)
    receiver_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    started_at = db.Column(db.DateTime, default=datetime.utcnow)

    receiver = db.relationship('User', foreign_keys=[receiver_id])
    sender = db.relationship('User', foreign_keys=[sender_id])

    __table_args__ = (db.UniqueConstraint('receiver_id', 'sender_id', name='unique_receiver_sender_typing'),)


# Phase 3: Message reactions
class MessageReaction(db.Model):
    __tablename__ = 'message_reactions'
    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    emoji = db.Column(db.String(10), nullable=False)  # Single emoji
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref='reactions')

    __table_args__ = (db.UniqueConstraint('message_id', 'user_id', 'emoji', name='unique_message_user_emoji'),)

    def to_dict(self):
        return {
            'id': self.id,
            'message_id': self.message_id,
            'user_id': self.user_id,
            'username': self.user.username if self.user else None,
            'emoji': self.emoji,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


# Phase 4: Mentions
class Mention(db.Model):
    __tablename__ = 'mentions'
    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=False)
    mentioned_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    mentioned_at = db.Column(db.DateTime, default=datetime.utcnow)

    mentioned_user = db.relationship('User', backref='mentions_received')

    def to_dict(self):
        return {
            'id': self.id,
            'message_id': self.message_id,
            'mentioned_user_id': self.mentioned_user_id,
            'mentioned_at': self.mentioned_at.isoformat() if self.mentioned_at else None
        }



class AuditLog(db.Model):
    """Security audit log for tracking authentication and access events."""
    __tablename__ = 'audit_logs'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    event_type = db.Column(db.String(50), nullable=False)  # login_success, login_fail, register, key_update, etc.
    ip_address = db.Column(db.String(45), nullable=True)
    details = db.Column(db.Text, nullable=True)
    severity = db.Column(db.String(20), default='info')  # info, warning, critical
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref='audit_logs')

    def __repr__(self):
        return f'<AuditLog {self.event_type} user={self.user_id}>'

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "username": self.user.username if self.user else None,
            "event_type": self.event_type,
            "ip_address": self.ip_address,
            "details": self.details,
            "severity": self.severity,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }
