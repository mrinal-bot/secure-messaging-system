import re
from flask import Blueprint, request, jsonify
from models import db, User, AuditLog
from flask_bcrypt import Bcrypt
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from datetime import datetime, timedelta
import secrets
import string
from flask_mail import Message as MailMessage
from config import Config

from flask_bcrypt import Bcrypt
auth_bp = Blueprint('auth', __name__)
bcrypt = Bcrypt() # Using a local instance is fine as long as it's consistent


def log_audit(user_id, event_type, details=None, severity='info'):
    """Helper to create an audit log entry."""
    log = AuditLog(
        user_id=user_id,
        event_type=event_type,
        ip_address=request.remote_addr,
        details=None,
        severity=severity,
    )
    db.session.add(log)
    db.session.commit()


def validate_password(password):
    """Enforce strong password policy."""
    errors = []
    if len(password) < 8:
        errors.append("Password must be at least 8 characters")
    if not re.search(r'[A-Z]', password):
        errors.append("Password must contain an uppercase letter")
    if not re.search(r'[a-z]', password):
        errors.append("Password must contain a lowercase letter")
    if not re.search(r'[0-9]', password):
        errors.append("Password must contain a digit")
    if not re.search(r'[!@#$%^&*(),.?\":{}|<>]', password):
        errors.append("Password must contain a special character")
    return errors


def generate_otp():
    """Generate a cryptographically secure 6-digit OTP."""
    return ''.join(secrets.choice(string.digits) for _ in range(6))


def send_otp_email(user, bypass_cooldown=False):
    now = datetime.utcnow()
    if (
        not bypass_cooldown
        and user.otp_last_sent_at
        and (now - user.otp_last_sent_at).total_seconds() < Config.OTP_RESEND_COOLDOWN_SECONDS
    ):
        wait_seconds = int(
            Config.OTP_RESEND_COOLDOWN_SECONDS - (now - user.otp_last_sent_at).total_seconds()
        )
        return False, f"Please wait {max(wait_seconds, 1)}s before requesting a new OTP."

    otp = generate_otp()
    print(f"\n[DEVELOPMENT] Generated OTP for {user.email}: {otp}\n")
    # Hash the OTP before storing it for maximum security
    user.otp_code = bcrypt.generate_password_hash(otp).decode('utf-8')
    user.otp_expiry = now + timedelta(minutes=Config.OTP_EXPIRY_MINUTES)
    user.otp_attempts = 0
    user.otp_last_sent_at = now
    user.otp_locked_until = None
    db.session.commit()

    try:
        from app import mail
        from flask import current_app
        from threading import Thread

        msg = MailMessage(
            "Security Code: Verify your Identity",
            recipients=[user.email],
            body=f"Your secure login code is: {otp}\n\nThis code will expire in 5 minutes.",
            sender=current_app.config.get('MAIL_DEFAULT_SENDER')
        )
        
        def send_async_email(app, message):
            with app.app_context():
                try:
                    mail.send(message)
                except Exception as e:
                    print(f"Background Mail Error: {e}")

        app_obj = current_app._get_current_object()
        Thread(target=send_async_email, args=(app_obj, msg)).start()
        
    except Exception as e:
        print(f"Error initiating mail: {e}")
    return True, "OTP sent."


