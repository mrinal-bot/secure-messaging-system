import eventlet
eventlet.monkey_patch()

from flask import Flask, jsonify
from flask_bcrypt import Bcrypt
from flask_jwt_extended import JWTManager
from flask_socketio import SocketIO
from flask_cors import CORS
from flask_talisman import Talisman
from flask_mail import Mail
from config import Config
from models import db
from werkzeug.middleware.proxy_fix import ProxyFix

bcrypt = Bcrypt()
jwt = JWTManager()
socketio = SocketIO(cors_allowed_origins="*", max_http_buffer_size=10000000)
talisman = Talisman()
mail = Mail()

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    
    # Handle reverse proxy headers on Render
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

    # Initialize extensions
    db.init_app(app)
    bcrypt.init_app(app)
    jwt.init_app(app)
    socketio.init_app(app)
    mail.init_app(app)
    CORS(app)

    # Security headers with CSP configured for our CDN resources
    csp = {
        'default-src': "'self'",
        'script-src': [
            "'self'",
            "'unsafe-inline'",
            "cdnjs.cloudflare.com",
        ],
        'style-src': [
            "'self'",
            "'unsafe-inline'",
            "cdnjs.cloudflare.com",
            "fonts.googleapis.com",
        ],
        'font-src': [
            "'self'",
            "cdnjs.cloudflare.com",
            "fonts.gstatic.com",
        ],
        'connect-src': [
            "'self'",
            "ws://127.0.0.1:*",
            "wss://127.0.0.1:*",
            "ws://localhost:*",
            "wss://localhost:*",
            "ws:",
            "wss:",
        ],
        'img-src': "'self' data: blob:",
        'media-src': "'self' data: blob:",
    }
    talisman.init_app(app, force_https=False, content_security_policy=csp)

    # Register blueprints
    from auth import auth_bp
    app.register_blueprint(auth_bp, url_prefix='/api/auth')


    from messages import messages_bp
    app.register_blueprint(messages_bp, url_prefix='/api/messages')

    from security import security_bp
    app.register_blueprint(security_bp, url_prefix='/api/security')

    # Initialize SocketIO events
    from chat import init_chat_events
    init_chat_events(socketio)

    with app.app_context():
        db.create_all()

    from flask import render_template

    @app.route('/')
    def index():
        return render_template('index.html')

    # Error handlers
    @app.errorhandler(404)
    def not_found(error):
        return jsonify({"message": "Resource not found"}), 404

    @app.errorhandler(500)
    def server_error(error):
        return jsonify({"message": "Internal server error"}), 500

    return app

if __name__ == '__main__':
    app = create_app()
    print("=" * 60)
    print("Server is running! Open your browser to:")
    print("http://127.0.0.1:5000")
    print("=" * 60)
    socketio.run(app, host="127.0.0.1", port=5000, debug=True, use_reloader=False, allow_unsafe_werkzeug=True)
