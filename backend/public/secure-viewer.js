// Secure viewer script loaded from same origin to satisfy script-src 'self'.
// This file is an ES module and imports pdf.js directly from the pdfjs-dist build.

import * as pdfjsLib from '/pdfjs/pdf.mjs';

// Configure pdf.js worker to load from the same-origin ES module build
// so we don't hit the "No GlobalWorkerOptions.workerSrc specified" error.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';

// Prevent right-click and most keyboard interactions in this page,
// except when the user is typing into the password dialog.
window.addEventListener('contextmenu', function (e) { e.preventDefault(); }, true);
['keydown', 'keypress', 'keyup'].forEach(function (type) {
  window.addEventListener(type, function (e) {
    var target = e.target;
    // Allow normal typing/Enter inside the password dialog
    if (target && (target.id === 'passwordInput' || (target.closest && target.closest('#passwordOverlay')))) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }, true);
});

(function () {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const sessionId = params.get('sessionId');
  const messageEl = document.getElementById('message');
  const canvas = document.getElementById('pdfCanvas');
  const ctx = canvas.getContext('2d');
  const canvasContainer = document.getElementById('canvas-container');
  const expiryEl = document.getElementById('expiry');
  const loadingEl = document.getElementById('loadingState');
  const loadingLabelEl = document.getElementById('loadingLabel');
  const passwordOverlay = document.getElementById('passwordOverlay');
  const passwordInput = document.getElementById('passwordInput');
  const passwordSubmit = document.getElementById('passwordSubmit');
  const passwordError = document.getElementById('passwordError');
  const passwordToggle = document.getElementById('passwordToggle');
  const screenshotShield = document.getElementById('screenshotShield');
  let pendingUpdatePassword = null;
  let activeToken = token || null;

  // Theme toggle (light/dark) - default is light. We simply toggle a CSS
  // class on the body and update the button label.
  const body = document.body;
  const toggleBtn = document.getElementById('themeToggle');
  if (body && toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      const isDark = body.classList.toggle('dark');
      toggleBtn.textContent = isDark ? 'Light mode' : 'Dark mode';
    });
  }

  function showShield() {
    if (screenshotShield) {
      screenshotShield.style.display = 'flex';
    }
  }

  function hideShield() {
    if (screenshotShield) {
      screenshotShield.style.display = 'none';
    }
  }

  window.addEventListener('blur', function () {
    showShield();
  });

  window.addEventListener('focus', function () {
    hideShield();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      showShield();
    } else {
      hideShield();
    }
  });

  // Wire up password submission for protected PDFs
  function handlePasswordSubmit() {
    if (!pendingUpdatePassword || !passwordInput) {
      return;
    }
    const value = passwordInput.value || '';
    if (!value) {
      if (passwordError) {
        passwordError.textContent = 'Password is required.';
      }
      return;
    }
    if (passwordError) {
      passwordError.textContent = '';
    }
    pendingUpdatePassword(value);
    passwordInput.value = '';
    if (passwordOverlay) {
      passwordOverlay.style.display = 'none';
    }
  }

  if (passwordSubmit && passwordInput) {
    passwordSubmit.addEventListener('click', handlePasswordSubmit);
    passwordInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handlePasswordSubmit();
      }
    });
  }

  if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener('click', function () {
      var isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      passwordToggle.textContent = isHidden ? 'Hide' : 'Show';
      passwordToggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      passwordInput.focus();
    });
  }

  function startExpiryTimer(tokenValue) {
    if (!tokenValue || !expiryEl) {
      return;
    }
    try {
      const parts = tokenValue.split('.');
      if (parts.length !== 3) {
        return;
      }
      const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(payloadJson);
      if (!payload || typeof payload.exp !== 'number') {
        return;
      }

      const expiryMs = payload.exp * 1000;

      const updateTimer = function () {
        const now = Date.now();
        const remainingMs = expiryMs - now;
        if (remainingMs <= 0) {
          expiryEl.textContent = 'Link expired';
          if (messageEl && !messageEl.textContent) {
            messageEl.textContent = 'This secure viewer link has expired. Close this window and request a new one.';
          }
          return;
        }

        const totalSeconds = Math.floor(remainingMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        expiryEl.textContent = `Expires in ${minutes}:${seconds.toString().padStart(2, '0')}`;
      };

      updateTimer();
      setInterval(updateTimer, 1000);
    } catch (e) {
      // If decoding fails, we simply skip showing the timer.
    }
  }

  function startSessionFlow(sessionId) {
    const pollIntervalMs = 3000;
    let attempts = 0;

    function updatePrepProgress(progress) {
      if (!loadingLabelEl) {
        return;
      }
      let percent = 10;
      if (progress && typeof progress.completedSteps === 'number' && typeof progress.totalSteps === 'number' && progress.totalSteps > 0) {
        percent = Math.floor((progress.completedSteps / progress.totalSteps) * 80) + 10;
      } else if (attempts > 0) {
        percent = Math.min(90, 10 + attempts * 5);
      }
      if (progress && typeof progress.completedSteps === 'number' && typeof progress.totalSteps === 'number' && progress.totalSteps > 0) {
        loadingLabelEl.textContent = 'Preparing secure viewer... ' + percent + '% (' + progress.completedSteps + '/' + progress.totalSteps + ')';
      } else {
        loadingLabelEl.textContent = 'Preparing secure viewer... ' + percent + '%';
      }
    }

    async function pollOnce() {
      attempts += 1;
      try {
        const res = await fetch('/api/access/public-session/' + encodeURIComponent(sessionId));
        if (!res.ok) {
          throw new Error('Status ' + res.status);
        }
        const body = await res.json();
        const status = body && body.status ? String(body.status) : 'UNKNOWN';
        updatePrepProgress(body && body.progress);

        const okStates = ['COMPLETED', 'COMPLETED_WITH_EVENT'];
        if (!okStates.includes(status)) {
          setTimeout(pollOnce, pollIntervalMs);
          return;
        }

        await requestSessionToken(sessionId);
      } catch (e) {
        if (attempts < 5) {
          setTimeout(pollOnce, pollIntervalMs);
          return;
        }
        if (loadingEl) {
          loadingEl.style.display = 'none';
        }
        if (messageEl) {
          messageEl.textContent = 'Failed to prepare secure viewer. ' + (e && e.message ? e.message : 'Unknown error');
        }
      }
    }

    async function requestSessionToken(sessionIdValue) {
      try {
        const res = await fetch('/api/access/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ sessionId: sessionIdValue })
        });

        if (res.status === 202) {
          // Not ready yet - keep polling
          setTimeout(pollOnce, pollIntervalMs);
          return;
        }

        if (!res.ok) {
          throw new Error('Status ' + res.status);
        }

        const body = await res.json();
        if (!body || !body.success || !body.ready || !body.accessToken) {
          throw new Error('Token not ready');
        }

        activeToken = body.accessToken;
        startExpiryTimer(activeToken);
        await loadPdf(activeToken);
      } catch (e) {
        if (loadingEl) {
          loadingEl.style.display = 'none';
        }
        if (messageEl) {
          messageEl.textContent = 'Failed to obtain viewer token. ' + (e && e.message ? e.message : 'Unknown error');
        }
      }
    }

    pollOnce();
  }

  if (activeToken) {
    startExpiryTimer(activeToken);
    loadPdf(activeToken).catch(function (err) {
      if (!messageEl) {
        return;
      }
      const msg = err && err.message ? String(err.message) : 'Unknown error';
      messageEl.textContent = 'Failed to load document. ' + msg;
    });
  } else if (sessionId) {
    if (loadingEl) {
      loadingEl.style.display = 'flex';
    }
    if (loadingLabelEl) {
      loadingLabelEl.textContent = 'Preparing secure viewer... 0%';
    }
    if (messageEl) {
      messageEl.textContent = '';
    }
    startSessionFlow(sessionId);
  } else {
    if (messageEl) {
      messageEl.textContent = 'Missing access token or session. Close this window and try again.';
    }
    return;
  }

  async function loadPdf(token) {
    if (canvasContainer) {
      canvasContainer.style.display = 'none';
    }
    if (loadingEl) {
      loadingEl.style.display = 'flex';
    }
    if (loadingLabelEl) {
      loadingLabelEl.textContent = 'Loading document... 0%';
    }
    if (messageEl) {
      messageEl.textContent = '';
    }

    const response = await fetch('/api/view?token=' + encodeURIComponent(token));

    const contentType = response.headers.get('Content-Type') || '';
    if (!response.ok || contentType.indexOf('application/json') !== -1) {
      var detail = 'Unknown error';
      try {
        var errBody = await response.json();
        detail = errBody.details || errBody.error || detail;
      } catch (e) {
        // ignore
      }
      if (loadingEl) {
        loadingEl.style.display = 'none';
      }
      if (messageEl) {
        messageEl.textContent = 'Unable to display this document. ' + detail;
      }
      return;
    }

    const arrayBuffer = await response.arrayBuffer();

    // Use pdf.js with its dedicated worker (workerSrc configured above).
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });

    if (loadingTask && typeof loadingTask.onProgress === 'function' && loadingLabelEl) {
      loadingTask.onProgress = function (progressData) {
        try {
          if (!progressData || typeof progressData.loaded !== 'number') {
            return;
          }
          let percent = 0;
          if (progressData.total && progressData.total > 0) {
            percent = Math.floor((progressData.loaded / progressData.total) * 100);
          } else {
            // Fallback heuristic when total size is unknown
            percent = Math.min(99, Math.floor(progressData.loaded / 10000));
          }
          loadingLabelEl.textContent = 'Loading document... ' + percent + '%';
        } catch (e) {
          // ignore progress errors
        }
      };
    }

    // Attach password handler so protected PDFs prompt the user.
    loadingTask.onPassword = function (updatePassword, reason) {
      pendingUpdatePassword = updatePassword;
      if (passwordOverlay) {
        passwordOverlay.style.display = 'flex';
      }
      if (passwordError) {
        if (reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD) {
          passwordError.textContent = 'Incorrect password. Please try again.';
        } else {
          passwordError.textContent = '';
        }
      }
      if (passwordInput) {
        passwordInput.focus();
      }
    };

    const pdf = await loadingTask.promise;

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    if (loadingEl) {
      loadingEl.style.display = 'none';
    }
    if (messageEl) {
      messageEl.textContent = '';
    }
    if (canvasContainer) {
      canvasContainer.style.display = 'block';
    }
  }
})();
