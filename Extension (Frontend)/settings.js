document.addEventListener('DOMContentLoaded', () => {
    const elements = {
        backBtn: document.getElementById('back-btn'),
        autoScan: document.getElementById('autoScanToggle'),
        trustedInput: document.getElementById('trustedInput'),
        addTrustedBtn: document.getElementById('addTrustedBtn'),
        trustedList: document.getElementById('trustedList'),
        inputError: document.getElementById('inputError'),
        saveBtn: document.getElementById('saveBtn'),
        statusMsg: document.getElementById('statusMsg')
    };

    let trustedSenders = [];

    // --- VALIDATION ---
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const WILDCARD_REGEX = /^\*@[^\s@]+\.[^\s@]+$/; // *@domain.com

    function isValidEntry(value) {
        return EMAIL_REGEX.test(value) || WILDCARD_REGEX.test(value);
    }

    function showError(msg) {
        elements.inputError.textContent = msg;
        elements.inputError.classList.add('visible');
        elements.trustedInput.classList.add('shake');
        setTimeout(() => {
            elements.trustedInput.classList.remove('shake');
        }, 500);
        setTimeout(() => {
            elements.inputError.classList.remove('visible');
        }, 3000);
    }

    // --- LOAD SETTINGS ---
    chrome.storage.local.get(['settings'], (result) => {
        const settings = result.settings || {
            autoScan: true,
            trustedSenders: []
        };

        elements.autoScan.checked = settings.autoScan;
        trustedSenders = settings.trustedSenders || [];
        renderTrustedList();
    });

    // --- BACK BUTTON ---
    elements.backBtn.addEventListener('click', () => {
        window.location.href = 'popup.html';
    });

    // --- ADD TRUSTED SENDER ---
    function addTrustedSender() {
        const raw = elements.trustedInput.value.trim().toLowerCase();

        if (!raw) return;

        if (!isValidEntry(raw)) {
            showError('Enter a valid email (e.g. user@example.com) or wildcard (*@domain.com)');
            return;
        }

        if (trustedSenders.includes(raw)) {
            showError('This entry is already in your trusted list.');
            return;
        }

        trustedSenders.push(raw);
        elements.trustedInput.value = '';
        renderTrustedList();
        autoSaveTrustedList();
    }

    elements.addTrustedBtn.addEventListener('click', addTrustedSender);

    // Enter key support
    elements.trustedInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTrustedSender();
        }
    });

    // --- RENDER LIST ---
    function renderTrustedList() {
        elements.trustedList.innerHTML = '';

        if (trustedSenders.length === 0) {
            elements.trustedList.innerHTML = '<li class="empty-msg">No trusted senders yet.</li>';
            return;
        }

        trustedSenders.forEach((email, index) => {
            const li = document.createElement('li');
            li.className = 'trusted-item';

            const isWildcard = email.startsWith('*@');
            const icon = isWildcard ? '🌐' : '👤';

            li.innerHTML = `
                <div class="trusted-item-info">
                    <span class="trusted-icon">${icon}</span>
                    <span class="trusted-email">${email}</span>
                </div>
                <span class="remove-btn" data-index="${index}" title="Remove">×</span>
            `;

            // Animate in
            li.style.animation = 'slideIn 0.3s ease forwards';
            li.style.animationDelay = `${index * 0.05}s`;

            elements.trustedList.appendChild(li);
        });

        // Add delete listeners
        document.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const li = e.target.closest('.trusted-item');
                li.style.animation = 'slideOut 0.3s ease forwards';
                setTimeout(() => {
                    trustedSenders.splice(idx, 1);
                    renderTrustedList();
                    autoSaveTrustedList();
                }, 250);
            });
        });
    }

    // --- AUTO-SAVE TRUSTED LIST (instant, no need for Save button) ---
    function autoSaveTrustedList() {
        chrome.storage.local.get(['settings'], (result) => {
            const settings = result.settings || {};
            settings.trustedSenders = trustedSenders;
            chrome.storage.local.set({ settings });
        });
    }



    // --- SAVE ALL SETTINGS ---
    elements.saveBtn.addEventListener('click', () => {
        const newSettings = {
            autoScan: elements.autoScan.checked,
            trustedSenders: trustedSenders
        };

        chrome.storage.local.set({ settings: newSettings }, () => {
            showStatus('Settings Saved Successfully!');
        });
    });

    function showStatus(msg) {
        elements.statusMsg.textContent = msg;
        elements.statusMsg.classList.add('visible');
        setTimeout(() => {
            elements.statusMsg.classList.remove('visible');
        }, 3000);
    }
});
