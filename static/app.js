// app.js — Secure Messaging System Frontend Logic

let socket;
let currentUser = null;
let currentRecipient = null;
let userKeyPair = null;
let accessToken = null;
const messages = {};
const unreadCounts = {};   // { userId: count }
const lastMessages = {};   // { userId: "preview text" }
let typingTimeout = null;
let securityPanelOpen = false;
let usersCache = [];       // Cache for contact list re-renders
let userListRefreshInterval = null;

// ═══════════════════════════════════════
//  THEME TOGGLE
// ═══════════════════════════════════════
function toggleTheme() {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    initializeThemeIcon();
}

function initializeThemeIcon() {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    const isLight = document.body.classList.contains('light-theme');
    btn.innerHTML = isLight ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}

// ═══════════════════════════════════════
//  NOTIFICATION SOUND
// ═══════════════════════════════════════
const notifCtx = new (window.AudioContext || window.webkitAudioContext)();
function playNotifSound() {
    try {
        const osc = notifCtx.createOscillator();
        const gain = notifCtx.createGain();
        osc.connect(gain);
        gain.connect(notifCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, notifCtx.currentTime);
        osc.frequency.setValueAtTime(1100, notifCtx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.15, notifCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, notifCtx.currentTime + 0.3);
        osc.start(notifCtx.currentTime);
        osc.stop(notifCtx.currentTime + 0.3);
    } catch (e) { /* audio not supported */ }
}

// ═══════════════════════════════════════
//  TOAST NOTIFICATIONS
// ═══════════════════════════════════════
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('hiding'); setTimeout(() => toast.remove(), 300); }, 4000);
}

// ═══════════════════════════════════════
//  PASSWORD STRENGTH
// ═══════════════════════════════════════
function checkPasswordStrength(password) {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score++;
    return score;
}

function updatePasswordMeter(password) {
    const bars = document.querySelectorAll('.pwd-bar');
    const hint = document.getElementById('pwd-hint');
    if (!bars.length) return;
    const score = checkPasswordStrength(password);
    const levels = ['', 'weak', 'weak', 'medium', 'strong', 'strong'];
    const hints = ['', 'Very weak', 'Weak — add variety', 'Fair — almost there', 'Strong', 'Very strong'];
    bars.forEach((bar, i) => {
        bar.className = 'pwd-bar';
        if (i < score) bar.classList.add('active', levels[score]);
    });
    if (hint) { hint.textContent = password ? hints[score] : ''; }
}

// ═══════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════
function toggleAuth() {
    document.getElementById('login-form').classList.toggle('hidden');
    document.getElementById('register-form').classList.toggle('hidden');
    document.getElementById('otp-form').classList.add('hidden');
}

function resetAuthFlow() {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('otp-form').classList.add('hidden');
    document.getElementById('forgot-form').classList.add('hidden');
    document.getElementById('reset-form').classList.add('hidden');
}

let recoveryMode = 'password';

function showForgot(mode) {
    recoveryMode = mode;
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('forgot-form').classList.remove('hidden');
    
    const title = document.getElementById('forgot-title');
    const subtitle = document.getElementById('forgot-subtitle');
    
    if (mode === 'username') {
        title.textContent = 'Recover Username';
        subtitle.textContent = 'Enter your email and we will send you your username.';
    } else {
        title.textContent = 'Reset Password';
        subtitle.textContent = 'Enter your email to receive a password reset code.';
    }
}

async function requestRecovery() {
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) return showToast('Enter your email address', 'warning');

    const endpoint = recoveryMode === 'username' ? '/api/auth/forgot-username' : '/api/auth/forgot-password';

    try {
        const res = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        
        if (res.ok) {
            showToast(data.message, 'success');
            if (recoveryMode === 'password' && data.user_id) {
                // Transition to reset form
                document.getElementById('forgot-form').classList.add('hidden');
                document.getElementById('reset-form').classList.remove('hidden');
                document.getElementById('reset-user-id').value = data.user_id;
            } else {
                resetAuthFlow();
            }
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) { showToast('Recovery request failed', 'error'); }
}

async function resetPassword() {
    const userId = document.getElementById('reset-user-id').value;
    const otp = document.getElementById('reset-otp').value.trim();
    const newPassword = document.getElementById('reset-new-password').value;

    if (!otp || !newPassword) return showToast('Fill all fields', 'warning');

    try {
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, otp, new_password: newPassword })
        });
        const data = await res.json();

        if (res.ok) {
            showToast(data.message, 'success');
            resetAuthFlow();
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) { showToast('Password reset failed', 'error'); }
}

async function register() {
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const password = document.getElementById('reg-password').value;
    if (!username || !email || !password) return showToast('Please fill all fields', 'warning');
    if (checkPasswordStrength(password) < 4) return showToast('Password is too weak', 'warning');

    try {
        userKeyPair = await CryptoUtils.generateRSAKeyPair();
        const pubKeyStr = await CryptoUtils.exportPublicKey(userKeyPair.publicKey);
        const res = await fetch('/api/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, phone, password, public_key: pubKeyStr })
        });
        const data = await res.json();
        if (res.ok) {
            if (data.requires_otp && data.user_id) {
                document.getElementById('login-form').classList.add('hidden');
                document.getElementById('register-form').classList.add('hidden');
                document.getElementById('forgot-form').classList.add('hidden');
                document.getElementById('reset-form').classList.add('hidden');
                document.getElementById('otp-form').classList.remove('hidden');
                document.getElementById('otp-user-id').value = data.user_id;
                showToast(data.message || 'Verification code sent to your email', 'success');
            } else {
                showToast('Account created! You can now log in.', 'success');
                toggleAuth(); // Fallback to login form
            }
        } else {
            const errMsg = data.errors ? data.errors.join(', ') : data.message;
            showToast(errMsg, 'error');
        }
    } catch (e) { showToast('Registration failed', 'error'); }
}

