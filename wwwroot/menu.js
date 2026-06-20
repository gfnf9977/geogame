document.getElementById('btn-enter-lobby').addEventListener('click', function() {
    const landing = document.getElementById('landing-screen');
    const lobby = document.getElementById('lobby-screen');

    // Ховаємо сплеш-скрін
    landing.classList.add('hidden');
    landing.classList.remove('active');

    // Показуємо лобі
    lobby.classList.remove('hidden');
    lobby.classList.add('active');
});
let selectedMapId = 'chernihiv';

document.querySelector('.menu-container').addEventListener('click', function(e) {
    const card = e.target.closest('.map-card');
    if (!card) return;
    if (card.id === 'btn-open-search') {
        document.getElementById('search-modal').classList.add('active');
        return;
    }
    document.querySelectorAll('.map-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    selectedMapId = card.getAttribute('data-map');
});

document.getElementById('rounds-select').addEventListener('change', updateHighScoresDisplay);

function updateHighScoresDisplay() {
    const currentRounds = document.getElementById('rounds-select').value;
    const maxScore = currentRounds === '5' ? 25000 : 5000;
    const savedScores = JSON.parse(localStorage.getItem('localguessr_scores')) || {};

    document.querySelectorAll('.map-card:not(.add-new)').forEach(card => {
        const mapId = card.getAttribute('data-map');
        const badge = card.querySelector('.score-badge');
        if(!badge) return;

        if (currentRounds === 'inf') {
            badge.style.display = 'none';
            return;
        }

        const scoreKey = `${mapId}_${currentRounds}`;
        if (savedScores[scoreKey] !== undefined) {
            badge.innerText = `🏆 ${savedScores[scoreKey]} / ${maxScore}`;
            badge.style.display = 'inline-block';
        } else {
            badge.innerText = `🏆 0 / ${maxScore}`;
            badge.style.display = 'inline-block';
        }
    });
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

async function searchLocation() {
    const query = searchInput.value.trim();
    if (!query) return;
    searchResults.innerHTML = '<div class="search-item">⏳ Завантажуємо...</div>';
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&polygon_geojson=1`);
        const data = await response.json();
        searchResults.innerHTML = '';
        if (data.length === 0) {
            searchResults.innerHTML = '<div class="search-item">❌ Не знайдено</div>';
            return;
        }
        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerText = item.display_name;
            div.addEventListener('click', () => saveAutoMap(item));
            searchResults.appendChild(div);
        });
    } catch (error) {
        searchResults.innerHTML = '<div class="search-item" style="color: #ef4444;">❌ Помилка</div>';
    }
}

document.getElementById('search-btn').addEventListener('click', searchLocation);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchLocation();
});

function saveAutoMap(item) {
    const bbox = item.boundingbox;
    const n = parseFloat(bbox[1]);
    const s = parseFloat(bbox[0]);
    const w = parseFloat(bbox[2]);
    const e = parseFloat(bbox[3]);
    const latDiff = Math.abs(n - s);

    let dynamicDecay = 5;
    let dynamicZoom = 12;
    if (latDiff > 5) {
        dynamicDecay = 300;
        dynamicZoom = 5;
    } else if (latDiff > 1) {
        dynamicDecay = 40;
        dynamicZoom = 7;
    }

    let customPolygon = null;
    if (item.geojson) {
        let coords = item.geojson.coordinates;
        if (item.geojson.type === 'Polygon') {
            customPolygon = coords[0].map(p => [p[1], p[0]]);
        } else if (item.geojson.type === 'MultiPolygon') {
            let largestPoly = coords[0][0];
            for (let i = 1; i < coords.length; i++) {
                if (coords[i][0].length > largestPoly.length) largestPoly = coords[i][0];
            }
            customPolygon = largestPoly.map(p => [p[1], p[0]]);
        }
        if (customPolygon && customPolygon.length > 500) {
            const step = Math.ceil(customPolygon.length / 500);
            customPolygon = customPolygon.filter((_, index) => index % step === 0);
        }
    }

    const newMap = {
        id: 'custom_' + Date.now(),
        name: item.name || item.display_name.split(',')[0],
        north: n, south: s, west: w, east: e,
        center: [parseFloat(item.lat), parseFloat(item.lon)],
        zoom: dynamicZoom,
        decay: dynamicDecay,
        polygon: customPolygon
    };

    let savedMaps = JSON.parse(localStorage.getItem('localguessr_maps')) || [];
    savedMaps.push(newMap);
    localStorage.setItem('localguessr_maps', JSON.stringify(savedMaps));
    closeModal('search-modal');
    searchInput.value = '';
    searchResults.innerHTML = '';
    loadCustomMaps();
    document.querySelectorAll('.map-card').forEach(c => c.classList.remove('active'));
    const newCard = document.querySelector(`[data-map="${newMap.id}"]`);
    if(newCard) newCard.classList.add('active');
    selectedMapId = newMap.id;
}

let mapEditor = null;
let isDrawMode = false;
let drawnPoints = [];
let drawnPolygonLayer = null;
let drawnMarkers = [];

document.getElementById('btn-open-editor').addEventListener('click', () => {
    closeModal('search-modal');
    document.getElementById('editor-modal').classList.add('active');
    setTimeout(() => { initEditorMap(); }, 400);
});

function initEditorMap() {
    const wrapper = document.getElementById('editor-map-wrapper');
    wrapper.innerHTML = '<div id="editor-map"></div>';

    if (mapEditor !== null) {
        mapEditor.remove();
        mapEditor = null;
    }

    mapEditor = L.map('editor-map').setView([51.4915, 31.3031], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(mapEditor);

    drawnPolygonLayer = L.polygon([], {
        color: '#10b981', weight: 3, fillOpacity: 0.2
    }).addTo(mapEditor);

    mapEditor.on('click', function(e) {
        if (!isDrawMode) return;
        addPointToMap(e.latlng.lat, e.latlng.lng);
    });

    drawnPoints = [];
    drawnMarkers = [];
    updateEditorUI();

    isDrawMode = false;
    const btn = document.getElementById('btn-toggle-mode');
    btn.innerHTML = '✋ Режим: Совання';
    btn.classList.remove('active-draw');
    document.getElementById('editor-map').classList.remove('drawing-cursor');
    mapEditor.dragging.enable();

    mapEditor.invalidateSize();

    setTimeout(() => { mapEditor.invalidateSize(true); }, 100);
    setTimeout(() => { mapEditor.invalidateSize(true); }, 500);
}

async function flyToLocation() {
    const query = document.getElementById('fly-input').value.trim();
    if(!query) return;
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`);
    const data = await res.json();
    if(data.length > 0 && mapEditor) mapEditor.setView([data[0].lat, data[0].lon], 12);
}

function toggleDrawMode() {
    if (!mapEditor) return;
    isDrawMode = !isDrawMode;
    const btn = document.getElementById('btn-toggle-mode');
    const mapContainer = document.getElementById('editor-map');
    if(isDrawMode) {
        btn.innerHTML = '📍 Режим: Малювання';
        btn.classList.add('active-draw');
        mapContainer.classList.add('drawing-cursor');
        mapEditor.dragging.disable();
    } else {
        btn.innerHTML = '✋ Режим: Совання';
        btn.classList.remove('active-draw');
        mapContainer.classList.remove('drawing-cursor');
        mapEditor.dragging.enable();
    }
}

function addPointToMap(lat, lng) {
    drawnPoints.push([lat, lng]);
    const marker = L.circleMarker([lat, lng], { radius: 5, color: '#ef4444', fillOpacity: 1 }).addTo(mapEditor);
    drawnMarkers.push(marker);
    drawnPolygonLayer.setLatLngs(drawnPoints);
    updateEditorUI();
}

function undoPoint() {
    if(drawnPoints.length === 0 || !mapEditor) return;
    drawnPoints.pop();
    const markerToRemove = drawnMarkers.pop();
    mapEditor.removeLayer(markerToRemove);
    drawnPolygonLayer.setLatLngs(drawnPoints);
    updateEditorUI();
}

function updateEditorUI() {
    const count = drawnPoints.length;
    document.getElementById('point-counter').innerText = `Точок: ${count} / 3 (мінімум)`;
    document.getElementById('btn-save-map').disabled = count < 3;
}

function saveDrawnMap() {
    if (drawnPoints.length < 3) return;
    document.getElementById('name-modal').classList.add('active');
    document.getElementById('map-name-input').focus();
}

document.getElementById('map-name-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmSaveDrawnMap();
});

