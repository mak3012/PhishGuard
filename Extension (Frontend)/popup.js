let extractedData = null;
let pollTimer = null;
let lastAnalysisResult = null;

// On Load
document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    const isGmail = activeTab.url && activeTab.url.includes('mail.google.com');

    if (!isGmail) {
      showView('inactive');
      return;
    }

    showView('main');
    fetchAndRender(activeTab.id);
  });

  // Settings Icon
  document.querySelector('.settings-icon').addEventListener('click', () => {
    stopPolling();
    window.location.href = 'settings.html';
  });

  // Re-Scan Button
  document.getElementById('refreshBtn').addEventListener('click', () => {
    const btn = document.getElementById('refreshBtn');
    btn.innerHTML = '<span>⏳</span> Scanning...';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'extract' }, (response) => {
        if (response && !response.error) {
          extractedData = response;
          renderResult(response);
          btn.innerHTML = '<span>✅</span> Scanned';
          setTimeout(() => btn.innerHTML = '<span>🔄</span> Re-Scan', 2000);
        } else {
          btn.innerHTML = '<span>❌</span> Error';
        }
      });
    });
  });

  // Download Report
  document.getElementById('downloadBtn').addEventListener('click', () => {
    if (extractedData && lastAnalysisResult) {
      const reportHtml = generateReportHTML(extractedData, lastAnalysisResult);
      const blob = new Blob([reportHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `phishguard_security_report_${Date.now()}.html`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });

  // Add to Trusted Button (Quick-add)
  document.getElementById('addTrustedBtn').addEventListener('click', () => {
    if (!extractedData || !extractedData.sender) return;

    const btn = document.getElementById('addTrustedBtn');
    btn.textContent = '...';
    btn.disabled = true;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'addTrusted',
        email: extractedData.sender
      }, (response) => {
        if (chrome.runtime.lastError) {
          btn.textContent = '+ Trust';
          btn.disabled = false;
          return;
        }
        if (response && response.success) {
          btn.style.display = 'none';
          showTrustedBadge();
          renderResult({
            risk_level: "GREEN",
            label: "SAFE",
            explanation: "Sender is in your Trusted List.",
            isTrusted: true
          });
        }
      });
    });
  });
});

// --- CORE DATA FETCHER ---
// Asks the content script for current state, then decides what to show
function fetchAndRender(tabId) {
  chrome.tabs.sendMessage(tabId, { action: 'getLastData' }, (response) => {
    if (chrome.runtime.lastError) {
      // Content script not injected yet
      renderEmptyState();
      return;
    }

    // Bug 1 fix: if no email is open, show empty state (clear stale data)
    if (!response || (!response.email && !response.scanning)) {
      renderEmptyState();
      stopPolling();
      return;
    }

    if (response.scanning) {
      // Bug 3 fix: content script is currently scanning — show scanning state
      renderScanningState(response.email);
      // Bug 2 fix: poll until scan finishes
      startPolling(tabId);
      return;
    }

    // We have a real result
    stopPolling();
    extractedData = response.email;

    // Populate email metadata
    if (response.email) {
      document.getElementById('sender-display').textContent = response.email.sender || 'Unknown';
      document.getElementById('subject-display').textContent = response.email.subject || 'No Subject';
      document.getElementById('link-count').textContent = response.email.links?.length || 0;
    }

    renderResult(response.analysis);
    updateTrustedUI(response.email?.sender, response.analysis);
  });
}

// --- POLLING (for scanning state) ---
// Polls the content script every 600ms until scanning is done
function startPolling(tabId) {
  if (pollTimer) return; // already polling
  pollTimer = setInterval(() => {
    chrome.tabs.sendMessage(tabId, { action: 'getLastData' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        stopPolling();
        return;
      }

      if (response.scanning) return; // still scanning, keep waiting

      // Scan finished!
      stopPolling();

      if (!response.email && !response.analysis) {
        renderEmptyState();
        return;
      }

      extractedData = response.email;

      if (response.email) {
        document.getElementById('sender-display').textContent = response.email.sender || 'Unknown';
        document.getElementById('subject-display').textContent = response.email.subject || 'No Subject';
        document.getElementById('link-count').textContent = response.email.links?.length || 0;
      }

      renderResult(response.analysis);
      updateTrustedUI(response.email?.sender, response.analysis);
    });
  }, 600);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function showView(viewName) {
  if (viewName === 'inactive') {
    document.getElementById('inactive-view').style.display = 'block';
    document.getElementById('main-view').style.display = 'none';
  } else {
    document.getElementById('inactive-view').style.display = 'none';
    document.getElementById('main-view').style.display = 'block';
  }
}

