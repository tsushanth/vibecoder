// Chat Application
class ChatApp {
    constructor() {
        this.messages = [];
        this.currentFile = null;
        this.isTyping = false;
        this.typingTimeout = null;

        this.init();
    }

    init() {
        this.loadElements();
        this.loadMessages();
        this.loadEmojis();
        this.attachEventListeners();
        this.updateDate();
        this.scrollToBottom();
    }

    loadElements() {
        this.messagesArea = document.getElementById('messagesArea');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.emojiBtn = document.getElementById('emojiBtn');
        this.emojiPicker = document.getElementById('emojiPicker');
        this.emojiGrid = document.getElementById('emojiGrid');
        this.fileInput = document.getElementById('fileInput');
        this.filePreview = document.getElementById('filePreview');
        this.previewImage = document.getElementById('previewImage');
        this.previewFile = document.getElementById('previewFile');
        this.fileName = document.getElementById('fileName');
        this.removeFileBtn = document.getElementById('removeFile');
        this.clearChatBtn = document.getElementById('clearChat');
        this.typingIndicator = document.getElementById('typingIndicator');
        this.typingStatus = document.getElementById('typingStatus');
    }

    loadMessages() {
        const stored = localStorage.getItem('chatMessages');
        if (stored) {
            try {
                this.messages = JSON.parse(stored);
                this.renderMessages();
            } catch (e) {
                this.messages = [];
            }
        }
    }

    saveMessages() {
        localStorage.setItem('chatMessages', JSON.stringify(this.messages));
    }

