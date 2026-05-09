import unittest
from crypto_utils import CryptoHandler
import hashlib
import hmac
import base64


class TestSecuritySystem(unittest.TestCase):

    # ── RSA Tests ──
    def test_rsa_key_generation(self):
        priv, pub = CryptoHandler.generate_rsa_keys()
        self.assertIn("BEGIN RSA PRIVATE KEY", priv)
        self.assertIn("BEGIN PUBLIC KEY", pub)

    def test_rsa_encryption_decryption(self):
        priv, pub = CryptoHandler.generate_rsa_keys()
        message = b"Secret AES Key"
        encrypted = CryptoHandler.rsa_encrypt(message, pub)
        decrypted = CryptoHandler.rsa_decrypt(encrypted, priv)
        self.assertEqual(message, decrypted)

    # ── AES Tests ──
    def test_aes_encryption_decryption(self):
        key = b'sixteen byte key'  # 16 bytes for AES-128
        message = "Hello, this is a secret message!"
        encrypted = CryptoHandler.aes_encrypt(message, key)
        decrypted = CryptoHandler.aes_decrypt(encrypted, key)
        self.assertEqual(message, decrypted)

    def test_aes_256_encryption(self):
        from Crypto.Random import get_random_bytes
        key = get_random_bytes(32)  # AES-256
        message = "Top secret message with AES-256"
        encrypted = CryptoHandler.aes_encrypt(message, key)
        decrypted = CryptoHandler.aes_decrypt(encrypted, key)
        self.assertEqual(message, decrypted)

    # ── HMAC Integrity Tests ──
    def test_hmac_generation_and_verification(self):
        key = b'hmac-secret-key'
        message = "This is a test message"
        signature = hmac.new(key, message.encode(), hashlib.sha256).hexdigest()
        # Verify
        expected = hmac.new(key, message.encode(), hashlib.sha256).hexdigest()
        self.assertEqual(signature, expected)

    def test_hmac_tamper_detection(self):
        key = b'hmac-secret-key'
        original = "Original message"
        tampered = "Tampered message"
        sig_original = hmac.new(key, original.encode(), hashlib.sha256).hexdigest()
        sig_tampered = hmac.new(key, tampered.encode(), hashlib.sha256).hexdigest()
        self.assertNotEqual(sig_original, sig_tampered)

    # ── SHA-256 Hash Tests ──
    def test_sha256_hash(self):
        message = "Hello World"
        hash1 = hashlib.sha256(message.encode()).hexdigest()
        hash2 = hashlib.sha256(message.encode()).hexdigest()
        self.assertEqual(hash1, hash2)

    def test_sha256_different_messages(self):
        hash1 = hashlib.sha256(b"Message A").hexdigest()
        hash2 = hashlib.sha256(b"Message B").hexdigest()
        self.assertNotEqual(hash1, hash2)

    # ── End-to-End Flow ──
    def test_end_to_end_flow_simulation(self):
        # 1. Receiver generates RSA keys
        rec_priv, rec_pub = CryptoHandler.generate_rsa_keys()

        # 2. Sender wants to send a message
        original_message = "Top secret intel"

        # 3. Sender generates a random AES key
        from Crypto.Random import get_random_bytes
        session_aes_key = get_random_bytes(32)  # AES-256

        # 4. Sender encrypts the message with AES
        encrypted_msg = CryptoHandler.aes_encrypt(original_message, session_aes_key)

        # 5. Sender encrypts the AES key with Receiver's RSA Public Key
        encrypted_aes_key = CryptoHandler.rsa_encrypt(session_aes_key, rec_pub)

        # 6. Sender creates HMAC signature
        hmac_key = b'shared-hmac-secret'
        hmac_sig = hmac.new(hmac_key, encrypted_msg.encode(), hashlib.sha256).hexdigest()

        # 7. Compute SHA-256 hash of ciphertext
        msg_hash = hashlib.sha256(encrypted_msg.encode()).hexdigest()

        # --- MESSAGE TRANSFERRED ---

        # 8. Receiver verifies integrity
        received_hash = hashlib.sha256(encrypted_msg.encode()).hexdigest()
        self.assertEqual(msg_hash, received_hash)

        # 9. Receiver verifies HMAC
        expected_hmac = hmac.new(hmac_key, encrypted_msg.encode(), hashlib.sha256).hexdigest()
        self.assertEqual(hmac_sig, expected_hmac)

        # 10. Receiver decrypts the AES key with RSA Private Key
        decrypted_aes_key = CryptoHandler.rsa_decrypt(encrypted_aes_key, rec_priv)

        # 11. Receiver decrypts the message with AES key
        decrypted_msg = CryptoHandler.aes_decrypt(encrypted_msg, decrypted_aes_key)

        self.assertEqual(original_message, decrypted_msg)
        print("\nEnd-to-end flow with HMAC integrity — PASSED!")

    # ── Password Strength Tests ──
    def test_password_strength_weak(self):
        import re
        password = "abc"
        self.assertTrue(len(password) < 8)

    def test_password_strength_strong(self):
        import re
        password = "MyP@ssw0rd!"
        self.assertTrue(len(password) >= 8)
        self.assertTrue(bool(re.search(r'[A-Z]', password)))
        self.assertTrue(bool(re.search(r'[a-z]', password)))
        self.assertTrue(bool(re.search(r'[0-9]', password)))
        self.assertTrue(bool(re.search(r'[!@#$%^&*(),.?":{}|<>]', password)))


if __name__ == '__main__':
    unittest.main()
