/* =============================================
   ChatWave — Client-side Socket.IO & UI Logic
   ============================================= */

const { currentUser, allUsers } = window.CHAT_CONFIG;
const socket = io();

// ─── DOM References ───────────────────────────
const messagesContainer = document.getElementById('messages-container');
const messageInput      = document.getElementById('messageInput');
const sendBtn           = document.getElementById('sendBtn');
const fileInput         = document.getElementById('fileInput');
const typingIndicator   = document.getElementById('typing-indicator');

// Sidebar
const tabChats          = document.getElementById('tab-chats');
const tabUsers          = document.getElementById('tab-users');
const chatsSection      = document.getElementById('chats-section');
const usersSection      = document.getElementById('users-section');
const activeChatsList   = document.getElementById('activeChatsList');
const onlineUsersList   = document.getElementById('onlineUsersList');
const onlineCount       = document.getElementById('onlineCount');

// Header
const headerAvatar      = document.getElementById('header-avatar');
const headerName        = document.getElementById('header-name');
const memberCount       = document.getElementById('memberCount');
const groupSettingsBtn  = document.getElementById('group-settings-btn');
const initialEmptyState = document.getElementById('initial-empty-state');

// Modals
const groupModal        = document.getElementById('group-modal');
const groupNameInput    = document.getElementById('group-name-input');
const groupUserList     = document.getElementById('group-user-list');

const manageGroupModal  = document.getElementById('group-manage-modal');
const manageGroupName   = document.getElementById('manage-group-name');
const manageMembersList = document.getElementById('manage-members-list');
const adminAddSection   = document.getElementById('admin-add-section');
const addMemberSelect   = document.getElementById('add-member-select');

// Upload UI
const uploadPreview     = document.getElementById('uploadPreview');
const uploadFileName    = document.getElementById('uploadFileName');
const removeFile        = document.getElementById('removeFile');
const uploadProgress    = document.getElementById('uploadProgress');
const progressBar       = document.getElementById('progressBar');
const progressText      = document.getElementById('progressText');
const lightbox          = document.getElementById('lightbox');
const lightboxImg       = document.getElementById('lightboxImg');
const lightboxClose     = document.getElementById('lightboxClose');
const toastContainer    = document.getElementById('toastContainer');

const deleteModal       = document.getElementById('delete-msg-modal');
const deleteMeBtn       = document.getElementById('delete-me-btn');
const deleteEveryoneBtn = document.getElementById('delete-everyone-btn');

// State
let selectedFile   = null;
let typingTimeout  = null;
let isTyping       = false;
let activeChat     = null; // The currently selected Chat object
let myChats        = []; // List of fetched chats
let onlineUserMap  = new Map(); // socket.id -> user obj

// Edit/Delete state
let editingMsgId   = null;
let deletingMsgId  = null;
let isEditMode     = false;