    attachEventListeners() {
        // Send message
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Typing indicator
        this.messageInput.addEventListener('input', () => {
            this.handleTyping();
        });

        // Emoji picker
        this.emojiBtn.addEventListener('click', () => {
            this.toggleEmojiPicker();
        });

        // Emoji categories
        document.querySelectorAll('.emoji-category').forEach(cat => {
            cat.addEventListener('click', (e) => {
                document.querySelectorAll('.emoji-category').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
                this.loadEmojis(e.target.dataset.category);
            });
        });

        // File handling
        this.fileInput.addEventListener('change', (e) => {
            this.handleFileSelect(e.target.files[0]);
        });

        this.removeFileBtn.addEventListener('click', () => {
            this.removeFile();
        });

        // Clear chat
        this.clearChatBtn.addEventListener('click', () => {
            if (confirm('Clear all messages?')) {
                this.messages = [];
                this.saveMessages();
                this.renderMessages();
            }
        });

        // Close emoji picker when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.emojiPicker.contains(e.target) && !this.emojiBtn.contains(e.target)) {
                this.emojiPicker.classList.remove('active');
            }
        });
    }

    handleTyping() {
        if (!this.isTyping) {
            this.isTyping = true;
            this.typingStatus.textContent = 'typing...';
        }

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.isTyping = false;
            this.typingStatus.textContent = 'online';
        }, 1000);
    }

    toggleEmojiPicker() {
        this.emojiPicker.classList.toggle('active');
    }

    loadEmojis(category = 'smileys') {
        const emojiCategories = {
            smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴'],
            animals: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🐢', '🐍', '🦎', '🐙', '🦑', '🦐', '🦀', '🐡', '🐠', '🐟'],
            food: ['🍕', '🍔', '🍟', '🌭', '🍿', '🧈', '🥓', '🥚', '🍳', '🧇', '🥞', '🧈', '🍞', '🥐', '🥨', '🥯', '🥖', '🧀', '🥗', '🥙', '🥪', '🌮', '🌯', '🫔', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦'],
            activities: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄'],
            objects: ['💡', '🔦', '🏮', '🪔', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '💾', '💿', '📀', '📷', '📸', '📹', '🎥', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏰', '⏱️', '⏲️', '⌚', '📡', '🔋', '🔌', '💵', '💴', '💶', '💷', '💰', '💳', '🎁', '🎀', '🎊', '🎉'],
            symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔']
        };

        this.emojiGrid.innerHTML = '';
        const emojis = emojiCategories[category] || emojiCategories.smileys;

        emojis.forEach(emoji => {
            const emojiEl = document.createElement('span');
            emojiEl.className = 'emoji-item';
            emojiEl.textContent = emoji;
            emojiEl.addEventListener('click', () => {
                this.insertEmoji(emoji);
            });
            this.emojiGrid.appendChild(emojiEl);
        });
    }

    insertEmoji(emoji) {
        const cursorPos = this.messageInput.selectionStart;
        const textBefore = this.messageInput.value.substring(0, cursorPos);
        const textAfter = this.messageInput.value.substring(cursorPos);
        this.messageInput.value = textBefore + emoji + textAfter;
        this.messageInput.focus();
        this.messageInput.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
    }

    handleFileSelect(file) {
        if (!file) return;

        this.currentFile = {
            name: file.name,
            size: file.size,
            type: file.type
        };

        this.filePreview.classList.add('active');

        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.currentFile.data = e.target.result;
                this.previewImage.src = e.target.result;
                this.previewImage.classList.add('active');
                this.previewFile.classList.remove('active');
            };
            reader.readAsDataURL(file);
        } else {
            this.fileName.textContent = file.name;
            this.previewImage.classList.remove('active');
            this.previewFile.classList.add('active');
        }
    }

    removeFile() {
        this.currentFile = null;
        this.filePreview.classList.remove('active');
        this.fileInput.value = '';
        this.previewImage.src = '';
        this.previewImage.classList.remove('active');
        this.previewFile.classList.remove('active');
    }

    sendMessage() {
        const text = this.messageInput.value.trim();

        if (!text && !this.currentFile) return;

        const message = {
            id: Date.now(),
            text: text,
            timestamp: new Date().toISOString(),
            type: 'sent',
            file: this.currentFile ? { ...this.currentFile } : null
        };

        this.messages.push(message);
        this.saveMessages();
        this.renderMessage(message);

        this.messageInput.value = '';
        this.removeFile();
        this.emojiPicker.classList.remove('active');
        this.scrollToBottom();

        // Simulate received message (auto-reply)
        if (text.toLowerCase().includes('hello') || text.toLowerCase().includes('hi')) {
            setTimeout(() => this.simulateReceivedMessage('Hey there! 👋'), 1000);
        } else if (text.toLowerCase().includes('how are you')) {
            setTimeout(() => this.simulateReceivedMessage("I'm doing great! How about you?"), 1000);
        } else if (text.toLowerCase().includes('?')) {
            setTimeout(() => this.simulateReceivedMessage('That\'s a great question! 🤔'), 1500);
        }
    }

    simulateReceivedMessage(text) {
        this.showTypingIndicator();

        setTimeout(() => {
            this.hideTypingIndicator();

            const message = {
                id: Date.now(),
                text: text,
                timestamp: new Date().toISOString(),
                type: 'received',
                file: null
            };

            this.messages.push(message);
            this.saveMessages();
            this.renderMessage(message);
            this.scrollToBottom();
        }, 1500);
    }

    showTypingIndicator() {
        this.typingIndicator.classList.add('active');
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        this.typingIndicator.classList.remove('active');
    }

    renderMessages() {
        // Keep date divider, clear rest
        const dateDivider = this.messagesArea.querySelector('.date-divider');
        this.messagesArea.innerHTML = '';
        if (dateDivider) {
            this.messagesArea.appendChild(dateDivider);
        }

        this.messages.forEach(message => {
            this.renderMessage(message, false);
        });

        this.scrollToBottom();
    }

    renderMessage(message, animate = true) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${message.type}`;

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';

        // File attachment
        if (message.file) {
            if (message.file.type && message.file.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = message.file.data;
                img.alt = message.file.name;
                const attachmentDiv = document.createElement('div');
                attachmentDiv.className = 'message-attachment';
                attachmentDiv.appendChild(img);
                bubble.appendChild(attachmentDiv);
            } else {
                const fileDiv = document.createElement('div');
                fileDiv.className = 'message-file';
                fileDiv.innerHTML = `
                    <span class="file-icon">📎</span>
                    <div class="file-details">
                        <span class="file-name">${message.file.name}</span>
                        <span class="file-size">${this.formatFileSize(message.file.size)}</span>
                    </div>
                `;
                bubble.appendChild(fileDiv);
            }
        }

        // Message text
        if (message.text) {
            const textDiv = document.createElement('div');
            textDiv.className = 'message-text';
            textDiv.textContent = message.text;
            bubble.appendChild(textDiv);
        }

        // Timestamp
        const time = document.createElement('div');
        time.className = 'message-time';
        const date = new Date(message.timestamp);
        time.textContent = this.formatTime(date);

        if (message.type === 'sent') {
            const checkmark = document.createElement('span');
            checkmark.className = 'checkmark';
            checkmark.textContent = '✓✓';
            time.appendChild(checkmark);
        }

        bubble.appendChild(time);
        messageEl.appendChild(bubble);

        this.messagesArea.appendChild(messageEl);
    }

    formatTime(date) {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    updateDate() {
        const today = new Date();
        const options = { month: 'long', day: 'numeric', year: 'numeric' };
        document.getElementById('todayDate').textContent = today.toLocaleDateString('en-US', options);
    }

    scrollToBottom() {
        setTimeout(() => {
            this.messagesArea.scrollTop = this.messagesArea.scrollHeight;
        }, 100);
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});
