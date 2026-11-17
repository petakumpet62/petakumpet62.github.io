const STORAGE_KEY = 'petak628.rooms';
const ROOM_DURATION_SECONDS = 90;
const ROLE_AVATARS = {
  SEEKER: 'assets/avatars/seeker.webp',
  HIDER: 'assets/avatars/hider.webp',
  IMPOSTOR: 'assets/avatars/impostor.webp',
};

const appState = {
  rooms: loadRooms(),
  currentRoomCode: null,
  currentPlayerId: null,
  currentPlayerName: '',
};

const setupPanel = document.getElementById('setupPanel');
const lobbyPanel = document.getElementById('lobbyPanel');
const gamePanel = document.getElementById('gamePanel');

const playerNameInput = document.getElementById('playerNameInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinCodeInput = document.getElementById('joinCodeInput');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const startGameBtn = document.getElementById('startGameBtn');
const roomCodeText = document.getElementById('roomCodeText');
const copyRoomBtn = document.getElementById('copyRoomBtn');
const playerCountText = document.getElementById('playerCountText');
const startGameHint = document.getElementById('startGameHint');
const playerList = document.getElementById('playerList');
const roleCard = document.getElementById('roleCard');
const timerText = document.getElementById('timerText');
const timerProgress = document.getElementById('timerProgress');
const missionList = document.getElementById('missionList');
const actionButtons = document.getElementById('actionButtons');
const eventLog = document.getElementById('eventLog');
const gameStateText = document.getElementById('gameStateText');
const gamePhaseBadge = document.getElementById('gamePhaseBadge');
const rematchBtn = document.getElementById('rematchBtn');
const appAlert = document.getElementById('appAlert');
const appAlertMessage = document.getElementById('appAlertMessage');
const appAlertConfirm = document.getElementById('appAlertConfirm');
let appAlertReturnFocus = null;

createRoomBtn.addEventListener('click', handleCreateRoom);
joinRoomBtn.addEventListener('click', handleJoinRoom);
startGameBtn.addEventListener('click', handleStartGame);
copyRoomBtn.addEventListener('click', handleCopyRoomCode);
rematchBtn.addEventListener('click', handleRematch);
playerNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleCreateRoom();
  }
});
joinCodeInput.addEventListener('input', () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});
joinCodeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleJoinRoom();
  }
});
appAlertConfirm.addEventListener('click', dismissAppAlert);
appAlert.querySelector('[data-alert-dismiss]').addEventListener('click', dismissAppAlert);
document.addEventListener('keydown', (event) => {
  if (appAlert.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    dismissAppAlert();
  } else if (event.key === 'Tab') {
    event.preventDefault();
    appAlertConfirm.focus();
  }
});

function showAppAlert(message) {
  appAlertReturnFocus = document.activeElement;
  appAlertMessage.textContent = message;
  appAlert.classList.remove('hidden');
  appAlertConfirm.focus();
}

function dismissAppAlert() {
  appAlert.classList.add('hidden');
  if (appAlertReturnFocus instanceof HTMLElement) appAlertReturnFocus.focus();
  appAlertReturnFocus = null;
}

async function handleCopyRoomCode() {
  const room = getCurrentRoom();
  if (!room) return;

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API tidak tersedia.');
    }

    await navigator.clipboard.writeText(room.code);
    copyRoomBtn.textContent = 'Tersalin!';
    window.setTimeout(() => {
      copyRoomBtn.textContent = 'Salin kode';
    }, 1600);
  } catch (error) {
    console.error('Gagal menyalin kode room', error);
    showAppAlert('Kode room tidak dapat disalin. Silakan salin kode secara manual.');
  }
}

function escapeHtml(value) {
  const replacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(value).replace(/[&<>"']/g, (character) => replacements[character]);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function getRoleAvatarMarkup(role) {
  const imagePath = ROLE_AVATARS[role];
  if (!imagePath) return '';

  return `
    <span class="role-avatar-frame" aria-hidden="true">
      <img class="role-avatar" src="${imagePath}" alt="" width="104" height="104" />
      <span class="role-avatar-fallback hidden">${role.charAt(0)}</span>
    </span>
  `;
}

function bindRoleAvatarFallback() {
  const avatar = roleCard.querySelector('.role-avatar');
  avatar?.addEventListener('error', () => {
    avatar.classList.add('hidden');
    avatar.nextElementSibling?.classList.remove('hidden');
  }, { once: true });
}

function uid() {
  return `p-${Math.random().toString(16).slice(2, 10)}-${Date.now().toString(36)}`;
}

function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function ensureRoomCodeIsUnique(code) {
  return !appState.rooms[code];
}

function loadRooms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Gagal memuat room', error);
    return {};
  }
}