async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) return showToast('Enter username and password', 'warning');

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!res.ok) {
            return showToast(data.message, 'error');
        }

        if (data.requires_otp && data.user_id) {
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('forgot-form').classList.add('hidden');
            document.getElementById('reset-form').classList.add('hidden');
            document.getElementById('otp-form').classList.remove('hidden');
            document.getElementById('otp-user-id').value = data.user_id;
            showToast(data.message || 'Security code sent to your email', 'success');
            return;
        }

        // Backward-compatibility fallback if server still returns direct token
        accessToken = data.access_token;
        currentUser = data.user;
        localStorage.setItem('token', accessToken);
        localStorage.setItem('user', JSON.stringify(currentUser));

        const storedKeys = await CryptoUtils.loadKeys(currentUser.id);
        if (storedKeys) userKeyPair = storedKeys;
        else {
            userKeyPair = await CryptoUtils.generateRSAKeyPair();
            await CryptoUtils.storeKeys(currentUser.id, userKeyPair);
        }
        await initAppAfterAuth();
    } catch (e) { console.error(e); showToast('Login failed', 'error'); }
}

async function verifyOTP() {
    const userId = document.getElementById('otp-user-id').value;
    const otp = document.getElementById('otp-code').value.trim();
    if (!otp || otp.length !== 6) return showToast('Enter 6-digit code', 'warning');

    try {
        const res = await fetch('/api/auth/verify-otp', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, otp: otp })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message, 'success');
            
            if (data.access_token) {
                // This was a 2FA login success
                accessToken = data.access_token;
                currentUser = data.user;
                localStorage.setItem('token', accessToken);
                localStorage.setItem('user', JSON.stringify(currentUser));

                // Load or generate keys
                const storedKeys = await CryptoUtils.loadKeys(currentUser.id);
                if (storedKeys) {
                    userKeyPair = storedKeys;
                } else {
                    userKeyPair = await CryptoUtils.generateRSAKeyPair();
                    await CryptoUtils.storeKeys(currentUser.id, userKeyPair);
                }
                
                resetAuthFlow();
                await initAppAfterAuth();
            } else {
                // This was just a registration verification success
                resetAuthFlow();
            }
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) { showToast('Verification failed', 'error'); }
}

async function resendOTP() {
    const userId = document.getElementById('otp-user-id').value;
    try {
        const res = await fetch('/api/auth/resend-otp', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message, 'success');
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) { showToast('Failed to resend code', 'error'); }
}

async function initAppAfterAuth() {
    // Always update public key on server
    const pubStr = await CryptoUtils.exportPublicKey(userKeyPair.publicKey);
    await fetch('/api/auth/update_keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ public_key: pubStr })
    });

    showChat();
    initSocket();
    loadUsers();
    startAutoRefresh();
    showToast(`Welcome back, ${currentUser.username}!`, 'success');
}

