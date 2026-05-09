
// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: GROUP MANAGEMENT, ONLINE STATUS & ADMIN FEATURES
// ═══════════════════════════════════════════════════════════════════════════

let currentGroup = null;
let groups = [];
let groupMessages = {};
let groupMembers = {};

// Load user's groups - Phase 1
async function loadGroups() {
    try {
        const res = await fetch('/api/groups/my_groups', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        groups = await res.json();
        renderGroupsList();
    } catch (e) {
        showToast('Failed to load groups', 'error');
    }
}

// Render groups list in sidebar - Phase 1
function renderGroupsList() {
    const list = document.getElementById('groups-list');
    if (!list) return;
    list.innerHTML = '';
    
    groups.forEach(group => {
        const isActive = currentGroup && currentGroup.id === group.id;
        const div = document.createElement('div');
        div.className = `contact-item${isActive ? ' active' : ''}`;
        div.onclick = () => selectGroup(group);
        div.innerHTML = `
            <div style="position:relative;">
                <div class="avatar-sm" style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);">${group.name[0].toUpperCase()}</div>
            </div>
            <div style="flex:1;overflow:hidden;">
                <div class="contact-name">${escapeHtml(group.name)}</div>
                <div class="contact-preview">${group.member_count} members</div>
            </div>`;
        list.appendChild(div);
    });
}

// Select group - Phase 1
async function selectGroup(group) {
    currentGroup = group;
    currentRecipient = null; // Clear private chat
    
    document.getElementById('empty-chat-state').classList.add('hidden');
    document.getElementById('chat-header-bar').classList.remove('hidden');
    document.getElementById('message-input-area').classList.remove('hidden');
    
    // Update header for group
    const name = group.name;
    document.getElementById('chat-user-avatar').textContent = name[0].toUpperCase();
    document.getElementById('chat-user-name').textContent = escapeHtml(name);
    document.getElementById('chat-user-status').textContent = `${group.member_count} members`;
    
    // Load group members - Phase 1
    await loadGroupMembers(group.id);
    
    // Load group messages
    await loadGroupMessageHistory(group.id);
    renderMessages();
    
    // Join group room via WebSocket
    socket.emit('join_group', { group_id: group.id });
}

// Load group members with roles and status - Phase 1
async function loadGroupMembers(groupId) {
    try {
        const res = await fetch(`/api/groups/${groupId}/members`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        groupMembers[groupId] = await res.json();
        renderGroupMembers(groupId);
    } catch (e) {
        showToast('Failed to load group members', 'error');
    }
}

// Render group members sidebar - Phase 1
function renderGroupMembers(groupId) {
    const membersPanel = document.getElementById('group-members-panel');
    if (!membersPanel) return;
    
    const members = groupMembers[groupId] || [];
    membersPanel.innerHTML = '<h4 style="padding:12px;border-bottom:1px solid var(--border);">Members</h4>';
    
    members.forEach(member => {
        const div = document.createElement('div');
        div.className = 'group-member-item';
        const statusIcon = member.is_online 
            ? '<i class="fa-solid fa-circle" style="color:#22c55e;font-size:8px;margin-right:4px;"></i>' 
            : '<i class="fa-solid fa-circle" style="color:#9ca3af;font-size:8px;margin-right:4px;"></i>';
        const roleLabel = member.role === 'creator' ? '👑' : member.role === 'admin' ? '🔐' : '';
        
        div.innerHTML = `
            <div style="display:flex;align-items:center;padding:8px 12px;">
                <div class="avatar-xs">${member.username[0].toUpperCase()}</div>
                <div style="flex:1;margin-left:8px;min-width:0;">
                    <div style="font-size:0.85rem;font-weight:500;display:flex;align-items:center;">
                        ${statusIcon}
                        <span>${escapeHtml(member.username)}</span>
                        <span style="margin-left:4px;">${roleLabel}</span>
                    </div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">${member.is_online ? 'Online' : 'Offline'}</div>
                </div>
                ${member.role === 'admin' || member.role === 'creator' ? 
                    `<button class="btn-icon" onclick="showMemberOptions(${member.user_id}, ${groupId})" title="Options">
                        <i class="fa-solid fa-ellipsis-v"></i>
                    </button>` : ''
                }
            </div>`;
        membersPanel.appendChild(div);
    });
}

// Show member options modal - Phase 1
function showMemberOptions(memberId, groupId) {
    // TODO: Implement role change, remove member UI
    console.log(`Member options for ${memberId} in group ${groupId}`);
}

// Create new group - Phase 1
async function createNewGroup() {
    const groupName = prompt('Enter group name:');
    if (!groupName) return;
    
    try {
        const res = await fetch('/api/groups/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify({ 
                name: groupName,
                description: '',
                members: []
            })
        });
        
        if (res.ok) {
            const data = await res.json();
            showToast('Group created!', 'success');
            await loadGroups();
            selectGroup(data.group);
        } else {
            const err = await res.json();
            showToast(err.message, 'error');
        }
    } catch (e) {
        showToast('Failed to create group', 'error');
    }
}