// ─── Socket Events (Global) ───────────────────
socket.on('userUpdated', (data) => {
  // Update local currentUser if it's us
  if (data.userId === currentUser._id) {
    currentUser.avatar = data.avatar;
    currentUser.username = data.username;
    
    // Update Sidebar current user card
    const sidebarAvatar = document.getElementById('sidebar-avatar');
    const sidebarName   = document.getElementById('sidebar-name');
    if (sidebarAvatar) {
      if (data.avatar) {
        sidebarAvatar.innerHTML = `<img src="${data.avatar}" alt="Avatar" /><div class="online-dot"></div>`;
      } else {
        sidebarAvatar.innerHTML = `${getInitial(data.username)}<div class="online-dot"></div>`;
      }
    }
    if (sidebarName) sidebarName.textContent = data.username;
  }

  // 1. Update allUsers array
  const user = allUsers.find(u => u._id === data.userId);
  if (user) {
    user.avatar = data.avatar;
    user.username = data.username;
  }

  // 2. Update myChats array (populate correct avatars for 1-1 chats)
  myChats.forEach(chat => {
    const member = chat.users.find(u => u._id === data.userId);
    if (member) {
      member.avatar = data.avatar;
      member.username = data.username;
    }
  });

  // 3. Update activeChat if it's the one being viewed
  if (activeChat) {
    const member = activeChat.users.find(u => u._id === data.userId);
    if (member) {
      member.avatar = data.avatar;
      member.username = data.username;
      
      // Re-trigger header update if we are currently looking at this user
      if (!activeChat.isGroupChat && member._id !== currentUser._id) {
        const chatAvatar = getChatAvatar(activeChat);
        const chatName   = getChatName(activeChat);
        headerName.textContent = chatName;
        headerAvatar.innerHTML = chatAvatar ? `<img src="${chatAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : getInitial(chatName);
        headerAvatar.style.background = chatAvatar ? 'transparent' : stringToColor(chatName);
      }
    }
  }

  // 4. Refresh List UIs
  renderChatsList();
  renderAllUsersTab();
});

socket.on('chatRead', ({ chatId, userId }) => {
  if (activeChat && activeChat._id === chatId && userId !== currentUser._id) {
    // Current user's sent messages in this chat should turn blue
    document.querySelectorAll('.message-wrapper.sent .tick').forEach(tick => {
      tick.classList.add('read');
      tick.innerHTML = '<i class="fa-solid fa-check-double"></i>';
    });
  }
});

socket.on('messageStatusUpdate', ({ messageId, deliveredTo, readBy }) => {
  const msgWrap = document.getElementById(`msg-${messageId}`);
  if (msgWrap && msgWrap.classList.contains('sent')) {
    const tick = msgWrap.querySelector('.tick');
    if (tick) {
      const isRead = readBy.length > 1;
      const isDelivered = deliveredTo.length > 1;
      
      if (isRead) {
        tick.className = 'tick read';
        tick.innerHTML = '<i class="fa-solid fa-check-double"></i>';
      } else if (isDelivered) {
        tick.className = 'tick delivered';
        tick.innerHTML = '<i class="fa-solid fa-check-double"></i>';
      }
    }
  }
});

socket.on('messageEdited', (data) => {
  const msgWrap = document.getElementById(`msg-${data._id}`);
  if (msgWrap) {
    // Re-render the message bubble with new content/isEdited flag
    const parent = msgWrap.parentNode;
    const newMsgNode = buildMessage(data);
    parent.replaceChild(newMsgNode, msgWrap);
  }
});

socket.on('messageDeletedEveryone', ({ messageId }) => {
  const msgWrap = document.getElementById(`msg-${messageId}`);
  if (msgWrap) {
    const bubbleGroup = msgWrap.querySelector('.msg-bubble-group');
    if (bubbleGroup) {
      // Clear content and show deleted state
      bubbleGroup.innerHTML = `
        <div class="msg-bubble deleted"><i class="fa-solid fa-ban"></i> This message was deleted</div>
        <div class="msg-status">
          <span class="msg-time">${formatTime()}</span>
        </div>
      `;
    }
    // Remove options button
    const optBtn = msgWrap.querySelector('.msg-options-btn');
    if (optBtn) optBtn.remove();
  }
});

socket.on('messageDeletedMe', ({ messageId }) => {
  const msgWrap = document.getElementById(`msg-${messageId}`);
  if (msgWrap) msgWrap.remove();
});

// ─── Helpers ──────────────────────────────────
function getInitial(name) { return (name || '?').charAt(0).toUpperCase(); }
function formatTime(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.classList.add('toast', type);
  const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
  toast.innerHTML = `<i class="fa-solid ${icons[type]}"></i> ${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}
function scrollToBottom(smooth = true) {
  messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}
function stringToColor(str) {
  const colors = ['#7c3aed','#2563eb','#059669','#dc2626','#d97706','#9333ea','#0891b2','#65a30d','#e11d48','#7c2d12'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function getChatName(chat) {
  if (chat.isGroupChat) return chat.chatName;
  const otherUser = chat.users.find(u => u._id !== currentUser._id);
  return otherUser ? otherUser.username : "Unknown User";
}

function getChatAvatar(chat) {
  if (chat.isGroupChat) return null;
  const otherUser = chat.users.find(u => u._id !== currentUser._id);
  return otherUser ? otherUser.avatar : null;
}

// ─── Initial Data Setup ───────────────────────
async function fetchChats() {
  try {
    const res = await fetch('/api/chats');
    myChats = await res.json();
    renderChatsList();
  } catch(e) { console.error('Error fetching chats'); }
}

// Render "Chats" Tab
function renderChatsList() {
  activeChatsList.innerHTML = '';
  myChats.forEach(chat => {
    const chatName = getChatName(chat);
    const chatAvatar = getChatAvatar(chat);
    
    const li = document.createElement('li');
    li.classList.add('user-item');
    if (activeChat && activeChat._id === chat._id) li.classList.add('active');

    const lastMsgNode = chat.latestMessage ? `<div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;">${escapeHTML(chat.latestMessage.content)}</div>` : '';

    const icon = chat.isGroupChat 
      ? '<i class="fa-solid fa-users"></i>' 
      : (chatAvatar ? `<img src="${chatAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : getInitial(chatName));

    const unreadNode = chat.unreadCount > 0 ? `<div class="unread-badge">${chat.unreadCount}</div>` : '';

    li.innerHTML = `
      <div class="avatar sm" style="background: ${chat.isGroupChat ? 'var(--bg-tertiary)' : (chatAvatar ? 'transparent' : stringToColor(chatName))}">
        ${icon}
      </div>
      <div class="user-info w-100" style="overflow:hidden; display: flex; justify-content: space-between; align-items: center;">
        <div style="flex: 1; overflow: hidden;">
          <div class="username">${escapeHTML(chatName)}</div>
          ${lastMsgNode}
        </div>
        ${unreadNode}
      </div>
    `;
    li.addEventListener('click', () => loadChat(chat));
    activeChatsList.appendChild(li);
  });
}

// Render "Users" Tab (List of all registered users + online status if available)
function renderAllUsersTab() {
  onlineUsersList.innerHTML = '';
  let onlineCountNum = 0;

  // Track who is online by their DB _id
  const onlineDBIds = new Set();
  onlineUserMap.forEach(u => onlineDBIds.add(u.userId));

  allUsers.forEach(u => {
    const isOnline = onlineDBIds.has(u._id) || u.isOnline;
    if (isOnline) onlineCountNum++;

    const li = document.createElement('li');
    li.classList.add('user-item');
    
    const icon = u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : getInitial(u.username);

    li.innerHTML = `
      <div class="avatar sm" style="background: ${u.avatar ? 'transparent' : stringToColor(u.username)}">
        ${icon}
        ${isOnline ? '<div class="online-dot"></div>' : ''}
      </div>
      <div class="user-info">
        <div class="username">${escapeHTML(u.username)}</div>
        <div class="user-status ${!isOnline ? 'offline' : ''}">${isOnline ? '● Active now' : 'Offline'}</div>
      </div>
    `;
    li.addEventListener('click', () => startDirectChat(u._id));
    onlineUsersList.appendChild(li);
  });

  onlineCount.textContent = onlineCountNum;
}

// Switch Sidebar Tabs
tabChats.addEventListener('click', () => {
  tabChats.classList.add('active'); tabUsers.classList.remove('active');
  chatsSection.classList.remove('hidden'); usersSection.classList.add('hidden');
});
tabUsers.addEventListener('click', () => {
  tabUsers.classList.add('active'); tabChats.classList.remove('active');
  usersSection.classList.remove('hidden'); chatsSection.classList.add('hidden');
  renderAllUsersTab();
});

// ─── Chat Actions ─────────────────────────────
async function startDirectChat(userId) {
  try {
    const res = await fetch('/api/chats/direct', {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });
    const chatData = await res.json();
    if (!myChats.find(c => c._id === chatData._id)) myChats.unshift(chatData);
    
    // Switch to chats tab
    tabChats.click();
    loadChat(chatData);
  } catch (err) { showToast('Error opening chat', 'error'); }
}

async function loadChat(chat) {
  activeChat = chat;
  socket.emit("joinChat", chat._id);
  renderChatsList(); // Updates active class
  
  const chatName = getChatName(chat);
  const chatAvatar = getChatAvatar(chat);

  headerName.textContent = chatName;
  headerAvatar.innerHTML = chat.isGroupChat 
    ? '<i class="fa-solid fa-users"></i>' 
    : (chatAvatar ? `<img src="${chatAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : getInitial(chatName));
  
  headerAvatar.style.background = chat.isGroupChat 
    ? 'var(--bg-tertiary)' 
    : (chatAvatar ? 'transparent' : stringToColor(chatName));

  if (chat.isGroupChat) {
    groupSettingsBtn.classList.remove('hidden');
    memberCount.textContent = chat.users.length + ' members';
  } else {
    groupSettingsBtn.classList.add('hidden');
    memberCount.textContent = 'Private Chat';
  }

  if (initialEmptyState) initialEmptyState.remove();
  messagesContainer.innerHTML = '';
  
  // Reset edit mode when changing chats
  isEditMode = false;
  editingMsgId = null;
  messageInput.value = '';
  messageInput.placeholder = `Message ${chatName}...`;
  messageInput.style.height = 'auto';

  // Notify server we are reading this chat
  socket.emit('readChat', { chatId: chat._id, userId: currentUser._id });

  // Fetch messages
  try {
    const res = await fetch(`/api/chats/${chat._id}/messages`);
    const messages = await res.json();
    messages.forEach(m => messagesContainer.appendChild(buildMessage(m)));
    scrollToBottom();
  } catch (err) { console.error('Failed to load messages'); }
}

// ─── Group Creation ───────────────────────────
document.getElementById('create-group-btn').addEventListener('click', () => {
  groupModal.classList.remove('hidden');
  groupNameInput.value = '';
  groupUserList.innerHTML = '';
  
  // Populate users to select
  allUsers.forEach(u => {
    const div = document.createElement('div');
    div.classList.add('user-select-item');
    div.innerHTML = `
      <input type="checkbox" id="user-cb-${u._id}" value="${u._id}" />
      <div class="avatar sm" style="background: ${stringToColor(u.username)}">${getInitial(u.username)}</div>
      <label class="user-select-name" for="user-cb-${u._id}">${escapeHTML(u.username)}</label>
    `;
    groupUserList.appendChild(div);
  });
});
window.closeGroupModal = () => groupModal.classList.add('hidden');

window.submitCreateGroup = async () => {
  const name = groupNameInput.value.trim();
  const checkboxes = groupUserList.querySelectorAll('input:checked');
  const selectedUsers = Array.from(checkboxes).map(c => c.value);

  if (!name || selectedUsers.length < 1) {
    return showToast('Name and at least 1 other user required.', 'error');
  }

  try {
    const res = await fetch('/api/chats/group/create', {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, users: JSON.stringify(selectedUsers) })
    });
    const groupChat = await res.json();
    myChats.unshift(groupChat);
    closeGroupModal();
    loadChat(groupChat);
    showToast('Group created!', 'success');
  } catch (err) { showToast('Group creation failed', 'error'); }
};

// ─── Group Management ─────────────────────────
groupSettingsBtn.addEventListener('click', () => {
  if (!activeChat || !activeChat.isGroupChat) return;
  manageGroupModal.classList.remove('hidden');
  manageGroupName.textContent = activeChat.chatName;
  manageMembersList.innerHTML = '';

  const isAdmin = activeChat.groupAdmin && activeChat.groupAdmin._id === currentUser._id;
  
  if (isAdmin) {
    adminAddSection.classList.remove('hidden');
    addMemberSelect.innerHTML = '<option value="">Select a user...</option>';
    allUsers.forEach(u => {
      // Don't show users already in group
      if (!activeChat.users.find(member => member._id === u._id)) {
        addMemberSelect.innerHTML += `<option value="${u._id}">${escapeHTML(u.username)}</option>`;
      }
    });
  } else {
    adminAddSection.classList.add('hidden');
  }

  activeChat.users.forEach(u => {
    const isAdminUser = activeChat.groupAdmin._id === u._id;
    const isMe = u._id === currentUser._id;
    const li = document.createElement('li');
    li.classList.add('user-select-item');
    
    const icon = u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : getInitial(u.username);

    li.innerHTML = `
      <div class="avatar sm" style="background: ${u.avatar ? 'transparent' : stringToColor(u.username)}">${icon}</div>
      <div class="user-select-name" style="flex:1;">${escapeHTML(u.username)} ${isAdminUser ? '<span style="color:var(--accent); font-size:10px;">[Admin]</span>' : ''}</div>
      ${isAdmin && !isAdminUser ? `<button class="btn-primary" style="background:var(--danger); padding:4px 8px; font-size:11px; width:auto;" onclick="removeMember('${u._id}')">Remove</button>` : ''}
    `;
    manageMembersList.appendChild(li);
  });
});
window.closeManageGroupModal = () => manageGroupModal.classList.add('hidden');

window.adminAddMember = async () => {
  const userId = addMemberSelect.value;
  if(!userId) return;
  try {
    const res = await fetch('/api/chats/group/add', {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: activeChat._id, userId })
    });
    activeChat = await res.json();
    showToast('Member added', 'success');
    closeManageGroupModal();
    loadChat(activeChat); // refresh visually
  } catch (err) { showToast('Failed to add member', 'error'); }
};

window.removeMember = async (userId) => {
  try {
    const res = await fetch('/api/chats/group/remove', {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: activeChat._id, userId })
    });
    activeChat = await res.json();
    showToast('Member removed', 'success');
    closeManageGroupModal();
    loadChat(activeChat);
  } catch(e) { showToast('Failed to remove member', 'error'); }
};

window.leaveGroup = async () => {
  try {
    await fetch('/api/chats/group/remove', {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: activeChat._id, userId: currentUser._id })
    });
    showToast('Left group', 'info');
    closeManageGroupModal();
    activeChat = null;
    headerName.textContent = 'Select a chat';
    messagesContainer.innerHTML = '';
    fetchChats();
  } catch(e) { showToast('Failed to leave', 'error'); }
};

// ─── Messaging Logic ──────────────────────────
function buildMessage(data) {
  // 0. Handle System Messages (Calls, etc)
  if (data.messageType === 'system') {
    const wrapper = document.createElement('div');
    wrapper.classList.add('message-wrapper', 'system');
    wrapper.id = `msg-${data._id}`;
    
    let icon = '<i class="fa-solid fa-circle-info"></i>';
    if (data.content.includes('Video call')) icon = '<i class="fa-solid fa-video"></i>';
    else if (data.content.includes('Voice call') || data.content.includes('call')) icon = '<i class="fa-solid fa-phone"></i>';

    wrapper.innerHTML = `
      <div class="msg-system-bubble call">
        ${icon} <span>${escapeHTML(data.content)}</span>
      </div>
    `;
    return wrapper;
  }

  const isSent = (data.senderId && (data.senderId._id === currentUser._id)) || (data.senderId === currentUser._id);
  const senderName = data.senderId.username || data.sender;
  const wrapClass = isSent ? 'sent' : 'received';
  const time = formatTime(data.createdAt);
  
  // Use the actual avatar if available, otherwise get initial
  const senderAvatar = data.senderId.avatar || null;
  const avatarImage = senderAvatar 
    ? `<img src="${senderAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` 
    : getInitial(senderName);

  let contentHTML = '';
  
  // 1. Handle Deleted Everyone
  if (data.isDeletedEveryone) {
    contentHTML = `<div class="msg-bubble deleted"><i class="fa-solid fa-ban"></i> This message was deleted</div>`;
  } 
  // 2. Handle Normal Messages
  else if (data.messageType === 'image') {
    contentHTML = `<img src="${data.mediaUrl}" alt="image" class="msg-image" onclick="openLightbox('${data.mediaUrl}')" />`;
  } else if (data.messageType === 'file') {
    contentHTML = `
      <a href="${data.mediaUrl}" download="${data.mediaName}" class="msg-file">
        <div class="msg-file-icon"><i class="fa-solid fa-file"></i></div>
        <div class="msg-file-info">
          <div class="file-name">${escapeHTML(data.mediaName)}</div>
          <div class="file-label">Click to download</div>
        </div>
      </a>`;
  } else {
    contentHTML = `<div class="msg-bubble">${escapeHTML(data.content)}</div>`;
  }

  // Options Menu
  let optionsHtml = '';
  if (!data.isDeletedEveryone) {
    if (isSent) {
      optionsHtml = `
        <div class="msg-options-btn" onclick="toggleMsgDropdown(event, '${data._id}')">
          <i class="fa-solid fa-ellipsis-vertical"></i>
          <div class="msg-dropdown" id="dropdown-${data._id}">
            <div class="msg-dropdown-item" onclick="requestEdit('${data._id}', this)">
              <i class="fa-solid fa-pen"></i> Edit
            </div>
            <div class="msg-dropdown-item delete" onclick="requestDelete('${data._id}')">
              <i class="fa-solid fa-trash"></i> Delete
            </div>
          </div>
        </div>
      `;
    } else {
      // Receiver can only delete for themselves
      optionsHtml = `
        <div class="msg-options-btn" onclick="toggleMsgDropdown(event, '${data._id}')">
          <i class="fa-solid fa-ellipsis-vertical"></i>
          <div class="msg-dropdown" id="dropdown-${data._id}">
            <div class="msg-dropdown-item delete" onclick="requestDelete('${data._id}')">
              <i class="fa-solid fa-trash"></i> Delete
            </div>
          </div>
        </div>
      `;
    }
  }

  const senderNameHTML = !isSent ? `<div class="msg-sender-name">${escapeHTML(senderName)}</div>` : '';
  const avatarHtml = `<div class="msg-avatar" style="background:${senderAvatar ? 'transparent' : (isSent ? '#5b21b6' : stringToColor(senderName))}">${avatarImage}</div>`;

  const wrapper = document.createElement('div');
  wrapper.classList.add('message-wrapper', wrapClass);
  wrapper.id = `msg-${data._id}`;
  
  // Tick logic & Edited Badge
  let statusHtml = '';
  const editedBadge = data.isEdited ? `<span class="msg-edited-badge">Edited</span>` : '';

  if (isSent) {
    const isRead = data.readBy && data.readBy.length > 1;
    const isDelivered = data.deliveredTo && data.deliveredTo.length > 1;
    
    let tickClass = isRead ? 'tick read' : 'tick';
    let icon = isRead || isDelivered ? '<i class="fa-solid fa-check-double"></i>' : '<i class="fa-solid fa-check"></i>';
    
    statusHtml = `
      <div class="msg-status">
        ${editedBadge}
        <span class="msg-time">${time}</span>
        <span class="${tickClass}">${icon}</span>
      </div>
    `;
  } else {
    statusHtml = `<div class="msg-status">${editedBadge}<span class="msg-time">${time}</span></div>`;
  }

  wrapper.innerHTML = `
    ${!isSent ? avatarHtml : ''}
    <div class="msg-bubble-group">
      ${senderNameHTML}
      ${contentHTML}
      ${statusHtml}
      ${optionsHtml}
    </div>
    ${isSent ? avatarHtml : ''}
  `;
  return wrapper;
}

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';

  if (!activeChat) return;
  socket.emit('typing', { username: currentUser.username, chatId: activeChat._id, isTyping: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', { username: currentUser.username, chatId: activeChat._id, isTyping: false });
  }, 1500);
});

