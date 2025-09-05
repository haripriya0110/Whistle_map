// js/app.js

// Configuration
const CONFIG = {
    DEFAULT_CENTER: [13.0827, 80.2707], // Chennai [lat, lng]
    DEFAULT_ZOOM: 11,
};

// Supabase setup
const SUPABASE_URL = 'https://ntpnjbdffkftwejzzlvg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50cG5qYmRmZmtmdHdlanp6bHZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwMDgwNDcsImV4cCI6MjA3MjU4NDA0N30.ZRfPtegRjTfOOlARFysXdkU3xfpTX4JDxIyzvosS3lM';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global variables
let map;
let markers = [];
let tempMarker = null;
let selectedLocation = null;
let searchTimeout = null;
let activeFilters = new Set(); // Track active filter categories

// Category colors (expanded with unique colors)
const CATEGORY_COLORS = {
    buy: '#4caf50',    // Green
    sell: '#ff9800',   // Orange
    help: '#2196f3',   // Blue
    party: '#e91e63',  // Pink
    misc: '#9c27b0'    // Purple
};

// Main initialization function
document.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        initMap();
        setupFormHandlers();
        setupFilterHandlers();
        setupDataManagementHandlers();
        listenForNewWhistles();

        // Cleanup expired whistles from the database every 5 minutes
        setInterval(async () => {
            const { error } = await supabaseClient
                .from('whistles')
                .delete()
                .not('expires_at', 'is', null)
                .lt('expires_at', new Date().toISOString());

            if (error) console.error('Error cleaning up expired whistles:', error);

        }, 300000); // 300000 ms = 5 minutes

        showAlert('Whistle Map loaded successfully!');
    } catch (err) {
        console.error('Initialization error:', err);
        showAlert('Failed to initialize app: ' + err.message, 'error');
    }
}

// Utility functions
function showAlert(message, type = 'success') {
    const alertsContainer = document.getElementById('alerts');
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    alert.style.display = 'block';

    alertsContainer.innerHTML = '';
    alertsContainer.appendChild(alert);

    setTimeout(() => {
        alert.style.display = 'none';
    }, 3000);
}

function updateLocationStatus(location = null) {
    const status = document.getElementById('locationStatus');
    if (location) {
        status.textContent = `Location selected: ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
        status.className = 'location-status location-selected';
        selectedLocation = location;
    } else {
        status.textContent = 'Click on the map to select a location';
        status.className = 'location-status';
        selectedLocation = null;
    }
}

async function updateWhistleCount() {
    const { count, error } = await supabaseClient
        .from('whistles')
        .select('*', { count: 'exact', head: true })
        .is('expires_at', null)
        .or(`expires_at.gt.${new Date().toISOString()}`);

    if (error) {
        console.error('Error fetching whistle count:', error);
        return;
    }

    document.getElementById('whistleCount').textContent = `${count || 0} active whistles`;
}

// Map setup
function initMap() {
    map = L.map('map').setView(CONFIG.DEFAULT_CENTER, CONFIG.DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    map.on('click', (e) => {
        const location = { lat: e.latlng.lat, lng: e.latlng.lng };
        if (tempMarker) map.removeLayer(tempMarker);

        tempMarker = L.marker([location.lat, location.lng], {
            icon: L.icon({
                iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34]
            })
        }).addTo(map).bindPopup('Selected location');

        updateLocationStatus(location);
    });

    initializeSearch();
    loadAndDisplayWhistles();
}

// Search
function initializeSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');

    searchInput.addEventListener('keyup', (e) => {
        clearTimeout(searchTimeout);
        if (e.target.value.trim() === '') {
            searchResults.style.display = 'none';
            return;
        }
        searchTimeout = setTimeout(() => {
            const query = e.target.value;
            if (query.length > 2) {
                searchPlaces(query);
            }
        }, 300);
    });
}

async function searchPlaces(query) {
    const searchResults = document.getElementById('searchResults');
    const endpoint = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;

    try {
        const response = await fetch(endpoint, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) throw new Error('Network response was not ok');
        const places = await response.json();

        if (places && places.length > 0) {
            searchResults.innerHTML = places.map(place => `
                <div class="search-result-item" data-lat="${place.lat}" data-lon="${place.lon}">
                    ${place.display_name}
                </div>
            `).join('');

            document.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const lat = parseFloat(item.dataset.lat);
                    const lon = parseFloat(item.dataset.lon);
                    map.flyTo([lat, lon], 15);
                    searchResults.style.display = 'none';
                    document.getElementById('searchInput').value = item.textContent.trim();
                });
            });
            searchResults.style.display = 'block';
        } else {
            searchResults.innerHTML = '<div class="search-result-item">No results found</div>';
            searchResults.style.display = 'block';
        }
    } catch (error) {
        console.error('Error fetching search results:', error);
        searchResults.innerHTML = '<div class="search-result-item">Failed to fetch results</div>';
        searchResults.style.display = 'block';
    }
}

// Marker & popup
function createMarker(whistle) {
    const categoryColor = CATEGORY_COLORS[whistle.category] || '#3388ff'; // Default to blue if no category match
    const markerIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="background-color: ${categoryColor}; width: 25px; height: 41px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); position: relative;"><div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(45deg); color: white; font-weight: bold;">${whistle.category.charAt(0).toUpperCase()}</div></div>`,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34]
    });

    const marker = L.marker([whistle.lat, whistle.lng], {
        icon: markerIcon
    }).addTo(map);

    marker.bindPopup(createPopupContent(whistle), { maxWidth: 300, minWidth: 300 }); // Bigger popup
    marker.whistleId = whistle.id;
    marker.category = whistle.category;
    return marker;
}

