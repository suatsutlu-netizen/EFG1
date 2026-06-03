// --- CONFIGURATION ET ETAT GLOBAL ---
let db = null;
let currentTestId = null;
let wakeLock = null;
let audioCtx = null;

const state = {
  p1Timer: { duration: 360, remaining: 360, interval: null },
  p2Timer: { duration: 360, remaining: 360, interval: null },
  p3Timer: { duration: 60, remaining: 60, interval: null }
};

// Ordre linéaire des écrans
const screenOrder = ['screen-home', 'screen-p1', 'screen-p2', 'screen-p3', 'screen-p4', 'screen-p5'];

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', () => {
  initDB();
  setupEventListeners();
  registerServiceWorker();
  manageWakeLock();
});

// Enregistrement du Service Worker
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
  }
}

// Initialisation de la base de données IndexedDB
function initDB() {
  const request = indexedDB.open('BrakeTestDB', 1);
  request.onupgradeneeded = (e) => {
    const database = e.target.result;
    if (!database.objectStoreNames.contains('tests')) {
      database.createObjectStore('tests', { keyPath: 'id', autoIncrement: true });
    }
  };
  request.onsuccess = (e) => { db = e.target.result; };
}

// --- IMPÉCHEMENT DE LA MISE EN VEILLE (WAKE LOCK) ---
async function manageWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn("Wake Lock non actif :", err.message);
    }
  }
}

// Ré-acquisition automatique lors du retour sur l'application
document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    manageWakeLock();
  }
});

// --- ENGIN AUDIO (WEB AUDIO API) ---
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playThreeToneAlarm() {
  initAudio();
  if (!audioCtx) return;

  let sequenceCount = 0;
  
  function triggerSequence() {
    if (sequenceCount >= 3) return; // Arrêt impératif après 3 cycles complets
    
    let now = audioCtx.currentTime;
    const tones = [440, 660, 880];
    const duration = 0.25;

    tones.forEach((freq, idx) => {
      let osc = audioCtx.createOscillator();
      let gainNode = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + (idx * duration));
      
      gainNode.gain.setValueAtTime(0.3, now + (idx * duration));
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + (idx * duration) + duration - 0.02);
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.start(now + (idx * duration));
      osc.stop(now + (idx * duration) + duration);
    });

    sequenceCount++;
    setTimeout(triggerSequence, 1000);
  }

  triggerSequence();

  // Déclenchement de la notification persistante en tâche de fond (via Service Worker)
  if (Notification.permission === 'granted' && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification("Alerte Temporisateur", {
        body: "Le temps imparti est écoulé !",
        tag: "rail-alert"
      });
    });
  }
}

// Demande d'autorisation de notifications au premier clic utilisateur
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// --- LOGIQUE MÉTIER & HORODATAGES ---
function debounceButton(buttonElement) {
  buttonElement.disabled = true;
  setTimeout(() => { buttonElement.disabled = false; }, 600);
}

function getFormattedTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function createNewTestRecord() {
  const now = new Date();
  const record = {
    date: now.toLocaleDateString('fr-FR'),
    h1: getFormattedTimestamp(),
    h2: '', h3: '', h4: '', h5: ''
  };

  const tx = db.transaction('tests', 'readwrite');
  const store = tx.objectStore('tests');
  const request = store.add(record);

  request.onsuccess = (e) => {
    currentTestId = e.target.result;
  };
}

function updateTimestamp(field) {
  if (!currentTestId) return;
  const tx = db.transaction('tests', 'readwrite');
  const store = tx.objectStore('tests');
  
  store.get(currentTestId).onsuccess = (e) => {
    const data = e.target.result;
    if(data) {
      data[field] = getFormattedTimestamp();
      store.put(data);
    }
  };
}

// --- GESTIONNAIRES DES CHRONOMÈTRES ---
function updateTimerUI(displayId, seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  document.getElementById(displayId).textContent = `${mins}:${secs}`;
}

