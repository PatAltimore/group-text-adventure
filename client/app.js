// ===== Group Text Adventure — Client =====

(function () {
  'use strict';

  // --- Config ---
  let apiBaseUrl = '';

  async function loadConfig() {
    try {
      const res = await fetch('config.json');
      if (res.ok) {
        const config = await res.json();
        apiBaseUrl = (config.apiBaseUrl || '').replace(/\/+$/, '');
        console.log('[Config] Loaded config.json, API base URL:', apiBaseUrl || '(relative)');
      } else {
        console.log('[Config] config.json not found (status:', res.status, '), using relative paths');
      }
    } catch (err) {
      console.log('[Config] config.json fetch failed:', err.message, '— using relative paths (local development)');
    }
  }

  // --- State ---
  const state = {
    playerName: '',
    gameId: '',
    worldId: '',
    isHost: false,
    ws: null,
    players: [],
    commandHistory: [],
    historyIndex: -1,
    connected: false,
  };

  // --- DOM References ---
  const $ = (sel) => document.querySelector(sel);
  const screens = {
    join: $('#screen-join'),
    landing: $('#screen-landing'),
    lobby: $('#screen-lobby'),
    game: $('#screen-game'),
  };
  const els = {
    // Join screen
    joinPlayerName: $('#join-player-name'),
    joinDisplayCode: $('#join-display-code'),
    btnJoinStart: $('#btn-join-start'),
    
    // Landing screen
    playerName: $('#player-name'),
    btnHost: $('#btn-host'),
    btnJoin: $('#btn-join'),
    joinCodeGroup: $('#join-code-group'),
    joinCode: $('#join-code'),
    btnJoinGo: $('#btn-join-go'),
    
    // Lobby screen
    lobbyUrl: $('#lobby-url'),
    btnCopyUrl: $('#btn-copy-url'),
    qrCanvas: $('#qr-canvas'),
    lobbyPlayerCount: $('#lobby-player-count'),
    lobbyPlayerList: $('#lobby-player-list'),
    btnStartGame: $('#btn-start-game'),
    
    // Game screen
    gameTitle: $('#game-title'),
    gamePlayerCount: $('#game-player-count'),
    gameOutput: $('#game-output'),
    commandForm: $('#command-form'),
    commandInput: $('#command-input'),
    btnShare: $('#btn-share'),
    
    // World selector
    worldSelectorGroup: $('#world-selector-group'),
    worldSelector: $('#world-selector'),
    lobbyAdventureName: $('#lobby-adventure-name'),

    // Share overlay
    shareOverlay: $('#share-overlay'),
    shareOverlayClose: $('#share-overlay-close'),
    shareQrCanvas: $('#share-qr-canvas'),
    shareUrl: $('#share-url'),
    btnShareCopy: $('#btn-share-copy'),
  };

  // --- Screen Management ---
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
    if (name === 'game') {
      els.commandInput.focus();
    } else if (name === 'join') {
      els.joinPlayerName.focus();
    } else if (name === 'landing') {
      els.playerName.focus();
    }
  }

  // --- World Loading ---
  function setDefaultWorld() {
    try {
      els.worldSelector.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = 'default-world';
      opt.textContent = 'The Forgotten Castle';
      els.worldSelector.appendChild(opt);
    } catch (e) {
      console.error('[Worlds] Could not set fallback option:', e);
    }
  }

  async function loadWorlds() {
    // Show loading indicator while fetching
    els.worldSelector.innerHTML = '';
    const loadingOpt = document.createElement('option');
    loadingOpt.value = '';
    loadingOpt.textContent = 'Loading adventures...';
    loadingOpt.disabled = true;
    loadingOpt.selected = true;
    els.worldSelector.appendChild(loadingOpt);
    els.worldSelector.disabled = true;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${apiBaseUrl}/api/worlds`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const worlds = await res.json();
      if (!Array.isArray(worlds) || worlds.length === 0) throw new Error('Empty response');

      els.worldSelector.innerHTML = '';
      worlds.forEach((world) => {
        const opt = document.createElement('option');
        opt.value = world.id;
        opt.textContent = world.name;
        if (world.description) opt.title = world.description;
        els.worldSelector.appendChild(opt);
      });
    } catch (err) {
      console.log('[Worlds] Failed to load worlds:', err.message, '— using default');
      setDefaultWorld();
    } finally {
      els.worldSelector.disabled = false;
    }
  }

  // --- URL Helpers ---
  function getGameIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('game') || '';
  }

  function buildJoinUrl(gameId) {
    const url = new URL(window.location.href);
    url.search = `?game=${encodeURIComponent(gameId)}`;
    return url.toString();
  }

  // --- QR Code ---
  function renderQrCode(url, targetContainer) {
    // Default to lobby QR container if not specified
    const container = targetContainer || els.qrCanvas;
    
    container.innerHTML = '';
    if (typeof QRCode === 'undefined') {
      const fallback = document.createElement('p');
      fallback.textContent = url;
      fallback.style.wordBreak = 'break-all';
      fallback.style.fontSize = '12px';
      container.appendChild(fallback);
      return;
    }
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    QRCode.toCanvas(canvas, url, {
      width: 200,
      margin: 2,
      color: { dark: '#e6edf3', light: '#0d1117' },
    }).catch(() => {
      // QR rendering failed — show URL as fallback text
      container.innerHTML = '';
      const fallback = document.createElement('p');
      fallback.textContent = url;
      fallback.style.wordBreak = 'break-all';
      fallback.style.fontSize = '12px';
      container.appendChild(fallback);
    });
  }

  // --- WebSocket ---
  async function connectWebSocket(gameId) {
    try {
      // Close existing connection to prevent duplicate listeners
      if (state.ws) {
        state.ws.close();
        state.ws = null;
      }

      const negotiateUrl = `${apiBaseUrl}/api/negotiate?gameId=${encodeURIComponent(gameId)}`;
      const res = await fetch(negotiateUrl);
      if (!res.ok) throw new Error(`Negotiate failed: ${res.status} when calling ${negotiateUrl}`);
      const data = await res.json();
      const wsUrl = data.url;

      const ws = new WebSocket(wsUrl, 'json.webpubsub.azure.v1');
      state.ws = ws;

      ws.addEventListener('open', () => {
        state.connected = true;
        const joinMsg = { type: 'join', playerName: state.playerName, gameId: state.gameId };
        if (state.isHost && state.worldId) {
          joinMsg.worldId = state.worldId;
        }
        sendMessage(joinMsg);
      });

      ws.addEventListener('message', (event) => {
        handleServerMessage(event);
      });

      ws.addEventListener('close', () => {
        state.connected = false;
        appendSystemMessage('Connection lost. Refresh to reconnect.');
      });

      ws.addEventListener('error', () => {
        state.connected = false;
        appendSystemMessage('Connection error. Please try again.');
      });
    } catch (err) {
      appendSystemMessage(`Failed to connect: ${err.message}`);
    }
  }

  function sendMessage(payload) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    // Web PubSub json.webpubsub.azure.v1 subprotocol — send as user event so
    // the server's gameHubMessage handler receives it (not sendToGroup, which
    // bypasses the server entirely).
    state.ws.send(JSON.stringify({
      type: 'event',
      event: 'message',
      dataType: 'json',
      data: payload,
    }));
  }

  function sendCommand(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Local echo
    appendCommandEcho(trimmed);

    // Store in history
    state.commandHistory.push(trimmed);
    state.historyIndex = state.commandHistory.length;

    sendMessage({ type: 'command', text: trimmed });
  }

  // --- Incoming Messages ---
  // Debounce duplicate look messages (e.g. from Web PubSub retry/echo)
  let _lastLookTime = 0;
  let _lastLookRoom = '';

  function handleServerMessage(event) {
    let raw;
    try {
      raw = JSON.parse(event.data);
    } catch {
      return;
    }

    // Web PubSub wraps data in an envelope — unwrap it.
    // Defensive: if data is a string (e.g. server double-serialized), parse it.
    let msg = raw.data || raw;
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg); } catch { return; }
    }

    switch (msg.type) {
      case 'look': {
        const roomKey = msg.room?.name || '';
        const now = Date.now();
        if (roomKey === _lastLookRoom && now - _lastLookTime < 2000) {
          break; // Skip duplicate look for the same room within 2s
        }
        _lastLookTime = now;
        _lastLookRoom = roomKey;
        renderRoomMessage(msg.room);
        break;
      }
      case 'message':
        appendNarrativeMessage(msg.text);
        break;
      case 'error':
        appendErrorMessage(msg.text);
        break;
      case 'inventory':
        renderInventoryMessage(msg.items);
        break;
      case 'playerEvent':
        handlePlayerEvent(msg);
        break;
      case 'gameInfo':
        handleGameInfo(msg);
        break;
      default:
        // Unknown message type — show as system text if it has text
        if (msg.text) appendSystemMessage(msg.text);
        break;
    }
  }

  // --- Message Rendering ---
  function scrollToBottom() {
    const out = els.gameOutput;
    requestAnimationFrame(() => {
      out.scrollTop = out.scrollHeight;
    });
  }

  function appendToOutput(element) {
    els.gameOutput.appendChild(element);
    scrollToBottom();
  }

  function createMsg(className, content) {
    const div = document.createElement('div');
    div.className = `msg ${className}`;
    if (typeof content === 'string') {
      div.textContent = content;
    } else {
      div.appendChild(content);
    }
    return div;
  }

  function appendSystemMessage(text) {
    appendToOutput(createMsg('msg-system', text));
  }

  function appendNarrativeMessage(text) {
    appendToOutput(createMsg('msg-narrative', text));
  }

  function appendErrorMessage(text) {
    appendToOutput(createMsg('msg-error', text));
  }

  function appendCommandEcho(text) {
    appendToOutput(createMsg('msg-command', text));
  }

  function renderRoomMessage(room) {
    const container = document.createElement('div');

    const name = document.createElement('div');
    name.className = 'room-name';
    name.textContent = room.name || 'Unknown Room';
    container.appendChild(name);

    if (room.description) {
      const desc = document.createElement('div');
      desc.className = 'room-desc';
      desc.textContent = room.description;
      container.appendChild(desc);
    }

    if (room.exits && room.exits.length) {
      container.appendChild(
        createRoomSection('Exits', room.exits.join(', '), 'room-exits')
      );
    }

    if (room.items && room.items.length) {
      container.appendChild(
        createRoomSection('Items', room.items.join(', '), 'room-items')
      );
    }

    if (room.players && room.players.length) {
      container.appendChild(
        createRoomSection('Players here', room.players.join(', '), 'room-players-list')
      );
    }

    if (room.hazards && room.hazards.length) {
      container.appendChild(
        createRoomSection('⚠ Hazards', room.hazards.join(', '), 'room-hazard')
      );
    }

    const msg = document.createElement('div');
    msg.className = 'msg msg-room';
    msg.appendChild(container);
    appendToOutput(msg);
  }

  function createRoomSection(label, value, valueClass) {
    const section = document.createElement('div');
    section.className = 'room-section';

    const lbl = document.createElement('span');
    lbl.className = 'room-section-label';
    lbl.textContent = label;
    section.appendChild(lbl);

    const val = document.createElement('span');
    val.className = `room-section-value ${valueClass}`;
    val.textContent = value;
    section.appendChild(val);

    return section;
  }

  function renderInventoryMessage(items) {
    const container = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = '🎒 Inventory';
    container.appendChild(title);

    if (!items || items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'Your inventory is empty.';
      container.appendChild(empty);
    } else {
      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'inv-item';

        const itemName = document.createElement('span');
        itemName.className = 'inv-item-name';
        itemName.textContent = item.name;
        row.appendChild(itemName);

        if (item.description) {
          const itemDesc = document.createElement('span');
          itemDesc.className = 'inv-item-desc';
          itemDesc.textContent = ` — ${item.description}`;
          row.appendChild(itemDesc);
        }

        container.appendChild(row);
      });
    }

    const msg = document.createElement('div');
    msg.className = 'msg msg-inventory';
    msg.appendChild(container);
    appendToOutput(msg);
  }

  function handlePlayerEvent(msg) {
    let text;
    if (msg.text) {
      text = msg.text;
    } else if (msg.event === 'joined') {
      text = `${msg.playerName} has joined the game.`;
    } else {
      text = `${msg.playerName} has left the game.`;
    }
    appendToOutput(createMsg('msg-player-event', text));

    // Update player list (only on actual join/disconnect, not room movement)
    if (msg.event === 'joined' && !state.players.includes(msg.playerName)) {
      state.players.push(msg.playerName);
    } else if (msg.event === 'left') {
      state.players = state.players.filter((p) => p !== msg.playerName);
    }
    updatePlayerCount();
  }

  function handleGameInfo(msg) {
    if (msg.gameId) state.gameId = msg.gameId;
    if (msg.playerCount != null) {
      updatePlayerCount(msg.playerCount);
    }
    if (msg.room) {
      renderRoomMessage(msg.room);
    }
    if (msg.joinUrl && state.isHost) {
      els.lobbyUrl.value = msg.joinUrl;
      renderQrCode(msg.joinUrl);
    }
  }

  function updatePlayerCount(count) {
    const c = count != null ? count : state.players.length;
    els.gamePlayerCount.textContent = c;
    els.lobbyPlayerCount.textContent = c;
  }

  function updateLobbyPlayerList() {
    els.lobbyPlayerList.innerHTML = '';
    state.players.forEach((name) => {
      const li = document.createElement('li');
      li.textContent = name;
      els.lobbyPlayerList.appendChild(li);
    });
    els.lobbyPlayerCount.textContent = state.players.length;
  }

  // --- Join Screen Logic ---
  function initJoin() {
    const urlGameId = getGameIdFromUrl();
    
    // Display the game code
    els.joinDisplayCode.textContent = urlGameId;
    state.gameId = urlGameId;
    
    // Enable button when name is entered
    els.joinPlayerName.addEventListener('input', () => {
      const hasName = els.joinPlayerName.value.trim().length > 0;
      els.btnJoinStart.disabled = !hasName;
    });
    
    // Handle Enter key in name input
    els.joinPlayerName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && els.joinPlayerName.value.trim()) {
        e.preventDefault();
        els.btnJoinStart.click();
      }
    });
    
    // Join button
    els.btnJoinStart.addEventListener('click', () => {
      state.playerName = els.joinPlayerName.value.trim();
      state.isHost = false;
      startJoin();
    });
    
    // Show join screen and focus name input
    showScreen('join');
  }

  // --- Landing Screen Logic ---
  function initLanding() {
    const urlGameId = getGameIdFromUrl();
    
    // If URL has game code, show join screen instead
    if (urlGameId) {
      initJoin();
      return;
    }

    // Enable/disable buttons based on name input
    els.playerName.addEventListener('input', () => {
      const hasName = els.playerName.value.trim().length > 0;
      els.btnHost.disabled = !hasName;
      els.btnJoin.disabled = !hasName;
      els.btnJoinGo.disabled = !hasName || !els.joinCode.value.trim();
    });

    els.joinCode.addEventListener('input', () => {
      els.btnJoinGo.disabled =
        !els.playerName.value.trim() || !els.joinCode.value.trim();
    });

    // Host button
    els.btnHost.addEventListener('click', () => {
      state.playerName = els.playerName.value.trim();
      state.isHost = true;
      state.gameId = generateGameId();
      state.worldId = els.worldSelector.value;
      startHost();
    });

    // Join button — toggle code input
    els.btnJoin.addEventListener('click', () => {
      els.joinCodeGroup.classList.toggle('hidden');
      if (!els.joinCodeGroup.classList.contains('hidden')) {
        els.joinCode.focus();
      }
    });

    // Join go
    els.btnJoinGo.addEventListener('click', () => {
      state.playerName = els.playerName.value.trim();
      state.gameId = els.joinCode.value.trim();
      state.isHost = false;
      startJoin();
    });

    // Focus on name input
    els.playerName.focus();
  }

  function generateGameId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  function startHost() {
    const joinUrl = buildJoinUrl(state.gameId);

    // Set up lobby
    els.lobbyUrl.value = joinUrl;
    renderQrCode(joinUrl);
    state.players = [state.playerName];
    updateLobbyPlayerList();

    // Show selected adventure name in lobby
    const selectedOption = els.worldSelector.options[els.worldSelector.selectedIndex];
    els.lobbyAdventureName.textContent = selectedOption ? `Adventure: ${selectedOption.textContent}` : '';

    showScreen('lobby');

    // Connect
    connectWebSocket(state.gameId);

    // Share URL button — same flow as game Share button
    els.btnCopyUrl.addEventListener('click', () => handleShare(els.btnCopyUrl, 'Share'));

    // Start game button
    els.btnStartGame.addEventListener('click', () => {
      showScreen('game');
    });
  }

  function startJoin() {
    // Update URL without reload
    const joinUrl = buildJoinUrl(state.gameId);
    window.history.replaceState({}, '', `?game=${encodeURIComponent(state.gameId)}`);

    showScreen('game');
    connectWebSocket(state.gameId);
  }

  // --- Clipboard Helper ---
  // Returns true on success, false on failure
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Clipboard API blocked or unavailable (non-secure context, etc.)
    }
    return false;
  }

  // --- Share Logic ---
  // Reusable share handler: native share → QR overlay + clipboard fallback
  async function handleShare(btn, originalText) {
    const joinUrl = buildJoinUrl(state.gameId);

    // Try native Web Share API first (mobile-friendly)
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my text adventure!',
          url: joinUrl,
        });
        showButtonFeedback(btn, 'Shared!', originalText, 1500);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    // Fallback: show QR overlay so user can scan or manually copy
    els.shareUrl.value = joinUrl;
    renderQrCode(joinUrl, els.shareQrCanvas);
    els.shareOverlay.classList.remove('hidden');
    els.shareOverlayClose.focus();

    const copied = await copyToClipboard(joinUrl);
    showButtonFeedback(btn, copied ? 'Copied!' : 'Link ready', originalText, 1500);
  }

  // --- Share Overlay ---
  function initShareOverlay() {
    // Share button click
    els.btnShare.addEventListener('click', () => handleShare(els.btnShare, 'Share'));
    
    // Close button
    els.shareOverlayClose.addEventListener('click', closeShareOverlay);
    
    // Backdrop click
    els.shareOverlay.querySelector('.share-overlay-backdrop').addEventListener('click', closeShareOverlay);
    
    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.shareOverlay.classList.contains('hidden')) {
        closeShareOverlay();
      }
    });
    
    // Copy button in overlay
    els.btnShareCopy.addEventListener('click', async () => {
      const joinUrl = els.shareUrl.value;
      const copied = await copyToClipboard(joinUrl);
      showButtonFeedback(els.btnShareCopy, copied ? 'Copied!' : 'Failed', 'Copy', 2000);
    });
  }
  
  function closeShareOverlay() {
    els.shareOverlay.classList.add('hidden');
    // Return focus to command input
    els.commandInput.focus();
  }

  function showButtonFeedback(btn, text, originalText, duration) {
    btn.textContent = text;
    setTimeout(() => { btn.textContent = originalText; }, duration);
  }

  // --- Command Input ---
  function initCommandInput() {
    els.commandForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = els.commandInput.value;
      els.commandInput.value = '';
      sendCommand(text);
      els.commandInput.focus();
    });

    // Command history (Up/Down arrows)
    els.commandInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (state.historyIndex > 0) {
          state.historyIndex--;
          els.commandInput.value = state.commandHistory[state.historyIndex];
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (state.historyIndex < state.commandHistory.length - 1) {
          state.historyIndex++;
          els.commandInput.value = state.commandHistory[state.historyIndex];
        } else {
          state.historyIndex = state.commandHistory.length;
          els.commandInput.value = '';
        }
      }
    });
  }

  // --- Init ---
  async function init() {
    await loadConfig();
    await loadWorlds();
    initLanding();
    initCommandInput();
    initShareOverlay();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