function createPopupContent(whistle) {
    const expiryText = whistle.expires_in_seconds === 0 ?
        'Never expires' :
        `Expires: ${new Date(whistle.expires_at).toLocaleString()}`;

    const priceText = whistle.price ? `<p><strong>Price:</strong> ${whistle.price}</p>` : '';
    const descriptionText = whistle.description ? `<p><strong>Description:</strong> ${whistle.description}</p>` : '';
    const contactText = whistle.contact ? `<p><strong>Contact:</strong> ${whistle.contact}</p>` : '';
    const categoryColor = CATEGORY_COLORS[whistle.category] || '#3388ff';

    return `
        <div class="whistle-popup" style="background-color: #333; padding: 10px; border-radius: 5px; color: #fff; position: relative;">
            <h4 style="margin: 0 0 10px 0;">${whistle.title}</h4>
            <button class="category-button" style="background-color: ${categoryColor}; color: #fff; padding: 5px 10px; border: none; border-radius: 3px; font-weight: bold; margin-bottom: 10px;">
                ${whistle.category.toUpperCase()}
            </button>
            ${priceText}
            ${descriptionText}
            ${contactText}
            <div class="popup-footer" style="margin-top: 10px; font-size: 0.9em;">
                
                <p><strong>Created:</strong> ${new Date(whistle.created_at).toLocaleString()}</p>
                <p><strong>${expiryText}</strong></p>
                <p><strong>Latitude:</strong> ${whistle.lat}</p>
                <p><strong>Longitude:</strong> ${whistle.lng}</p>
                <p><strong>Expires in seconds:</strong> ${whistle.expires_in_seconds}</p>
            </div>
            <button class="btn btn-secondary edit-btn" data-id="${whistle.id}" style="margin-top: 10px; background-color: #555; color: #fff; border: none; padding: 5px 10px; border-radius: 3px;">Edit</button>
        </div>
    `;
}

async function loadAndDisplayWhistles() {
    // Clear existing markers to prevent duplicates or ghosts
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];

    const { data: activeWhistles, error } = await supabaseClient
        .from('whistles')
        .select('*')
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

    if (error) {
        console.error('Error loading whistles:', error);
        showAlert('Could not load whistles from the database.', 'error');
        return;
    }

    activeWhistles.forEach(whistle => {
        const marker = createMarker(whistle);
        markers.push(marker);
    });

    applyFilters();
    updateWhistleCount();
}

