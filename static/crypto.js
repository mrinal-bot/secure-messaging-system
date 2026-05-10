// crypto.js — End-to-End Encryption with AES-GCM + HMAC Integrity

const CryptoUtils = {
    // ── RSA Key Pair ──
    async generateRSAKeyPair() {
        return await window.crypto.subtle.generateKey(
            { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
            true, ["encrypt", "decrypt"]
        );
    },

    async exportPublicKey(publicKey) {
        const exported = await window.crypto.subtle.exportKey("spki", publicKey);
        return btoa(String.fromCharCode(...new Uint8Array(exported)));
    },

    async importPublicKey(keyStr) {
        const bin = Uint8Array.from(atob(keyStr), c => c.charCodeAt(0));
        return await window.crypto.subtle.importKey("spki", bin, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]);
    },

    async exportPrivateKey(privateKey) {
        const exported = await window.crypto.subtle.exportKey("pkcs8", privateKey);
        return btoa(String.fromCharCode(...new Uint8Array(exported)));
    },

    async importPrivateKey(keyStr) {
        const bin = Uint8Array.from(atob(keyStr), c => c.charCodeAt(0));
        return await window.crypto.subtle.importKey("pkcs8", bin, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]);
    },

    // ── AES-256-GCM ──
    async generateAESKey() {
        return await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    },

    async exportAESKey(key) {
        return await window.crypto.subtle.exportKey("raw", key);
    },

    async importAESKey(rawKey) {
        return await window.crypto.subtle.importKey("raw", rawKey, "AES-GCM", true, ["encrypt", "decrypt"]);
    },

    async encryptMessage(text, aesKey) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 12-byte IV for GCM
        const encoded = new TextEncoder().encode(text);
        const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encoded);
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);
        let binaryString = "";
        for (let i = 0; i < combined.length; i++) {
            binaryString += String.fromCharCode(combined[i]);
        }
        return btoa(binaryString);
    },

    async decryptMessage(encryptedBase64, aesKey) {
        const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);
        const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
        return new TextDecoder().decode(decrypted);
    },

    // ── RSA Key Encapsulation ──
    async encryptAESKeyWithRSA(rawAesKey, rsaPublicKey) {
        const encrypted = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaPublicKey, rawAesKey);
        return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    },

    async decryptAESKeyWithRSA(encryptedBase64, rsaPrivateKey) {
        const encrypted = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
        return await window.crypto.subtle.decrypt({ name: "RSA-OAEP" }, rsaPrivateKey, encrypted);
    },

    // ── HMAC Integrity ──
    async generateHMACKey() {
        return await window.crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"]);
    },

    async importHMACKey(rawKey) {
        return await window.crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    },

    async signHMAC(data, hmacKey) {
        const encoded = new TextEncoder().encode(data);
        const sig = await window.crypto.subtle.sign("HMAC", hmacKey, encoded);
        return btoa(String.fromCharCode(...new Uint8Array(sig)));
    },

    async verifyHMAC(data, signatureBase64, hmacKey) {
        const encoded = new TextEncoder().encode(data);
        const sig = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
        return await window.crypto.subtle.verify("HMAC", hmacKey, sig, encoded);
    },

    // ── SHA-256 Hash ──
    async sha256(text) {
        const encoded = new TextEncoder().encode(text);
        const hash = await window.crypto.subtle.digest("SHA-256", encoded);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    // ── Key Fingerprint (for visual verification) ──
    async getKeyFingerprint(publicKeyStr) {
        const hash = await this.sha256(publicKeyStr);
        return hash.substring(0, 32).match(/.{4}/g).join(' ').toUpperCase();
    },

    // ── IndexedDB Key Storage ──
    async storeKeys(userId, keyPair) {
        const privStr = await this.exportPrivateKey(keyPair.privateKey);
        const pubStr = await this.exportPublicKey(keyPair.publicKey);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('SecureMsgKeys', 1);
            req.onupgradeneeded = (e) => { e.target.result.createObjectStore('keys', { keyPath: 'userId' }); };
            req.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction('keys', 'readwrite');
                tx.objectStore('keys').put({ userId, privateKey: privStr, publicKey: pubStr });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });
    },

    async loadKeys(userId) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('SecureMsgKeys', 1);
            req.onupgradeneeded = (e) => { e.target.result.createObjectStore('keys', { keyPath: 'userId' }); };
            req.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction('keys', 'readonly');
                const get = tx.objectStore('keys').get(userId);
                get.onsuccess = async () => {
                    if (get.result) {
                        try {
                            const privateKey = await CryptoUtils.importPrivateKey(get.result.privateKey);
                            const publicKey = await CryptoUtils.importPublicKey(get.result.publicKey);
                            resolve({ privateKey, publicKey });
                        } catch (err) { resolve(null); }
                    } else { resolve(null); }
                };
                get.onerror = () => resolve(null);
            };
            req.onerror = () => resolve(null);
        });
    }
};
