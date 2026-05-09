import sqlite3

try:
    conn = sqlite3.connect('instance/secure_msg.db')
    cursor = conn.cursor()
    
    # ═════════════════════════════════════════════════════════════════════════
    # Existing migrations from User & Message tables
    # ═════════════════════════════════════════════════════════════════════════
    cursor.execute("PRAGMA table_info(messages)")
    columns = [info[1] for info in cursor.fetchall()]

    if 'receiver_id' not in columns:
        cursor.execute("ALTER TABLE messages ADD COLUMN receiver_id INTEGER;")
        conn.commit()
        print("Migration successful: Added receiver_id column to messages table.")
    else:
        print("Column 'receiver_id' already exists in messages table.")

    if 'message_hash' not in columns:
        cursor.execute("ALTER TABLE messages ADD COLUMN message_hash TEXT;")
        conn.commit()
        print("Migration successful: Added message_hash column to messages table.")
    else:
        print("Column 'message_hash' already exists in messages table.")

    if 'hmac_signature' not in columns:
        cursor.execute("ALTER TABLE messages ADD COLUMN hmac_signature TEXT;")
        conn.commit()
        print("Migration successful: Added hmac_signature column to messages table.")
    else:
        print("Column 'hmac_signature' already exists in messages table.")
    
    if 'encrypted_key_sender' not in columns:
        cursor.execute("ALTER TABLE messages ADD COLUMN encrypted_key_sender TEXT;")
        conn.commit()
        print("Migration successful: Added encrypted_key_sender column to messages table.")
    else:
        print("Column 'encrypted_key_sender' already exists in messages table.")

    if 'is_read' not in columns:
        cursor.execute("ALTER TABLE messages ADD COLUMN is_read BOOLEAN DEFAULT 0;")
        conn.commit()
        print("Migration successful: Added is_read column to messages table.")
    else:
        print("Column 'is_read' already exists in messages table.")

    # Phase 3: Add quoted_message_id to messages table
    if 'quoted_message_id' not in columns:
        cursor.execute("ALTER TABLE messages ADD COLUMN quoted_message_id INTEGER;")
        conn.commit()
        print("Migration successful: Added quoted_message_id column to messages table.")
    else:
        print("Column 'quoted_message_id' already exists in messages table.")

    # User table migrations
    cursor.execute("PRAGMA table_info(users)")
    user_columns = [info[1] for info in cursor.fetchall()]

    if 'is_verified' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT 0;")
        conn.commit()
        print("Migration successful: Added is_verified column to users table.")

    if 'display_name' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN display_name VARCHAR(80);")
        conn.commit()
        print("Migration successful: Added display_name column to users table.")

    if 'profile_photo' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN profile_photo TEXT;")
        conn.commit()
        print("Migration successful: Added profile_photo column to users table.")

    if 'otp_code' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN otp_code VARCHAR(6);")
        conn.commit()
        print("Migration successful: Added otp_code column to users table.")

    if 'otp_expiry' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN otp_expiry DATETIME;")
        conn.commit()
        print("Migration successful: Added otp_expiry column to users table.")

    if 'otp_attempts' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN otp_attempts INTEGER DEFAULT 0;")
        conn.commit()
        print("Migration successful: Added otp_attempts column to users table.")

    if 'otp_last_sent_at' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN otp_last_sent_at DATETIME;")
        conn.commit()
        print("Migration successful: Added otp_last_sent_at column to users table.")

    if 'otp_locked_until' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN otp_locked_until DATETIME;")
        conn.commit()
        print("Migration successful: Added otp_locked_until column to users table.")

    # Phase 1: Add online status tracking to users table
    if 'is_online' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN is_online BOOLEAN DEFAULT 0;")
        conn.commit()
        print("Migration successful: Added is_online column to users table.")
    else:
        print("Column 'is_online' already exists in users table.")

    if 'last_seen' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN last_seen DATETIME;")
        conn.commit()
        print("Migration successful: Added last_seen column to users table.")
    else:
        print("Column 'last_seen' already exists in users table.")

    if 'status' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'offline';")
        conn.commit()
        print("Migration successful: Added status column to users table.")
    else:
        print("Column 'status' already exists in users table.")

    # Removed Phase 1 group settings and admin roles

    # ═════════════════════════════════════════════════════════════════════════
    # Phase 2: Typing indicators table
    # ═════════════════════════════════════════════════════════════════════════
    try:
        cursor.execute("CREATE TABLE IF NOT EXISTS typing_indicators ("
                      "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                      "receiver_id INTEGER NOT NULL,"
                      "sender_id INTEGER NOT NULL,"
                      "started_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
                      "FOREIGN KEY(receiver_id) REFERENCES users(id),"
                      "FOREIGN KEY(sender_id) REFERENCES users(id),"
                      "UNIQUE(receiver_id, sender_id));")
        conn.commit()
        print("Migration successful: Created typing_indicators table.")
    except Exception as e:
        print(f"Typing indicators table already exists or error: {e}")

    # ═════════════════════════════════════════════════════════════════════════
    # Phase 3: Message reactions table
    # ═════════════════════════════════════════════════════════════════════════
    try:
        cursor.execute("CREATE TABLE IF NOT EXISTS message_reactions ("
                      "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                      "message_id INTEGER NOT NULL,"
                      "user_id INTEGER NOT NULL,"
                      "emoji VARCHAR(10) NOT NULL,"
                      "created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
                      "FOREIGN KEY(message_id) REFERENCES messages(id),"
                      "FOREIGN KEY(user_id) REFERENCES users(id),"
                      "UNIQUE(message_id, user_id, emoji));")
        conn.commit()
        print("Migration successful: Created message_reactions table.")
    except Exception as e:
        print(f"Message reactions table already exists or error: {e}")

    # ═════════════════════════════════════════════════════════════════════════
    # Phase 4: Mentions table
    # ═════════════════════════════════════════════════════════════════════════
    try:
        cursor.execute("CREATE TABLE IF NOT EXISTS mentions ("
                      "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                      "message_id INTEGER NOT NULL,"
                      "mentioned_user_id INTEGER NOT NULL,"
                      "mentioned_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
                      "FOREIGN KEY(message_id) REFERENCES messages(id),"
                      "FOREIGN KEY(mentioned_user_id) REFERENCES users(id));")
        conn.commit()
        print("Migration successful: Created mentions table.")
    except Exception as e:
        print(f"Mentions table already exists or error: {e}")

    conn.close()
except Exception as e:
    print(f"Migration failed: {e}")
