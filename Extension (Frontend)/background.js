// Background Service Worker for PhishGuard

// Listen for the extension installation event
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // Open the onboarding page when the extension is first installed
        chrome.tabs.create({ url: 'onboarding.html' });

        // Seed default settings
        chrome.storage.local.get(['settings'], (result) => {
            if (!result.settings) {
                chrome.storage.local.set({
                    settings: {
                        autoScan: true,
                        trustedSenders: []
                    }
                });
            }
        });
    }
});
