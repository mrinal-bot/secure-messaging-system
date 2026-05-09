import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'you-will-never-guess'
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or 'sqlite:///secure_msg.db'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY') or 'super-secret-jwt'
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    HMAC_SECRET_KEY = os.environ.get('HMAC_SECRET_KEY') or 'hmac-secret-key-change-this'
    MAX_MESSAGE_LENGTH = 5000  # Maximum characters per message
    MAX_LOGIN_ATTEMPTS = 5    # Lock threshold for brute-force detection
    OTP_EXPIRY_MINUTES = 5
    OTP_MAX_ATTEMPTS = 5
    OTP_RESEND_COOLDOWN_SECONDS = 30
    OTP_LOCKOUT_MINUTES = 15

    # Mail Settings
    MAIL_SERVER = os.environ.get('MAIL_SERVER') or 'smtp.gmail.com'
    MAIL_PORT = int(os.environ.get('MAIL_PORT') or 465)
    MAIL_USE_TLS = str(os.environ.get('MAIL_USE_TLS', 'false')).lower() == 'true'
    MAIL_USE_SSL = str(os.environ.get('MAIL_USE_SSL', 'true')).lower() == 'true'
    MAIL_USERNAME = os.environ.get('MAIL_USERNAME')
    MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER = os.environ.get('MAIL_DEFAULT_SENDER') or os.environ.get('MAIL_USERNAME')