function confirmSaveDrawnMap() {
    const inputVal = document.getElementById('map-name-input').value.trim();
    const mapName = inputVal || "Моя секретна мапа";

    let n = -90, s = 90, e = -180, w = 180;
    drawnPoints.forEach(pt => {
        if(pt[0] > n) n = pt[0];
        if(pt[0] < s) s = pt[0];
        if(pt[1] > e) e = pt[1];
        if(pt[1] < w) w = pt[1];
    });

    const latDiff = Math.abs(n - s);
    let dynamicDecay = 5;
    let dynamicZoom = 12;
    if (latDiff > 5) {
        dynamicDecay = 300;
        dynamicZoom = 5;
    } else if (latDiff > 1) {
        dynamicDecay = 40;
        dynamicZoom = 7;
    }

    const centerLat = s + (n - s)/2;
    const centerLng = w + (e - w)/2;

    const newMap = {
        id: 'custom_' + Date.now(),
        name: mapName,
        north: n, south: s, west: w, east: e,
        center: [centerLat, centerLng],
        zoom: dynamicZoom,
        decay: dynamicDecay,
        polygon: [...drawnPoints]
    };

    let savedMaps = JSON.parse(localStorage.getItem('localguessr_maps')) || [];
    savedMaps.push(newMap);
    localStorage.setItem('localguessr_maps', JSON.stringify(savedMaps));

    document.getElementById('map-name-input').value = '';
    closeModal('name-modal');
    closeModal('editor-modal');
    loadCustomMaps();
    document.querySelectorAll('.map-card').forEach(c => c.classList.remove('active'));
    const newCard = document.querySelector(`[data-map="${newMap.id}"]`);
    if(newCard) newCard.classList.add('active');
    selectedMapId = newMap.id;
}