async function logout() {
    stopAutoRefresh();
    try {
        if (accessToken) {
            await fetch('/api/auth/logout', {
                method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` }
            });
        }
    } catch (e) { /* ignore */ }
    localStorage.clear();
    location.reload();
}

function showChat() {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('chat-section').classList.remove('hidden');
    const displayName = currentUser.display_name || currentUser.username;
    document.getElementById('current-username').textContent = displayName;
    const userAvatar = document.getElementById('user-avatar');
    if (currentUser.profile_photo) {
        userAvatar.innerHTML = `<img src="${currentUser.profile_photo}" alt="${escapeHtml(displayName)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
        userAvatar.textContent = displayName[0].toUpperCase();
    }
}

function showProfileModal() {
    document.getElementById('edit-display-name').value = currentUser.display_name || currentUser.username;
    const photoInput = document.getElementById('edit-profile-photo');
    if (photoInput) photoInput.value = '';
    document.getElementById('profile-modal').classList.remove('hidden');
}

function closeProfileModal() {
    document.getElementById('profile-modal').classList.add('hidden');
}

async function updateProfile() {
    const newName = document.getElementById('edit-display-name').value.trim();
    if (!newName) return showToast('Name cannot be empty', 'warning');
    const photoInput = document.getElementById('edit-profile-photo');
    let profilePhoto = currentUser.profile_photo || null;

    if (photoInput && photoInput.files && photoInput.files[0]) {
        const file = photoInput.files[0];
        if (!file.type.startsWith('image/')) return showToast('Please choose an image file', 'warning');
        if (file.size > 1024 * 1024) return showToast('Profile photo must be under 1MB', 'warning');
        profilePhoto = await fileToDataURL(file);
    }

    try {
        const res = await fetch('/api/auth/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify({ display_name: newName, profile_photo: profilePhoto })
        });
        const data = await res.json();
        if (res.ok) {
            currentUser = data.user;
            localStorage.setItem('user', JSON.stringify(currentUser));
            showChat(); // Refresh display
            closeProfileModal();
            showToast(data.message, 'success');
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) { showToast('Failed to update profile', 'error'); }
}

// ═══════════════════════════════════════
//  AUTO REFRESH (WhatsApp-like)
// ═══════════════════════════════════════
function startAutoRefresh() {
    // Refresh contact list every 10 seconds for online status
    userListRefreshInterval = setInterval(() => {
        loadUsers(true); // silent refresh
    }, 10000);
}

function stopAutoRefresh() {
    if (userListRefreshInterval) {
        clearInterval(userListRefreshInterval);
        userListRefreshInterval = null;
    }
}

// ═══════════════════════════════════════
//  SOCKET.IO
// ═══════════════════════════════════════
function initSocket() {
    socket = io({ query: { token: accessToken } });

    socket.on('connect', () => {
        socket.emit('register_session', { user_id: currentUser.id });
    });

    socket.on('receive_message', async (data) => {
        try {
            const rawAesKey = await CryptoUtils.decryptAESKeyWithRSA(data.encrypted_key, userKeyPair.privateKey);
            const aesKey = await CryptoUtils.importAESKey(rawAesKey);
            const decryptedText = await CryptoUtils.decryptMessage(data.message, aesKey);

            // Verify integrity
            let integrityOk = true;
            if (data.message_hash) {
                const computedHash = await CryptoUtils.sha256(data.message);
                integrityOk = computedHash === data.message_hash;
            }

            const msgObj = { id: data.id, sender_id: data.sender_id, text: decryptedText, timestamp: data.timestamp, isMe: false, integrity: integrityOk };
            if (!messages[data.sender_id]) messages[data.sender_id] = [];
            messages[data.sender_id].push(msgObj);

            // Update last message preview for this contact
            let preview = decryptedText;
            if (typeof decryptedText === 'string') {
                try {
                    const parsed = JSON.parse(decryptedText);
                    if (parsed && parsed.type === 'audio') preview = '🎤 Voice Message';
                    else if (parsed && parsed.type === 'image') preview = '📷 Photo';
                    else if (parsed && parsed.type === 'file') preview = '📄 File';
                } catch(e) {}
            }
            lastMessages[data.sender_id] = preview;

            if (currentRecipient && currentRecipient.id === data.sender_id) {
                // Chat is open with this sender — mark read immediately
                msgObj.is_read = true;
                socket.emit('mark_read', { message_ids: [data.id], sender_id: data.sender_id });
                renderMessages();
            } else {
                // Chat NOT open — increment unread count + show notification
                unreadCounts[data.sender_id] = (unreadCounts[data.sender_id] || 0) + 1;
                // Find sender username
                const sender = usersCache.find(u => u.id === data.sender_id);
                const senderName = sender ? sender.username : `User #${data.sender_id}`;
                showToast(`${senderName}: ${decryptedText.substring(0, 50)}${decryptedText.length > 50 ? '...' : ''}`, 'info');
                if (!sender) {
                    // Ensure new sender appears in contact list immediately.
                    await loadUsers(true);
                }
            }

            // Play notification sound
            playNotifSound();

            // Re-render contact list to update previews and badges
            renderUserList(usersCache);

        } catch (e) { console.error("Decrypt failed:", e); showToast('Failed to decrypt a message', 'error'); }
    });

    socket.on('message_sent', (data) => {
        // Server confirmed message saved
    });

    socket.on('messages_read', (data) => {
        const { message_ids, receiver_id } = data;
        if (messages[receiver_id]) {
            messages[receiver_id].forEach(m => {
                if (message_ids.includes(m.id)) m.is_read = true;
            });
            if (currentRecipient && currentRecipient.id === receiver_id) {
                renderMessages();
            }
        }
    });

    socket.on('user_status', (data) => {
        updateUserStatus(data.user_id, data.is_online);
        // Update cache
        const u = usersCache.find(c => c.id === data.user_id);
        if (u) u.is_online = data.is_online;
    });

    socket.on('user_typing', (data) => {
        if (currentRecipient && currentRecipient.id === data.sender_id) {
            const el = document.getElementById('typing-indicator');
            if (data.is_typing) {
                el.innerHTML = `${currentRecipient.username} is typing<span class="typing-dots"><span></span><span></span><span></span></span>`;
            } else {
                el.innerHTML = '';
            }
        }
    });

    socket.on('disconnect', () => {
        showToast('Connection lost. Reconnecting...', 'warning');
    });

    socket.on('reconnect', () => {
        socket.emit('register_session', { user_id: currentUser.id });
        showToast('Reconnected!', 'success');
    });
}

// ═══════════════════════════════════════
//  USERS / CONTACTS
// ═══════════════════════════════════════
async function loadUsers(silent = false) {
    try {
        const res = await fetch('/api/auth/users', { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const users = await res.json();
        usersCache = users.filter(u => u.id !== currentUser.id);
        renderUserList(usersCache);
    } catch (e) {
        if (!silent) showToast('Failed to load contacts', 'error');
    }
}


function renderUserList(users) {
    const list = document.getElementById('users-list');
    list.innerHTML = '';
    if (!users || !users.length) {
        list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:24px;font-size:0.85rem;">No contacts found</p>';
        return;
    }

    // Sort: online first, then by unread count, then alphabetical
    const sorted = [...users].sort((a, b) => {
        const aUnread = unreadCounts[a.id] || 0;
        const bUnread = unreadCounts[b.id] || 0;
        if (bUnread !== aUnread) return bUnread - aUnread;
        if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
        return a.username.localeCompare(b.username);
    });

    sorted.forEach(user => {
        const isActive = currentRecipient && currentRecipient.id === user.id;
        const isOnline = user.is_online;
        const unread = unreadCounts[user.id] || 0;
        const preview = lastMessages[user.id] || 'Encrypted channel';
        const previewTruncated = preview.length > 30 ? preview.substring(0, 30) + '...' : preview;

        const name = user.display_name || user.username;
        const div = document.createElement('div');
        div.className = `contact-item${isActive ? ' active' : ''}`;
        div.id = `contact-${user.id}`;
        div.onclick = () => selectUser(user);
        const avatarHtml = user.profile_photo
            ? `<img src="${user.profile_photo}" alt="${escapeHtml(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
            : `${name[0].toUpperCase()}`;
        div.innerHTML = `
            <div style="position:relative;">
                <div class="avatar-sm">${avatarHtml}</div>
                <div class="online-dot${isOnline ? '' : ' offline'}" id="dot-${user.id}"></div>
            </div>
            <div style="flex:1;overflow:hidden;">
                <div class="contact-name">${name}</div>
                <div class="contact-preview" id="preview-${user.id}">${escapeHtml(previewTruncated)}</div>
            </div>
            <div class="contact-meta">
                <div class="contact-status ${isOnline ? 'online' : 'offline'}" id="status-${user.id}">${isOnline ? 'Online' : 'Offline'}</div>
                ${unread > 0 ? `<div class="unread-badge">${unread}</div>` : ''}
            </div>`;
        list.appendChild(div);
    });
}

function updateUserStatus(userId, isOnline) {
    const dot = document.getElementById(`dot-${userId}`);
    const status = document.getElementById(`status-${userId}`);
    if (dot) { dot.className = `online-dot${isOnline ? '' : ' offline'}`; }
    if (status) { status.textContent = isOnline ? 'Online' : 'Offline'; status.className = `contact-status ${isOnline ? 'online' : 'offline'}`; }
    if (currentRecipient && currentRecipient.id === userId) {
        const hStatus = document.getElementById('chat-user-status');
        if (hStatus) { hStatus.textContent = isOnline ? 'Online • Encrypted' : 'Offline • Encrypted'; }
    }
}

// ═══════════════════════════════════════
//  SELECT USER & MESSAGE HISTORY
// ═══════════════════════════════════════
async function selectUser(user) {
    currentRecipient = user;
    document.getElementById('empty-chat-state').classList.add('hidden');
    document.getElementById('chat-header-bar').classList.remove('hidden');
    document.getElementById('message-input-area').classList.remove('hidden');

    // Clear unread count for this user
    unreadCounts[user.id] = 0;
    renderUserList(usersCache);

    // Fetch recipient's public key
    try {
        const res = await fetch(`/api/auth/public_key/${user.id}`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const data = await res.json();
        currentRecipient.public_key = data.public_key;
    } catch (e) { showToast('Could not fetch encryption key', 'error'); }

    // Update chat header
    const fingerprint = currentRecipient.public_key ? await CryptoUtils.getKeyFingerprint(currentRecipient.public_key) : 'N/A';
    const name = user.display_name || user.username;
    const chatAvatar = document.getElementById('chat-user-avatar');
    if (user.profile_photo) {
        chatAvatar.innerHTML = `<img src="${user.profile_photo}" alt="${escapeHtml(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
        chatAvatar.textContent = name[0].toUpperCase();
    }
    document.getElementById('chat-user-name').textContent = name;
    document.getElementById('chat-user-status').textContent = user.is_online ? 'Online • Encrypted' : 'Offline • Encrypted';
    document.getElementById('key-fingerprint').textContent = fingerprint;

    // Highlight active contact
    document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
    const contactEl = document.getElementById(`contact-${user.id}`);
    if (contactEl) contactEl.classList.add('active');

    // Load message history (force refresh each time to catch new messages)
    await loadMessageHistory(user.id);
    renderMessages();
    document.getElementById('message-input').focus();
}

async function clearChat() {
    if (!currentRecipient) return;
    
    const confirmed = confirm(`Are you sure you want to CLEAR the entire chat with ${currentRecipient.username}?\n\nThis will permanently delete all messages for BOTH of you.`);
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/messages/${currentRecipient.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (res.ok) {
            // Clear local data
            messages[currentRecipient.id] = [];
            lastMessages[currentRecipient.id] = 'Chat cleared';
            
            // UI Updates
            renderMessages();
            renderUserList(usersCache);
            showToast('Chat history deleted permanently', 'success');
        } else {
            const data = await res.json();
            showToast(data.message || 'Failed to clear chat', 'error');
        }
    } catch (e) {
        showToast('Network error while clearing chat', 'error');
    }
}

async function loadMessageHistory(userId) {
    // Always fetch from server to get latest messages (WhatsApp-like reload)
    try {
        const res = await fetch(`/api/messages/${userId}?per_page=100`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const data = await res.json();
        if (!data.messages || !data.messages.length) {
            // Keep any real-time messages we have locally
            if (!messages[userId]) messages[userId] = [];
            return;
        }

        // Build a set of message IDs we already have locally (from real-time)
        const existingIds = new Set((messages[userId] || []).filter(m => m.id).map(m => m.id));
        // Keep real-time messages that don't have an ID from server (just sent by us)
        const localOnly = (messages[userId] || []).filter(m => !m.id || !data.messages.find(sm => sm.id === m.id));

        const serverMessages = [];
        for (const msg of data.messages) {
            if (existingIds.has(msg.id)) {
                // We already have this decrypted — keep the local version
                const local = messages[userId].find(m => m.id === msg.id);
                if (local) { serverMessages.push(local); continue; }
            }

            const isMe = msg.sender_id === currentUser.id;
            try {
                if (!isMe && msg.encrypted_key) {
                    const rawAesKey = await CryptoUtils.decryptAESKeyWithRSA(msg.encrypted_key, userKeyPair.privateKey);
                    const aesKey = await CryptoUtils.importAESKey(rawAesKey);
                    const text = await CryptoUtils.decryptMessage(msg.encrypted_message, aesKey);
                    serverMessages.push({ id: msg.id, sender_id: msg.sender_id, text, timestamp: msg.timestamp, isMe: false, integrity: true });
                    let preview = text;
                    if (typeof text === 'string') {
                        try {
                            const parsed = JSON.parse(text);
                            if (parsed && parsed.type === 'audio') preview = '🎤 Voice Message';
                            else if (parsed && parsed.type === 'image') preview = '📷 Photo';
                            else if (parsed && parsed.type === 'file') preview = '📄 File';
                        } catch(e) {}
                    }
                    lastMessages[userId] = preview;
                } else if (isMe && msg.encrypted_key_sender) {
                    const rawAesKey = await CryptoUtils.decryptAESKeyWithRSA(msg.encrypted_key_sender, userKeyPair.privateKey);
                    const aesKey = await CryptoUtils.importAESKey(rawAesKey);
                    const text = await CryptoUtils.decryptMessage(msg.encrypted_message, aesKey);
                    serverMessages.push({ id: msg.id, sender_id: msg.sender_id, text, timestamp: msg.timestamp, isMe: true, integrity: true });
                    let preview = text;
                    if (typeof text === 'string') {
                        try {
                            const parsed = JSON.parse(text);
                            if (parsed && parsed.type === 'audio') preview = '🎤 Voice Message';
                            else if (parsed && parsed.type === 'image') preview = '📷 Photo';
                            else if (parsed && parsed.type === 'file') preview = '📄 File';
                        } catch(e) {}
                    }
                    lastMessages[userId] = preview;
                } else {
                    serverMessages.push({ id: msg.id, sender_id: msg.sender_id, text: '[Encrypted — sent by you]', timestamp: msg.timestamp, isMe: true, integrity: true });
                }
            } catch (e) {
                serverMessages.push({ id: msg.id, sender_id: msg.sender_id, text: '[Cannot decrypt]', timestamp: msg.timestamp, isMe, integrity: false });
            }
        }

        // Merge: server messages + any local-only messages (just sent, not yet in DB)
        messages[userId] = [...serverMessages, ...localOnly];

        // Mark any unread messages from this user as read now that we opened the chat
        const unreadIds = messages[userId].filter(m => !m.isMe && !m.is_read && m.id).map(m => m.id);
        if (unreadIds.length > 0) {
            socket.emit('mark_read', { message_ids: unreadIds, sender_id: userId });
            messages[userId].forEach(m => {
                if (unreadIds.includes(m.id)) m.is_read = true;
            });
        }

    } catch (e) {
        // First conversation or network error — keep local messages
        if (!messages[userId]) messages[userId] = [];
    }
}

// ═══════════════════════════════════════
//  SEND MESSAGE
// ═══════════════════════════════════════
async function sendMessage(overrideText = null) {
    const input = document.getElementById('message-input');
    const text = overrideText !== null ? overrideText : input.value.trim();
    if (!text || !currentRecipient) return;

    try {
        const aesKey = await CryptoUtils.generateAESKey();
        const rawAesKey = await CryptoUtils.exportAESKey(aesKey);
        const encryptedMsg = await CryptoUtils.encryptMessage(text, aesKey);

        const recipientPubKey = await CryptoUtils.importPublicKey(currentRecipient.public_key);
        const encryptedAesKey = await CryptoUtils.encryptAESKeyWithRSA(rawAesKey, recipientPubKey);
        const encryptedAesKeySender = await CryptoUtils.encryptAESKeyWithRSA(rawAesKey, userKeyPair.publicKey);

        // HMAC signature for integrity
        const hmacKey = await CryptoUtils.generateHMACKey();
        const hmacSig = await CryptoUtils.signHMAC(encryptedMsg, hmacKey);

        socket.emit('send_message', {
            sender_id: currentUser.id,
            receiver_id: currentRecipient.id,
            message: encryptedMsg,
            encrypted_key: encryptedAesKey,
            encrypted_key_sender: encryptedAesKeySender,
            hmac_signature: hmacSig,
        });

        if (!messages[currentRecipient.id]) messages[currentRecipient.id] = [];
        messages[currentRecipient.id].push({ text, timestamp: new Date().toISOString(), isMe: true, integrity: true, is_read: false });

        // Update last message preview and ensure user is in cache
        let previewText = text;
        if (typeof text === 'string') {
            try {
                const parsed = JSON.parse(text);
                if (parsed && parsed.type === 'audio') previewText = '🎤 Voice Message';
                else if (parsed && parsed.type === 'image') previewText = '📷 Photo';
                else if (parsed && parsed.type === 'file') previewText = '📄 File';
            } catch(e) {}
        }
        lastMessages[currentRecipient.id] = previewText;
        if (!usersCache.find(u => u.id === currentRecipient.id)) {
            usersCache.push(currentRecipient);
        }
        
        // Clear search if active, otherwise just re-render
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value.trim() !== '') {
            searchInput.value = '';
            handleSearch(''); // Reset to full list
        } else {
            renderUserList(usersCache);
        }

        if (overrideText === null) {
            input.value = '';
            input.style.height = 'auto';
            const btn = document.getElementById('main-action-btn');
            if(btn) { btn.innerHTML = '<i class="fa-solid fa-microphone"></i>'; btn.title = "Record Voice Message"; }
        }
        renderMessages();
        emitTyping(false);
    } catch (e) {
        console.error("Encryption failed:", e);
        showToast('Failed to encrypt. Recipient may lack valid keys.', 'error');
    }
}

// ═══════════════════════════════════════
//  VOICE RECORDING
// ═══════════════════════════════════════
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingSeconds = 0;

function handleMainAction() {
    const input = document.getElementById('message-input');
    if (input.value.trim().length > 0) {
        sendMessage();
    } else {
        startVoiceRecording();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('message-input');
    if(input) {
        input.addEventListener('input', function() {
            const btn = document.getElementById('main-action-btn');
            if (!btn) return;
            if (this.value.trim().length > 0) {
                btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
                btn.title = "Send";
            } else {
                btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                btn.title = "Record Voice Message";
            }
        });
    }
});

async function startVoiceRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.start();
        
        document.getElementById('text-input-row').classList.add('hidden');
        document.getElementById('voice-recording-row').classList.remove('hidden');
        
        recordingSeconds = 0;
        document.getElementById('recording-time').textContent = '00:00';
        recordingInterval = setInterval(() => {
            recordingSeconds++;
            const m = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
            const s = String(recordingSeconds % 60).padStart(2, '0');
            document.getElementById('recording-time').textContent = `${m}:${s}`;
        }, 1000);
        
    } catch (err) {
        showToast('Microphone access denied or unavailable.', 'error');
    }
}

function stopRecording(callback) {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    clearInterval(recordingInterval);
    
    mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        mediaRecorder = null;
        
        document.getElementById('text-input-row').classList.remove('hidden');
        document.getElementById('voice-recording-row').classList.add('hidden');
        
        if (callback) callback(audioBlob);
    };
    mediaRecorder.stop();
}

function cancelVoiceRecording() {
    stopRecording(null);
}

function stopAndSendVoiceRecording() {
    stopRecording(async (audioBlob) => {
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
            const base64Audio = reader.result;
            const payload = JSON.stringify({ type: 'audio', data: base64Audio });
            sendMessage(payload);
        };
    });
}

// ═══════════════════════════════════════
//  RENDER MESSAGES
// ═══════════════════════════════════════
function renderMessages() {
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    if (!currentRecipient || !messages[currentRecipient.id] || !messages[currentRecipient.id].length) {
        container.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text-muted);font-size:0.85rem;"><i class="fa-solid fa-lock" style="font-size:24px;margin-bottom:12px;display:block;color:var(--accent);"></i>Messages are end-to-end encrypted.<br>No one outside of this chat can read them.</div>';
        return;
    }

    messages[currentRecipient.id].forEach(msg => {
        const div = document.createElement('div');
        div.className = `message-row ${msg.isMe ? 'sent' : 'received'}`;
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const integrityIcon = msg.integrity !== false
            ? '<i class="fa-solid fa-shield-check integrity-badge verified" title="Integrity verified"></i>'
            : '<i class="fa-solid fa-shield-xmark integrity-badge failed" title="Integrity check failed"></i>';

        // Detect media payloads to strip default bubble padding
        let isMediaBubble = false;
        if (typeof msg.text === 'string') {
            try {
                const p = JSON.parse(msg.text);
                // All media (audio, image, file) should use the media-bubble style
                if (p && (p.type === 'audio' || p.type === 'image' || p.type === 'file')) isMediaBubble = true;
            } catch(e) {}
        }
        const bubbleClass = isMediaBubble ? 'message-bubble media-bubble' : 'message-bubble';

        div.innerHTML = `
            <div class="message-wrap">
                <div class="${bubbleClass}">${formatMessageContent(msg.text)}</div>
                <div class="message-meta">
                    <span class="message-time">${time}</span>
                    ${msg.isMe ? (msg.is_read ? '<i class="fa-solid fa-check-double" style="font-size:10px;color:var(--accent-light);" title="Read"></i>' : '<i class="fa-solid fa-check" style="font-size:10px;color:var(--text-muted);" title="Sent"></i>') : ''}
                    ${integrityIcon}
                </div>
            </div>`;
        container.appendChild(div);
    });

    // Auto-scroll to bottom (WhatsApp-like)
    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });
}

