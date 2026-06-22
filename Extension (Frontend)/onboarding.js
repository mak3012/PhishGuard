document.addEventListener('DOMContentLoaded', () => {
    const enableBtn = document.getElementById('enable-btn');

    enableBtn.addEventListener('click', () => {
        // Request Permissions (Optional but good practice to verify)
        // Since we have activeTab, we don't strictly need more permission to just run on click,
        // but we want to simulate the "Enable" experience and save the consent state.

        chrome.storage.local.set({ userConsent: true }, () => {
            // Visual feedback
            enableBtn.textContent = 'Protection Enabled! 🛡️';
            enableBtn.style.backgroundColor = '#1f6feb';
            enableBtn.style.pointerEvents = 'none'; // Disable multiple clicks

            // Visual feedback - Show success message in-page
            const card = document.querySelector('.permission-card');
            card.innerHTML = `
               <div style="font-size: 4rem; margin-bottom: 20px;">🛡️</div>
               <h3 style="color: #4CAF50;">PhishGuard Activated!</h3>
               <p style="color: #ccc;">Please refresh your Gmail tabs to start scanning.</p>
            `;
            // No alert, just smooth UI update
        });
    });
});