function handleTimerLogic(configKey, displayId, screenId) {
  const timerData = state[configKey];
  
  if (timerData.interval) {
    clearInterval(timerData.interval);
    timerData.interval = null;
    return;
  }

  timerData.interval = setInterval(() => {
    if (timerData.remaining > 0) {
      timerData.remaining--;
      updateTimerUI(displayId, timerData.remaining);
    } else {
      clearInterval(timerData.interval);
      timerData.interval = null;
      document.getElementById(screenId).classList.add('flash-alert');
      playThreeToneAlarm();
    }
  }, 1000);
}

function resetTimerLogic(configKey, displayId, screenId) {
  const timerData = state[configKey];
  clearInterval(timerData.interval);
  timerData.interval = null;
  timerData.remaining = timerData.duration;
  updateTimerUI(displayId, timerData.remaining);
  document.getElementById(screenId).classList.remove('flash-alert');
}

// --- ROUTAGE INTERNE ET INTERFACE ---
function changeView(targetScreenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(targetScreenId).classList.add('active');
  
  // Arrêt systématique des animations d'alerte lors du changement d'écran
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('flash-alert'));
}

function setupEventListeners() {
  // Navigation Initiale
  document.getElementById('btn-start-test').addEventListener('click', (e) => {
    debounceButton(e.target);
    initAudio();
    requestNotificationPermission();
    createNewTestRecord();
    changeView('screen-p1');
  });

  document.getElementById('btn-go-history').addEventListener('click', () => {
    renderHistoryTable();
    changeView('screen-history');
  });

  document.querySelectorAll('.btn-back-home').forEach(btn => {
    btn.addEventListener('click', () => changeView('screen-home'));
  });

  // Logique Boutons Universels : [RETOUR] et [SAUTER]
  document.querySelectorAll('.screen').forEach(screen => {
    const backBtn = screen.querySelector('.btn-universal-back');
    const skipBtn = screen.querySelector('.btn-universal-skip');

    if (backBtn) {
      backBtn.addEventListener('click', () => {
        const index = screenOrder.indexOf(screen.id);
        if (index > 0) changeView(screenOrder[index - 1]);
      });
    }
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        const index = screenOrder.indexOf(screen.id);
        if (index < screenOrder.length - 1) changeView(screenOrder[index + 1]);
      });
    }
  });

  // PAGE 1 : Événements
  document.getElementById('p1-time-plus').addEventListener('click', () => {
    state.p1Timer.duration += 60; state.p1Timer.remaining += 60;
    updateTimerUI('p1-timer-display', state.p1Timer.remaining);
  });
  document.getElementById('p1-time-minus').addEventListener('click', () => {
    if (state.p1Timer.duration > 60) {
      state.p1Timer.duration -= 60; state.p1Timer.remaining -= 60;
      updateTimerUI('p1-timer-display', state.p1Timer.remaining);
    }
  });
  document.getElementById('btn-p1-timer').addEventListener('click', () => {
    handleTimerLogic('p1Timer', 'p1-timer-display', 'screen-p1');
  });
  document.getElementById('btn-p1-reset').addEventListener('click', () => {
    resetTimerLogic('p1Timer', 'p1-timer-display', 'screen-p1');
  });
  document.getElementById('btn-to-p2').addEventListener('click', (e) => {
    debounceButton(e.target);
    updateTimestamp('h2');
    changeView('screen-p2');
  });

  // PAGE 2 : Événements
  document.getElementById('p2-time-plus').addEventListener('click', () => {
    state.p2Timer.duration += 60; state.p2Timer.remaining += 60;
    updateTimerUI('p2-timer-display', state.p2Timer.remaining);
  });
  document.getElementById('p2-time-minus').addEventListener('click', () => {
    if (state.p2Timer.duration > 60) {
      state.p2Timer.duration -= 60; state.p2Timer.remaining -= 60;
      updateTimerUI('p2-timer-display', state.p2Timer.remaining);
    }
  });
  document.getElementById('btn-p2-timer').addEventListener('click', () => {
    handleTimerLogic('p2Timer', 'p2-timer-display', 'screen-p2');
  });
  document.getElementById('btn-p2-reset').addEventListener('click', () => {
    resetTimerLogic('p2Timer', 'p2-timer-display', 'screen-p2');
  });
  document.getElementById('btn-to-p3').addEventListener('click', (e) => {
    debounceButton(e.target);
    updateTimestamp('h3');
    changeView('screen-p3');
  });

  // PAGE 3 : Événements
  document.getElementById('btn-p3-timer').addEventListener('click', () => {
    handleTimerLogic('p3Timer', 'p3-timer-display', 'screen-p3');
  });
  document.getElementById('btn-p3-reset').addEventListener('click', () => {
    resetTimerLogic('p3Timer', 'p3-timer-display', 'screen-p3');
  });
  document.getElementById('btn-to-p4').addEventListener('click', (e) => {
    debounceButton(e.target);
    updateTimestamp('h4');
    changeView('screen-p4');
  });

  // PAGE 4 : Fin d'essai
  document.getElementById('btn-finish-test').addEventListener('click', (e) => {
    debounceButton(e.target);
    updateTimestamp('h5');
    changeView('screen-p5');
  });

  // Exportation du document
  document.getElementById('btn-export-doc').addEventListener('click', () => {
    exportToWordDocument();
  });
}