function saveRooms() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.rooms));
}

function getCurrentRoom() {
  return appState.currentRoomCode ? appState.rooms[appState.currentRoomCode] : null;
}

function getCurrentPlayer(room = getCurrentRoom()) {
  if (!room || !appState.currentPlayerId) {
    return null;
  }

  return room.players.find((player) => player.id === appState.currentPlayerId) || null;
}

function normalizeName(value) {
  const name = (value || '').trim();
  return name || 'Player';
}

function addLog(room, message) {
  if (!room) return;
  room.eventLog.unshift(message);
  room.eventLog = room.eventLog.slice(0, 12);
}

function buildMissions(role) {
  if (role === 'SEEKER') {
    return [
      { id: 'seek_scan', label: 'Scan area', goal: 2, progress: 0 },
      { id: 'seek_find', label: 'Temukan Hider', goal: 1, progress: 0 },
      { id: 'seek_guard', label: 'Amankan perimeter', goal: 1, progress: 0 },
    ];
  }

  if (role === 'IMPOSTOR') {
    return [
      { id: 'imp_sneak', label: 'Buat kebingungan', goal: 2, progress: 0 },
      { id: 'imp_escape', label: 'Terlalu sulit terlihat', goal: 1, progress: 0 },
      { id: 'imp_secret', label: 'Misi rahasia', goal: 1, progress: 0 },
    ];
  }

  return [
    { id: 'hide_move', label: 'Bertahan di zona aman', goal: 2, progress: 0 },
    { id: 'hide_stealth', label: 'Sembunyi tanpa terdeteksi', goal: 1, progress: 0 },
    { id: 'hide_survive', label: 'Selamat sampai timer habis', goal: 1, progress: 0 },
  ];
}

function assignRoles(room) {
  const players = [...room.players];
  const shuffled = players.sort(() => Math.random() - 0.5);
  const seeker = shuffled[0];
  const impostor = shuffled[1] || shuffled[0];

  room.players = shuffled.map((player, index) => {
    let role = 'HIDER';
    if (player.id === seeker.id) role = 'SEEKER';
    if (player.id === impostor.id && player.id !== seeker.id) role = 'IMPOSTOR';

    return {
      ...player,
      role,
      missions: buildMissions(role),
      isFound: false,
      secretMissionDone: false,
      status: 'READY',
    };
  });

  room.phase = 'PLAYING';
  room.status = 'PLAYING';
  room.timeLeft = ROOM_DURATION_SECONDS;
  room.winner = null;
  room.startedAt = Date.now();

  addLog(room, 'Role dibagikan secara rahasia oleh server.');
  addLog(room, 'Permainan dimulai. Semua pemain siap bergerak.');
}

function updateMissionProgress(player, missionId, step = 1) {
  const mission = player.missions.find((item) => item.id === missionId);
  if (!mission) return;

  mission.progress = Math.min(mission.goal, mission.progress + step);
  if (mission.progress >= mission.goal && mission.id === 'imp_secret') {
    player.secretMissionDone = true;
  }
}

function getWinnerFromRoom(room) {
  const seekers = room.players.filter((player) => player.role === 'SEEKER');
  const hiders = room.players.filter((player) => player.role !== 'SEEKER');
  const hiddenHiders = hiders.filter((player) => !player.isFound);
  const impostor = hiders.find((player) => player.role === 'IMPOSTOR');

  const allHidersFound = hiders.length > 0 && hiders.every((player) => player.isFound);
  const seekerWon = allHidersFound || seekers.some((player) => player.role === 'SEEKER' && room.timeLeft <= 0 && hiddenHiders.length === 0);
  const impostorWon = Boolean(impostor && !impostor.isFound && impostor.secretMissionDone);

  if (seekerWon) return 'SEEKER';
  if (impostorWon) return 'IMPOSTOR';
  return 'HIDER';
}