function loadCustomMaps() {
    const savedMaps = JSON.parse(localStorage.getItem('localguessr_maps')) || [];
    document.querySelectorAll('.map-card.custom-saved').forEach(el => el.remove());
    const customGrid = document.getElementById('custom-grid');
    const btnAddMap = document.getElementById('btn-open-search');

    const gradients = [
        'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
        'linear-gradient(135deg, #b91c1c 0%, #ec4899 100%)',
        'linear-gradient(135deg, #047857 0%, #10b981 100%)',
        'linear-gradient(135deg, #c2410c 0%, #f59e0b 100%)',
        'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)'
    ];

    savedMaps.forEach(mapData => {
        let hash = 0;
        for (let i = 0; i < mapData.id.length; i++) hash += mapData.id.charCodeAt(i);
        const bgGradient = gradients[hash % gradients.length];

        const card = document.createElement('div');
        card.className = 'map-card custom-saved';
        card.setAttribute('data-map', mapData.id);
        card.style.backgroundImage = bgGradient;
        card.innerHTML = `<span class="delete-map-btn" onclick="deleteMap(event, '${mapData.id}')">✖</span><div class="title">${mapData.name}</div><div><span class="score-badge"></span></div>`;
        customGrid.insertBefore(card, btnAddMap);
    });
    updateHighScoresDisplay();
}

function loadGlobalStats() {
    let globalStats = JSON.parse(localStorage.getItem('localguessr_global_stats')) || { games: 0, totalScore: 0, totalDistance: 0, rounds: 0 };

    document.getElementById('stat-games').innerText = globalStats.games;
    document.getElementById('stat-score').innerText = globalStats.totalScore;

    let avgDistance = globalStats.rounds > 0 ? (globalStats.totalDistance / globalStats.rounds) : 0;

    // Якщо дистанція менша за 1 км, показуємо в метрах для краси
    let distanceText = avgDistance < 1 ? Math.round(avgDistance * 1000) + ' м' : avgDistance.toFixed(1) + ' км';
    document.getElementById('stat-distance').innerText = distanceText;
}

// Викликаємо одразу при завантаженні меню
loadGlobalStats();

window.deleteMap = function(event, mapId) {
    event.stopPropagation();
    let savedMaps = JSON.parse(localStorage.getItem('localguessr_maps')) || [];
    savedMaps = savedMaps.filter(m => m.id !== mapId);
    localStorage.setItem('localguessr_maps', JSON.stringify(savedMaps));
    if(selectedMapId === mapId) {
        selectedMapId = 'chernihiv';
        document.querySelector('[data-map="chernihiv"]').classList.add('active');
    }
    loadCustomMaps();
};

loadCustomMaps();

function startGame() {
    if (!selectedMapId) {
        alert('Будь ласка, оберіть мапу!');
        return;
    }
    const selectedMode = document.getElementById('mode-select').value;
    const selectedRounds = document.getElementById('rounds-select').value;
    const allowMove = document.getElementById('allow-move').checked;
    const allowPan = document.getElementById('allow-pan').checked;
    const allowZoom = document.getElementById('allow-zoom').checked;
    window.location.href = `game.html?map=${selectedMapId}&mode=${selectedMode}&rounds=${selectedRounds}&move=${allowMove}&pan=${allowPan}&zoom=${allowZoom}`;
}