@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()

    if not data or not data.get('username') or not data.get('password') or not data.get('email'):
        return jsonify({"message": "Missing required fields"}), 400

    # Validate password strength
    pwd_errors = validate_password(data['password'])
    if pwd_errors:
        return jsonify({"message": "Weak password", "errors": pwd_errors}), 400

    if User.query.filter_by(username=data['username']).first():
        return jsonify({"message": "Username already exists"}), 400

    if User.query.filter_by(email=data['email']).first():
        return jsonify({"message": "Email already exists"}), 400

    hashed_password = bcrypt.generate_password_hash(data['password']).decode('utf-8')

    new_user = User(
        username=data['username'],
        email=data['email'],
        phone=data.get('phone'),
        password_hash=hashed_password,
        public_key=data.get('public_key'),
        is_verified=False
    )

    db.session.add(new_user)
    db.session.commit()

    ok, msg = send_otp_email(new_user, bypass_cooldown=True)
    if not ok:
        return jsonify({"message": msg}), 429
    log_audit(new_user.id, 'register', f"New user registered: {new_user.username}")
    log_audit(new_user.id, 'otp_sent', f"Verification OTP sent to {new_user.email}")
    return jsonify({
        "message": "Account created. A verification code was sent to your email.",
        "user_id": new_user.id,
        "requires_otp": True
    }), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()

    if not data or not data.get('username') or not data.get('password'):
        return jsonify({"message": "Missing username or password"}), 400

    user = User.query.filter_by(username=data['username']).first()

    if user and bcrypt.check_password_hash(user.password_hash, data['password']):
        if user.otp_locked_until and datetime.utcnow() < user.otp_locked_until:
            remaining = user.otp_locked_until - datetime.utcnow()
            mins = max(1, int(remaining.total_seconds() // 60))
            return jsonify({
                "message": f"Too many invalid OTP attempts. Try again in ~{mins} minute(s)."
            }), 429

        ok, msg = send_otp_email(user)
        if not ok:
            return jsonify({"message": msg}), 429
        log_audit(user.id, 'otp_sent', f"Login OTP sent to {user.email}")
        return jsonify({
            "message": msg if msg else "Security code sent to your email. Please verify to continue.",
            "requires_otp": True,
            "user_id": user.id
        }), 200

    # Failed login
    log_audit(
        user.id if user else None,
        'login_fail',
        f"Failed login attempt for username: {data['username']}",
        severity='warning',
    )

    # Check for brute-force: count recent failed attempts
    if user:
        recent_fails = AuditLog.query.filter_by(
            user_id=user.id, event_type='login_fail'
        ).order_by(AuditLog.timestamp.desc()).limit(Config.MAX_LOGIN_ATTEMPTS).all()

        if len(recent_fails) >= Config.MAX_LOGIN_ATTEMPTS:
            log_audit(user.id, 'brute_force_detected',
                      f"Multiple failed login attempts for {user.username}",
                      severity='critical')

    return jsonify({"message": "Invalid username or password"}), 401


@auth_bp.route('/verify-otp', methods=['POST'])
def verify_otp():
    data = request.get_json()
    user_id = data.get('user_id')
    otp = data.get('otp')

    if not user_id or not otp:
        return jsonify({"message": "Missing user ID or OTP"}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({"message": "User not found"}), 404

    if user.otp_locked_until and datetime.utcnow() < user.otp_locked_until:
        remaining = user.otp_locked_until - datetime.utcnow()
        mins = max(1, int(remaining.total_seconds() // 60))
        return jsonify({
            "message": f"Too many invalid attempts. Try again in ~{mins} minute(s)."
        }), 429

    if user.is_verified and user.otp_code is None:
        # If they were already verified but it's a new 2FA session, that's fine.
        pass

    # Verify hashed OTP
    if not user.otp_code or not bcrypt.check_password_hash(user.otp_code, otp):
        user.otp_attempts = (user.otp_attempts or 0) + 1
        if user.otp_attempts >= Config.OTP_MAX_ATTEMPTS:
            user.otp_code = None
            user.otp_expiry = None
            user.otp_locked_until = datetime.utcnow() + timedelta(minutes=Config.OTP_LOCKOUT_MINUTES)
            db.session.commit()
            log_audit(
                user.id,
                'otp_locked',
                f"OTP verification locked after {Config.OTP_MAX_ATTEMPTS} failed attempts",
                severity='warning'
            )
            return jsonify({
                "message": "Too many invalid attempts. OTP expired and account temporarily locked."
            }), 429
        db.session.commit()
        return jsonify({"message": "Invalid security code"}), 400

    if datetime.utcnow() > user.otp_expiry:
        user.otp_code = None
        user.otp_expiry = None
        user.otp_attempts = 0
        db.session.commit()
        return jsonify({"message": "Security code has expired. Please request a new one."}), 400

    # Verification successful
    user.is_verified = True
    user.otp_code = None
    user.otp_expiry = None
    user.otp_attempts = 0
    user.otp_locked_until = None
    user.is_online = True
    user.last_seen = datetime.utcnow()
    db.session.commit()

    # Generate the access token NOW after 2FA is complete
    access_token = create_access_token(identity=str(user.id))

    log_audit(user.id, 'login_verified', f"User {user.username} successfully passed 2FA")
    
    return jsonify({
        "message": "Login successful",
        "access_token": access_token,
        "user": user.to_dict(include_key=True)
    }), 200


@auth_bp.route('/resend-otp', methods=['POST'])
def resend_otp():
    data = request.get_json()
    user_id = data.get('user_id')

    if not user_id:
        return jsonify({"message": "User ID required"}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({"message": "User not found"}), 404

    if user.is_verified and user.otp_code is None:
        # If they are already verified, we can still send an OTP for things like 2FA or password reset
        pass

    if user.otp_locked_until and datetime.utcnow() < user.otp_locked_until:
        remaining = user.otp_locked_until - datetime.utcnow()
        mins = max(1, int(remaining.total_seconds() // 60))
        return jsonify({
            "message": f"OTP is temporarily locked. Try again in ~{mins} minute(s)."
        }), 429

    ok, msg = send_otp_email(user)
    if not ok:
        return jsonify({"message": msg}), 429
    log_audit(user.id, 'otp_resent', f"OTP resent to {user.email}")
    return jsonify({"message": "A new security code has been sent to your email."}), 200


@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    email = data.get('email')

    if not email:
        return jsonify({"message": "Email address required"}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        # For security, we don't confirm if the email exists, we just say "if it exists, we sent it"
        return jsonify({"message": "If an account exists with this email, a reset code has been sent."}), 200

    if user.otp_locked_until and datetime.utcnow() < user.otp_locked_until:
        remaining = user.otp_locked_until - datetime.utcnow()
        mins = max(1, int(remaining.total_seconds() // 60))
        return jsonify({
            "message": f"Too many invalid attempts. Try again in ~{mins} minute(s)."
        }), 429

    ok, msg = send_otp_email(user)
    if not ok:
        return jsonify({"message": msg}), 429
    log_audit(user.id, 'password_reset_otp_sent', f"Password reset OTP sent to {user.email}")
    return jsonify({
        "message": "A password reset code has been sent to your email.",
        "user_id": user.id
    }), 200


@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    user_id = data.get('user_id')
    otp = data.get('otp')
    new_password = data.get('new_password')

    if not user_id or not otp or not new_password:
        return jsonify({"message": "Missing required fields"}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({"message": "User not found"}), 404

    # Validate OTP hash
    if user.otp_locked_until and datetime.utcnow() < user.otp_locked_until:
        remaining = user.otp_locked_until - datetime.utcnow()
        mins = max(1, int(remaining.total_seconds() // 60))
        return jsonify({
            "message": f"Too many invalid attempts. Try again in ~{mins} minute(s)."
        }), 429

    if not user.otp_code or not bcrypt.check_password_hash(user.otp_code, otp):
        user.otp_attempts = (user.otp_attempts or 0) + 1
        if user.otp_attempts >= Config.OTP_MAX_ATTEMPTS:
            user.otp_code = None
            user.otp_expiry = None
            user.otp_locked_until = datetime.utcnow() + timedelta(minutes=Config.OTP_LOCKOUT_MINUTES)
            db.session.commit()
            return jsonify({"message": "Too many invalid attempts. Reset code expired."}), 429
        db.session.commit()
        return jsonify({"message": "Invalid or expired reset code"}), 400

    if datetime.utcnow() > user.otp_expiry:
        user.otp_code = None
        user.otp_expiry = None
        user.otp_attempts = 0
        db.session.commit()
        return jsonify({"message": "Reset code has expired"}), 400

    # Validate new password strength
    pwd_errors = validate_password(new_password)
    if pwd_errors:
        return jsonify({"message": "New password is too weak", "errors": pwd_errors}), 400

    # Update password
    user.password_hash = bcrypt.generate_password_hash(new_password).decode('utf-8')
    user.otp_code = None
    user.otp_expiry = None
    user.otp_attempts = 0
    user.otp_locked_until = None
    db.session.commit()

    log_audit(user.id, 'password_reset', f"User {user.username} successfully reset their password")
    return jsonify({"message": "Password updated successfully! You can now log in."}), 200


@auth_bp.route('/forgot-username', methods=['POST'])
def forgot_username():
    data = request.get_json()
    email = data.get('email')

    if not email:
        return jsonify({"message": "Email address required"}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({"message": "If an account exists with this email, your username has been sent."}), 200

    try:
        from app import mail
        from flask import current_app
        msg = MailMessage(
            "Account Recovery: Your Username",
            recipients=[user.email],
            body=f"Hi {user.username},\n\nYour username for SecureMsg is: {user.username}\n\nIf you did not request this, please ignore this email.",
            sender=current_app.config.get('MAIL_DEFAULT_SENDER')
        )
        mail.send(msg)
        log_audit(user.id, 'username_recovery_sent', f"Username recovery sent to {user.email}")
        return jsonify({"message": "Your username has been sent to your email."}), 200
    except Exception:
        # Recovery fallback when SMTP is unavailable.
        log_audit(user.id, 'username_recovery_fallback', severity='warning')
        return jsonify({
            "message": "Email service is unavailable. Please contact support/admin for username recovery."
        }), 200


@auth_bp.route('/update-profile', methods=['POST'])
@jwt_required()
def update_profile():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"message": "User not found"}), 404

    data = request.get_json()
    new_display_name = data.get('display_name')
    new_profile_photo = data.get('profile_photo')
    
    if not new_display_name:
        return jsonify({"message": "Profile name cannot be empty"}), 400

    user.display_name = new_display_name
    if new_profile_photo is not None:
        # Accept data URL image or empty value to remove photo.
        if new_profile_photo and not str(new_profile_photo).startswith('data:image/'):
            return jsonify({"message": "Invalid profile photo format"}), 400
        if new_profile_photo and len(new_profile_photo) > 2_000_000:
            return jsonify({"message": "Profile photo is too large"}), 400
        user.profile_photo = new_profile_photo or None
    db.session.commit()

    log_audit(user.id, 'profile_update', f"User {user.username} updated display name to {new_display_name}")
    return jsonify({
        "message": "Profile updated successfully",
        "user": user.to_dict()
    }), 200


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_profile():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"message": "User not found"}), 404
    return jsonify(user.to_dict(include_key=True)), 200


@auth_bp.route('/update_keys', methods=['POST'])
@jwt_required()
def update_keys():
    current_user_id = get_jwt_identity()
    data = request.get_json()

    if not data or not data.get('public_key'):
        return jsonify({"message": "Public key required"}), 400

    user = User.query.get(current_user_id)
    user.public_key = data['public_key']
    db.session.commit()

    log_audit(user.id, 'key_update', f"Public key updated for {user.username}")
    return jsonify({"message": "Keys updated successfully"}), 200


@auth_bp.route('/public_key/<int:user_id>', methods=['GET'])
@jwt_required()
def get_public_key(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"message": "User not found"}), 404

    return jsonify({
        "user_id": user.id,
        "username": user.username,
        "public_key": user.public_key,
    }), 200


@auth_bp.route('/users', methods=['GET'])
@jwt_required()
def get_users():
    current_user_id = int(get_jwt_identity())
    # Only return users who have exchanged messages with the current user
    from models import Message
    
    sent_to = db.session.query(Message.receiver_id).filter(Message.sender_id == current_user_id)
    received_from = db.session.query(Message.sender_id).filter(Message.receiver_id == current_user_id)
    
    chat_user_ids = sent_to.union(received_from).all()
    chat_user_ids = [uid[0] for uid in chat_user_ids]
    
    users = User.query.filter(User.id.in_(chat_user_ids)).all()
    return jsonify([u.to_dict() for u in users]), 200


@auth_bp.route('/search', methods=['GET'])
@jwt_required()
def search_users():
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify([]), 200

    # Search by exact email, or partial username/display_name/phone
    users = User.query.filter(
        db.or_(
            User.username.ilike(f'%{query}%'),
            User.display_name.ilike(f'%{query}%'),
            User.email == query,
            User.phone.ilike(f'%{query}%')
        )
    ).all()
    return jsonify([u.to_dict() for u in users]), 200


@auth_bp.route('/logout', methods=['POST'])
@jwt_required()
def logout_user():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if user:
        user.is_online = False
        user.last_seen = datetime.utcnow()
        db.session.commit()
        log_audit(user.id, 'logout', f"User {user.username} logged out")
    return jsonify({"message": "Logged out"}), 200


@auth_bp.route('/delete-account', methods=['DELETE'])
@jwt_required()
def delete_account():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"message": "User not found"}), 404

    from models import Message, TypingIndicator, AuditLog, MessageReaction, Mention, MessageRecipient

    # Delete typing indicators involving the user
    TypingIndicator.query.filter(db.or_(TypingIndicator.sender_id == user.id, TypingIndicator.receiver_id == user.id)).delete()
    
    # Delete audit logs
    AuditLog.query.filter_by(user_id=user.id).delete()

    # Delete messages (cascades will handle recipients, reactions, mentions)
    messages_to_delete = Message.query.filter(db.or_(Message.sender_id == user.id, Message.receiver_id == user.id)).all()
    for msg in messages_to_delete:
        db.session.delete(msg)
        
    # Manually cleanup remaining just in case
    MessageReaction.query.filter_by(user_id=user.id).delete()
    Mention.query.filter_by(mentioned_user_id=user.id).delete()
    MessageRecipient.query.filter_by(receiver_id=user.id).delete()

    db.session.delete(user)
    db.session.commit()

    return jsonify({"message": "Account deleted successfully"}), 200
