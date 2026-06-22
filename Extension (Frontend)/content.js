let lastExtractedEmailId = null;
let lastExtractedData = null;
let lastAnalysisResult = null;
let isScanning = false;
let currentSettings = null;
let currentEmailId = null;       // email_id from backend (for feedback)
let feedbackSubmitted = false;   // prevent duplicate submissions

// --- API CONFIGURATION ---
const API_URL = 'http://localhost:5000/analyze';
const FEEDBACK_URL = 'http://localhost:5000/feedback';

// --- SETTINGS LOADER ---
async function loadSettings() {
  const result = await chrome.storage.local.get(['settings']);
  currentSettings = result.settings || {
    autoScan: true,
    trustedSenders: []
  };
  return currentSettings;
}

// --- TRUSTED SENDER CHECK ---
function isSenderTrusted(senderEmail, trustedList) {
  if (!senderEmail || !trustedList || trustedList.length === 0) return false;

  const normalizedSender = senderEmail.toLowerCase().trim();
  const senderDomain = normalizedSender.split('@')[1];

  return trustedList.some(entry => {
    const normalizedEntry = entry.toLowerCase().trim();
    if (normalizedEntry.startsWith('*@')) {
      const trustedDomain = normalizedEntry.substring(2);
      return senderDomain === trustedDomain;
    }
    return normalizedSender === normalizedEntry;
  });
}

// --- CHECK IF AN EMAIL IS CURRENTLY OPEN ---
function isEmailViewActive() {
  const bodyElement = document.querySelector('.a3s') || document.querySelector('.ii');
  return !!bodyElement;
}

// 1. Listen for messages (Popup interaction)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    const data = extractEmailData();
    sendResponse(data);

  } else if (request.action === 'getLastData') {
    if (!isEmailViewActive()) {
      sendResponse({ email: null, analysis: null, scanning: false });
      return;
    }
    sendResponse({
      email: lastExtractedData,
      analysis: lastAnalysisResult,
      scanning: isScanning
    });

  } else if (request.action === 'addTrusted') {
    handleAddTrusted(request.email).then(result => {
      sendResponse(result);
    });
    return true;

  } else if (request.action === 'checkTrusted') {
    loadSettings().then(settings => {
      const trusted = isSenderTrusted(request.email, settings.trustedSenders);
      sendResponse({ isTrusted: trusted });
    });
    return true;
  }
});

// Handle quick-add trusted from popup
async function handleAddTrusted(email) {
  const normalizedEmail = email.toLowerCase().trim();
  await loadSettings();

  if (!currentSettings.trustedSenders.includes(normalizedEmail)) {
    currentSettings.trustedSenders.push(normalizedEmail);
    await chrome.storage.local.set({ settings: currentSettings });

    if (lastExtractedData && lastExtractedData.sender) {
      const senderNorm = lastExtractedData.sender.toLowerCase().trim();
      if (senderNorm === normalizedEmail || isSenderTrusted(senderNorm, currentSettings.trustedSenders)) {
        const trustedResult = {
          risk_level: "GREEN",
          label: "SAFE",
          explanation: "Sender is in your Trusted List.",
          isTrusted: true
        };
        lastAnalysisResult = trustedResult;
        isScanning = false;
        chrome.storage.session.set({
          lastExtractedData: lastExtractedData,
          lastAnalysisResult: trustedResult
        });
        renderResult(trustedResult);
      }
    }
  }
  return { success: true };
}

// 2. Main Loop with Debounce Logic
function autoDetectAndExtractEmail() {
  if (currentSettings && currentSettings.autoScan === false) return;

  const bodyElement = document.querySelector('.a3s') || document.querySelector('.ii');

  if (bodyElement) {
    const emailFingerprint = bodyElement.innerHTML.substring(0, 50);

    if (emailFingerprint !== lastExtractedEmailId) {
      lastExtractedEmailId = emailFingerprint;

      // Reset state for new email
      lastExtractedData = null;
      lastAnalysisResult = null;
      currentEmailId = null;
      feedbackSubmitted = false;
      isScanning = true;

      // Remove any existing feedback card
      removeFeedbackCard();

      setTimeout(() => {
        chrome.storage.session.remove('lastExtractedData', () => {
          lastExtractedData = extractEmailData();

          injectBadge("⏳ SCANNING", "#FFC107");
          sendToAPI(lastExtractedData);

          chrome.storage.session.set({ 'lastExtractedData': lastExtractedData });
        });
      }, 500);
    }
  } else {
    if (lastExtractedEmailId !== null) {
      lastExtractedEmailId = null;
      lastExtractedData = null;
      lastAnalysisResult = null;
      currentEmailId = null;
      feedbackSubmitted = false;
      isScanning = false;
      removeFeedbackCard();
    }
  }
}