function renderEmptyState() {
  document.getElementById('sender-display').textContent = 'No email open';
  document.getElementById('subject-display').textContent = '—';
  document.getElementById('link-count').textContent = '0';
  document.getElementById('status-badge').textContent = 'Open an Email';
  document.getElementById('status-badge').style.borderColor = 'rgba(255,255,255,0.1)';
  document.getElementById('status-badge').style.color = 'var(--neutral-color)';
  document.getElementById('trusted-badge').style.display = 'none';
  document.getElementById('addTrustedBtn').style.display = 'none';
  document.getElementById('downloadBtn').style.display = 'none';
  document.documentElement.style.setProperty('--status-color', 'var(--neutral-color)');
  setProgress(0);
  // Reset score text to 0 directly
  document.getElementById('score-text').innerHTML = '0';
}

// Bug 3 fix: Scanning state rendering
function renderScanningState(emailData) {
  // Show partial info if we already have email metadata
  if (emailData) {
    document.getElementById('sender-display').textContent = emailData.sender || 'Unknown';
    document.getElementById('subject-display').textContent = emailData.subject || 'No Subject';
    document.getElementById('link-count').textContent = emailData.links?.length || 0;
  } else {
    document.getElementById('sender-display').textContent = 'Detecting...';
  }

  document.getElementById('status-badge').textContent = 'SCANNING';
  document.getElementById('status-badge').style.borderColor = '#FFC107';
  document.getElementById('status-badge').style.color = '#FFC107';
  document.getElementById('trusted-badge').style.display = 'none';
  document.getElementById('addTrustedBtn').style.display = 'none';
  document.getElementById('downloadBtn').style.display = 'none';
  document.documentElement.style.setProperty('--status-color', '#FFC107');

  // Pulse the gauge while scanning
  document.getElementById('score-text').innerHTML = '…';
  const circle = document.querySelector('.progress-ring__circle');
  circle.style.strokeDashoffset = 326; // reset to 0%
}

function updateTrustedUI(senderEmail, analysisResult) {
  const addBtn = document.getElementById('addTrustedBtn');
  const trustedBadge = document.getElementById('trusted-badge');

  if (analysisResult && analysisResult.isTrusted) {
    showTrustedBadge();
    addBtn.style.display = 'none';
  } else if (senderEmail && senderEmail !== 'Unknown') {
    addBtn.style.display = 'inline-flex';
    trustedBadge.style.display = 'none';
  } else {
    addBtn.style.display = 'none';
    trustedBadge.style.display = 'none';
  }
}

function showTrustedBadge() {
  const badge = document.getElementById('trusted-badge');
  badge.style.display = 'inline-flex';
  badge.style.animation = 'trustedPulse 0.6s ease';
}

function renderResult(data) {
  if (!data) {
    renderEmptyState();
    return;
  }

  document.getElementById('sender-display').textContent = data.sender || extractedData?.sender || 'Unknown';
  document.getElementById('subject-display').textContent = data.subject || extractedData?.subject || 'No Subject';
  document.getElementById('link-count').textContent = data.links ? data.links.length : (extractedData?.links?.length || 0);

  const bodyText = data.body?.text || extractedData?.body?.text || '';
  if (bodyText && document.getElementById('body-display')) {
    document.getElementById('body-display').textContent = bodyText.substring(0, 80) + '...';
  }

  const riskMap = {
    "GREEN": { color: "var(--safe-color)", label: "SAFE", baseScore: 10 },
    "YELLOW": { color: "var(--warning-color)", label: "SUSPICIOUS", baseScore: 60 },
    "RED": { color: "var(--danger-color)", label: "PHISHING", baseScore: 90 },
    "GRAY": { color: "var(--neutral-color)", label: "UNKNOWN", baseScore: 0 }
  };

  if (data.isTrusted) {
    document.documentElement.style.setProperty('--status-color', 'var(--trusted-color, #00bcd4)');
    document.getElementById('status-badge').textContent = 'TRUSTED';
    document.getElementById('status-badge').style.borderColor = '#00bcd4';
    document.getElementById('status-badge').style.color = '#00bcd4';
    setProgress(0);
    document.getElementById('downloadBtn').style.display = 'flex';
    return;
  }

  const status = riskMap[data.risk_level] || riskMap["GRAY"];
  let score = status.baseScore;
  if (data.phishing_probability) {
    score = Math.round(data.phishing_probability * 100);
  }

  document.documentElement.style.setProperty('--status-color', status.color);
  document.getElementById('status-badge').textContent = status.label;
  document.getElementById('status-badge').style.borderColor = status.color;
  document.getElementById('status-badge').style.color = status.color;

  lastAnalysisResult = data;
  setProgress(score);
  document.getElementById('downloadBtn').style.display = 'flex';
}