function applyFilters() {
    markers.forEach(marker => {
        const shouldShow = activeFilters.size === 0 || activeFilters.has(marker.category);
        if (shouldShow) {
            if (!map.hasLayer(marker)) {
                marker.addTo(map);
            }
        } else {
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        }
    });
}

// Form handlers
function setupFormHandlers() {
    const form = document.getElementById('whistleForm');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!selectedLocation && !form.dataset.editingId) {
            showAlert('Please select a location on the map', 'error');
            return;
        }

        const title = document.getElementById('title').value.trim();
        const category = document.getElementById('category').value;
        if (!title || !category) {
            showAlert('Title and category are required', 'error');
            return;
        }

        const expiresInSeconds = parseInt(document.getElementById('expiresIn').value);
        const expiresAt = expiresInSeconds === 0 ? null :
            new Date(Date.now() + expiresInSeconds * 1000).toISOString();

        const updatedWhistle = {
            title,
            category,
            price: document.getElementById('price').value.trim() || null,
            description: document.getElementById('description').value.trim() || null,
            contact: document.getElementById('contact').value.trim() || null,
            lat: selectedLocation ? selectedLocation.lat : undefined,
            lng: selectedLocation ? selectedLocation.lng : undefined,
            expires_in_seconds: expiresInSeconds,
            expires_at: expiresAt
        };

        if (form.dataset.editingId) {
            // Validate that editingId is a valid UUID
            const editingId = form.dataset.editingId;
            if (!editingId || editingId === 'null') {
                showAlert('Invalid whistle ID for editing.', 'error');
                console.error('Invalid editingId:', editingId);
                return;
            }

            const { error } = await supabaseClient
                .from('whistles')
                .update(updatedWhistle)
                .eq('id', editingId);

            if (error) {
                console.error('Error updating whistle:', error);
                showAlert('Failed to update whistle: ' + error.message, 'error');
                return;
            }

            loadAndDisplayWhistles();
            showAlert('Whistle updated successfully!');

            // Reset form and button after update
            form.reset();
            form.dataset.editingId = null;
            form.querySelector('button[type="submit"]').textContent = 'Add Whistle';
            if (tempMarker) {
                map.removeLayer(tempMarker);
                tempMarker = null;
            }
            updateLocationStatus();
        } else {
            const { data, error } = await supabaseClient
                .from('whistles')
                .insert([updatedWhistle])
                .select();

            if (error) {
                console.error('Error adding whistle:', error);
                showAlert('Failed to add whistle.', 'error');
                return;
            }

            if (data && data.length > 0) {
                const newlyCreatedWhistle = data[0];
                const newMarker = createMarker(newlyCreatedWhistle);
                markers.push(newMarker);
                newMarker.addTo(map); // Ensure marker is added to map immediately
                newMarker.openPopup();
                updateWhistleCount();
            }

            showAlert('Whistle added successfully!');

            // Reset form after add
            form.reset();
            if (tempMarker) {
                map.removeLayer(tempMarker);
                tempMarker = null;
            }
            updateLocationStatus();
        }
    });

    // Edit form handler
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('edit-btn')) {
            const whistleId = e.target.dataset.id;
            if (!whistleId || whistleId === 'null') {
                showAlert('Invalid whistle ID.', 'error');
                console.error('Invalid whistleId:', whistleId);
                return;
            }

            const { data: whistle, error } = await supabaseClient
                .from('whistles')
                .select('*')
                .eq('id', whistleId)
                .single();

            if (error) {
                console.error('Error fetching whistle:', error);
                showAlert('Failed to fetch whistle for editing.', 'error');
                return;
            }

            // Center map on the whistle location
            map.flyTo([whistle.lat, whistle.lng], 15);

            // Populate form with whistle data
            document.getElementById('title').value = whistle.title;
            document.getElementById('category').value = whistle.category;
            document.getElementById('price').value = whistle.price || '';
            document.getElementById('expiresIn').value = whistle.expires_in_seconds || 0;
            document.getElementById('description').value = whistle.description || '';
            document.getElementById('contact').value = whistle.contact || '';

            // Set editing mode
            form.dataset.editingId = whistleId;
            form.querySelector('button[type="submit"]').textContent = 'Update Whistle';

            // Place temp marker on existing location
            if (tempMarker) map.removeLayer(tempMarker);
            tempMarker = L.marker([whistle.lat, whistle.lng]).addTo(map);
            selectedLocation = { lat: whistle.lat, lng: whistle.lng };
            updateLocationStatus(selectedLocation);
        }
    });
}