// Auto send on enter key
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (selectedFile) uploadFile();
    else sendTextMessage();
  }
});

sendBtn.addEventListener('click', () => {
  if (!activeChat) return showToast('Please select a chat first.', 'error');
  if (selectedFile) uploadFile();
  else sendTextMessage();
});

function sendTextMessage() {
  const content = messageInput.value.trim();
  if (!content || !activeChat) return;

  if (isEditMode && editingMsgId) {
    socket.emit('editMessage', {
      messageId: editingMsgId,
      content,
      chatId: activeChat._id,
      userId: currentUser._id
    });
    isEditMode = false;
    editingMsgId = null;
    messageInput.placeholder = `Message ${getChatName(activeChat)}...`;
  } else {
    socket.emit('sendMessage', {
      sender: currentUser.username,
      senderId: currentUser._id,
      content,
      chatId: activeChat._id,
    });
  }

  messageInput.value = '';
  messageInput.style.height = 'auto';
  socket.emit('typing', { username: currentUser.username, chatId: activeChat._id, isTyping: false });
}

// ─── Edit / Delete Interactions ───────────────
window.toggleMsgDropdown = (e, msgId) => {
  e.stopPropagation();
  // Close any other open dropdowns
  document.querySelectorAll('.msg-dropdown').forEach(d => {
    if (d.id !== `dropdown-${msgId}`) d.classList.remove('show');
  });
  
  const dropdown = document.getElementById(`dropdown-${msgId}`);
  if (dropdown) dropdown.classList.toggle('show');
};