// Load group message history - Phase 1 & 3
async function loadGroupMessageHistory(groupId) {
    try {
        const res = await fetch(`/api/messages/${groupId}/group?per_page=100`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const data = await res.json();
        groupMessages[groupId] = data.messages || [];
    } catch (e) {
        groupMessages[groupId] = [];
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: TYPING INDICATORS
// ═══════════════════════════════════════════════════════════════════════════

let typingTimeout2 = null;
let isTyping = false;

// Send typing indicator when user starts typing - Phase 2
function onGroupMessageInput() {
    if (!currentGroup) return;
    
    if (!isTyping) {
        isTyping = true;
        socket.emit('typing_start', { group_id: currentGroup.id });
    }
    
    clearTimeout(typingTimeout2);
    typingTimeout2 = setTimeout(() => {
        isTyping = false;
        socket.emit('typing_stop', { group_id: currentGroup.id });
    }, 3000);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: MESSAGE REACTIONS & QUOTED REPLIES
// ═══════════════════════════════════════════════════════════════════════════

let selectedMessageForReply = null;

// Show emoji picker for reactions - Phase 3
function showReactionPicker(messageId) {
    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '✨', '🎉'];
    let html = '<div class="emoji-picker">';
    emojis.forEach(emoji => {
        html += `<button class="emoji-btn" onclick="addReaction(${messageId}, '${emoji}')">${emoji}</button>`;
    });
    html += '</div>';
    
    const div = document.createElement('div');
    div.className = 'reaction-picker';
    div.innerHTML = html;
    document.body.appendChild(div);
    
    setTimeout(() => div.remove(), 5000);
}

// Add emoji reaction to message - Phase 3
async function addReaction(messageId, emoji) {
    if (!currentGroup) return;
    
    try {
        const res = await fetch(`/api/messages/${messageId}/react`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify({ emoji })
        });
        
        if (res.ok) {
            // Update local message and re-render
            await loadGroupMessageHistory(currentGroup.id);
            renderMessages();
        }
    } catch (e) {
        console.error('Failed to add reaction', e);
    }
}

// Remove reaction from message - Phase 3
async function removeReaction(messageId, emoji) {
    try {
        const res = await fetch(`/api/messages/${messageId}/reactions/${emoji}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (res.ok) {
            await loadGroupMessageHistory(currentGroup.id);
            renderMessages();
        }
    } catch (e) {
        console.error('Failed to remove reaction', e);
    }
}

// Reply to specific message - Phase 3
function replyToMessage(messageId) {
    selectedMessageForReply = messageId;
    const input = document.getElementById('group-message-input');
    if (input) {
        input.placeholder = `Replying to message #${messageId}...`;
        input.focus();
    }
}

// Clear reply selection - Phase 3
function clearReply() {
    selectedMessageForReply = null;
    const input = document.getElementById('group-message-input');
    if (input) {
        input.placeholder = 'Type a message...';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: MENTIONS & NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

// Parse mentions in message text - Phase 4
function parseMentions(text) {
    const regex = /@(\w+)/g;
    const mentions = [];
    let match;
    
    while ((match = regex.exec(text)) !== null) {
        const username = match[1];
        const member = groupMembers[currentGroup.id]?.find(m => m.username === username);
        if (member) {
            mentions.push(member.user_id);
        }
    }
    
    return mentions;
}

// Send group message with mentions and reactions support - Phase 1-4
async function sendGroupMessage() {
    if (!currentGroup) return;
    
    const input = document.getElementById('group-message-input');
    const text = input.value.trim();
    if (!text) return;
    
    try {
        // Get all group members' public keys
        const members = groupMembers[currentGroup.id] || [];
        const mentions = parseMentions(text);
        
        // Encrypt message for each member
        const aesKey = await CryptoUtils.generateAESKey();
        const rawAesKey = await CryptoUtils.exportAESKey(aesKey);
        const encryptedMsg = await CryptoUtils.encryptMessage(text, aesKey);
        
        const encrypted_keys = {};
        for (const member of members) {
            if (member.user_id === currentUser.id) continue; // Skip self
            
            const memberPubKey = await CryptoUtils.importPublicKey(member.public_key || currentUser.public_key);
            encrypted_keys[member.user_id] = await CryptoUtils.encryptAESKeyWithRSA(rawAesKey, memberPubKey);
        }
        
        // Also encrypt for self
        const selfEncKey = await CryptoUtils.encryptAESKeyWithRSA(rawAesKey, userKeyPair.publicKey);
        encrypted_keys[currentUser.id] = selfEncKey;
        
        socket.emit('send_message', {
            sender_id: currentUser.id,
            group_id: currentGroup.id,
            message: encryptedMsg,
            encrypted_keys: encrypted_keys,
            quoted_message_id: selectedMessageForReply,  // Phase 3
            mentions: mentions  // Phase 4
        });
        
        input.value = '';
        input.style.height = 'auto';
        clearReply();
        renderMessages();
        
    } catch (e) {
        console.error('Failed to send group message', e);
        showToast('Failed to send message', 'error');
    }
}

// Update notification preferences for group - Phase 4
async function updateGroupNotifications(groupId, level) {
    // 'all', 'mentions_only', 'muted'
    try {
        const res = await fetch(`/api/groups/${groupId}/notification-level`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify({ notification_level: level })
        });
        
        if (res.ok) {
            showToast(`Notifications set to: ${level}`, 'success');
        }
    } catch (e) {
        showToast('Failed to update notifications', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SOCKET.IO EVENTS FOR GROUPS (Phases 1-4)
// ═══════════════════════════════════════════════════════════════════════════

// Add these to initSocket() function:

// Listen for user status changes in group - Phase 1
function setupGroupSocketEvents() {
    if (!socket) return;
    
    // User online/offline status - Phase 1
    socket.on('user_status_changed', (data) => {
        if (currentGroup) {
            const member = groupMembers[currentGroup.id]?.find(m => m.user_id === data.user_id);
            if (member) {
                member.is_online = data.is_online;
                member.last_seen = data.last_seen;
                renderGroupMembers(currentGroup.id);
            }
        }
    });
    
    // Typing indicators - Phase 2
    socket.on('users_typing', (data) => {
        if (currentGroup && currentGroup.id === data.group_id) {
            const typingDiv = document.getElementById('group-typing-indicator');
            if (typingDiv) {
                if (data.typing_users.length > 0) {
                    const typingUsernames = data.typing_users
                        .map(uid => groupMembers[currentGroup.id]?.find(m => m.user_id === uid)?.username || `User ${uid}`)
                        .join(', ');
                    typingDiv.innerHTML = `<small style="color:var(--text-muted);">${typingUsernames} ${data.typing_users.length === 1 ? 'is' : 'are'} typing...</small>`;
                } else {
                    typingDiv.innerHTML = '';
                }
            }
        }
    });
    
    // User joined group - Phase 1
    socket.on('user_joined_group', (data) => {
        if (currentGroup && currentGroup.id === data.group_id) {
            showToast(`${data.username} joined the group`, 'info');
            loadGroupMembers(currentGroup.id);
        }
    });
}

// Attach group socket events after socket init
function initSocket() {
    // ... existing socket.io setup ...
    setupGroupSocketEvents();
}
