// World Editor — editor.js
// Vanilla JS, no frameworks. Manages world JSON editing with an interactive SVG map.

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let world = null;         // The current world JSON object
  let fileName = '';        // Loaded filename for Save
  let selectedRoomId = null;
  let selectedItemId = null;
  let selectedPuzzleId = null;
  let roomPositions = {};   // { roomId: { x, y } } — editor-only layout positions

  // Map panning/zooming state
  let viewBox = { x: 0, y: 0, w: 1200, h: 800 };
  let isPanning = false;
  let panStart = { x: 0, y: 0 };

  // Room dragging state
  let isDragging = false;
  let dragRoomId = null;
  let dragOffset = { x: 0, y: 0 };

  // Constants
  const ROOM_W = 150;
  const ROOM_H = 60;
  const GRID_STEP = 200;
  const DIR_OFFSETS = {
    north: { dx: 0, dy: -1 },
    south: { dx: 0, dy: 1 },
    east:  { dx: 1, dy: 0 },
    west:  { dx: -1, dy: 0 },
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    worldName: $('#world-name'),
    worldDesc: $('#world-desc'),
    btnNew: $('#btn-new'),
    btnLoad: $('#btn-load'),
    btnSave: $('#btn-save'),
    btnSaveAs: $('#btn-save-as'),
    fileInput: $('#file-input'),
    loadPreset: $('#load-preset'),
    btnAddRoom: $('#btn-add-room'),
    btnResetLayout: $('#btn-reset-layout'),
    btnZoomIn: $('#btn-zoom-in'),
    btnZoomOut: $('#btn-zoom-out'),
    btnZoomFit: $('#btn-zoom-fit'),
    svg: $('#map-svg'),
    mapContainer: $('#map-container'),
    editPlaceholder: $('#edit-placeholder'),
    editForm: $('#edit-form'),
    roomId: $('#room-id'),
    roomName: $('#room-name'),
    roomDescription: $('#room-description'),
    roomIsStart: $('#room-is-start'),
    exitNorth: $('#exit-north'),
    exitSouth: $('#exit-south'),
    exitEast: $('#exit-east'),
    exitWest: $('#exit-west'),
    roomItemsList: $('#room-items-list'),
    roomHazardsList: $('#room-hazards-list'),
    btnAddHazard: $('#btn-add-hazard'),
    btnDeleteRoom: $('#btn-delete-room'),
    itemsList: $('#items-list'),
    itemPlaceholder: $('#item-placeholder'),
    itemForm: $('#item-form'),
    itemId: $('#item-id'),
    itemName: $('#item-name'),
    itemDescription: $('#item-description'),
    itemPickup: $('#item-pickup'),
    itemRoomText: $('#item-room-text'),
    itemPortable: $('#item-portable'),
    btnAddItem: $('#btn-add-item'),
    btnDeleteItem: $('#btn-delete-item'),
    puzzlesList: $('#puzzles-list'),
    puzzlePlaceholder: $('#puzzle-placeholder'),
    puzzleForm: $('#puzzle-form'),
    puzzleId: $('#puzzle-id'),
    puzzleRoom: $('#puzzle-room'),
    puzzleDescription: $('#puzzle-description'),
    puzzleRequiredItem: $('#puzzle-required-item'),
    puzzleSolvedText: $('#puzzle-solved-text'),
    puzzleActionType: $('#puzzle-action-type'),
    puzzleActionDir: $('#puzzle-action-dir'),
    puzzleActionTarget: $('#puzzle-action-target'),
    btnAddPuzzle: $('#btn-add-puzzle'),
    btnDeletePuzzle: $('#btn-delete-puzzle'),
  };

  // ── Utility ────────────────────────────────────────────────────────────────
  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ` toast-${type}` : '');
    el.textContent = msg;
    const container = $('#toast-container');
    container.appendChild(el);
    setTimeout(() => { el.remove(); }, 3000);
  }

  function generateId(prefix) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let suffix = '';
    for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    return `${prefix}-${suffix}`;
  }

  // ── World Operations ──────────────────────────────────────────────────────
  function newWorld() {
    const roomId = 'start-room';
    world = {
      name: 'New World',
      description: '',
      startRoom: roomId,
      rooms: {
        [roomId]: {
          name: 'Starting Room',
          description: 'You are in an empty room.',
          exits: {},
          items: [],
          hazards: [],
        },
      },
      items: {},
      puzzles: {},
    };
    fileName = '';
    roomPositions = { [roomId]: { x: 400, y: 300 } };
    selectedRoomId = null;
    selectedItemId = null;
    selectedPuzzleId = null;
    syncToUI();
    toast('New world created', 'success');
  }

  function loadWorldFromObject(obj, name) {
    world = obj;
    if (!world.rooms) world.rooms = {};
    if (!world.items) world.items = {};
    if (!world.puzzles) world.puzzles = {};
    // Ensure every room has its arrays
    for (const r of Object.values(world.rooms)) {
      if (!r.exits) r.exits = {};
      if (!r.items) r.items = [];
      if (!r.hazards) r.hazards = [];
    }
    fileName = name || '';
    selectedRoomId = null;
    selectedItemId = null;
    selectedPuzzleId = null;
    autoLayout();
    syncToUI();
  }

  function loadFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        loadWorldFromObject(obj, file.name);
        toast(`Loaded ${file.name}`, 'success');
      } catch (e) {
        toast('Invalid JSON file', 'error');
      }
    };
    reader.readAsText(file);
  }

  async function loadPreset(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(resp.statusText);
      const obj = await resp.json();
      const name = url.split('/').pop();
      loadWorldFromObject(obj, name);
      toast(`Loaded ${name}`, 'success');
    } catch (e) {
      toast('Failed to load preset: ' + e.message, 'error');
    }
  }

  function buildJSON() {
    return JSON.stringify(world, null, 2);
  }

  function downloadJSON(fname) {
    const blob = new Blob([buildJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function doSave() {
    const name = fileName || 'world.json';
    downloadJSON(name);
    toast(`Saved ${name}`, 'success');
  }

  function doSaveAs() {
    const name = prompt('Save as filename:', fileName || 'world.json');
    if (!name) return;
    fileName = name.endsWith('.json') ? name : name + '.json';
    downloadJSON(fileName);
    toast(`Saved ${fileName}`, 'success');
  }

  // ── Auto Layout ────────────────────────────────────────────────────────────
  function autoLayout() {
    roomPositions = {};
    if (!world || !world.rooms) return;
    const roomIds = Object.keys(world.rooms);
    if (roomIds.length === 0) return;

    const startId = world.startRoom && world.rooms[world.startRoom] ? world.startRoom : roomIds[0];
    const visited = new Set();
    const queue = [{ id: startId, gx: 0, gy: 0 }];
    visited.add(startId);
    const gridPositions = {};

    // BFS placing rooms on a grid using compass direction hints
    while (queue.length > 0) {
      const { id, gx, gy } = queue.shift();
      // Find a free grid cell near the target
      const pos = findFreeCell(gridPositions, gx, gy);
      gridPositions[id] = pos;

      const room = world.rooms[id];
      if (!room || !room.exits) continue;
      for (const [dir, targetId] of Object.entries(room.exits)) {
        if (visited.has(targetId) || !world.rooms[targetId]) continue;
        visited.add(targetId);
        const off = DIR_OFFSETS[dir] || { dx: 0, dy: 0 };
        queue.push({ id: targetId, gx: pos.gx + off.dx, gy: pos.gy + off.dy });
      }
    }

    // Place any disconnected rooms
    for (const id of roomIds) {
      if (!gridPositions[id]) {
        visited.add(id);
        const pos = findFreeCell(gridPositions, 0, roomIds.indexOf(id) + 1);
        gridPositions[id] = pos;
      }
    }

    // Convert grid positions to pixel positions
    const centerX = 400;
    const centerY = 300;
    for (const [id, pos] of Object.entries(gridPositions)) {
      roomPositions[id] = {
        x: centerX + pos.gx * GRID_STEP,
        y: centerY + pos.gy * GRID_STEP,
      };
    }
  }

  function findFreeCell(grid, gx, gy) {
    const occupied = new Set(Object.values(grid).map(p => `${p.gx},${p.gy}`));
    if (!occupied.has(`${gx},${gy}`)) return { gx, gy };
    // Spiral outward to find free cell
    for (let r = 1; r < 20; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const key = `${gx + dx},${gy + dy}`;
          if (!occupied.has(key)) return { gx: gx + dx, gy: gy + dy };
        }
      }
    }
    return { gx, gy };
  }

  // ── Sync UI ────────────────────────────────────────────────────────────────
  function syncToUI() {
    if (!world) return;
    dom.worldName.value = world.name || '';
    dom.worldDesc.value = world.description || '';
    renderMap();
    renderRoomEditor();
    renderItemsList();
    renderItemEditor();
    renderPuzzlesList();
    renderPuzzleEditor();
  }

  // ── SVG Map Rendering ─────────────────────────────────────────────────────
  function renderMap() {
    const svg = dom.svg;
    // Clear
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!world || !world.rooms) return;

    // Fit viewBox
    svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);

    const roomIds = Object.keys(world.rooms);
    const drawnExits = new Set();

    // Draw exit lines first (behind rooms)
    for (const roomId of roomIds) {
      const room = world.rooms[roomId];
      const pos = roomPositions[roomId];
      if (!pos || !room.exits) continue;
      for (const [dir, targetId] of Object.entries(room.exits)) {
        const tpos = roomPositions[targetId];
        if (!tpos) continue;
        const edgeKey = [roomId, targetId].sort().join('|');
        if (drawnExits.has(edgeKey)) continue;
        drawnExits.add(edgeKey);
        drawExitLine(svg, pos, tpos, roomId, targetId);
      }
    }

    // Draw rooms
    for (const roomId of roomIds) {
      const room = world.rooms[roomId];
      const pos = roomPositions[roomId];
      if (!pos) continue;
      drawRoom(svg, roomId, room, pos);
    }
  }

  function drawExitLine(svg, fromPos, toPos, fromId, toId) {
    const line = svgEl('line', {
      x1: fromPos.x, y1: fromPos.y,
      x2: toPos.x, y2: toPos.y,
      class: 'exit-line',
    });
    svg.appendChild(line);

    // Find direction labels for this connection
    const fromRoom = world.rooms[fromId];
    const toRoom = world.rooms[toId];
    const labels = [];
    if (fromRoom && fromRoom.exits) {
      for (const [dir, tid] of Object.entries(fromRoom.exits)) {
        if (tid === toId) labels.push(dir.charAt(0).toUpperCase());
      }
    }
    if (toRoom && toRoom.exits) {
      for (const [dir, tid] of Object.entries(toRoom.exits)) {
        if (tid === fromId) labels.push(dir.charAt(0).toUpperCase());
      }
    }

    if (labels.length > 0) {
      const mx = (fromPos.x + toPos.x) / 2;
      const my = (fromPos.y + toPos.y) / 2;
      const label = svgEl('text', { x: mx, y: my - 6, class: 'exit-label' });
      label.textContent = [...new Set(labels)].join('/');
      svg.appendChild(label);
    }
  }

  function drawRoom(svg, roomId, room, pos) {
    const g = svgEl('g', { class: 'room-node', 'data-room': roomId });
    const x = pos.x - ROOM_W / 2;
    const y = pos.y - ROOM_H / 2;

    const isStart = world.startRoom === roomId;
    const isSelected = selectedRoomId === roomId;
    let cls = 'room-rect';
    if (isStart) cls += ' start-room';
    if (isSelected) cls += ' selected';

    const rect = svgEl('rect', {
      x, y, width: ROOM_W, height: ROOM_H, class: cls,
    });
    g.appendChild(rect);

    // Room name
    const nameLabel = svgEl('text', {
      x: pos.x, y: pos.y - 4, class: 'room-label',
    });
    nameLabel.textContent = truncate(room.name || roomId, 18);
    g.appendChild(nameLabel);

    // Room ID
    const idLabel = svgEl('text', {
      x: pos.x, y: pos.y + 14, class: 'room-id-label',
    });
    idLabel.textContent = truncate(roomId, 22);
    g.appendChild(idLabel);

    // Puzzle indicator
    const hasPuzzle = Object.values(world.puzzles || {}).some(p => p.room === roomId);
    if (hasPuzzle) {
      const pInd = svgEl('text', {
        x: x + ROOM_W - 10, y: y + 14, class: 'puzzle-indicator',
      });
      pInd.textContent = '🧩';
      g.appendChild(pInd);
    }

    // Events
    g.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      isDragging = true;
      dragRoomId = roomId;
      const pt = svgPoint(e);
      dragOffset.x = pt.x - pos.x;
      dragOffset.y = pt.y - pos.y;
      selectRoom(roomId);
    });

    svg.appendChild(g);
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      el.setAttribute(k, v);
    }
    return el;
  }

  function svgPoint(e) {
    const svg = dom.svg;
    const rect = svg.getBoundingClientRect();
    return {
      x: viewBox.x + (e.clientX - rect.left) / rect.width * viewBox.w,
      y: viewBox.y + (e.clientY - rect.top) / rect.height * viewBox.h,
    };
  }

  function truncate(s, max) {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // ── Map Interactions ───────────────────────────────────────────────────────
  function initMapInteractions() {
    const container = dom.mapContainer;
    const svg = dom.svg;

    // Pan: mousedown on background
    svg.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || isDragging) return;
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      container.classList.add('grabbing');
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging && dragRoomId) {
        const pt = svgPoint(e);
        roomPositions[dragRoomId] = {
          x: pt.x - dragOffset.x,
          y: pt.y - dragOffset.y,
        };
        renderMap();
        return;
      }
      if (isPanning) {
        const rect = svg.getBoundingClientRect();
        const dx = (e.clientX - panStart.x) / rect.width * viewBox.w;
        const dy = (e.clientY - panStart.y) / rect.height * viewBox.h;
        viewBox.x -= dx;
        viewBox.y -= dy;
        panStart = { x: e.clientX, y: e.clientY };
        svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
      }
    });

    window.addEventListener('mouseup', () => {
      isPanning = false;
      isDragging = false;
      dragRoomId = null;
      container.classList.remove('grabbing');
    });

    // Zoom
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = e.deltaY > 0 ? 1.1 : 0.9;
      const rect = svg.getBoundingClientRect();
      const mx = viewBox.x + (e.clientX - rect.left) / rect.width * viewBox.w;
      const my = viewBox.y + (e.clientY - rect.top) / rect.height * viewBox.h;

      const nw = viewBox.w * scale;
      const nh = viewBox.h * scale;
      viewBox.x = mx - (mx - viewBox.x) * scale;
      viewBox.y = my - (my - viewBox.y) * scale;
      viewBox.w = nw;
      viewBox.h = nh;
      svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
    }, { passive: false });

    // Click on empty space to deselect
    svg.addEventListener('click', (e) => {
      if (e.target === svg) {
        selectRoom(null);
      }
    });
  }

  // ── Zoom Buttons ──────────────────────────────────────────────────────────
  function zoomIn() {
    const cx = viewBox.x + viewBox.w / 2;
    const cy = viewBox.y + viewBox.h / 2;
    viewBox.w *= 0.8;
    viewBox.h *= 0.8;
    viewBox.x = cx - viewBox.w / 2;
    viewBox.y = cy - viewBox.h / 2;
    dom.svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
  }

  function zoomOut() {
    const cx = viewBox.x + viewBox.w / 2;
    const cy = viewBox.y + viewBox.h / 2;
    viewBox.w *= 1.25;
    viewBox.h *= 1.25;
    viewBox.x = cx - viewBox.w / 2;
    viewBox.y = cy - viewBox.h / 2;
    dom.svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
  }

  function zoomFit() {
    const ids = Object.keys(roomPositions);
    if (ids.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const id of ids) {
      const p = roomPositions[id];
      minX = Math.min(minX, p.x - ROOM_W);
      maxX = Math.max(maxX, p.x + ROOM_W);
      minY = Math.min(minY, p.y - ROOM_H);
      maxY = Math.max(maxY, p.y + ROOM_H);
    }
    const pad = 60;
    viewBox.x = minX - pad;
    viewBox.y = minY - pad;
    viewBox.w = (maxX - minX) + pad * 2;
    viewBox.h = (maxY - minY) + pad * 2;
    dom.svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
  }

  // ── Room Selection & Editing ───────────────────────────────────────────────
  function selectRoom(roomId) {
    selectedRoomId = roomId;
    renderMap();
    renderRoomEditor();
  }

  function renderRoomEditor() {
    if (!selectedRoomId || !world || !world.rooms[selectedRoomId]) {
      dom.editPlaceholder.classList.remove('hidden');
      dom.editForm.classList.add('hidden');
      return;
    }

    dom.editPlaceholder.classList.add('hidden');
    dom.editForm.classList.remove('hidden');

    const room = world.rooms[selectedRoomId];

    // Room ID — read-only for existing rooms
    dom.roomId.value = selectedRoomId;
    dom.roomId.readOnly = true;

    dom.roomName.value = room.name || '';
    dom.roomDescription.value = room.description || '';
    dom.roomIsStart.checked = world.startRoom === selectedRoomId;

    // Exits dropdowns
    populateExitDropdown(dom.exitNorth, room.exits.north || '');
    populateExitDropdown(dom.exitSouth, room.exits.south || '');
    populateExitDropdown(dom.exitEast, room.exits.east || '');
    populateExitDropdown(dom.exitWest, room.exits.west || '');

    // Items checkboxes
    renderRoomItemsCheckboxes(room);

    // Hazards
    renderHazardsList(room);
  }

  function populateExitDropdown(select, currentVal) {
    const roomIds = Object.keys(world.rooms).filter(id => id !== selectedRoomId);
    select.innerHTML = '<option value="">— none —</option>';
    for (const id of roomIds) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${world.rooms[id].name || id} (${id})`;
      if (id === currentVal) opt.selected = true;
      select.appendChild(opt);
    }
  }

  function renderRoomItemsCheckboxes(room) {
    const container = dom.roomItemsList;
    container.innerHTML = '';
    const allItems = Object.keys(world.items || {});
    if (allItems.length === 0) {
      container.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">No items defined yet.</span>';
      return;
    }
    for (const itemId of allItems) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = itemId;
      cb.checked = room.items.includes(itemId);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!room.items.includes(itemId)) room.items.push(itemId);
        } else {
          room.items = room.items.filter(i => i !== itemId);
        }
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(world.items[itemId].name || itemId));
      container.appendChild(label);
    }
  }

  function renderHazardsList(room) {
    const container = dom.roomHazardsList;
    container.innerHTML = '';

    // Normalize legacy string hazards to objects
    for (let i = 0; i < room.hazards.length; i++) {
      if (typeof room.hazards[i] === 'string') {
        room.hazards[i] = { description: room.hazards[i], probability: 0.3, deathText: '' };
      }
    }

    for (let i = 0; i < room.hazards.length; i++) {
      const hazard = room.hazards[i];
      const card = document.createElement('div');
      card.className = 'hazard-card';

      // Description
      const descLabel = document.createElement('label');
      descLabel.textContent = 'Description';
      const descInput = document.createElement('input');
      descInput.type = 'text';
      descInput.value = hazard.description || '';
      descInput.placeholder = 'What the player sees…';
      descInput.addEventListener('input', () => { hazard.description = descInput.value; });
      card.appendChild(descLabel);
      card.appendChild(descInput);

      // Probability
      const probLabel = document.createElement('label');
      probLabel.textContent = 'Probability';
      const probInput = document.createElement('input');
      probInput.type = 'number';
      probInput.min = '0';
      probInput.max = '1';
      probInput.step = '0.05';
      probInput.value = hazard.probability != null ? hazard.probability : 0.3;
      probInput.addEventListener('input', () => { hazard.probability = parseFloat(probInput.value) || 0; });
      card.appendChild(probLabel);
      card.appendChild(probInput);

      // Death text
      const deathLabel = document.createElement('label');
      deathLabel.textContent = 'Death Text';
      const deathInput = document.createElement('input');
      deathInput.type = 'text';
      deathInput.value = hazard.deathText || '';
      deathInput.placeholder = 'How the player dies…';
      deathInput.addEventListener('input', () => { hazard.deathText = deathInput.value; });
      card.appendChild(deathLabel);
      card.appendChild(deathInput);

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-small btn-danger hazard-remove-btn';
      removeBtn.textContent = '✕ Remove';
      removeBtn.addEventListener('click', () => {
        room.hazards.splice(i, 1);
        renderHazardsList(room);
      });
      card.appendChild(removeBtn);

      container.appendChild(card);
    }
  }

  function saveRoomEdits() {
    if (!selectedRoomId || !world.rooms[selectedRoomId]) return;
    const room = world.rooms[selectedRoomId];
    room.name = dom.roomName.value;
    room.description = dom.roomDescription.value;

    if (dom.roomIsStart.checked) {
      world.startRoom = selectedRoomId;
    }

    // Update exits
    room.exits = {};
    if (dom.exitNorth.value) room.exits.north = dom.exitNorth.value;
    if (dom.exitSouth.value) room.exits.south = dom.exitSouth.value;
    if (dom.exitEast.value) room.exits.east = dom.exitEast.value;
    if (dom.exitWest.value) room.exits.west = dom.exitWest.value;

    renderMap();
  }

  function addHazard() {
    if (!selectedRoomId || !world.rooms[selectedRoomId]) return;
    world.rooms[selectedRoomId].hazards.push({
      description: 'New hazard',
      probability: 0.3,
      deathText: '',
    });
    renderHazardsList(world.rooms[selectedRoomId]);
  }

  function deleteRoom() {
    if (!selectedRoomId) return;
    if (!confirm(`Delete room "${selectedRoomId}"? This will also remove exits pointing to it.`)) return;
    const id = selectedRoomId;

    // Remove exits pointing to this room
    for (const room of Object.values(world.rooms)) {
      for (const [dir, tid] of Object.entries(room.exits)) {
        if (tid === id) delete room.exits[dir];
      }
    }

    // Remove items from room back to unplaced
    // Remove puzzles referencing this room
    for (const [pid, puzzle] of Object.entries(world.puzzles)) {
      if (puzzle.room === id) delete world.puzzles[pid];
      if (puzzle.action && puzzle.action.targetRoom === id) {
        delete puzzle.action.targetRoom;
      }
    }

    delete world.rooms[id];
    delete roomPositions[id];

    if (world.startRoom === id) {
      world.startRoom = Object.keys(world.rooms)[0] || '';
    }

    selectedRoomId = null;
    syncToUI();
    toast('Room deleted', 'success');
  }

  function addRoom() {
    const id = generateId('room');
    world.rooms[id] = {
      name: 'New Room',
      description: '',
      exits: {},
      items: [],
      hazards: [],
    };
    // Place near center of current view
    roomPositions[id] = {
      x: viewBox.x + viewBox.w / 2,
      y: viewBox.y + viewBox.h / 2,
    };
    selectRoom(id);
    renderMap();
    renderItemsList();
    renderPuzzlesList();
    toast('Room added — drag it into place', 'success');
  }

  // ── Items ──────────────────────────────────────────────────────────────────
  function renderItemsList() {
    const list = dom.itemsList;
    list.innerHTML = '';
    for (const [id, item] of Object.entries(world.items || {})) {
      const li = document.createElement('li');
      li.textContent = `${item.name || id}`;
      li.title = id;
      if (id === selectedItemId) li.className = 'selected';
      li.addEventListener('click', () => selectItem(id));
      list.appendChild(li);
    }
  }

  function selectItem(id) {
    selectedItemId = id;
    renderItemsList();
    renderItemEditor();
  }

  function renderItemEditor() {
    if (!selectedItemId || !world.items[selectedItemId]) {
      dom.itemPlaceholder.classList.remove('hidden');
      dom.itemForm.classList.add('hidden');
      return;
    }
    dom.itemPlaceholder.classList.add('hidden');
    dom.itemForm.classList.remove('hidden');

    const item = world.items[selectedItemId];
    dom.itemId.value = selectedItemId;
    dom.itemId.readOnly = true;
    dom.itemName.value = item.name || '';
    dom.itemDescription.value = item.description || '';
    dom.itemPickup.value = item.pickupText || '';
    dom.itemRoomText.value = item.roomText || '';
    dom.itemPortable.checked = item.portable !== false;
  }

  function saveItemEdits() {
    if (!selectedItemId || !world.items[selectedItemId]) return;
    const item = world.items[selectedItemId];
    item.name = dom.itemName.value;
    item.description = dom.itemDescription.value;
    item.pickupText = dom.itemPickup.value;
    item.roomText = dom.itemRoomText.value;
    item.portable = dom.itemPortable.checked;
    renderItemsList();
    // Refresh room editor in case item names changed
    if (selectedRoomId) renderRoomEditor();
  }

  function addItem() {
    const id = generateId('item');
    world.items[id] = {
      name: 'New Item',
      description: '',
      pickupText: '',
      roomText: '',
      portable: true,
    };
    selectItem(id);
    renderItemsList();
    // Refresh room items checkboxes
    if (selectedRoomId) renderRoomEditor();
    toast('Item added', 'success');
  }

  function deleteItem() {
    if (!selectedItemId) return;
    if (!confirm(`Delete item "${selectedItemId}"?`)) return;
    const id = selectedItemId;

    // Remove from room item lists
    for (const room of Object.values(world.rooms)) {
      room.items = room.items.filter(i => i !== id);
    }

    // Remove from puzzles
    for (const puzzle of Object.values(world.puzzles)) {
      if (puzzle.requiredItem === id) puzzle.requiredItem = '';
    }

    delete world.items[id];
    selectedItemId = null;
    renderItemsList();
    renderItemEditor();
    if (selectedRoomId) renderRoomEditor();
    renderPuzzleEditor();
    toast('Item deleted', 'success');
  }

  // ── Puzzles ────────────────────────────────────────────────────────────────
  function renderPuzzlesList() {
    const list = dom.puzzlesList;
    list.innerHTML = '';
    for (const [id, puzzle] of Object.entries(world.puzzles || {})) {
      const li = document.createElement('li');
      li.textContent = id;
      li.title = puzzle.description || id;
      if (id === selectedPuzzleId) li.className = 'selected';
      li.addEventListener('click', () => selectPuzzle(id));
      list.appendChild(li);
    }
  }

  function selectPuzzle(id) {
    selectedPuzzleId = id;
    renderPuzzlesList();
    renderPuzzleEditor();
  }

  function renderPuzzleEditor() {
    if (!selectedPuzzleId || !world.puzzles[selectedPuzzleId]) {
      dom.puzzlePlaceholder.classList.remove('hidden');
      dom.puzzleForm.classList.add('hidden');
      return;
    }
    dom.puzzlePlaceholder.classList.add('hidden');
    dom.puzzleForm.classList.remove('hidden');

    const puzzle = world.puzzles[selectedPuzzleId];
    dom.puzzleId.value = selectedPuzzleId;
    dom.puzzleId.readOnly = true;
    dom.puzzleDescription.value = puzzle.description || '';
    dom.puzzleSolvedText.value = puzzle.solvedText || '';

    // Room dropdown
    populateRoomDropdown(dom.puzzleRoom, puzzle.room || '');

    // Required item dropdown
    populateItemDropdown(dom.puzzleRequiredItem, puzzle.requiredItem || '');

    // Action
    const action = puzzle.action || {};
    dom.puzzleActionType.value = action.type || 'openExit';
    dom.puzzleActionDir.value = action.direction || 'north';
    populateRoomDropdown(dom.puzzleActionTarget, action.targetRoom || '');
  }

  function populateRoomDropdown(select, currentVal) {
    select.innerHTML = '<option value="">— select —</option>';
    for (const [id, room] of Object.entries(world.rooms || {})) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${room.name || id} (${id})`;
      if (id === currentVal) opt.selected = true;
      select.appendChild(opt);
    }
  }

  function populateItemDropdown(select, currentVal) {
    select.innerHTML = '<option value="">— select —</option>';
    for (const [id, item] of Object.entries(world.items || {})) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${item.name || id} (${id})`;
      if (id === currentVal) opt.selected = true;
      select.appendChild(opt);
    }
  }

  function savePuzzleEdits() {
    if (!selectedPuzzleId || !world.puzzles[selectedPuzzleId]) return;
    const puzzle = world.puzzles[selectedPuzzleId];
    puzzle.description = dom.puzzleDescription.value;
    puzzle.solvedText = dom.puzzleSolvedText.value;
    puzzle.room = dom.puzzleRoom.value;
    puzzle.requiredItem = dom.puzzleRequiredItem.value;
    puzzle.action = {
      type: dom.puzzleActionType.value || 'openExit',
      direction: dom.puzzleActionDir.value || 'north',
      targetRoom: dom.puzzleActionTarget.value || '',
    };
    renderPuzzlesList();
    renderMap(); // puzzle indicator may have moved
  }

  function addPuzzle() {
    const id = generateId('puzzle');
    world.puzzles[id] = {
      room: '',
      description: '',
      requiredItem: '',
      solvedText: '',
      action: { type: 'openExit', direction: 'north', targetRoom: '' },
    };
    selectPuzzle(id);
    renderPuzzlesList();
    toast('Puzzle added', 'success');
  }

  function deletePuzzle() {
    if (!selectedPuzzleId) return;
    if (!confirm(`Delete puzzle "${selectedPuzzleId}"?`)) return;
    delete world.puzzles[selectedPuzzleId];
    selectedPuzzleId = null;
    renderPuzzlesList();
    renderPuzzleEditor();
    renderMap();
    toast('Puzzle deleted', 'success');
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────
  function initTabs() {
    for (const btn of $$('.tab-btn')) {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach(b => b.classList.remove('active'));
        $$('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tab = document.getElementById(btn.dataset.tab);
        if (tab) tab.classList.add('active');
      });
    }
  }

  // ── Event Binding ──────────────────────────────────────────────────────────
  function bindEvents() {
    // Toolbar
    dom.worldName.addEventListener('input', () => { if (world) world.name = dom.worldName.value; });
    dom.worldDesc.addEventListener('input', () => { if (world) world.description = dom.worldDesc.value; });
    dom.btnNew.addEventListener('click', () => {
      if (world && !confirm('Create a new world? Unsaved changes will be lost.')) return;
      newWorld();
    });
    dom.btnLoad.addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) loadFromFile(e.target.files[0]);
      e.target.value = '';
    });
    dom.loadPreset.addEventListener('change', (e) => {
      if (e.target.value) loadPreset(e.target.value);
      e.target.value = '';
    });
    dom.btnSave.addEventListener('click', doSave);
    dom.btnSaveAs.addEventListener('click', doSaveAs);

    // Map controls
    dom.btnAddRoom.addEventListener('click', addRoom);
    dom.btnResetLayout.addEventListener('click', () => { autoLayout(); renderMap(); zoomFit(); });
    dom.btnZoomIn.addEventListener('click', zoomIn);
    dom.btnZoomOut.addEventListener('click', zoomOut);
    dom.btnZoomFit.addEventListener('click', zoomFit);

    // Room editor — live save on input
    dom.roomName.addEventListener('input', saveRoomEdits);
    dom.roomDescription.addEventListener('input', saveRoomEdits);
    dom.roomIsStart.addEventListener('change', saveRoomEdits);
    dom.exitNorth.addEventListener('change', saveRoomEdits);
    dom.exitSouth.addEventListener('change', saveRoomEdits);
    dom.exitEast.addEventListener('change', saveRoomEdits);
    dom.exitWest.addEventListener('change', saveRoomEdits);
    dom.btnAddHazard.addEventListener('click', addHazard);
    dom.btnDeleteRoom.addEventListener('click', deleteRoom);

    // Item editor
    dom.btnAddItem.addEventListener('click', addItem);
    dom.btnDeleteItem.addEventListener('click', deleteItem);
    dom.itemName.addEventListener('input', saveItemEdits);
    dom.itemDescription.addEventListener('input', saveItemEdits);
    dom.itemPickup.addEventListener('input', saveItemEdits);
    dom.itemRoomText.addEventListener('input', saveItemEdits);
    dom.itemPortable.addEventListener('change', saveItemEdits);

    // Puzzle editor
    dom.btnAddPuzzle.addEventListener('click', addPuzzle);
    dom.btnDeletePuzzle.addEventListener('click', deletePuzzle);
    dom.puzzleDescription.addEventListener('input', savePuzzleEdits);
    dom.puzzleSolvedText.addEventListener('input', savePuzzleEdits);
    dom.puzzleRoom.addEventListener('change', savePuzzleEdits);
    dom.puzzleRequiredItem.addEventListener('change', savePuzzleEdits);
    dom.puzzleActionType.addEventListener('change', savePuzzleEdits);
    dom.puzzleActionDir.addEventListener('change', savePuzzleEdits);
    dom.puzzleActionTarget.addEventListener('change', savePuzzleEdits);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    initTabs();
    initMapInteractions();
    bindEvents();
    // Start with a blank world
    newWorld();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