// Global click to close dropdowns
document.addEventListener('click', () => {
  document.querySelectorAll('.msg-dropdown').forEach(d => d.classList.remove('show'));
});

window.requestEdit = (msgId, el) => {
  const wrapper = document.getElementById(`msg-${msgId}`);
  if (!wrapper) return;
  
  const bubble = wrapper.querySelector('.msg-bubble');
  if (!bubble) return;
  
  const text = bubble.textContent;
  messageInput.value = text;
  messageInput.focus();
  messageInput.placeholder = "Editing message...";
  
  isEditMode = true;
  editingMsgId = msgId;
  
  // Auto resize textarea
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
};

window.requestDelete = (msgId) => {
  deletingMsgId = msgId;
  deleteModal.classList.remove('hidden');
  
  // Per latest request: Ensure "Delete for Everyone" is NEVER visible
  // Only "Delete for Me" and "Cancel" will be shown
  deleteEveryoneBtn.classList.add('hidden');
};

window.closeDeleteModal = () => {
  deleteModal.classList.add('hidden');
  deletingMsgId = null;
};

// Add listeners to delete modal buttons
deleteMeBtn.addEventListener('click', () => {
  if (deletingMsgId && activeChat) {
    socket.emit('deleteMessage', { 
      messageId: deletingMsgId, 
      chatId: activeChat._id, 
      userId: currentUser._id, 
      deleteForEveryone: false 
    });
    closeDeleteModal();
  }
});