// --- TRAITEMENT DU VISUEL DE L'HISTORIQUE ---
function renderHistoryTable() {
  const tbody = document.querySelector('#table-history tbody');
  tbody.innerHTML = '';
  
  if (!db) return;

  const store = db.transaction('tests', 'readonly').objectStore('tests');
  store.openCursor(null, 'prev').onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      const v = cursor.value;
      const row = `<tr>
        <td>${v.id}</td>
        <td>${v.date}</td>
        <td>${v.h1 || '--'}</td>
        <td>${v.h2 || '--'}</td>
        <td>${v.h3 || '--'}</td>
        <td>${v.h4 || '--'}</td>
        <td>${v.h5 || '--'}</td>
      </tr>`;
      tbody.innerHTML += row;
      cursor.continue();
    }
  };
}

// --- MODULE D'EXPORTATION EN FICHIER .DOC ---
function exportToWordDocument() {
  if (!db) return;

  const store = db.transaction('tests', 'readonly').objectStore('tests');
  let tableRows = '';

  store.getAll().onsuccess = (e) => {
    const allRecords = e.target.result;
    allRecords.forEach(r => {
      tableRows += `
        <tr>
          <td style="border: 1px solid #000000; padding: 8px;">${r.id}</td>
          <td style="border: 1px solid #000000; padding: 8px;">${r.date}</td>
          <td style="border: 1px solid #000000; padding: 8px;">${r.h1 || '--'}</td>
          <td style="border: 1px solid #000000; padding: 8px;">${r.h2 || '--'}</td>
          <td style="border: 1px solid #000000; padding: 8px;">${r.h3 || '--'}</td>
          <td style="border: 1px solid #000000; padding: 8px;">${r.h4 || '--'}</td>
          <td style="border: 1px solid #000000; padding: 8px;">${r.h5 || '--'}</td>
        </tr>`;
    });

    const docContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset="utf-8">
        <title>Historique Essais de Frein</title>
        <style>
          body { font-family: Arial, sans-serif; }
          table { border-collapse: collapse; width: 100%; margin-top: 20px; }
          th { background-color: #f2f2f2; border: 1px solid #000000; padding: 10px; text-align: left; }
        </style>
      </head>
      <body>
        <h2>Rapport d'Historique - Essais de Frein</h2>
        <p>Généré automatiquement par l'application ferroviaire de sécurité.</p>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Date</th>
              <th>Horodatage 1</th>
              <th>Horodatage 2</th>
              <th>Horodatage 3</th>
              <th>Horodatage 4</th>
              <th>Horodatage 5</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </body>
      </html>`;

    const blob = new Blob(['\ufeff' + docContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Historique_Essais_Frein_${new Date().toISOString().slice(0,10)}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
}