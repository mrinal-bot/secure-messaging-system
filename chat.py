import hashlib
from flask import request
from flask_socketio import emit, join_room, leave_room
from models import db, Message, User, TypingIndicator, MessageRecipient, Mention
from flask_jwt_extended import decode_token
from datetime import datetime


# Track connected users: { user_id: set(sid1, sid2, ...) }
connected_users = {}

def init_chat_events(socketio):

    @socketio.on('connect')
    def handle_connect():
        token = request.args.get('token')
        if token:
            try:
                decoded = decode_token(token)
                user_id = int(decoded['sub'])
                request.environ['user_id'] = user_id
                print(f"[Socket] Authenticated connect: user {user_id}, sid {request.sid}")
            except Exception as e:
                print(f"[Socket] Auth failed: {e}")
                return False  # Reject connection
        else:
            print(f"[Socket] Anonymous connect: {request.sid}")

    @socketio.on('disconnect')
    def handle_disconnect():
        user_id = request.environ.get('user_id')
        if user_id and user_id in connected_users:
            connected_users[user_id].discard(request.sid)
            if not connected_users[user_id]:
                del connected_users[user_id]
                # Mark user offline
                user = User.query.get(user_id)
                if user:
                    user.is_online = False
                    user.status = 'offline'
                    user.last_seen = datetime.utcnow()
                    db.session.commit()
                # Broadcast offline status to all users - removed group logic
        print(f"[Socket] Disconnected: {request.sid}")

    @socketio.on('register_session')
    def on_register(data):
        user_id = data.get('user_id')
        if user_id:
            join_room(str(user_id))
            # Track connection
            if user_id not in connected_users:
                connected_users[user_id] = set()
            connected_users[user_id].add(request.sid)
            request.environ['user_id'] = user_id
            # Mark user online
            user = User.query.get(user_id)
            if user:
                user.is_online = True
                user.status = 'online'
                user.last_seen = datetime.utcnow()
                db.session.commit()
                # Broadcast online status to all users - removed group logic
            print(f"[Socket] User {user_id} registered session {request.sid}")


    @socketio.on('join')
    def on_join(data):
        username = data.get('username')
        room = data.get('room')
        join_room(room)
        print(f"[Socket] {username} joined room {room}")

    @socketio.on('send_message')
    def handle_message(data):
        sender_id = data.get('sender_id')
        receiver_id = data.get('receiver_id')
        encrypted_msg = data.get('message')
        quoted_message_id = data.get('quoted_message_id')  # Phase 3
        encrypted_key_single = data.get('encrypted_key')
        encrypted_key_sender = data.get('encrypted_key_sender')
        message_hash = data.get('message_hash')
        hmac_signature = data.get('hmac_signature')
        # encrypted_keys is a dict for group fan-out: { receiver_id: encrypted_aes_key }
        encrypted_keys = data.get('encrypted_keys', {})

        if not sender_id or not encrypted_msg:
            return

        # Normalize 1-to-1 payload into recipient key map expected by delivery loop.
        if receiver_id and encrypted_key_single and not encrypted_keys:
            encrypted_keys = {str(receiver_id): encrypted_key_single}
        
        # Save main message entry
        new_msg = Message(
            sender_id=sender_id,
            receiver_id=receiver_id,
            encrypted_message=encrypted_msg,
            quoted_message_id=quoted_message_id,  # Phase 3: Support quoted replies
            encrypted_key_sender=encrypted_key_sender,
            message_hash=message_hash,
            hmac_signature=hmac_signature
        )
        db.session.add(new_msg)
        db.session.flush() # Get message ID
        
        # Phase 4: Parse mentions in message text
        # Note: Message is encrypted, so we'd need to decrypt on client to find mentions
        # For now, we'll check if client provides mention data
        mentions_data = data.get('mentions', [])
        for mentioned_user_id in mentions_data:
            mention = Mention(
                message_id=new_msg.id,
                mentioned_user_id=mentioned_user_id
            )
            db.session.add(mention)
        
        # Save recipient-specific keys
        for rid, enc_key in encrypted_keys.items():
            recipient_entry = MessageRecipient(
                message_id=new_msg.id,
                receiver_id=int(rid),
                encrypted_key=enc_key
            )
            db.session.add(recipient_entry)
            
            # Broadcast to each recipient's private room
            emit('receive_message', {
                'id': new_msg.id,
                'sender_id': sender_id,
                'message': encrypted_msg,
                'encrypted_key': enc_key,
                'quoted_message_id': quoted_message_id,  # Phase 3
                'timestamp': str(new_msg.timestamp),
                'message_hash': message_hash,
                'hmac_signature': hmac_signature
            }, room=str(rid))
            
        db.session.commit()

    @socketio.on('typing')
    def handle_typing(data):
        receiver_id = data.get('receiver_id')
        sender_id = data.get('sender_id')
        is_typing = data.get('is_typing', False)
        if receiver_id and sender_id:
            if is_typing:
                indicator = TypingIndicator.query.filter_by(receiver_id=receiver_id, sender_id=sender_id).first()
                if not indicator:
                    db.session.add(TypingIndicator(receiver_id=receiver_id, sender_id=sender_id))
                    db.session.commit()
            else:
                TypingIndicator.query.filter_by(receiver_id=receiver_id, sender_id=sender_id).delete()
                db.session.commit()

            emit('user_typing', {
                'sender_id': sender_id,
                'is_typing': is_typing,
            }, room=str(receiver_id))

    @socketio.on('mark_read')
    def handle_mark_read(data):
        message_ids = data.get('message_ids', [])
        sender_id = data.get('sender_id')
        receiver_id = request.environ.get('user_id')  # The one who read the messages

        if not message_ids or not sender_id or not receiver_id:
            return

        # Update DB
        Message.query.filter(Message.id.in_(message_ids), Message.receiver_id == receiver_id).update({'is_read': True}, synchronize_session=False)
        db.session.commit()

        # Notify the sender that these messages were read
        emit('messages_read', {
            'message_ids': message_ids,
            'receiver_id': receiver_id
        }, room=str(sender_id))
