(() => {
  const storageKey = 'host1top-fivem-chat-history';
  const maxMessages = 10;

  const form = document.getElementById('fivem-chat-form');
  const input = document.getElementById('fivem-chat-input');
  const messagesContainer = document.getElementById('fivem-chat-messages');
  const statusNode = document.getElementById('fivem-chat-status');
  const submitButton = document.getElementById('fivem-chat-submit');
  const quickPromptButtons = Array.from(document.querySelectorAll('[data-fivem-prompt]'));
  const resultsArea = document.getElementById('fivem-chat-results');
  const analysisPanel = document.getElementById('fivem-chat-analysis');
  const analysisRam = document.getElementById('fivem-analysis-ram');
  const analysisCpu = document.getElementById('fivem-analysis-cpu');
  const analysisActions = document.getElementById('fivem-analysis-actions');

  if (!form || !input || !messagesContainer || !submitButton) {
    return;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMarkdown(markdown) {
    const lines = String(markdown || '').split(/\r?\n/);
    const html = [];
    let listItems = [];

    const flushList = () => {
      if (!listItems.length) return;
      html.push(`<ul>${listItems.join('')}</ul>`);
      listItems = [];
    };

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        return;
      }

      if (trimmed.startsWith('## ')) {
        flushList();
        html.push(`<h4>${escapeHtml(trimmed.slice(3))}</h4>`);
        return;
      }

      if (trimmed.startsWith('- ')) {
        listItems.push(`<li>${escapeHtml(trimmed.slice(2))}</li>`);
        return;
      }

      flushList();
      html.push(`<p>${escapeHtml(trimmed)}</p>`);
    });

    flushList();
    return html.join('');
  }

  function saveHistory(messages) {
    sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-maxMessages)));
  }

  function loadHistory() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry) => entry && typeof entry.role === 'string' && typeof entry.content === 'string');
    } catch {
      return [];
    }
  }

  function scrollMessagesToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function setStatus(message, isError = false) {
    statusNode.textContent = message;
    statusNode.style.color = isError ? 'var(--danger, #c62828)' : 'var(--muted, #5c6470)';
  }

  function renderMessages(messages) {
    messagesContainer.innerHTML = '';

    messages.forEach((entry) => {
      const bubble = document.createElement('article');
      bubble.className = `fivem-chatbot__message fivem-chatbot__message--${entry.role === 'assistant' ? 'assistant' : 'user'}`;

      const meta = document.createElement('div');
      meta.className = 'fivem-chatbot__meta';
      meta.innerHTML = `<span>${entry.role === 'assistant' ? 'FiveM Optimizer' : 'You'}</span><span>${entry.meta?.provider || ''}</span>`;

      const body = document.createElement('div');
      body.className = 'fivem-chatbot__body';
      body.innerHTML = entry.role === 'assistant'
        ? renderMarkdown(entry.content)
        : escapeHtml(entry.content).replace(/\n/g, '<br>');

      bubble.append(meta, body);
      messagesContainer.appendChild(bubble);
    });

    scrollMessagesToBottom();
  }

  function updateAnalysis(analysis, meta) {
    if (!analysis || !analysis.hardware) {
      analysisPanel.hidden = true;
      return;
    }

    analysisRam.textContent = analysis.hardware.ram || '-';
    analysisCpu.textContent = analysis.hardware.cpu || '-';
    analysisActions.innerHTML = Array.isArray(analysis.priorityActions)
      ? `<ul>${analysis.priorityActions.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '';
    analysisPanel.hidden = false;
  }

  function collectProfile() {
    return {
      playerCount: document.getElementById('fivem-player-count')?.value || '',
      ramGb: document.getElementById('fivem-ram-gb')?.value || '',
      cpuCores: document.getElementById('fivem-cpu-cores')?.value || '',
      scriptLoad: document.getElementById('fivem-script-load')?.value || '',
      issue: input.value.trim()
    };
  }

  const state = {
    messages: loadHistory()
  };

  if (!state.messages.length) {
    state.messages = [
      {
        role: 'assistant',
        content: [
          '## FiveM Lag Doctor',
          '- Describe your player count, RAM, CPU, script load, and the lag symptoms you see.',
          '- I can recommend hardware upgrades, network targets, and script tuning priorities for FiveM.'
        ].join('\n'),
        meta: { provider: 'ready' }
      }
    ];
    saveHistory(state.messages);
  }

  renderMessages(state.messages);

  quickPromptButtons.forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.dataset.fivemPrompt || '';
      input.focus();
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();

    if (!message) {
      setStatus('Describe the lag or performance issue first.', true);
      input.focus();
      return;
    }

    const userEntry = { role: 'user', content: message };
    state.messages.push(userEntry);
    state.messages = state.messages.slice(-maxMessages);
    renderMessages(state.messages);
    saveHistory(state.messages);

    if (resultsArea) resultsArea.hidden = false;
    submitButton.disabled = true;
    if (statusNode) setStatus('Analyzing FiveM workload...');

    try {
      const response = await fetch('/api/ai/fivem-optimizer/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          messages: state.messages,
          profile: collectProfile()
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to reach the FiveM optimization service right now.');
      }

      const assistantEntry = {
        role: 'assistant',
        content: payload.reply || 'No reply was returned.',
        meta: payload.meta || {}
      };
      state.messages.push(assistantEntry);
      state.messages = state.messages.slice(-maxMessages);
      renderMessages(state.messages);
      saveHistory(state.messages);
      updateAnalysis(payload.analysis, payload.meta);
      setStatus(payload.meta?.usedFallback
        ? 'Delivered using the built-in FiveM sizing engine.'
        : 'Delivered with live Gemini reasoning and FiveM sizing guidance.');
      input.value = '';
    } catch (error) {
      setStatus(error.message || 'Unable to analyze the server right now.', true);
      state.messages.push({
        role: 'assistant',
        content: [
          '## Temporary Error',
          '- The optimization service could not complete this request.',
          '- Please retry in a few seconds or simplify the description to the key server symptoms.'
        ].join('\n'),
        meta: { provider: 'error' }
      });
      state.messages = state.messages.slice(-maxMessages);
      renderMessages(state.messages);
      saveHistory(state.messages);
    } finally {
      submitButton.disabled = false;
    }
  });
})();
