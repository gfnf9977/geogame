let map = null;
let panorama = null;
let actualLocation = null;
let hasGuessed = false;
let isPaused = false;

let guessMarker = null;
let realMarker = null;
let resultPolyline = null;
let activePolygonLayer = null;

let mapConfig = null;
let currentMode = 'easy';
let totalRounds = 'inf';

let currentRound = 1;
let totalScore = 0;
let roundHistory = [];
let seedLocations = [];
let isSeededGame = false;

let timerInterval;
let timeElapsed = 0;
let timeLeft = 180;

// Рушій для ефекту швидкої прокрутки цифр (Score Ticker)
function animateScore(element, endValue, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const easeOut = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        element.innerText = Math.floor(easeOut * endValue);
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

function initialize() {
    const urlParams = new URLSearchParams(window.location.search);
    currentMode = urlParams.get('mode') || 'easy';
    totalRounds = urlParams.get('rounds') || 'inf';
    const selectedMap = urlParams.get('map') || 'chernihiv';

    const allowMove = urlParams.get('move') !== 'false';
    const allowPan = urlParams.get('pan') !== 'false';
    const allowZoom = urlParams.get('zoom') !== 'false';

    const seedParam = urlParams.get('seed');
    if (seedParam) {
        isSeededGame = true;
        seedLocations = seedParam.split('|').map(coord => {
            const [lat, lng] = coord.split(',');
            return { lat: parseFloat(lat), lng: parseFloat(lng) };
        });
        totalRounds = seedLocations.length;
    }

    if (selectedMap.startsWith('custom_')) {
        const savedMaps = JSON.parse(localStorage.getItem('localguessr_maps')) || [];
        mapConfig = savedMaps.find(m => m.id === selectedMap);
        if (!mapConfig) {
            alert("Мапу не знайдено.");
            window.location.href = 'index.html';
            return;
        }
    } else {
        mapConfig = MAP_DATA[selectedMap] || MAP_DATA.chernihiv;
    }

    let panoOptions = {
        addressControl: false,
        showRoadLabels: false,
        fullscreenControl: false,
        panControlOptions: { position: google.maps.ControlPosition.TOP_LEFT },
        zoomControlOptions: { position: google.maps.ControlPosition.TOP_LEFT },
        linksControl: allowMove,
        clickToGo: allowMove,
        zoomControl: allowZoom,
        scrollwheel: allowZoom,
        disableDoubleClickZoom: !allowZoom,
        panControl: allowPan
    };

    if (!allowPan) {
        panoOptions.gestureHandling = 'none';
    }

    panorama = new google.maps.StreetViewPanorama(
        document.getElementById("pano"), panoOptions
    );

    // Відображаємо бейджі, якщо щось заборонено
    const restPanel = document.getElementById('restrictions-panel');
    restPanel.innerHTML = '';
    if (!allowMove) restPanel.innerHTML += '<div class="restriction-badge">🚫 NO MOVE</div>';
    if (!allowPan) restPanel.innerHTML += '<div class="restriction-badge">🚫 NO PAN</div>';
    if (!allowZoom) restPanel.innerHTML += '<div class="restriction-badge">🚫 NO ZOOM</div>';

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19
    });

    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri', maxZoom: 18
    });

    map = L.map('map', {
        center: mapConfig.center,
        zoom: mapConfig.zoom,
        layers: [osmLayer]
    });

    L.control.layers({ "Карта": osmLayer, "Супутник": satelliteLayer }).addTo(map);

    drawMapBorders();

    map.on('click', function(e) {
        if (hasGuessed || isPaused) return;
        if (guessMarker) map.removeLayer(guessMarker);
        guessMarker = L.marker(e.latlng).addTo(map);
        document.getElementById('submit-btn').style.display = 'block';
    });

    document.getElementById('submit-btn').addEventListener('click', () => calculateResult(false));
    document.getElementById('reset-btn').addEventListener('click', () => {
        if (actualLocation && !isPaused) panorama.setPosition(actualLocation);
    });

    // Логіка HTML-кнопки розширення
    document.getElementById('expand-map-btn').addEventListener('click', function(e) {
        e.stopPropagation();
        const mapEl = document.getElementById('map');
        const btn = document.getElementById('expand-map-btn');
        mapEl.classList.toggle('expanded');

        if (mapEl.classList.contains('expanded')) {
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
            btn.title = "Згорнути мапу";
        } else {
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
            btn.title = "Розгорнути мапу";
        }
        setTimeout(() => { map.invalidateSize(); }, 350);
    });

    updateInfoPanel();
    getRandomPanorama(0);
    startTimer();
}