// 3. The API Bridge
async function sendToAPI(emailData) {
  try {
    await loadSettings();
    const trustedList = currentSettings.trustedSenders || [];

    const senderEmail = emailData.sender;
    const trusted = isSenderTrusted(senderEmail, trustedList);

    if (trusted) {
      const trustedResult = {
        risk_level: "GREEN",
        label: "SAFE",
        explanation: "Sender is in your Trusted List.",
        isTrusted: true
      };
      lastAnalysisResult = trustedResult;
      isScanning = false;

      chrome.storage.session.set({
        lastExtractedData: emailData,
        lastAnalysisResult: trustedResult
      });

      renderResult(trustedResult);
      return;
    }

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailData)
    });

    const result = await response.json();
    result.isTrusted = false;

    // Store the email_id from backend (for feedback)
    if (result.email_id) {
      currentEmailId = result.email_id;
      console.log("✅ Stored email_id for feedback:", currentEmailId);
    } else {
      console.warn("⚠️ No email_id received from backend:", result);
    }

    lastAnalysisResult = result;
    isScanning = false;

    chrome.storage.session.set({
      lastExtractedData: emailData,
      lastAnalysisResult: result
    });

    renderResult(result);
  } catch (error) {
    console.error("API Error:", error);
    isScanning = false;
    renderResult({ risk_level: "GRAY", label: "CONNECTION ERROR", explanation: "Backend not reachable.", isTrusted: false });
  }
}

// 4. UI: Rendering Engine
function renderResult(data) {
  const badgeSpan = document.querySelector('.phishguard-badge span');
  if (!badgeSpan) return;

  if (data.isTrusted) {
    badgeSpan.style.background = 'linear-gradient(135deg, #00bcd4, #009688)';
    badgeSpan.style.color = '#fff';
    badgeSpan.innerHTML = `🛡️ <strong>TRUSTED SENDER</strong> | ✓ Verified Safe`;
    badgeSpan.title = `This sender is in your Trusted Senders list.`;
    // No feedback for trusted senders
    return;
  }

  const config = {
    "GREEN": { color: "#4CAF50", text: "SAFE", actionText: "Allowed" },
    "YELLOW": { color: "#FFC107", text: "SUSPICIOUS", actionText: "Review Recommended" },
    "RED": { color: "#F44336", text: "PHISHING", actionText: "Blocked / Warning" },
    "GRAY": { color: "#9E9E9E", text: "ERROR", actionText: "N/A" }
  };

  const ui = config[data.risk_level] || config["GRAY"];
  const probPercent = data.phishing_probability ? (data.phishing_probability * 100).toFixed(2) : "0.00";

  badgeSpan.style.background = ui.color;
  badgeSpan.style.color = (data.risk_level === "YELLOW") ? "#333" : "#fff";
  badgeSpan.innerHTML = `🛡️ <strong>${ui.text}</strong> | ${probPercent}% Risk | ${ui.actionText}`;
  badgeSpan.title = `Click to provide feedback on this analysis`;
  badgeSpan.style.cursor = 'pointer';
  badgeSpan.style.transition = 'all 0.2s ease';

  // Make the badge clickable for feedback (only for non-error results)
  if (data.risk_level !== "GRAY") {
    badgeSpan.onclick = () => toggleFeedbackCard();

    // Inject styles and add glow animation
    injectBadgeInteractionStyles();
    badgeSpan.classList.add('phishguard-badge-glow');

    // Show the "click to review" hint briefly
    showClickHint(ui.color);
  }
}

