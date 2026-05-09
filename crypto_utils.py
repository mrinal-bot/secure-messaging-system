from Crypto.Cipher import AES, PKCS1_OAEP
from Crypto.PublicKey import RSA
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad, unpad
import base64

class CryptoHandler:
    @staticmethod
    def generate_rsa_keys():
        key = RSA.generate(2048)
        private_key = key.export_key().decode('utf-8')
        public_key = key.publickey().export_key().decode('utf-8')
        return private_key, public_key

    @staticmethod
    def aes_encrypt(data, key):
        """Encrypt data using AES-256-CBC"""
        iv = get_random_bytes(16)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        ct_bytes = cipher.encrypt(pad(data.encode('utf-8'), AES.block_size))
        # Return IV + Ciphertext encoded in base64
        return base64.b64encode(iv + ct_bytes).decode('utf-8')

    @staticmethod
    def aes_decrypt(encoded_data, key):
        """Decrypt data using AES-256-CBC"""
        data = base64.b64decode(encoded_data)
        iv = data[:16]
        ct = data[16:]
        cipher = AES.new(key, AES.MODE_CBC, iv)
        pt = unpad(cipher.decrypt(ct), AES.block_size)
        return pt.decode('utf-8')

    @staticmethod
    def rsa_encrypt(data, public_key_str):
        """Encrypt data using RSA Public Key"""
        recipient_key = RSA.import_key(public_key_str)
        cipher_rsa = PKCS1_OAEP.new(recipient_key)
        enc_data = cipher_rsa.encrypt(data)
        return base64.b64encode(enc_data).decode('utf-8')

    @staticmethod
    def rsa_decrypt(encoded_data, private_key_str):
        """Decrypt data using RSA Private Key"""
        private_key = RSA.import_key(private_key_str)
        cipher_rsa = PKCS1_OAEP.new(private_key)
        dec_data = cipher_rsa.decrypt(base64.b64decode(encoded_data))
        return dec_data