function togglePause() {
    if (hasGuessed) return;
    isPaused = !isPaused;
    const overlay = document.getElementById('pause-overlay');
    const pano = document.getElementById('pano');
    const mapContainer = document.getElementById('map-container');

    if(isPaused) {
        overlay.style.display = 'flex';
        pano.classList.add('blurred');
        mapContainer.style.pointerEvents = 'none';
    } else {
        overlay.style.display = 'none';
        pano.classList.remove('blurred');
        mapContainer.style.pointerEvents = 'auto';
    }
}

function drawMapBorders() {
    if (activePolygonLayer) map.removeLayer(activePolygonLayer);
    if (mapConfig.polygon) {
        activePolygonLayer = L.polygon(mapConfig.polygon, {color: "#10b981", weight: 2, fillOpacity: 0.05}).addTo(map);
    } else if (mapConfig !== MAP_DATA.world) {
        activePolygonLayer = L.rectangle([[mapConfig.south, mapConfig.west], [mapConfig.north, mapConfig.east]], {color: "#10b981", weight: 2, fillOpacity: 0.05}).addTo(map);
    }
}

function isPointInPolygon(point, vs) {
    let x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        let xi = vs[i][0], yi = vs[i][1];
        let xj = vs[j][0], yj = vs[j][1];
        let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function formatTime(seconds) {
    return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function startTimer() {
    clearInterval(timerInterval);
    const timerPanel = document.getElementById('timer-panel');
    timerPanel.classList.remove('danger-time');

    if (currentMode === 'easy') {
        timeElapsed = 0;
        timerPanel.innerText = "00:00";
        timerInterval = setInterval(() => {
            if (isPaused) return;
            if (hasGuessed) { clearInterval(timerInterval); return; }
            timeElapsed++;
            timerPanel.innerText = formatTime(timeElapsed);
        }, 1000);
    } else {
        timeLeft = 180;
        timerPanel.innerText = formatTime(timeLeft);
        timerInterval = setInterval(() => {
            if (isPaused) return;
            if (hasGuessed) { clearInterval(timerInterval); return; }
            timeLeft--;
            timerPanel.innerText = formatTime(timeLeft);
            if (timeLeft <= 15) timerPanel.classList.add('danger-time');
            if (timeLeft <= 0) { clearInterval(timerInterval); calculateResult(true); }
        }, 1000);
    }
}

function getRandomPanorama(attempts) {
    document.getElementById('loading-overlay').classList.remove('hidden');

    if (isSeededGame && seedLocations[currentRound - 1]) {
        const seedPt = seedLocations[currentRound - 1];
        const svService = new google.maps.StreetViewService();
        svService.getPanorama({
            location: new google.maps.LatLng(seedPt.lat, seedPt.lng),
            radius: 50
        }, function(data, status) {
            if (status === google.maps.StreetViewStatus.OK) {
                actualLocation = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
                panorama.setPosition(actualLocation);
                document.getElementById('loading-overlay').classList.add('hidden');
            } else {
                alert("Помилка завантаження локації з посилання!");
                document.getElementById('loading-overlay').classList.add('hidden');
            }
        });
        return;
    }

    if (attempts >= 50) {
        alert("У цій локації замало панорам Street View.");
        window.location.href = 'index.html';
        return;
    }

    let randomLat, randomLng;
    if (mapConfig.polygon) {
        let isInside = false;
        while (!isInside) {
            randomLat = Math.random() * (mapConfig.north - mapConfig.south) + mapConfig.south;
            randomLng = Math.random() * (mapConfig.east - mapConfig.west) + mapConfig.west;
            isInside = isPointInPolygon([randomLat, randomLng], mapConfig.polygon);
        }
    } else {
        randomLat = Math.random() * (mapConfig.north - mapConfig.south) + mapConfig.south;
        randomLng = Math.random() * (mapConfig.east - mapConfig.west) + mapConfig.west;
    }

    const svService = new google.maps.StreetViewService();
    const searchRadius = mapConfig.polygon ? 5000 : (mapConfig.decay > 100 ? 50000 : 1000);

    svService.getPanorama({
        location: new google.maps.LatLng(randomLat, randomLng),
        radius: searchRadius,
        source: google.maps.StreetViewSource.OUTDOOR
    }, function(data, status) {
        if (status === google.maps.StreetViewStatus.OK) {
            actualLocation = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
            panorama.setPosition(actualLocation);
            document.getElementById('loading-overlay').classList.add('hidden');
        } else {
            getRandomPanorama(attempts + 1);
        }
    });
}

function updateInfoPanel() {
    const roundText = totalRounds === 'inf' ? currentRound : `${currentRound} / ${totalRounds}`;
    document.getElementById('info-panel').innerText = `Раунд: ${roundText} | Рахунок: ${totalScore}`;
}

window.copyChallengeLink = function(url) {
    navigator.clipboard.writeText(url).then(() => {
        alert('✅ Посилання скопійовано! Надішліть його другу.');
    }).catch(err => {
        prompt("Скопіюйте це посилання вручну:", url);
    });
}

function calculateResult(isTimeOut) {
    hasGuessed = true;
    document.getElementById('submit-btn').style.display = 'none';
    document.getElementById('reset-btn').style.display = 'none';
    document.getElementById('top-left-panel').style.display = 'none';
    document.getElementById('map').classList.remove('expanded');
    document.getElementById('expand-map-btn').style.display = 'none';

    let score = 0;
    let distanceKm = 0;
    const resultPanel = document.getElementById('result-panel');
    const guessLat = guessMarker ? guessMarker.getLatLng().lat : null;
    const guessLng = guessMarker ? guessMarker.getLatLng().lng : null;

    if (isTimeOut && !guessMarker) {
        score = 0;
    } else {
        distanceKm = getDistanceFromLatLonInKm(actualLocation.lat, actualLocation.lng, guessLat, guessLng);
        score = distanceKm <= 0.025 ? 5000 : Math.max(0, Math.round(5000 * Math.exp(-distanceKm / mapConfig.decay)));
    }

    totalScore += score;
    roundHistory.push({
        round: currentRound,
        guess: guessMarker ? [guessLat, guessLng] : null,
        actual: [actualLocation.lat, actualLocation.lng],
        score: score,
        distance: distanceKm
    });

    updateInfoPanel();

    let isGameOver = (totalRounds !== 'inf' && currentRound >= parseInt(totalRounds));
    let isNewRecord = false;
    const selectedMapId = new URLSearchParams(window.location.search).get('map') || 'chernihiv';

    if (isGameOver && !isSeededGame) {
        const scoreKey = `${selectedMapId}_${totalRounds}`;
        let savedScores = JSON.parse(localStorage.getItem('localguessr_scores')) || {};
        if (savedScores[scoreKey] === undefined || totalScore > savedScores[scoreKey]) {
            savedScores[scoreKey] = totalScore;
            localStorage.setItem('localguessr_scores', JSON.stringify(savedScores));
            isNewRecord = true;
        }

        // НОВЕ: Оновлення глобальної статистики
        let globalStats = JSON.parse(localStorage.getItem('localguessr_global_stats')) || { games: 0, totalScore: 0, totalDistance: 0, rounds: 0 };
        globalStats.games += 1;
        globalStats.totalScore += totalScore;

        let matchDistance = roundHistory.reduce((sum, r) => sum + (r.distance || 0), 0);
        globalStats.totalDistance += matchDistance;
        globalStats.rounds += roundHistory.length;

        localStorage.setItem('localguessr_global_stats', JSON.stringify(globalStats));
    }

    let buttonsHtml = '';
    if (isGameOver) {
        let historyHtml = '<div style="text-align: left; margin: 15px 0; font-size: 14px; border-top: 1px solid #334155; padding-top: 10px;">';
        roundHistory.forEach(r => {
            historyHtml += `<div style="margin-bottom: 5px; display:flex; justify-content:space-between;"><span><b>Р${r.round}:</b> <span style="color:#94a3b8; font-size: 12px;">${r.guess ? r.distance.toFixed(1) + ' км' : 'Час вийшов'}</span></span> <span style="color:#10b981; font-weight:bold;">${r.score}</span></div>`;
        });
        historyHtml += '</div>';

        let challengeBtnHtml = '';
        if (!selectedMapId.startsWith('custom_') && totalRounds !== 'inf') {
            let seedString = roundHistory.map(r => `${r.actual[0].toFixed(5)},${r.actual[1].toFixed(5)}`).join('|');
            let challengeUrl = `${window.location.origin}${window.location.pathname}?map=${selectedMapId}&mode=${currentMode}&rounds=${totalRounds}&seed=${seedString}`;
            challengeBtnHtml = `<button class="action-btn btn-share" onclick="copyChallengeLink('${challengeUrl}')">🔗 Кинути виклик другу</button>`;
        }

        buttonsHtml = `<h2 style="color:#10b981; margin-bottom: 5px; margin-top: 5px;">Гру завершено!</h2>
                       Загальний рахунок: <b id="anim-total-score" style="font-size: 32px; color:#10b981; display:block; margin: 5px 0;">0</b>
                       ${isNewRecord ? `<span style="color:#fbbf24; font-size:16px;">🌟 Новий рекорд!</span>` : ''}
                       ${isSeededGame ? `<span style="color:#3b82f6; font-size:14px;">🎮 Гра за викликом</span>` : ''}
                       ${historyHtml}
                       <div style="display:flex; flex-direction:column; gap:10px;">
                           ${challengeBtnHtml}
                           <button class="action-btn btn-next" style="width: 100%; margin:0;" onclick="restartGame()">🔄 Зіграти знову</button>
                           <button class="action-btn btn-exit" style="width: 100%; margin:0;" onclick="window.location.href='index.html'">В головне меню</button>
                       </div>`;
    } else {
        buttonsHtml = `<div style="display:flex; gap:10px; justify-content:center; margin-top:15px;"><button class="action-btn btn-next" style="margin:0;" onclick="nextRound()">Наступний раунд</button><button class="action-btn btn-exit" style="margin:0;" onclick="window.location.href='index.html'">В меню</button></div>`;
    }

    const timeoutMsg = (isTimeOut && !guessMarker) ? `<b>Час вийшов!</b>` : (isTimeOut ? `<span style="color:#ef4444">Час вийшов!</span>` : `Дистанція: <b>${distanceKm.toFixed(2)} км</b>`);

    if (!isGameOver) {
        resultPanel.innerHTML = `${timeoutMsg}<br>Бали: <span id="anim-round-score" class="score-value">0</span> <b>/ 5000</b> ${buttonsHtml}`;
    } else {
        resultPanel.innerHTML = buttonsHtml;
    }

    resultPanel.style.display = 'block';
    document.getElementById('map').classList.add('map-fullscreen');
    document.getElementById('map-container').classList.add('container-fullscreen');

    if (isGameOver) {
        animateScore(document.getElementById('anim-total-score'), totalScore, 2000);
    } else {
        animateScore(document.getElementById('anim-round-score'), score, 1500);
    }

    setTimeout(() => {
        map.invalidateSize();

        const actualIcon = L.divIcon({
            html: '<div style="font-size: 26px; text-shadow: 0 2px 5px rgba(0,0,0,0.8); line-height: 1;">🏁</div>',
            className: 'custom-icon', iconSize: [26, 26], iconAnchor: [8, 26], tooltipAnchor: [10, -20]
        });
        const guessIcon = L.divIcon({
            html: '<div style="font-size: 24px; text-shadow: 0 2px 5px rgba(0,0,0,0.8); line-height: 1;">🧍</div>',
            className: 'custom-icon', iconSize: [24, 24], iconAnchor: [12, 24]
        });

        if (isGameOver) {
            if (guessMarker) map.removeLayer(guessMarker);
            let allPoints = [];
            roundHistory.forEach((r, idx) => {
                let actualPt = r.actual;
                L.marker(actualPt, { icon: actualIcon }).bindTooltip(`Р${idx+1}`).addTo(map);
                allPoints.push(actualPt);
                if (r.guess) {
                    let guessPt = r.guess;
                    L.marker(guessPt, { icon: guessIcon }).addTo(map);
                    L.polyline([guessPt, actualPt], { color: '#ef4444', dashArray: '5, 5', weight: 2, opacity: 0.8 }).addTo(map);
                    allPoints.push(guessPt);
                }
            });
            if (allPoints.length > 0) {
                map.flyToBounds(L.latLngBounds(allPoints), { padding: [50, 50], duration: 2, animate: true });
            }
        } else {
            realMarker = L.marker([actualLocation.lat, actualLocation.lng], { icon: actualIcon }).addTo(map);
            if (guessMarker) {
                let currentGuess = guessMarker.getLatLng();
                map.removeLayer(guessMarker);
                guessMarker = L.marker(currentGuess, { icon: guessIcon }).addTo(map);
                resultPolyline = L.polyline([
                    [guessLat, guessLng],
                    [actualLocation.lat, actualLocation.lng]
                ], {color: '#ef4444', dashArray: '5, 10', weight: 3}).addTo(map);

                map.setView(currentGuess, 14, { animate: false });
                setTimeout(() => {
                    map.flyToBounds(resultPolyline.getBounds(), {padding: [50, 50], duration: 1.5, animate: true});
                }, 300);
            } else {
                map.setView([actualLocation.lat, actualLocation.lng], 14, { animate: false });
            }
        }
    }, 350);
}

function nextRound() {
    currentRound++;
    hasGuessed = false;

    if (guessMarker) { map.removeLayer(guessMarker); guessMarker = null; }
    if (realMarker) { map.removeLayer(realMarker); realMarker = null; }
    if (resultPolyline) { map.removeLayer(resultPolyline); resultPolyline = null; }

    document.getElementById('map').classList.remove('map-fullscreen');
    document.getElementById('map-container').classList.remove('container-fullscreen');
    document.getElementById('result-panel').style.display = 'none';
    document.getElementById('top-left-panel').style.display = 'flex';
    document.getElementById('reset-btn').style.display = 'block';
    document.getElementById('expand-map-btn').style.display = 'flex';

    updateInfoPanel();

    setTimeout(() => {
        map.invalidateSize();
        map.setView(mapConfig.center, mapConfig.zoom, { animate: false });
    }, 350);

    getRandomPanorama(0);
    startTimer();
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function deg2rad(deg) {
    return deg * (Math.PI/180);
}

// Функція швидкого перезапуску матчу з тими ж налаштуваннями
window.restartGame = function() {
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.delete('seed');
    window.location.href = window.location.pathname + '?' + urlParams.toString();
};