deleteEveryoneBtn.addEventListener('click', () => {
  if (deletingMsgId && activeChat) {
    socket.emit('deleteMessage', { 
      messageId: deletingMsgId, 
      chatId: activeChat._id, 
      userId: currentUser._id, 
      deleteForEveryone: true 
    });
    closeDeleteModal();
  }
});

// ─── File Upload Logic ────────────────────────
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showToast('File too large. Max 10MB.', 'error');
    fileInput.value = '';
    return;
  }
  selectedFile = file;
  uploadFileName.textContent = file.name;
  uploadPreview.classList.add('show');
});

removeFile.addEventListener('click', () => {
  selectedFile = null; fileInput.value = '';
  uploadPreview.classList.remove('show');
});

function uploadFile() {
  if (!selectedFile || !activeChat) return;
  const formData = new FormData();
  formData.append('media', selectedFile);
  formData.append('chatId', activeChat._id);

  uploadPreview.classList.remove('show');
  uploadProgress.classList.add('show');
  progressBar.style.width = '0%';
  progressText.textContent = '0%';

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/upload', true);
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = `${pct}%`;
      progressText.textContent = `${pct}%`;
    }
  });

  xhr.addEventListener('load', () => {
    uploadProgress.classList.remove('show');
    if (xhr.status === 200) showToast('Sent!', 'success');
    else showToast('Failed.', 'error');
    selectedFile = null; fileInput.value = '';
  });
  xhr.send(formData);
}

