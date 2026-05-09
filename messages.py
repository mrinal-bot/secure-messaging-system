from flask import Blueprint, request, jsonify
from models import db, Message, MessageReaction, MessageRecipient
from flask_jwt_extended import jwt_required, get_jwt_identity

messages_bp = Blueprint('messages', __name__)


@messages_bp.route('/<int:user_id>', methods=['GET'])
@jwt_required()
def get_message_history(user_id):
    """Fetch encrypted message history between the current user and another user."""
    current_user_id = int(get_jwt_identity())

    # Get optional pagination params
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    per_page = min(per_page, 100)  # Cap at 100

    # Fetch messages where current user is either sender or receiver
    query = Message.query.filter(
        db.or_(
            db.and_(Message.sender_id == current_user_id, Message.receiver_id == user_id),
            db.and_(Message.sender_id == user_id, Message.receiver_id == current_user_id),
        )
    ).order_by(Message.timestamp.asc())

    # Paginate
    total = query.count()
    messages = query.offset((page - 1) * per_page).limit(per_page).all()

    messages_data = []
    for m in messages:
        msg_dict = m.to_dict()
        msg_dict["receiver_id"] = m.receiver_id
        msg_dict["is_read"] = m.is_read
        msg_dict["encrypted_key_sender"] = m.encrypted_key_sender
        msg_dict["message_hash"] = m.message_hash
        msg_dict["hmac_signature"] = m.hmac_signature

        # Provide recipient-specific encrypted key for the requesting user.
        recipient_key = MessageRecipient.query.filter_by(
            message_id=m.id,
            receiver_id=current_user_id
        ).first()
        msg_dict["encrypted_key"] = recipient_key.encrypted_key if recipient_key else None
        messages_data.append(msg_dict)

    return jsonify({
        "messages": messages_data,
        "total": total,
        "page": page,
        "per_page": per_page,
    }), 200


@messages_bp.route('/<int:user_id>', methods=['DELETE'])
@jwt_required()
def clear_chat(user_id):
    """Permanently delete all messages between current user and target user (Hard Delete)."""
    current_user_id = int(get_jwt_identity())
    
    try:
        # Delete messages where current user is either sender or receiver and other user is the opposite
        Message.query.filter(
            db.or_(
                db.and_(Message.sender_id == current_user_id, Message.receiver_id == user_id),
                db.and_(Message.sender_id == user_id, Message.receiver_id == current_user_id),
            )
        ).delete(synchronize_session=False)
        
        db.session.commit()
        return jsonify({"message": "Chat cleared successfully"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Failed to clear chat: {str(e)}"}), 500


@messages_bp.route('/verify/<int:message_id>', methods=['GET'])
@jwt_required()
def verify_message(message_id):
    """Verify message integrity by checking its stored hash against the ciphertext."""
    import hashlib
    current_user_id = int(get_jwt_identity())

    msg = Message.query.get(message_id)
    if not msg:
        return jsonify({"message": "Message not found"}), 404

    # Only sender or receiver can verify
    if msg.sender_id != current_user_id and msg.receiver_id != current_user_id:
        return jsonify({"message": "Unauthorized"}), 403

    # Recompute hash from stored ciphertext
    computed_hash = hashlib.sha256(msg.encrypted_message.encode('utf-8')).hexdigest()
    is_intact = computed_hash == msg.message_hash

    return jsonify({
        "message_id": msg.id,
        "stored_hash": msg.message_hash,
        "computed_hash": computed_hash,
        "integrity_verified": is_intact,
        "hmac_present": msg.hmac_signature is not None,
    }), 200


# ═══════════════════════════════════════════════════════════════════════════
# Phase 3: Message Reactions & Quoted Replies
# ═══════════════════════════════════════════════════════════════════════════

@messages_bp.route('/<int:message_id>/reactions', methods=['GET'])
@jwt_required()
def get_message_reactions(message_id):
    """Get all reactions on a message. Phase 3."""
    current_user_id = int(get_jwt_identity())
    
    msg = Message.query.get(message_id)
    if not msg:
        return jsonify({"message": "Message not found"}), 404
    
    # Verify user can see this message (sender, recipient)
    if msg.sender_id != current_user_id and msg.receiver_id != current_user_id:
        return jsonify({"message": "Unauthorized"}), 403
    
    reactions = MessageReaction.query.filter_by(message_id=message_id).all()
    
    # Group reactions by emoji
    reactions_by_emoji = {}
    for reaction in reactions:
        emoji = reaction.emoji
        if emoji not in reactions_by_emoji:
            reactions_by_emoji[emoji] = {'count': 0, 'users': []}
        reactions_by_emoji[emoji]['count'] += 1
        reactions_by_emoji[emoji]['users'].append({
            'user_id': reaction.user_id,
            'username': reaction.user.username if reaction.user else None
        })
    
    return jsonify({
        "message_id": message_id,
        "reactions": reactions_by_emoji
    }), 200


@messages_bp.route('/<int:message_id>/react', methods=['POST'])
@jwt_required()
def add_reaction(message_id):
    """Add emoji reaction to message. Phase 3."""
    current_user_id = int(get_jwt_identity())
    data = request.get_json()
    emoji = data.get('emoji')
    
    if not emoji:
        return jsonify({"message": "emoji required"}), 400
    
    msg = Message.query.get(message_id)
    if not msg:
        return jsonify({"message": "Message not found"}), 404
    
    # Verify user can react (sender, recipient)
    if msg.sender_id != current_user_id and msg.receiver_id != current_user_id:
        return jsonify({"message": "Unauthorized"}), 403
    
    # Check if already reacted with this emoji
    existing = MessageReaction.query.filter_by(
        message_id=message_id,
        user_id=current_user_id,
        emoji=emoji
    ).first()
    
    if existing:
        return jsonify({"message": "Already reacted with this emoji"}), 400
    
    reaction = MessageReaction(
        message_id=message_id,
        user_id=current_user_id,
        emoji=emoji
    )
    db.session.add(reaction)
    db.session.commit()
    
    return jsonify({
        "message": "Reaction added",
        "reaction": reaction.to_dict()
    }), 201


@messages_bp.route('/<int:message_id>/reactions/<emoji>', methods=['DELETE'])
@jwt_required()
def remove_reaction(message_id, emoji):
    """Remove emoji reaction from message. Phase 3."""
    current_user_id = int(get_jwt_identity())
    
    reaction = MessageReaction.query.filter_by(
        message_id=message_id,
        user_id=current_user_id,
        emoji=emoji
    ).first()
    
    if not reaction:
        return jsonify({"message": "Reaction not found"}), 404
    
    db.session.delete(reaction)
    db.session.commit()
    
    return jsonify({"message": "Reaction removed"}), 200