function setupFilterHandlers() {
    document.querySelector('.filter-group').addEventListener('change', (e) => {
        if (e.target.type === 'checkbox') {
            const category = e.target.id.replace('filter-', '');
            if (e.target.checked) {
                activeFilters.add(category);
            } else {
                activeFilters.delete(category);
            }
            applyFilters();
        }
    });
}

// Data management
function setupDataManagementHandlers() {
    document.getElementById('exportBtn').addEventListener('click', async () => {
        const { data: whistles, error } = await supabaseClient.from('whistles').select('*');
        if (error || whistles.length === 0) {
            showAlert('No whistles to export', 'error');
            return;
        }

        const dataStr = JSON.stringify(whistles, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `whistles-export-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        showAlert(`${whistles.length} whistles exported successfully!`);
    });

    document.getElementById('importFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
            showAlert('Please select a valid JSON file', 'error');
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const importedWhistles = JSON.parse(event.target.result);
                if (!Array.isArray(importedWhistles)) {
                    throw new Error('Invalid format: expected an array');
                }

                // Insert all imported whistles into the database
                const { data, error } = await supabaseClient.from('whistles').insert(importedWhistles).select();

                if (error) {
                    throw new Error(`Supabase error: ${error.message}`);
                }

                // Refresh markers and UI with the newly imported data
                loadAndDisplayWhistles();
                showAlert(`${importedWhistles.length} whistles imported successfully!`);

            } catch (err) {
                console.error('Import error:', err);
                showAlert(`Import failed: ${err.message}`, 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    document.getElementById('clearAllBtn').addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear ALL whistles from the database? This cannot be undone.')) {
            const { error } = await supabaseClient
                .from('whistles')
                .delete()
                .neq('id', null); // Updated to delete all records without condition

            if (error) {
                showAlert('Failed to clear whistles.', 'error');
                console.error('Clear all error:', error);
            } else {
                loadAndDisplayWhistles();
                // Clear form and editingId
                const form = document.getElementById('whistleForm');
                form.reset();
                form.dataset.editingId = null;
                form.querySelector('button[type="submit"]').textContent = 'Add Whistle';
                if (tempMarker) {
                    map.removeLayer(tempMarker);
                    tempMarker = null;
                }
                updateLocationStatus();
                showAlert('All whistles cleared successfully!');
            }
        }
    });
}

// Real-time listener for new whistles
function listenForNewWhistles() {
    supabaseClient.channel('whistles')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whistles' }, payload => {
            console.log('New whistle received!', payload.new);
            const newWhistle = payload.new;

            const markerExists = markers.some(marker => marker.whistleId === newWhistle.id);

            if (!markerExists) {
                const marker = createMarker(newWhistle);
                markers.push(marker);
                marker.addTo(map); // Ensure marker is added to map immediately
                applyFilters();
                updateWhistleCount();
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whistles' }, payload => {
            console.log('Whistle updated!', payload.new);
            loadAndDisplayWhistles(); // Reload to reflect updates
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'whistles' }, payload => {
            console.log('Whistle deleted!', payload.old);
            loadAndDisplayWhistles(); // Reload to remove deleted markers
        })
        .subscribe();
}

// Event listeners
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const searchResults = document.getElementById('searchResults');
        if (searchResults.style.display !== 'none') {
            searchResults.style.display = 'none';
        }
    }
});
window.addEventListener('error', (e) => {
    console.error('An unexpected error occurred:', e.message);
    showAlert('An unexpected error occurred. See console for details.', 'error');
});
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        loadAndDisplayWhistles();
    }
});