// ─── Lightbox ─────────────────────────────────
window.openLightbox = function(src) { lightboxImg.src = src; lightbox.classList.add('open'); };
function closeLightbox() { lightbox.classList.remove('open'); lightboxImg.src = ''; }
lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => { if(e.target === lightbox) closeLightbox(); });

// ─── Sockets ──────────────────────────────────
socket.on('connect', () => {
  socket.emit('setup', { username: currentUser.username, userId: currentUser._id, avatar: currentUser.avatar });
});
socket.on('reconnect', () => {
  socket.emit('setup', { username: currentUser.username, userId: currentUser._id, avatar: currentUser.avatar });
  showToast('Reconnected!', 'success');
});

socket.on('updateOnlineUsers', (users) => {
  onlineUserMap.clear();
  users.forEach(u => onlineUserMap.set(u.socketId, u));
  if(tabUsers.classList.contains('active')) renderAllUsersTab();
  
  // Update webRTC UI
  updateWebRTCButtons();
});

socket.on('receiveMessage', async (msg) => {
  if (activeChat && msg.chatId === activeChat._id) {
    messagesContainer.appendChild(buildMessage(msg));
    scrollToBottom();
    
    // If we are looking at this chat, mark it as read immediately
    if (msg.senderId._id !== currentUser._id) {
      socket.emit('messageRead', { messageId: msg._id, userId: currentUser._id, chatId: msg.chatId });
    }
  } else {
    // We are not looking at it, mark it as delivered if it's for us
    if (msg.senderId._id !== currentUser._id) {
      socket.emit('messageDelivered', { messageId: msg._id, userId: currentUser._id, chatId: msg.chatId });
    }
  }
  fetchChats(); // Refresh sidebar order and latest messages
});