function handleFileAttachment(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (file.size > 7 * 1024 * 1024) {
        showToast('File must be smaller than 7MB', 'error');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
        const base64Data = reader.result;
        const isImage = file.type.startsWith('image/');
        const payload = JSON.stringify({
            type: isImage ? 'image' : 'file',
            data: base64Data,
            filename: file.name,
            mimeType: file.type
        });
        sendMessage(payload);
        event.target.value = ''; // reset input
    };
    reader.readAsDataURL(file);
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

function formatMessageContent(rawText) {
    if (typeof rawText === 'string') {
        try {
            const parsed = JSON.parse(rawText);
            if (parsed && parsed.type === 'audio' && parsed.data) {
                const safeUrl = parsed.data.replace(/"/g, '%22').replace(/'/g, '%27');
                const playerId = 'audio_' + Math.random().toString(36).substr(2, 9);
                return `<div class="custom-audio-player" id="player_${playerId}"><audio id="${playerId}" src="${safeUrl}" style="display:none;"></audio><button class="audio-play-btn" onclick="toggleAudioPlayer('${playerId}')"><i class="fa-solid fa-play" id="icon_${playerId}"></i></button><div class="audio-waveform-container" onclick="seekAudioPlayer(event, '${playerId}')"><div class="audio-track"><div class="audio-track-fill" id="progress_${playerId}"></div></div><div class="audio-thumb" id="thumb_${playerId}"></div></div><span class="audio-time" id="time_${playerId}">0:00</span><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" onload="initAudioPlayer('${playerId}')" style="display:none;"></div>`;
            }
            if (parsed && parsed.type === 'image' && parsed.data) {
                const imgId = 'img_' + Math.random().toString(36).substr(2, 9);
                const safeName = escapeHtml(parsed.filename || 'image');
                return `<div class="image-message-container"><img id="${imgId}" src="${parsed.data}" alt="${safeName}" onclick="openImagePreview('${imgId}')" style="cursor:pointer;"><br><small class="image-name">${safeName}</small></div>`;
            }
            if (parsed && parsed.type === 'file' && parsed.data) {
                const safeUrl = parsed.data.replace(/"/g, '%22').replace(/'/g, '%27');
                const safeName = escapeHtml(parsed.filename || 'file');
                const isPdf = safeName.toLowerCase().endsWith('.pdf');
                const iconClass = isPdf ? 'fa-file-pdf' : 'fa-file';
                return `<div class="file-message-container">
                            <a href="${safeUrl}" download="${safeName}" class="file-attachment">
                                <i class="fa-solid ${iconClass}"></i> 
                                <span class="file-name">${safeName}</span>
                            </a>
                        </div>`;
            }
        } catch(e) {}
    }
    return escapeHtml(rawText);
}

// ═══════════════════════════════════════
//  TYPING INDICATOR
// ═══════════════════════════════════════
function emitTyping(isTyping) {
    if (!socket || !currentRecipient) return;
    socket.emit('typing', { sender_id: currentUser.id, receiver_id: currentRecipient.id, is_typing: isTyping });
}

function handleTypingInput() {
    emitTyping(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => emitTyping(false), 2000);
}

// ═══════════════════════════════════════
//  SEARCH CONTACTS
// ═══════════════════════════════════════
let searchTimeout;
async function handleSearch(query) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const q = query.trim().toLowerCase();
        if (!q) { renderUserList(usersCache); return; }
        
        try {
            // Find local matches first
            const localMatches = usersCache.filter(u => 
                u.username.toLowerCase().includes(q) || 
                (u.display_name && u.display_name.toLowerCase().includes(q)) ||
                u.email.toLowerCase() === q || 
                (u.phone && u.phone.toLowerCase().includes(q))
            );

            // Fetch server matches (for finding new users by exact email/phone)
            const res = await fetch(`/api/auth/search?q=${encodeURIComponent(q)}`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const serverUsers = await res.json();
            
            // Merge results, preferring server data if duplicates exist
            const displayUsers = [...localMatches];
            serverUsers.forEach(u => {
                if (u.id !== currentUser.id && !displayUsers.find(du => du.id === u.id)) {
                    displayUsers.push(u);
                }
            });
            
            renderUserList(displayUsers);
        } catch (e) { 
            // Fallback to local filtering if network fails
            renderUserList(usersCache.filter(u => 
                u.username.toLowerCase().includes(q) || 
                (u.display_name && u.display_name.toLowerCase().includes(q)) ||
                u.email.toLowerCase() === q || 
                (u.phone && u.phone.toLowerCase().includes(q))
            ));
        }
    }, 300);
}

// ═══════════════════════════════════════
//  SECURITY PANEL
// ═══════════════════════════════════════
async function toggleSecurityPanel() {
    const panel = document.getElementById('security-panel');
    securityPanelOpen = !securityPanelOpen;
    if (securityPanelOpen) {
        panel.classList.add('open');
        await loadSecurityStats();
    } else {
        panel.classList.remove('open');
    }
}

async function loadSecurityStats() {
    try {
        const res = await fetch('/api/security/stats', { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const stats = await res.json();
        document.getElementById('stat-logins').textContent = stats.successful_logins;
        document.getElementById('stat-failed').textContent = stats.failed_logins;
        document.getElementById('stat-alerts').textContent = stats.brute_force_alerts;
        document.getElementById('stat-keys').textContent = stats.key_updates;

        const logContainer = document.getElementById('audit-log-list');
        logContainer.innerHTML = '';
        const logRes = await fetch('/api/security/audit-log?per_page=15', { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const logData = await logRes.json();
        logData.logs.forEach(entry => {
            const div = document.createElement('div');
            div.className = 'audit-entry';
            div.innerHTML = `
                <div class="audit-type ${entry.severity}">${entry.event_type.replace(/_/g, ' ')}</div>
                <div class="audit-detail">${entry.details || 'No details'}</div>
                <div class="audit-time">${new Date(entry.timestamp).toLocaleString()}</div>`;
            logContainer.appendChild(div);
        });
    } catch (e) { showToast('Failed to load security data', 'error'); }
}

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════
async function initApp() {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (storedToken && storedUser) {
        // Validate the stored token is still valid by checking with the server
        try {
            const res = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${storedToken}` }
            });
            if (!res.ok) {
                // Token expired or invalid — clear saved data and show login
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                console.log('[Auth] Saved session expired, showing login.');
                return;
            }
            const freshUser = await res.json();
            accessToken = storedToken;
            currentUser = freshUser;
            localStorage.setItem('user', JSON.stringify(currentUser));

            const storedKeys = await CryptoUtils.loadKeys(currentUser.id);
            if (storedKeys) userKeyPair = storedKeys;
            else {
                userKeyPair = await CryptoUtils.generateRSAKeyPair();
                await CryptoUtils.storeKeys(currentUser.id, userKeyPair);
            }
            showChat();
            initSocket();
            loadUsers();
            startAutoRefresh();
            showToast(`Welcome back, ${currentUser.display_name || currentUser.username}!`, 'success');
        } catch (e) {
            console.error('[Auth] Session restore failed:', e);
            localStorage.removeItem('token');
            localStorage.removeItem('user');
        }
    }
}

// Event listeners after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const msgInput = document.getElementById('message-input');
    if (msgInput) {
        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
        msgInput.addEventListener('input', () => {
            handleTypingInput();
            msgInput.style.height = 'auto';
            msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
        });
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', (e) => handleSearch(e.target.value));

    const pwdInput = document.getElementById('reg-password');
    if (pwdInput) pwdInput.addEventListener('input', (e) => updatePasswordMeter(e.target.value));

    // Initialize theme based on localStorage
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
    }
    initializeThemeIcon();

    initApp();
});

// ═══════════════════════════════════════
//  CUSTOM AUDIO PLAYER
// ═══════════════════════════════════════
let currentlyPlayingAudio = null;

function formatAudioTime(seconds) {
    if (seconds === Infinity || !seconds || isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
}

function initAudioPlayer(id) {
    const audio = document.getElementById(id);
    const timeEl = document.getElementById('time_' + id);
    if (!audio || !timeEl) return;
    
    audio.addEventListener('timeupdate', () => updateAudioPlayer(id));
    audio.addEventListener('ended', () => resetAudioPlayer(id));

    const checkDuration = () => {
        if (audio.duration === Infinity || isNaN(audio.duration)) {
            // Chrome MediaRecorder WebM duration bug workaround
            audio.currentTime = 1e101;
            audio.addEventListener('seeked', function calc() {
                audio.removeEventListener('seeked', calc);
                audio.currentTime = 0;
                timeEl.textContent = formatAudioTime(audio.duration);
            });
        } else if (isFinite(audio.duration)) {
            timeEl.textContent = formatAudioTime(audio.duration);
        }
    };

    if (audio.readyState >= 1) {
        checkDuration();
    } else {
        audio.addEventListener('loadedmetadata', checkDuration);
    }
}

function toggleAudioPlayer(id) {
    const audio = document.getElementById(id);
    const icon = document.getElementById('icon_' + id);
    if (!audio) return;
    
    if (currentlyPlayingAudio && currentlyPlayingAudio !== audio) {
        currentlyPlayingAudio.pause();
        const prevIcon = document.getElementById('icon_' + currentlyPlayingAudio.id);
        if (prevIcon) prevIcon.className = 'fa-solid fa-play';
        const prevPlayer = currentlyPlayingAudio.closest('.custom-audio-player');
        if (prevPlayer) prevPlayer.classList.remove('playing');
    }
    
    if (audio.paused) {
        audio.play().then(() => {
            icon.className = 'fa-solid fa-pause';
            currentlyPlayingAudio = audio;
            const player = audio.closest('.custom-audio-player');
            if (player) player.classList.add('playing');
        }).catch(e => console.error(e));
    } else {
        audio.pause();
        icon.className = 'fa-solid fa-play';
        currentlyPlayingAudio = null;
        const player = audio.closest('.custom-audio-player');
        if (player) player.classList.remove('playing');
    }
}

function updateAudioPlayer(id) {
    const audio = document.getElementById(id);
    const progress = document.getElementById('progress_' + id);
    const thumb = document.getElementById('thumb_' + id);
    const timeEl = document.getElementById('time_' + id);
    if (!audio || !progress || !thumb || !timeEl) return;
    
    if (audio.duration === Infinity || isNaN(audio.duration)) {
        timeEl.textContent = formatAudioTime(audio.currentTime);
        return;
    }
    
    const pct = (audio.currentTime / audio.duration) * 100 || 0;
    progress.style.width = pct + '%';
    thumb.style.left = pct + '%';
    timeEl.textContent = formatAudioTime(audio.currentTime);
}

function seekAudioPlayer(event, id) {
    const audio = document.getElementById(id);
    if (!audio || !isFinite(audio.duration) || audio.duration === Infinity) return;
    const container = event.currentTarget;
    const rect = container.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    audio.currentTime = pct * audio.duration;
}

function resetAudioPlayer(id) {
    const icon = document.getElementById('icon_' + id);
    const audio = document.getElementById(id);
    const progress = document.getElementById('progress_' + id);
    const thumb = document.getElementById('thumb_' + id);
    
    if (icon) icon.className = 'fa-solid fa-play';
    if (progress) progress.style.width = '0%';
    if (thumb) thumb.style.left = '0%';
    if (audio) {
        const player = audio.closest('.custom-audio-player');
        if (player) player.classList.remove('playing');
        const timeEl = document.getElementById('time_' + id);
        if (timeEl && isFinite(audio.duration)) {
            timeEl.textContent = formatAudioTime(audio.duration);
        }
    }
    if (currentlyPlayingAudio === audio) currentlyPlayingAudio = null;
}
// ═══════════════════════════════════════
//  IMAGE PREVIEW MODAL
// ═══════════════════════════════════════
function openImagePreview(imgId) {
    const imgEl = document.getElementById(imgId);
    if (!imgEl) return;
    const src = imgEl.src;
    const alt = imgEl.alt || 'Image';

    // Remove any existing preview
    closeImagePreview();

    const overlay = document.createElement('div');
    overlay.id = 'image-preview-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:10000;display:flex;align-items:center;justify-content:center;flex-direction:column;cursor:zoom-out;animation:fadeIn 0.2s ease;';
    overlay.onclick = (e) => { if (e.target === overlay) closeImagePreview(); };

    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.style.cssText = 'max-width:90%;max-height:80vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);object-fit:contain;cursor:default;';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'margin-top:16px;display:flex;gap:16px;align-items:center;';

    const downloadBtn = document.createElement('a');
    downloadBtn.href = src;
    downloadBtn.download = alt;
    downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> Download';
    downloadBtn.style.cssText = 'color:#fff;background:var(--accent, #6c63ff);padding:8px 20px;border-radius:20px;text-decoration:none;font-size:0.85rem;cursor:pointer;';

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Close';
    closeBtn.style.cssText = 'color:#fff;background:rgba(255,255,255,0.15);border:none;padding:8px 20px;border-radius:20px;font-size:0.85rem;cursor:pointer;';
    closeBtn.onclick = closeImagePreview;

    toolbar.appendChild(downloadBtn);
    toolbar.appendChild(closeBtn);
    overlay.appendChild(img);
    overlay.appendChild(toolbar);
    document.body.appendChild(overlay);

    // Close on Escape key
    document.addEventListener('keydown', handlePreviewEsc);
}

function handlePreviewEsc(e) {
    if (e.key === 'Escape') closeImagePreview();
}

function closeImagePreview() {
    const overlay = document.getElementById('image-preview-overlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', handlePreviewEsc);
}

// ═══════════════════════════════════════
//  STARTUP
// ═══════════════════════════════════════
// initApp is already called in the first DOMContentLoaded listener