function endRoom(room) {
  room.phase = 'FINISHED';
  room.status = 'FINISHED';
  room.winner = getWinnerFromRoom(room);

  const message = room.winner === 'SEEKER'
    ? 'Seeker menang: semua Hider terdeteksi.'
    : room.winner === 'IMPOSTOR'
      ? 'Impostor menang: misi rahasia berhasil.'
      : 'Hider menang: mereka bertahan sampai waktu habis.';

  addLog(room, message);
  saveRooms();
  render();
}

function handleTick() {
  const room = getCurrentRoom();
  if (!room || room.phase !== 'PLAYING') return;

  room.timeLeft = Math.max(0, room.timeLeft - 1);

  if (room.timeLeft <= 0) {
    endRoom(room);
    return;
  }

  saveRooms();
  render();
}

setInterval(handleTick, 1000);

function handleCreateRoom() {
  const name = normalizeName(playerNameInput.value);
  let code = randomRoomCode();

  while (!ensureRoomCodeIsUnique(code)) {
    code = randomRoomCode();
  }

  const room = {
    code,
    phase: 'LOBBY',
    status: 'LOBBY',
    winner: null,
    timeLeft: ROOM_DURATION_SECONDS,
    players: [
      {
        id: uid(),
        name,
        isHost: true,
        role: null,
        missions: [],
        isFound: false,
        secretMissionDone: false,
        status: 'READY',
      },
    ],
    eventLog: ['Room dibuat. Tunggu pemain bergabung.'],
  };

  appState.rooms[code] = room;
  appState.currentRoomCode = code;
  appState.currentPlayerId = room.players[0].id;
  appState.currentPlayerName = name;

  saveRooms();
  render();
}