function generateReportHTML(email, analysis) {
  const timestamp = new Date().toLocaleString();
  const riskColor = {
    "GREEN": "#2ea043",
    "YELLOW": "#FFC107",
    "RED": "#f85149",
    "GRAY": "#8b949e"
  }[analysis.risk_level] || "#8b949e";

  const verdictMap = { "GREEN": "SAFE", "YELLOW": "SUSPICIOUS", "RED": "PHISHING", "GRAY": "UNKNOWN" };
  const verdict = analysis.isTrusted ? "TRUSTED SENDER" : (verdictMap[analysis.risk_level] || "UNKNOWN");
  const probability = analysis.phishing_probability ? (analysis.phishing_probability * 100).toFixed(2) : "0.00";

  // Recommendations based on risk
  const recommendations = {
    "GREEN": "This email appears safe to interact with. However, always remain cautious of unexpected requests.",
    "YELLOW": "Exercise caution. Do not click links or share personal info without verifying the sender via another channel.",
    "RED": "High risk of phishing. Do not click links, download attachments, or reply. Report this email as phishing.",
    "GRAY": "Analysis incomplete or errored. Handle with care."
  }[analysis.risk_level] || "Exercise general caution.";

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0d1117; color: #fff; padding: 40px; line-height: 1.6; }
    .report-card { max-width: 800px; margin: auto; background: rgba(22, 27, 34, 0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
    header { padding: 30px; background: linear-gradient(135deg, #1f6feb, #2ea043); display: flex; justify-content: space-between; align-items: center; }
    .logo { font-weight: 700; font-size: 24px; display: flex; align-items: center; gap: 10px; }
    .timestamp { font-size: 14px; opacity: 0.8; }
    .verdict-banner { padding: 40px; text-align: center; background: ${riskColor}22; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .verdict-label { font-size: 12px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; opacity: 0.7; }
    .verdict-value { font-size: 48px; font-weight: 800; color: ${riskColor}; }
    .probability { font-size: 18px; opacity: 0.9; margin-top: 5px; }
    .content { padding: 40px; }
    .section { margin-bottom: 30px; }
    h2 { font-size: 18px; color: #1f6feb; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .stat-box { background: rgba(255,255,255,0.03); padding: 20px; border-radius: 12px; }
    .label { font-size: 12px; color: #8b949e; margin-bottom: 5px; }
    .value { font-size: 16px; font-weight: 500; word-break: break-all; }
    .reasons { list-style: none; padding: 0; }
    .reasons li { background: rgba(248, 81, 73, 0.1); border-left: 4px solid #f85149; padding: 12px 15px; margin-bottom: 10px; border-radius: 4px; font-size: 14px; }
    .safe-item { border-left-color: #2ea043 !important; background: rgba(46, 160, 67, 0.1) !important; }
    .footer { padding: 30px; text-align: center; font-size: 12px; color: #8b949e; border-top: 1px solid rgba(255,255,255,0.05); }
    .recommendation { background: #1f6feb22; border: 1px solid #1f6feb44; padding: 20px; border-radius: 12px; font-weight: 500; }
  </style>
</head>
<body>
  <div class="report-card">
    <header>
      <div class="logo">🛡️ PhishGuard Security Report</div>
      <div class="timestamp">${timestamp}</div>
    </header>

    <div class="verdict-banner">
      <div class="verdict-label">Analysis Result</div>
      <div class="verdict-value">${verdict}</div>
      <div class="probability">${probability}% Phishing Risk</div>
    </div>

    <div class="content">
      <div class="section">
        <h2>Sender Profile</h2>
        <div class="grid">
          <div class="stat-box">
            <div class="label">From</div>
            <div class="value">${email.sender}</div>
          </div>
          <div class="stat-box">
            <div class="label">Status</div>
            <div class="value">${analysis.isTrusted ? "✓ Trusted Sender" : "Standard Verification"}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>Message Details</h2>
        <div class="grid">
          <div class="stat-box">
            <div class="label">Subject</div>
            <div class="value">${email.subject}</div>
          </div>
          <div class="stat-box">
            <div class="label">Analysis Evidence</div>
            <div class="value">${email.links.length} Links Found</div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>Security Analysis Findings</h2>
        <ul class="reasons">
          ${analysis.explanation ? `<li>${analysis.explanation}</li>` : '<li>No specific threat evidence detected.</li>'}
          ${analysis.isTrusted ? '<li class="safe-item">Sender successfully matched your personal Trusted List.</li>' : ''}
        </ul>
      </div>

      <div class="section">
        <h2>Recommendations</h2>
        <div class="recommendation">
          ${recommendations}
        </div>
      </div>
    </div>

    <div class="footer">
      Generated by PhishGuard Extension • Protecting your inbox with AI.
    </div>
  </div>
</body>
</html>
  `;
}

function setProgress(percent) {
  const circle = document.querySelector('.progress-ring__circle');
  const radius = circle.r.baseVal.value;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percent / 100) * circumference;
  circle.style.strokeDashoffset = offset;
  animateValue("score-text", 0, percent, 800);
}

function animateValue(id, start, end, duration) {
  const obj = document.getElementById(id);
  if (!obj || start === end) {
    if (obj) obj.innerHTML = end;
    return;
  }
  const range = end - start;
  let current = start;
  const increment = end > start ? 1 : -1;
  const stepTime = Math.max(1, Math.abs(Math.floor(duration / range)));

  const timer = setInterval(() => {
    current += increment;
    obj.innerHTML = current;
    if (current === end) clearInterval(timer);
  }, stepTime);
}