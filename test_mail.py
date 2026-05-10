import eventlet
eventlet.monkey_patch()
from flask import Flask
from flask_mail import Mail, Message
import os
from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 465
app.config['MAIL_USE_SSL'] = True
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD')

mail = Mail(app)

with app.app_context():
    try:
        msg = Message('Test', sender=os.environ.get('MAIL_USERNAME'), recipients=[os.environ.get('MAIL_USERNAME')])
        msg.body = 'Testing'
        mail.send(msg)
        print('Mail sent successfully!')
    except Exception as e:
        print(f'Error: {e}')
