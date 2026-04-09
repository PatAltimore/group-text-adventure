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
    playerId: '',
    worldId: '',
    isHost: false,
    ws: null,
    players: [],
    commandHistory: [],
    historyIndex: -1,
    connected: false,
    intentionalDisconnect: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    maxReconnectAttempts: 5,
    pendingRejoin: false,
    isDead: false,
    deathTimer: null,
  };

  // --- DOM References ---
  const $ = (sel) => document.querySelector(sel);
  const screens = {
    home: $('#screen-home'),
    'join-manual': $('#screen-join-manual'),
    join: $('#screen-join'),
    landing: $('#screen-landing'),
    lobby: $('#screen-lobby'),
    game: $('#screen-game'),
    'game-not-found': $('#screen-game-not-found'),
  };
  const els = {
    // Home screen
    btnGoHost: $('#btn-go-host'),
    btnGoJoin: $('#btn-go-join'),

    // Manual join screen
    manualJoinName: $('#manual-join-name'),
    manualJoinCode: $('#manual-join-code'),
    btnManualJoin: $('#btn-manual-join'),
    linkManualJoinBack: $('#link-manual-join-back'),

    // Join screen (URL-based)
    joinPlayerName: $('#join-player-name'),
    joinDisplayCode: $('#join-display-code'),
    btnJoinStart: $('#btn-join-start'),
    
    // Landing screen (host setup)
    playerName: $('#player-name'),
    btnHost: $('#btn-host'),
    linkHostBack: $('#link-host-back'),
    
    // Lobby screen
    btnCopyUrl: $('#btn-copy-url'),
    lobbyPlayerCount: $('#lobby-player-count'),
    lobbyPlayerList: $('#lobby-player-list'),
    btnStartGame: $('#btn-start-game'),
    lobbyWaitingMsg: $('#lobby-waiting-msg'),
    
    // Game screen
    gameTitle: $('#game-title'),
    gamePlayerCount: $('#game-player-count'),
    gameOutput: $('#game-output'),
    commandForm: $('#command-form'),
    commandInput: $('#command-input'),
    btnShare: $('#btn-share'),
    btnQr: $('#btn-qr'),
    btnHostNew: $('#btn-host-new'),
    
    // World selector
    worldSelectorGroup: $('#world-selector-group'),
    worldSelectorList: $('#world-selector-list'),
    lobbyAdventureName: $('#lobby-adventure-name'),

    // Share overlay
    shareOverlay: $('#share-overlay'),
    shareOverlayClose: $('#share-overlay-close'),
    shareQrCanvas: $('#share-qr-canvas'),
    shareUrl: $('#share-url'),
    btnShareCopy: $('#btn-share-copy'),

    // Lobby QR (always visible for host)
    lobbyQr: $('#lobby-qr'),
    lobbyQrLabel: $('#lobby-qr-label'),

    // Death overlay
    deathOverlay: $('#death-overlay'),
    deathText: $('#death-text'),
    deathCountdown: $('#death-countdown'),

    // Lobby death timeout (host-only)
    deathTimeoutGroup: $('#death-timeout-group'),
    deathTimeoutSelect: $('#death-timeout-select'),

    // Lobby hazard multiplier (host-only)
    hazardMultiplierGroup: $('#hazard-multiplier-group'),
    hazardMultiplierSelect: $('#hazard-multiplier-select'),

    // Lobby say scope (host-only)
    sayScopeGroup: $('#say-scope-group'),
    sayScopeSelect: $('#say-scope-select'),

    // Lobby hints toggle (host-only)
    hintsGroup: $('#hints-group'),
    hintsToggle: $('#hints-toggle'),
  };

  // --- Screen Management ---
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
    if (name === 'game') {
      els.commandInput.focus();
    } else if (name === 'join') {
      els.joinPlayerName.focus();
    } else if (name === 'join-manual') {
      els.manualJoinName.focus();
    } else if (name === 'landing') {
      screens[name].scrollTop = 0;
    }
  }

  // --- World Loading ---

  // Fallback world list when the /api/worlds endpoint is unreachable
  // (cold start, local dev without API, transient network error).
  const FALLBACK_WORLDS = [
    { id: 'default-world', name: 'The Forgotten Castle', description: 'An ancient castle shrouded in mist, perched atop a cliff that the locals dare not climb.', synopsis: 'Explore a cursed castle atop misty cliffs.' },
    { id: 'escape-room', name: 'The Clockmaker\'s Mansion', description: 'You awaken in the foyer of an old mansion. Find the seven keys hidden in the home, or remain here forever.', synopsis: 'Find seven keys to escape the mansion.' },
    { id: 'space-adventure', name: 'The Derelict Station', description: 'A deep-space research station gone dark. Reach the command deck before life support fails.', synopsis: 'Survive a dying space station.' },
  ];

  function populateWorldSelector(worlds) {
    try {
      els.worldSelectorList.innerHTML = '';
      worlds.forEach((world, idx) => {
        const card = document.createElement('div');
        card.className = 'world-card' + (idx === 0 ? ' selected' : '');
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', idx === 0 ? 'true' : 'false');
        card.setAttribute('tabindex', '0');
        card.dataset.worldId = world.id;

        const name = document.createElement('div');
        name.className = 'world-card-name';
        name.textContent = world.name;

        const desc = document.createElement('div');
        desc.className = 'world-card-desc';
        desc.textContent = world.synopsis || (world.description ? world.description.substring(0, 80) + '…' : '');

        card.appendChild(name);
        card.appendChild(desc);

        card.addEventListener('click', () => selectWorldCard(card));
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectWorldCard(card);
          }
        });

        els.worldSelectorList.appendChild(card);
      });
      // Auto-select first world
      if (worlds.length > 0) {
        state.worldId = worlds[0].id;
      }
    } catch (e) {
      console.error('[Worlds] Could not populate world selector:', e);
    }
  }

  function selectWorldCard(card) {
    const cards = els.worldSelectorList.querySelectorAll('.world-card');
    cards.forEach((c) => {
      c.classList.remove('selected');
      c.setAttribute('aria-checked', 'false');
    });
    card.classList.add('selected');
    card.setAttribute('aria-checked', 'true');
    state.worldId = card.dataset.worldId;
  }

  function getSelectedWorldName() {
    const selected = els.worldSelectorList.querySelector('.world-card.selected');
    if (selected) {
      const nameEl = selected.querySelector('.world-card-name');
      return nameEl ? nameEl.textContent : '';
    }
    return '';
  }

  async function loadWorlds() {
    // Show loading indicator while fetching
    els.worldSelectorList.innerHTML = '<div class="world-card-loading">Loading adventures…</div>';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${apiBaseUrl}/api/worlds`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const worlds = await res.json();
      if (!Array.isArray(worlds) || worlds.length === 0) throw new Error('Empty response');

      populateWorldSelector(worlds);
    } catch (err) {
      console.log('[Worlds] Failed to load worlds:', err.message, '— using fallback list');
      populateWorldSelector(FALLBACK_WORLDS);
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
    const container = targetContainer;
    if (!container) return;

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

  // --- Session Persistence (localStorage for cross-tab-close survival) ---
  function saveSession() {
    try {
      localStorage.setItem('gta_gameId', state.gameId);
      localStorage.setItem('gta_playerName', state.playerName);
      if (state.playerId) localStorage.setItem('gta_playerId', state.playerId);
    } catch { /* storage unavailable */ }
  }

  function loadSession() {
    try {
      return {
        gameId: localStorage.getItem('gta_gameId') || '',
        playerName: localStorage.getItem('gta_playerName') || '',
        playerId: localStorage.getItem('gta_playerId') || '',
      };
    } catch { return { gameId: '', playerName: '', playerId: '' }; }
  }

  function clearSession() {
    try {
      localStorage.removeItem('gta_gameId');
      localStorage.removeItem('gta_playerName');
      localStorage.removeItem('gta_playerId');
    } catch { /* storage unavailable */ }
  }

  // --- Reconnect Banner ---
  function showReconnectBanner(message, tappable) {
    let banner = document.getElementById('reconnect-banner');
    if (!banner) return;
    banner.textContent = message;
    banner.classList.remove('hidden');
    if (tappable) {
      banner.classList.add('reconnect-tappable');
    } else {
      banner.classList.remove('reconnect-tappable');
    }
  }

  function hideReconnectBanner() {
    const banner = document.getElementById('reconnect-banner');
    if (banner) {
      banner.classList.add('hidden');
      banner.classList.remove('reconnect-tappable');
    }
  }

  // --- WebSocket ---
  async function connectWebSocket(gameId) {
    try {
      // Close existing connection to prevent duplicate listeners
      if (state.ws) {
        state.intentionalDisconnect = true;
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
      state.intentionalDisconnect = false;

      ws.addEventListener('open', () => {
        state.connected = true;
        state.reconnectAttempts = 0;
        hideReconnectBanner();
        const joinMsg = { type: 'join', playerName: state.playerName, gameId: state.gameId };
        if (state.isHost && state.worldId) {
          joinMsg.worldId = state.worldId;
        }
        if (state.pendingRejoin) {
          joinMsg.rejoin = true;
          if (state.playerId) joinMsg.playerId = state.playerId;
        }
        sendMessage(joinMsg);
        saveSession();
      });

      ws.addEventListener('message', (event) => {
        handleServerMessage(event);
      });

      ws.addEventListener('close', () => {
        state.connected = false;
        if (!state.intentionalDisconnect) {
          attemptReconnect();
        }
      });

      ws.addEventListener('error', () => {
        state.connected = false;
      });
    } catch (err) {
      appendSystemMessage(`Failed to connect: ${err.message}`);
      throw err;
    }
  }

  function attemptReconnect() {
    if (state.reconnectAttempts >= state.maxReconnectAttempts) {
      showReconnectBanner('Connection lost. Tap to reconnect.', true);
      return;
    }

    state.reconnectAttempts++;
    const delay = Math.min(2000 * Math.pow(1.5, state.reconnectAttempts - 1), 10000);
    showReconnectBanner(`Connection lost. Reconnecting… (${state.reconnectAttempts}/${state.maxReconnectAttempts})`, false);

    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(async () => {
      try {
        // Mark as rejoin so the server reclaims the ghost instead of creating
        // a new player. Only set if we have a playerId to send.
        if (state.playerId) state.pendingRejoin = true;
        await connectWebSocket(state.gameId);
      } catch {
        // Negotiate failed (no WebSocket created) — continue retry chain
        attemptReconnect();
      }
    }, delay);
  }

  function manualReconnect() {
    state.reconnectAttempts = 0;
    if (state.playerId) state.pendingRejoin = true;
    hideReconnectBanner();
    showReconnectBanner('Reconnecting…', false);
    connectWebSocket(state.gameId).catch(() => {
      showReconnectBanner('Connection lost. Tap to reconnect.', true);
    });
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
    if (state.isDead) return;

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
        dismissDeathOverlay();
        renderRoomMessage(msg.room);
        break;
      }
      case 'message':
        appendNarrativeMessage(msg.text);
        break;
      case 'error':
        appendErrorMessage(msg.text);
        showLobbyError(msg.text);
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
      case 'gameStart':
        dismissDeathOverlay();
        handleGameStart(msg);
        break;
      case 'playerDrop':
        handlePlayerDrop(msg);
        break;
      case 'revived':
        dismissDeathOverlay();
        if (msg.room) renderRoomMessage(msg.room);
        appendSystemMessage('You have returned from the dead!');
        break;
      case 'ghostEvent':
        appendGhostMessage(msg.text);
        break;
      case 'death':
        appendToOutput(createMsg('msg-death-notification', `☠️ ${msg.deathText || 'You have died.'}`));
        showDeathScreen(msg.deathText, msg.deathTimeout);
        break;
      case 'playerDeath':
        appendToOutput(createMsg('msg-death-notification', `💀 ${msg.playerName} has been killed by a hazard!`));
        break;
      case 'playerRespawn':
        appendToOutput(createMsg('msg-respawn-notification', `${msg.playerName} has respawned.`));
        break;
      case 'goalComplete':
        renderGoalComplete(msg);
        break;
      case 'victoryComplete':
        renderVictoryComplete(msg);
        break;
      case 'gameNotFound':
        handleGameNotFound(msg);
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

  function showLobbyError(text) {
    const lobbyScreen = screens.lobby;
    if (!lobbyScreen || !lobbyScreen.classList.contains('active')) return;
    let errEl = lobbyScreen.querySelector('.lobby-error');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'lobby-error';
      lobbyScreen.appendChild(errEl);
    }
    errEl.textContent = `⚠️ ${text}`;
    errEl.classList.remove('hidden');
  }

  function appendCommandEcho(text) {
    appendToOutput(createMsg('msg-command', text));
  }

  function appendGhostMessage(text) {
    appendToOutput(createMsg('msg-ghost', `👻 ${text}`));
  }

  function renderRoomMessage(room) {
    const container = document.createElement('div');

    const name = document.createElement('div');
    name.className = 'room-name';
    name.textContent = room.name || 'Unknown Room';
    container.appendChild(name);

    // Goal progress display - right after room name
    if (room.goalProgress && room.goalProgress.total > 0) {
      const progress = document.createElement('div');
      progress.className = 'goal-progress';
      progress.textContent = `🏆 Goals: ${room.goalProgress.completed}/${room.goalProgress.total}`;
      container.appendChild(progress);
    }

    // Split items into native and displaced
    const nativeItems = (room.items || []).filter(item => !item.displaced);
    const displacedItems = (room.items || []).filter(item => item.displaced);

    // Build room description with native item roomText woven in
    let fullDescription = room.description || '';
    if (nativeItems.length) {
      nativeItems.forEach((item) => {
        if (typeof item === 'object' && item.roomText) {
          fullDescription += ' ' + item.roomText;
        }
      });
    }
    if (fullDescription) {
      const desc = document.createElement('div');
      desc.className = 'room-desc';
      desc.textContent = fullDescription.trim();
      container.appendChild(desc);
    }

    // Puzzle hint display - right after room description
    if (room.hintText) {
      const hint = document.createElement('div');
      hint.className = 'room-hint';
      hint.textContent = `💡 Hint: ${room.hintText}`;
      container.appendChild(hint);
    }

    // Show displaced items separately
    if (displacedItems.length) {
      const droppedDiv = document.createElement('div');
      droppedDiv.className = 'room-dropped-items';
      droppedDiv.appendChild(document.createTextNode('Some dropped items are here: '));
      displacedItems.forEach((item, i) => {
        const itemName = typeof item === 'string' ? item : (item.name || 'Unknown');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'room-item-name';
        nameSpan.textContent = itemName;
        droppedDiv.appendChild(nameSpan);
        if (i < displacedItems.length - 1) {
          droppedDiv.appendChild(document.createTextNode(', '));
        }
      });
      droppedDiv.appendChild(document.createTextNode('.'));
      container.appendChild(droppedDiv);
    }

    if (nativeItems.length) {
      const section = document.createElement('div');
      section.className = 'room-section';
      const lbl = document.createElement('span');
      lbl.className = 'room-section-label';
      lbl.textContent = 'Items';
      section.appendChild(lbl);
      const itemsContainer = document.createElement('span');
      itemsContainer.className = 'room-section-value room-items';
      nativeItems.forEach((item, i) => {
        const itemName = typeof item === 'string' ? item : (item.name || item.id || 'Unknown');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'room-item-name';
        nameSpan.textContent = itemName;
        itemsContainer.appendChild(nameSpan);
        if (i < nativeItems.length - 1) {
          itemsContainer.appendChild(document.createTextNode(', '));
        }
      });
      section.appendChild(itemsContainer);
      container.appendChild(section);
    }

    if (room.players && room.players.length) {
      container.appendChild(
        createRoomSection('Players here', room.players.join(', '), 'room-players-list')
      );
    }

    if (room.ghosts && room.ghosts.length) {
      const ghostText = room.ghosts.map(g => `👻 ${g} lingers here.`).join('  ');
      container.appendChild(
        createRoomSection('Ghosts', ghostText, 'room-ghosts')
      );
    }

    if (room.hazards && room.hazards.length) {
      const hazardTexts = room.hazards.map((h) =>
        typeof h === 'string' ? h : (h.description || 'Unknown hazard')
      );
      container.appendChild(
        createRoomSection('⚠ Hazards', hazardTexts.join(', '), 'room-hazard')
      );
    }

    if (room.exits && room.exits.length) {
      container.appendChild(
        createRoomSection('Exits', room.exits.join(', '), 'room-exits')
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

        if (typeof item === 'string') {
          const itemName = document.createElement('span');
          itemName.className = 'inv-item-name';
          itemName.textContent = item;
          row.appendChild(itemName);
        } else {
          const itemName = document.createElement('span');
          itemName.className = 'inv-item-name';
          itemName.textContent = item.name || item.id || 'Unknown';
          row.appendChild(itemName);

          if (item.description) {
            const itemDesc = document.createElement('span');
            itemDesc.className = 'inv-item-desc';
            itemDesc.textContent = ` — ${item.description}`;
            row.appendChild(itemDesc);
          }
        }

        container.appendChild(row);
      });
    }

    const msg = document.createElement('div');
    msg.className = 'msg msg-inventory';
    msg.appendChild(container);
    appendToOutput(msg);
  }

  function renderGoalComplete(msg) {
    const container = document.createElement('div');
    container.className = 'goal-complete';

    // ASCII art display
    if (msg.asciiArt) {
      const art = document.createElement('pre');
      art.className = 'goal-ascii-art';
      art.textContent = msg.asciiArt;
      container.appendChild(art);
    }

    // Achievement text
    const goalText = document.createElement('div');
    goalText.className = 'goal-text';
    goalText.textContent = `🏆 ${msg.playerName} achieved: ${msg.goalName}!`;
    container.appendChild(goalText);

    // Progress indicator
    const progressText = document.createElement('div');
    progressText.className = 'goal-progress-text';
    progressText.textContent = `Goals: ${msg.goalNumber}/${msg.totalGoals}`;
    container.appendChild(progressText);

    appendToOutput(container);
  }

  function renderVictoryComplete(msg) {
    const container = document.createElement('div');
    container.className = 'victory-complete';

    // ASCII art display
    if (msg.asciiArt) {
      const art = document.createElement('pre');
      art.className = 'victory-ascii-art';
      art.textContent = msg.asciiArt;
      container.appendChild(art);
    }

    // Victory text
    const victoryText = document.createElement('div');
    victoryText.className = 'victory-text';
    victoryText.textContent = '🎉 Adventure Complete! All goals have been achieved! 🎉';
    container.appendChild(victoryText);

    appendToOutput(container);
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
    updateLobbyPlayerList();
  }

  function handleGameInfo(msg) {
    if (msg.gameId) state.gameId = msg.gameId;
    if (msg.playerId) state.playerId = msg.playerId;
    saveSession();

    if (Array.isArray(msg.players)) {
      state.players = msg.players.slice();
      updateLobbyPlayerList();
    }
    if (msg.playerCount != null) {
      updatePlayerCount(msg.playerCount);
    }
    if (msg.adventureName && els.lobbyAdventureName) {
      els.lobbyAdventureName.textContent = `Adventure: ${msg.adventureName}`;
    }
    // Update game banner title for joiners/reconnectors
    if (els.gameTitle && msg.adventureName) {
      const name = msg.adventureName || 'Group Text Adventure';
      const code = msg.gameCode || state.gameId || '';
      els.gameTitle.textContent = `🏰 Group Text Adventure — ${name}${code ? ' — ' + code : ''}`;
    }

    // Reconnection: server restored player state
    if (msg.reconnected) {
      state.pendingRejoin = false;
      showScreen('game');
      if (msg.room) {
        renderRoomMessage(msg.room);
        const roomName = msg.room.name || 'the game';
        appendGhostMessage(`You reclaim your ghostly form. You're back in ${roomName}.`);
      }
      if (msg.inventory && msg.inventory.length > 0) {
        renderInventoryMessage(msg.inventory);
      }
      return;
    }

    // Post-start join: room is present, skip lobby and go straight to game
    if (msg.room) {
      state.pendingRejoin = false;
      showScreen('game');
      renderRoomMessage(msg.room);
      return;
    }

    // Pre-start: no room yet — show lobby
    if (state.pendingRejoin) {
      state.pendingRejoin = false;
      // Auto-rejoin landed before the game started — switch to lobby
      els.btnStartGame.classList.add('hidden');
      els.lobbyWaitingMsg.classList.remove('hidden');
      showScreen('lobby');
    }

    if (msg.joinUrl) {
      // joinUrl available for share overlay (stored in state)
    }
  }

  function handleGameStart(msg) {
    dismissDeathOverlay();
    // Update banner with adventure name and game code
    if (els.gameTitle) {
      const name = msg.adventureName || 'Group Text Adventure';
      const code = msg.gameCode || state.gameId || '';
      els.gameTitle.textContent = `🏰 Group Text Adventure — ${name}${code ? ' — ' + code : ''}`;
    }
    showScreen('game');
    if (msg.shareHint) {
      appendToOutput(createMsg('msg-share-hint', msg.shareHint));
    }
    if (msg.room) {
      renderRoomMessage(msg.room);
    }
  }

  function handlePlayerDrop(msg) {
    // Ghost loot: a ghost was looted or faded away
    const text = msg.text || `${msg.playerName}'s ghost fades away.`;
    appendGhostMessage(text);
  }

  // --- Game Not Found ---
  function handleGameNotFound(msg) {
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }
    showScreen('game-not-found');
  }

  // --- Death Screen ---
  function showDeathScreen(deathText, timeout) {
    state.isDead = true;
    els.commandInput.disabled = true;
    els.deathOverlay.classList.remove('hidden');
    els.deathText.textContent = deathText || 'You have died.';

    let remaining = timeout || 30;
    els.deathCountdown.textContent = `Respawning in ${remaining} seconds...`;

    if (state.deathTimer) clearInterval(state.deathTimer);
    state.deathTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(state.deathTimer);
        state.deathTimer = null;
        els.deathCountdown.textContent = 'Respawning...';
        sendMessage({ type: 'revive', playerId: state.playerId });
      } else {
        els.deathCountdown.textContent = `Respawning in ${remaining} second${remaining !== 1 ? 's' : ''}...`;
      }
    }, 1000);
  }

  function dismissDeathOverlay() {
    if (!state.isDead) return;
    state.isDead = false;
    if (state.deathTimer) {
      clearInterval(state.deathTimer);
      state.deathTimer = null;
    }
    els.deathOverlay.classList.add('hidden');
    els.commandInput.disabled = false;
    els.commandInput.focus();
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

  // --- Home Screen Logic ---
  function initHome() {
    // "Host a Game" → load worlds (if needed) and show host setup screen
    els.btnGoHost.addEventListener('click', async () => {
      els.btnGoHost.disabled = true;
      els.btnGoHost.textContent = 'Loading…';
      await loadWorlds();
      els.btnGoHost.disabled = false;
      els.btnGoHost.textContent = 'Host a Game';
      initLanding();
      showScreen('landing');
    });

    // "Join a Game" → show manual join screen
    els.btnGoJoin.addEventListener('click', () => {
      initJoinManual();
      showScreen('join-manual');
    });

    showScreen('home');
  }

  // --- Manual Join Screen Logic ---
  function initJoinManual() {
    const nameInput = els.manualJoinName;
    const codeInput = els.manualJoinCode;
    const btn = els.btnManualJoin;

    // Remove old listeners by cloning
    const newName = nameInput.cloneNode(true);
    nameInput.parentNode.replaceChild(newName, nameInput);
    els.manualJoinName = newName;

    const newCode = codeInput.cloneNode(true);
    codeInput.parentNode.replaceChild(newCode, codeInput);
    els.manualJoinCode = newCode;

    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    els.btnManualJoin = newBtn;

    function updateBtn() {
      els.btnManualJoin.disabled = !els.manualJoinName.value.trim() || !els.manualJoinCode.value.trim();
    }

    els.manualJoinName.addEventListener('input', updateBtn);
    els.manualJoinCode.addEventListener('input', updateBtn);

    // Enter key in either input
    els.manualJoinName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !els.btnManualJoin.disabled) {
        e.preventDefault();
        els.btnManualJoin.click();
      }
    });
    els.manualJoinCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !els.btnManualJoin.disabled) {
        e.preventDefault();
        els.btnManualJoin.click();
      }
    });

    els.btnManualJoin.addEventListener('click', () => {
      state.playerName = els.manualJoinName.value.trim();
      state.gameId = els.manualJoinCode.value.trim().toUpperCase();
      state.isHost = false;
      startJoin();
    });

    // Back link
    els.linkManualJoinBack.addEventListener('click', (e) => {
      e.preventDefault();
      showScreen('home');
    });
  }

  // --- Landing Screen Logic (Host Setup) ---
  function initLanding() {
    // Enable/disable host button based on name input
    els.playerName.addEventListener('input', () => {
      const hasName = els.playerName.value.trim().length > 0;
      els.btnHost.disabled = !hasName;
    });

    // Host button
    els.btnHost.addEventListener('click', () => {
      state.playerName = els.playerName.value.trim();
      state.isHost = true;
      state.gameId = generateGameId();
      startHost();
    });

    // Back link
    els.linkHostBack.addEventListener('click', (e) => {
      e.preventDefault();
      showScreen('home');
    });

    // Game-not-found: host a new game
    document.getElementById('btn-host-from-notfound').addEventListener('click', () => {
      window.history.replaceState({}, '', window.location.pathname);
      state.gameId = null;
      state.isHost = false;
      state.pendingRejoin = false;
      showScreen('home');
    });
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

    // Set up lobby — host sees Start Adventure button, not waiting message
    els.btnStartGame.classList.remove('hidden');
    els.lobbyWaitingMsg.classList.add('hidden');
    els.btnStartGame.disabled = false;
    els.btnStartGame.textContent = 'Start Adventure';

    state.players = [state.playerName];
    updateLobbyPlayerList();

    // Show selected adventure name in lobby
    els.lobbyAdventureName.textContent = `Adventure: ${getSelectedWorldName()}`;

    showScreen('lobby');

    // Connect
    connectWebSocket(state.gameId);

    // Share URL button — same flow as game Share button
    els.btnCopyUrl.addEventListener('click', () => handleShare(els.btnCopyUrl, '📤 Share Game Link'));

    // Render QR code always visible in lobby for the host
    renderQrCode(joinUrl, els.lobbyQr);
    if (els.lobbyQrLabel) els.lobbyQrLabel.classList.remove('hidden');

    // Start game button — send startGame to server; actual transition
    // happens when the server broadcasts gameStart back to all clients
    els.btnStartGame.addEventListener('click', () => {
      const deathTimeout = els.deathTimeoutSelect ? parseInt(els.deathTimeoutSelect.value, 10) : 30;
      const hazardMultiplier = els.hazardMultiplierSelect ? parseFloat(els.hazardMultiplierSelect.value) : 1;
      const sayScope = els.sayScopeSelect ? els.sayScopeSelect.value : 'room';
      const hintsEnabled = els.hintsToggle ? els.hintsToggle.value === 'true' : false;
      sendMessage({ type: 'startGame', deathTimeout, hazardMultiplier, sayScope, hintsEnabled });
      els.btnStartGame.disabled = true;
      els.btnStartGame.textContent = 'Starting…';
    });
  }

  function startJoin() {
    // Update URL without reload
    const joinUrl = buildJoinUrl(state.gameId);
    window.history.replaceState({}, '', `?game=${encodeURIComponent(state.gameId)}`);

    // Show lobby for joiners (not game screen) — host-only controls hidden
    els.btnStartGame.classList.add('hidden');
    els.lobbyWaitingMsg.classList.remove('hidden');

    // Set up lobby share info
    state.players = [state.playerName];
    updateLobbyPlayerList();

    // Show adventure name if available (will be updated by gameInfo)
    els.lobbyAdventureName.textContent = '';

    showScreen('lobby');

    // Share URL button
    els.btnCopyUrl.addEventListener('click', () => handleShare(els.btnCopyUrl, '📤 Share Game Link'));

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
    // Share Link button — copies URL, uses native share on mobile
    els.btnShare.addEventListener('click', () => handleShare(els.btnShare, '🔗 Share'));

    // QR Code button — directly opens QR overlay (no native share)
    els.btnQr.addEventListener('click', () => {
      const joinUrl = buildJoinUrl(state.gameId);
      els.shareUrl.value = joinUrl;
      renderQrCode(joinUrl, els.shareQrCanvas);
      els.shareOverlay.classList.remove('hidden');
      els.shareOverlayClose.focus();
    });

    // Host New Game button — clear session and navigate to fresh landing screen
    els.btnHostNew.addEventListener('click', () => {
      if (confirm('Leave this game and host a new one?')) {
        clearSession();
        window.location.href = window.location.pathname;
      }
    });
    
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

    // Reconnect banner tap handler
    const banner = document.getElementById('reconnect-banner');
    if (banner) {
      banner.addEventListener('click', () => {
        if (banner.classList.contains('reconnect-tappable')) {
          manualReconnect();
        }
      });
    }

    // Check localStorage for auto-rejoin
    const session = loadSession();
    const urlGameId = getGameIdFromUrl();
    const sessionGameId = session.gameId;
    const sessionPlayerName = session.playerName;

    // Suppress reconnect loop during page unload (refresh keeps localStorage intact)
    window.addEventListener('beforeunload', () => {
      state.intentionalDisconnect = true;
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    });

    // URL points to a different game than stored session — clear stale data
    if (urlGameId && sessionGameId && urlGameId !== sessionGameId) {
      clearSession();
    }

    // Auto-rejoin: session exists and URL matches (or no URL game param)
    if (sessionGameId && sessionPlayerName && (!urlGameId || urlGameId === sessionGameId)) {
      state.gameId = sessionGameId;
      state.playerName = sessionPlayerName;
      state.playerId = session.playerId || '';
      state.isHost = false;
      state.pendingRejoin = true;

      window.history.replaceState({}, '', `?game=${encodeURIComponent(sessionGameId)}`);

      // Show game screen with reconnecting indicator
      showScreen('game');
      appendSystemMessage('Reconnecting…');
      initCommandInput();
      initShareOverlay();

      try {
        await connectWebSocket(sessionGameId);
      } catch {
        // Reconnection failed — fall back to home screen
        state.pendingRejoin = false;
        clearSession();
        els.gameOutput.innerHTML = '';
        initHome();
        initCommandInput();
        initShareOverlay();
      }
      return;
    }

    // Normal flow
    if (urlGameId) {
      // URL has ?game= param — go directly to URL-based join screen
      initJoin();
      initCommandInput();
      initShareOverlay();
    } else {
      // No URL param — show home screen
      initHome();
      initCommandInput();
      initShareOverlay();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