const typingUsersMap = new Set();
socket.on('typingStatus', ({ username, isTyping }) => {
  if (username === currentUser.username) return;
  if(isTyping) typingUsersMap.add(username);
  else typingUsersMap.delete(username);
  
  if(typingUsersMap.size > 0) {
    const names = Array.from(typingUsersMap).slice(0, 2).join(', ');
    typingIndicator.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div><span>${escapeHTML(names)} is typing...</span>`;
  } else {
    typingIndicator.innerHTML = '';
  }
});

// Initialization
fetchChats();
renderAllUsersTab();

// ─── WEBRTC REMAINS IDENTICAL TO PREVIOUS ─────
function updateWebRTCButtons() {
  if (!activeChat || activeChat.isGroupChat) return; // Only 1-on-1 call supported directly right now
  const otherUser = activeChat.users.find(u => u._id !== currentUser._id);
  
  // Find their socket if they are online
  let theirSocketId = null;
  for (let [socketId, user] of onlineUserMap.entries()) {
    if (user.userId === otherUser._id) {
      theirSocketId = socketId;
      break;
    }
  }

  // Inject buttons into header dynamically
  let rtcOpts = document.getElementById('webrtc-header-options');
  if(!rtcOpts) {
    rtcOpts = document.createElement('div');
    rtcOpts.id = 'webrtc-header-options';
    rtcOpts.style.display = 'flex';
    rtcOpts.style.gap = '8px';
    rtcOpts.style.marginRight = '12px';
    const headerRight = document.querySelector('.chat-header-right');
    headerRight.insertBefore(rtcOpts, headerRight.firstChild);
  }

  if (theirSocketId) {
    rtcOpts.innerHTML = `
      <div class="icon-btn" onclick="startCall('${theirSocketId}', false, '${escapeHTML(otherUser.username)}')" title="Voice Call" style="color:var(--online-green); border-color:var(--online-green);"><i class="fa-solid fa-phone"></i></div>
      <div class="icon-btn" onclick="startCall('${theirSocketId}', true, '${escapeHTML(otherUser.username)}')" title="Video Call" style="color:var(--online-green); border-color:var(--online-green);"><i class="fa-solid fa-video"></i></div>
    `;
  } else {
    rtcOpts.innerHTML = ''; // offline
  }
}

// Intercept loadChat to inject webRTC logic
const originalLoadChat = loadChat;
loadChat = async (chat) => {
  await originalLoadChat(chat);
  updateWebRTCButtons();
};

let localStream;
let peerConnection;
let isVideoCall = false;
let callRemoteSocketId = null;
const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const incomingCallPopup = document.getElementById('incoming-call-popup');
const callerNameText = document.getElementById('caller-name');
const callTypeText = document.getElementById('call-type-text');
const callerAvatarText = document.getElementById('caller-avatar');
const acceptCallBtn = document.getElementById('accept-call-btn');
const rejectCallBtn = document.getElementById('reject-call-btn');

const videoOverlay = document.getElementById('video-call-overlay');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const endCallBtn = document.getElementById('end-call-btn');
const toggleVideoBtn = document.getElementById('toggle-video-btn');
const toggleMicBtn = document.getElementById('toggle-mic-btn');
const callStatus = document.getElementById('call-status');

async function initMedia(video = true) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Browser does not support camera/mic access or you are not using localhost/https.', 'error');
    return false;
  }

  // Stop any previous tracks before starting new ones
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: video, 
      audio: true 
    });
    
    localVideo.srcObject = localStream;
    localVideo.style.display = video ? 'block' : 'none';
    isVideoCall = video;
    
    toggleVideoBtn.classList.toggle('disabled', !video);
    toggleVideoBtn.innerHTML = video ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-video-slash"></i>';
    toggleMicBtn.classList.remove('disabled');
    toggleMicBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    
    return true;
  } catch (err) {
    console.error('Media Access Error:', err);
    showToast('Camera/Mic permission denied or device unavailable.', 'error');
    return false;
  }
}

window.startCall = async (userSocketId, video, username) => {
  if (!userSocketId) return showToast('User offline', 'error');
  const hasMedia = await initMedia(video);
  if (!hasMedia) return;
  callRemoteSocketId = userSocketId;
  videoOverlay.classList.remove('hidden');
  callStatus.textContent = 'Calling ' + username + '...';

  peerConnection = new RTCPeerConnection(iceServers);
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  peerConnection.ontrack = (event) => remoteVideo.srcObject = event.streams[0];
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) socket.emit('iceCandidate', { to: callRemoteSocketId, candidate: event.candidate });
  };
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('callUser', { userToCall: callRemoteSocketId, signalData: offer, from: socket.id, name: currentUser.username, isVideo: video });
  } catch (err) { endCallLocal(); }
};

let incomingOfferSignal = null;
socket.on('incomingCall', (data) => {
  callRemoteSocketId = data.from;
  incomingOfferSignal = data.signal;
  isVideoCall = data.isVideo;
  callerNameText.textContent = data.name;
  callTypeText.textContent = 'Incoming ' + (data.isVideo ? 'Video' : 'Voice') + ' Call...';
  callerAvatarText.textContent = getInitial(data.name);
  callerAvatarText.style.background = stringToColor(data.name);
  incomingCallPopup.classList.remove('hidden');
});

acceptCallBtn.addEventListener('click', async () => {
  incomingCallPopup.classList.add('hidden');
  const hasMedia = await initMedia(isVideoCall);
  if (!hasMedia) return socket.emit('rejectCall', { to: callRemoteSocketId });
  videoOverlay.classList.remove('hidden');
  callStatus.textContent = 'Connected';

  peerConnection = new RTCPeerConnection(iceServers);
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  peerConnection.ontrack = (event) => remoteVideo.srcObject = event.streams[0];
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) socket.emit('iceCandidate', { to: callRemoteSocketId, candidate: event.candidate });
  };
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingOfferSignal));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answerCall', { to: callRemoteSocketId, signal: answer });
    saveCallLog(`${isVideoCall ? 'Video' : 'Voice'} call started`);
  } catch (err) { endCallLocal(); }
});

rejectCallBtn.addEventListener('click', () => {
  incomingCallPopup.classList.add('hidden');
  if (callRemoteSocketId) socket.emit('rejectCall', { to: callRemoteSocketId });
  callRemoteSocketId = null;
});

socket.on('callAccepted', async (signal) => {
  callStatus.textContent = 'Connected';
  if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
});
socket.on('callRejected', () => { showToast('Call declined', 'error'); endCallLocal(); });
socket.on('iceCandidate', async (data) => {
  if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
});
socket.on('callEnded', () => { showToast('Call ended', 'info'); endCallLocal(); });

function endCallLocal() {
  if (peerConnection) { 
    peerConnection.close(); 
    peerConnection = null; 
    // Log call end if we were in a call
    if (activeChat) saveCallLog(`${isVideoCall ? 'Video' : 'Voice'} call ended`);
  }
  if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
  remoteVideo.srcObject = null; localVideo.srcObject = null;
  videoOverlay.classList.add('hidden'); incomingCallPopup.classList.add('hidden');
  callRemoteSocketId = null;
}

function saveCallLog(text) {
  if (!activeChat) return;
  // Delay slightly to prevent interfering with media access
  setTimeout(() => {
    socket.emit('sendMessage', {
      sender: 'System',
      senderId: currentUser._id,
      content: text,
      chatId: activeChat._id,
      messageType: 'system'
    });
  }, 800);
}

endCallBtn.addEventListener('click', () => {
  if (callRemoteSocketId) socket.emit('endCall', { to: callRemoteSocketId });
  endCallLocal();
});

toggleVideoBtn.addEventListener('click', () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    toggleVideoBtn.classList.toggle('disabled', !videoTrack.enabled);
    toggleVideoBtn.innerHTML = videoTrack.enabled ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-video-slash"></i>';
  } else showToast('Audio-only call!', 'error');
});

toggleMicBtn.addEventListener('click', () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    toggleMicBtn.classList.toggle('disabled', !audioTrack.enabled);
    toggleMicBtn.innerHTML = audioTrack.enabled ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
  }
});

// ─── Mobile Sidebar Toggling ──────────────────
const backBtn = document.getElementById('back-btn');
const chatApp = document.getElementById('chat-app');

if (backBtn && chatApp) {
  // When mobile user goes "back", we leave the chat screen and show sidebar
  backBtn.addEventListener('click', () => {
    chatApp.classList.remove('mobile-chat-active');
  });

  // When a chat is loaded on mobile, we automatically switch to the chat-main screen
  const originalLoadChatForMobile = loadChat;
  loadChat = async (chat) => {
    await originalLoadChatForMobile(chat);
    if (window.innerWidth <= 768) {
      chatApp.classList.add('mobile-chat-active');
    }
  };
}