function handleJoinRoom() {
  const code = normalizeName(joinCodeInput.value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const room = appState.rooms[code];
  const name = normalizeName(playerNameInput.value);

  if (!room) {
    showAppAlert('Room tidak ditemukan. Coba kode lain.');
    return;
  }

  if (room.phase !== 'LOBBY' || room.status !== 'LOBBY') {
    showAppAlert('Room sudah dimulai. Tidak bisa join lagi.');
    return;
  }

  const player = {
    id: uid(),
    name,
    isHost: false,
    role: null,
    missions: [],
    isFound: false,
    secretMissionDone: false,
    status: 'READY',
  };

  room.players.push(player);
  appState.currentRoomCode = code;
  appState.currentPlayerId = player.id;
  appState.currentPlayerName = name;
  addLog(room, `${name} bergabung ke room.`);

  saveRooms();
  render();
}

function handleStartGame() {
  const room = getCurrentRoom();
  const currentPlayer = getCurrentPlayer(room);

  if (!room || !currentPlayer || !currentPlayer.isHost) {
    return;
  }

  if (room.players.length < 2) {
    showAppAlert('Minimal 2 pemain untuk memulai sesi.');
    return;
  }

  assignRoles(room);
  saveRooms();
  render();
}

function handleRematch() {
  const room = getCurrentRoom();
  if (!room) return;

  room.phase = 'LOBBY';
  room.status = 'LOBBY';
  room.winner = null;
  room.timeLeft = ROOM_DURATION_SECONDS;
  room.players = room.players.map((player) => ({
    ...player,
    role: null,
    missions: [],
    isFound: false,
    secretMissionDone: false,
    status: 'READY',
  }));
  room.eventLog = ['Room direset. Siap untuk rematch.'];

  saveRooms();
  render();
}

function render() {
  const room = getCurrentRoom();
  const currentPlayer = getCurrentPlayer(room);

  setupPanel.classList.toggle('hidden', Boolean(room));
  lobbyPanel.classList.toggle('hidden', !room || room.phase !== 'LOBBY');
  gamePanel.classList.toggle('hidden', !room || room.phase === 'LOBBY');

  if (!room) {
    return;
  }

  if (room.phase === 'LOBBY') {
    roomCodeText.textContent = room.code;
    renderLobby(room, currentPlayer);
    return;
  }

  renderGameView(room, currentPlayer);
}

function renderLobby(room, currentPlayer) {
  const isHost = currentPlayer && currentPlayer.isHost;
  const playerCount = room.players.length;
  playerCountText.textContent = `${playerCount} pemain`;
  startGameBtn.classList.toggle('hidden', !isHost);
  startGameBtn.disabled = playerCount < 2;
  startGameHint.textContent = playerCount < 2
    ? 'Ajak setidaknya satu teman sebelum permainan dimulai.'
    : isHost
      ? 'Semua siap? Mulai permainan saat teman-temanmu sudah bergabung.'
      : 'Menunggu host memulai permainan.';

  const players = room.players.map((player) => {
    return `
      <li class="player-item">
        <div class="player-info">
          <span class="player-avatar" aria-hidden="true">${escapeHtml(player.name.trim().charAt(0).toUpperCase() || 'P')}</span>
          <div>
            <strong class="player-name">${escapeHtml(player.name)}</strong>
            <div class="player-status">Siap bermain</div>
          </div>
        </div>
        <span class="badge ${player.isHost ? 'host' : 'role'}">${player.isHost ? 'Host' : 'Pemain'}</span>
      </li>
    `;
  }).join('');

  playerList.innerHTML = players;
}

function renderGameView(room, currentPlayer) {
  const isHost = currentPlayer && currentPlayer.isHost;
  const currentRole = currentPlayer ? currentPlayer.role : '—';
  const timeLeft = Math.max(0, Number(room.timeLeft) || 0);

  gameStateText.textContent = room.phase === 'PLAYING' ? 'Permainan berlangsung' : room.winner ? 'Sesi selesai' : 'Persiapan';
  timerText.textContent = formatTime(timeLeft);
  timerProgress.style.width = `${Math.min(100, (timeLeft / ROOM_DURATION_SECONDS) * 100)}%`;
  timerProgress.parentElement.setAttribute('aria-valuenow', String(timeLeft));
  timerProgress.parentElement.classList.toggle('urgent', timeLeft <= 15 && room.phase === 'PLAYING');
  timerText.parentElement.classList.toggle('urgent', timeLeft <= 15 && room.phase === 'PLAYING');
  gamePhaseBadge.classList.toggle('finished', room.phase === 'FINISHED');
  gamePhaseBadge.innerHTML = room.phase === 'FINISHED'
    ? 'SELESAI'
    : '<span class="live-dot"></span> LIVE';

  if (currentPlayer) {
    const roleDescription = currentRole === 'SEEKER'
      ? 'Anda adalah Seeker. Cari Hider dan amankan area.'
      : currentRole === 'IMPOSTOR'
        ? 'Anda adalah Impostor. Sembunyikan diri dan selesaikan tugas rahasia.'
        : currentRole === 'HIDER'
          ? 'Anda adalah Hider. Bertahan dan lengkapi misi tim.'
          : 'Role akan dibagikan saat permainan dimulai.';

    roleCard.className = 'role-card';
    if (currentRole !== '—') {
      roleCard.classList.add(`role-${currentRole.toLowerCase()}`);
    }
    roleCard.innerHTML = `
      <div class="role-card-content">
        ${getRoleAvatarMarkup(currentRole)}
        <div class="role-details">
          <div class="role-label">Role kamu</div>
          <h3>${currentRole === '—' ? 'Menunggu' : currentRole}</h3>
          <p>${roleDescription}</p>
        </div>
      </div>
    `;
    bindRoleAvatarFallback();

    const missionMarkup = currentPlayer.missions.length
      ? currentPlayer.missions.map((mission) => {
        const progress = Math.max(0, Number(mission.progress) || 0);
        const goal = Math.max(1, Number(mission.goal) || 1);
        const percentage = Math.min(100, (progress / goal) * 100);
        const complete = progress >= goal;
        return `
          <li class="mission-item">
            <div class="mission-item-main">
              <span class="mission-item-label">${escapeHtml(mission.label)}</span>
              <span class="mission-count ${complete ? 'complete' : ''}">${Math.min(progress, goal)}/${goal}${complete ? ' ✓' : ''}</span>
            </div>
            <div class="mission-progress" aria-hidden="true"><span style="width: ${percentage}%"></span></div>
          </li>
        `;
      }).join('')
      : '<li class="mission-item"><span>Belum ada misi</span><span>—</span></li>';

    missionList.innerHTML = missionMarkup;

    const actionMarkup = currentRole === 'SEEKER'
      ? `<button type="button" data-action="scan" ${room.phase !== 'PLAYING' ? 'disabled' : ''}>Scan area <span aria-hidden="true">→</span></button>`
      : currentRole === 'IMPOSTOR'
        ? `<button type="button" data-action="impostor" ${room.phase !== 'PLAYING' ? 'disabled' : ''}>Buat kekacauan <span aria-hidden="true">→</span></button>`
        : `<button type="button" data-action="hide" ${room.phase !== 'PLAYING' ? 'disabled' : ''}>Selesaikan misi <span aria-hidden="true">→</span></button>`;

    actionButtons.innerHTML = actionMarkup;
    actionButtons.querySelector('button')?.addEventListener('click', handlePlayerAction);
  }

  eventLog.innerHTML = room.eventLog.map((entry) => `<li class="event-item">${escapeHtml(entry)}</li>`).join('');

  const showRematch = room.phase === 'FINISHED';
  rematchBtn.classList.toggle('hidden', !showRematch || !isHost);

  if (room.phase === 'FINISHED' && room.winner) {
    const winnerText = room.winner === 'SEEKER'
      ? 'Seeker menang'
      : room.winner === 'IMPOSTOR'
        ? 'Impostor menang'
        : 'Hider menang';

    roleCard.innerHTML = `
      <div class="role-card-content">
        ${getRoleAvatarMarkup(currentRole)}
        <div class="role-details">
          <div class="role-label">Hasil permainan</div>
          <h3>${winnerText}</h3>
          <p>Role kamu: ${currentRole}. Lihat kembali progres misi, lalu mulai rematch jika ingin bermain lagi.</p>
        </div>
      </div>
    `;
    bindRoleAvatarFallback();
  }
}

function handlePlayerAction(event) {
  const room = getCurrentRoom();
  const player = getCurrentPlayer(room);
  const action = event.currentTarget.dataset.action;

  if (!room || !player || room.phase !== 'PLAYING') return;

  if (action === 'scan') {
    const hiders = room.players.filter((candidate) => candidate.role !== 'SEEKER' && !candidate.isFound);
    if (!hiders.length) {
      addLog(room, 'Semua Hider sudah ditemukan.');
      endRoom(room);
      return;
    }

    updateMissionProgress(player, 'seek_scan', 1);
    const target = hiders[Math.floor(Math.random() * hiders.length)];
    const success = Math.random() > 0.35;

    if (success) {
      target.isFound = true;
      addLog(room, `${player.name} menemukan ${target.name}.`);
      updateMissionProgress(player, 'seek_find', 1);

      if (room.players.filter((candidate) => candidate.role !== 'SEEKER').every((candidate) => candidate.isFound)) {
        endRoom(room);
        return;
      }
    } else {
      addLog(room, `${player.name} gagal membaca area, target sempat kabur.`);
    }
  }

  if (action === 'hide') {
    updateMissionProgress(player, 'hide_move', 1);
    updateMissionProgress(player, 'hide_stealth', 1);
    if (Math.random() > 0.5) {
      updateMissionProgress(player, 'hide_survive', 1);
    }
    addLog(room, `${player.name} berhasil menyelesaikan misi Hider.`);
  }

  if (action === 'impostor') {
    updateMissionProgress(player, 'imp_sneak', 1);
    updateMissionProgress(player, 'imp_escape', 1);
    const seekers = room.players.filter((candidate) => candidate.role === 'SEEKER');
    const target = seekers[Math.floor(Math.random() * seekers.length)];
    if (target) {
      addLog(room, `${player.name} menipu ${target.name} dan memperbesar peluang kabur.`);
    }

    if (Math.random() > 0.4) {
      updateMissionProgress(player, 'imp_secret', 1);
      player.secretMissionDone = true;
      addLog(room, `${player.name} menyelesaikan misi rahasia.`);
    }
  }

  const finalWinner = getWinnerFromRoom(room);
  if (finalWinner === 'SEEKER' || finalWinner === 'IMPOSTOR' || finalWinner === 'HIDER') {
    if (room.timeLeft <= 0 || room.players.filter((candidate) => candidate.role !== 'SEEKER').every((candidate) => candidate.isFound) || player.secretMissionDone) {
      room.winner = finalWinner;
      room.phase = 'FINISHED';
      room.status = 'FINISHED';
      addLog(room, finalWinner === 'SEEKER' ? 'Seeker menang.' : finalWinner === 'IMPOSTOR' ? 'Impostor menang.' : 'Hider menang.');
      saveRooms();
      render();
      return;
    }
  }

  saveRooms();
  render();
}

render();