// 5. UI: Inject initial Badge
function injectBadge(text, color) {
  const existingBadge = document.querySelector('.phishguard-badge');
  if (existingBadge) existingBadge.remove();

  removeFeedbackCard();

  const subjectElement = document.querySelector('h2.hP');
  if (subjectElement) {
    const badge = document.createElement('div');
    badge.className = 'phishguard-badge';
    badge.innerHTML = `<span style="display: inline-block; background: ${color}; color: #333; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-left: 10px; white-space: nowrap;">${text}</span>`;
    subjectElement.parentElement.appendChild(badge);
  }
}

// ========== 5.5 BADGE INTERACTION HINTS ==========

function injectBadgeInteractionStyles() {
  if (document.getElementById('phishguard-badge-interaction-styles')) return;
  const style = document.createElement('style');
  style.id = 'phishguard-badge-interaction-styles';
  style.textContent = `
    @keyframes pgBadgeGlow {
      0%, 100% { box-shadow: 0 0 4px rgba(255,255,255,0.1); }
      50% { box-shadow: 0 0 14px rgba(255,255,255,0.35), 0 0 30px rgba(255,255,255,0.1); }
    }
    .phishguard-badge-glow {
      animation: pgBadgeGlow 2s ease-in-out 3;
      border-radius: 20px;
    }
    .phishguard-badge-glow:hover {
      transform: scale(1.04);
      filter: brightness(1.15);
      box-shadow: 0 0 18px rgba(255,255,255,0.3) !important;
    }
    .phishguard-click-hint {
      font-size: 11px;
      font-weight: 600;
      margin-top: 6px;
      padding: 4px 12px;
      border-radius: 8px;
      display: inline-block;
      animation: pgHintFadeIn 0.5s ease 0.8s both;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    @keyframes pgHintFadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes pgHintFadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

function showClickHint(accentColor) {
  // Remove any existing hint
  const existing = document.querySelector('.phishguard-click-hint');
  if (existing) existing.remove();

  const badge = document.querySelector('.phishguard-badge');
  if (!badge) return;

  const hint = document.createElement('div');
  hint.className = 'phishguard-click-hint';
  hint.style.color = accentColor;
  hint.style.background = `${accentColor}15`;
  hint.style.border = `1px solid ${accentColor}30`;
  hint.textContent = '👆 Click the badge to review this result';
  badge.appendChild(hint);

  // Fade out after 4 seconds
  setTimeout(() => {
    hint.style.animation = 'pgHintFadeOut 0.5s ease forwards';
    setTimeout(() => hint.remove(), 500);
  }, 4000);
}

// ========== 5.6 FEEDBACK CARD SYSTEM ==========

function injectFeedbackStyles() {
  if (document.getElementById('phishguard-feedback-styles')) return;
  const style = document.createElement('style');
  style.id = 'phishguard-feedback-styles';
  style.textContent = `
    .phishguard-feedback-card {
      background: #161b22;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 20px 24px;
      margin: 12px 0 8px 0;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      animation: pgFeedbackSlideIn 0.3s ease;
      max-width: 600px;
    }
    @keyframes pgFeedbackSlideIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes pgFeedbackFadeOut {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(-10px); }
    }
    .phishguard-feedback-card .pg-fb-question {
      color: #e6edf3;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .phishguard-feedback-card .pg-fb-buttons {
      display: flex;
      gap: 10px;
    }
    .phishguard-feedback-card .pg-fb-btn {
      flex: 1;
      padding: 10px 16px;
      border: none;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .phishguard-feedback-card .pg-fb-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .phishguard-feedback-card .pg-fb-btn:active {
      transform: scale(0.97);
    }
    .phishguard-feedback-card .pg-fb-legit {
      background: linear-gradient(135deg, #238636, #2ea043);
      color: #fff;
    }
    .phishguard-feedback-card .pg-fb-phish {
      background: linear-gradient(135deg, #da3633, #f85149);
      color: #fff;
    }
    .phishguard-feedback-card .pg-fb-btn.disabled {
      pointer-events: none;
      opacity: 0.5;
    }
    .phishguard-feedback-card .pg-fb-thanks {
      color: #58a6ff;
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      padding: 8px 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .phishguard-feedback-card .pg-fb-hint {
      color: #8b949e;
      font-size: 11px;
      margin-top: 10px;
    }
  `;
  document.head.appendChild(style);
}

function toggleFeedbackCard() {
  const existing = document.querySelector('.phishguard-feedback-card');
  if (existing) {
    removeFeedbackCard();
    return;
  }
  showFeedbackCard();
}

function showFeedbackCard() {
  if (feedbackSubmitted) return;
  injectFeedbackStyles();

  removeFeedbackCard();

  const badge = document.querySelector('.phishguard-badge');
  if (!badge) return;

  const card = document.createElement('div');
  card.className = 'phishguard-feedback-card';

  card.innerHTML = `
    <div class="pg-fb-question">
      💬 Help us improve — does this email look safe to you?
    </div>
    <div class="pg-fb-buttons">
      <button class="pg-fb-btn pg-fb-legit" data-label="legitimate_email">
        ✅ Yes, it's Legitimate
      </button>
      <button class="pg-fb-btn pg-fb-phish" data-label="phishing_email">
        🚨 No, it's Phishing
      </button>
    </div>
    <div class="pg-fb-hint">Your feedback helps our AI learn and improve.</div>
  `;

  // Insert after the badge
  badge.parentElement.insertBefore(card, badge.nextSibling);

  // Button handlers
  card.querySelectorAll('.pg-fb-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const label = btn.dataset.label;
      submitFeedback(label, card);
    });
  });
}

function removeFeedbackCard() {
  const existing = document.querySelector('.phishguard-feedback-card');
  if (existing) {
    existing.style.animation = 'pgFeedbackFadeOut 0.25s ease forwards';
    setTimeout(() => existing.remove(), 250);
  }
}

async function submitFeedback(trueLabel, cardElement) {
  if (feedbackSubmitted) return;
  feedbackSubmitted = true;

  // Disable both buttons immediately
  cardElement.querySelectorAll('.pg-fb-btn').forEach(b => b.classList.add('disabled'));

  try {
    const payload = {
      email_id: currentEmailId || null,
      true_label: trueLabel
    };

    console.log("📤 Sending feedback:", payload);

    const response = await fetch(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const responseData = await response.json();
    console.log("📥 Feedback response:", responseData, "Status:", response.status);

    if (!response.ok) {
      console.error("❌ Feedback submission failed:", responseData);
    }
  } catch (err) {
    console.error("Feedback submission error:", err);
    // Show thanks anyway — don't block UX on network issues
  }

  // Replace card content with thank you
  const labelText = trueLabel === 'legitimate_email' ? 'Legitimate' : 'Phishing';
  cardElement.innerHTML = `
    <div class="pg-fb-thanks">
      🙏 Thanks for your feedback! You marked this as <strong>${labelText}</strong>.
    </div>
  `;

  // Fade out after 3 seconds
  setTimeout(() => {
    removeFeedbackCard();
  }, 3000);
}

// 6. Extraction Logic
function extractEmailData() {
  if (!window.location.href.includes('mail.google.com')) return { error: 'Not on Gmail' };

  let sender = 'Unknown';
  const activeSender = document.querySelector('.gD');
  if (activeSender && activeSender.getAttribute('email')) {
    sender = activeSender.getAttribute('email');
  } else {
    const headerArea = document.querySelector('.gE');
    const senderElement = headerArea ? headerArea.querySelector('[email]') : null;
    if (senderElement) sender = senderElement.getAttribute('email');
  }

  const subjectElement = document.querySelector('h2.hP');
  const subject = subjectElement ? subjectElement.textContent.trim() : 'Unknown';

  const bodyElement = document.querySelector('.a3s') || document.querySelector('.ii');
  if (!bodyElement) return { error: 'No email body found' };

  const links = [];
  bodyElement.querySelectorAll('a').forEach(link => {
    links.push({ url: link.href, text: link.textContent.trim() });
  });
  return {
    sender,
    subject,
    body: { text: bodyElement.textContent || '', html: bodyElement.innerHTML || '' },
    links
  };
}

// 7. Initializer (Single Instance)
async function initializePhishGuard() {
  await loadSettings();

  chrome.storage.local.get(['userConsent'], (result) => {
    if (result.userConsent && window.location.href.includes('mail.google.com')) {
      const observer = new MutationObserver(() => autoDetectAndExtractEmail());
      observer.observe(document.body, { childList: true, subtree: true });
      autoDetectAndExtractEmail();
    }
  });
}

initializePhishGuard();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.userConsent?.newValue === true) initializePhishGuard();
  if (area === 'local' && changes.settings) loadSettings();
});