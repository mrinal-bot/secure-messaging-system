from flask import Blueprint, jsonify, request
from models import db, AuditLog
from flask_jwt_extended import jwt_required, get_jwt_identity

security_bp = Blueprint('security', __name__)


@security_bp.route('/audit-log', methods=['GET'])
@jwt_required()
def get_audit_log():
    """Retrieve security audit log entries. Optionally filter by event type."""
    event_type = request.args.get('event_type')
    severity = request.args.get('severity')
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    per_page = min(per_page, 100)

    query = AuditLog.query

    if event_type:
        query = query.filter_by(event_type=event_type)
    if severity:
        query = query.filter_by(severity=severity)

    query = query.order_by(AuditLog.timestamp.desc())
    total = query.count()
    logs = query.offset((page - 1) * per_page).limit(per_page).all()

    return jsonify({
        "logs": [log.to_dict() for log in logs],
        "total": total,
        "page": page,
        "per_page": per_page,
    }), 200


@security_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_security_stats():
    """Get aggregated security statistics."""
    from sqlalchemy import func

    total_events = AuditLog.query.count()
    failed_logins = AuditLog.query.filter_by(event_type='login_fail').count()
    successful_logins = AuditLog.query.filter_by(event_type='login_success').count()
    brute_force_alerts = AuditLog.query.filter_by(event_type='brute_force_detected').count()
    key_updates = AuditLog.query.filter_by(event_type='key_update').count()
    registrations = AuditLog.query.filter_by(event_type='register').count()

    # Recent critical events
    critical_events = AuditLog.query.filter_by(severity='critical').order_by(
        AuditLog.timestamp.desc()
    ).limit(10).all()

    return jsonify({
        "total_events": total_events,
        "failed_logins": failed_logins,
        "successful_logins": successful_logins,
        "brute_force_alerts": brute_force_alerts,
        "key_updates": key_updates,
        "registrations": registrations,
        "critical_events": [e.to_dict() for e in critical_events],
    }), 200
