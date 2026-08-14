const STATUS_CLASS_MAP = {
  green: "status-green",
  red: "status-red",
  blue: "status-blue",
  orange: "status-orange",
  yellow: "status-yellow"
};

const DEMO_DATA = {
  factionName: "Warband of the Fallen",
  members: [
    {
      name: "Astra Vale",
      level: 98,
      position: "Leader",
      status: { description: "Online", color: "green" },
      last_action: { relative: "2 minutes ago" },
      is_revivable: false
    },
    {
      name: "Kestrel Voss",
      level: 84,
      position: "Deputy",
      status: { description: "Idle", color: "yellow" },
      last_action: { relative: "18 minutes ago" },
      is_revivable: true
    },
    {
      name: "Morrow Dane",
      level: 76,
      position: "Recruiter",
      status: { description: "Traveling", color: "blue" },
      last_action: { relative: "1 hour ago" },
      is_revivable: false
    },
    {
      name: "Iris Noct",
      level: 61,
      position: "Member",
      status: { description: "Hospital", color: "red" },
      last_action: { relative: "3 hours ago" },
      is_revivable: true
    }
  ]
};

const form = document.getElementById("faction-form");
const factionNameInput = document.getElementById("faction-name");
const apiKeyInput = document.getElementById("api-key");
const ffscouterApiKeyInput = document.getElementById("ffscouter-api-key");
const demoButton = document.getElementById("demo-button");
const autoRefreshToggle = document.getElementById("auto-refresh-toggle");
const ultrawideToggle = document.getElementById("ultrawide-toggle");
const memberBody = document.getElementById("member-body");
const factionTitle = document.getElementById("faction-title");
const memberCount = document.getElementById("member-count");
const dataSource = document.getElementById("data-source");
const message = document.getElementById("message");
const notificationStack = document.getElementById("notification-stack");
const sortButtons = Array.from(document.querySelectorAll(".sort-button"));

let currentMembers = [];
let currentLiveRequest = null;
let autoRefreshTimerId = null;
let isRefreshing = false;
let lastRosterSnapshot = [];
let fairFightMap = {};
let fairFightLoadedForFaction = null;
let sortState = {
  key: null,
  direction: "asc"
};

const SORT_LABELS = {
  name: "Name",
  level: "Lvl",
  position: "Position",
  status: "Status",
  revive: "Revive",
  lastAction: "Last Action",
  fairFight: "Fair Fight"
};

const ULTRAWIDE_STORAGE_KEY = "faction-scout-ultrawide";

function setMessage(text) {
  message.textContent = text;
}

function formatAircraftType(value) {
  const normalized = String(value ?? "").toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  const labelMap = {
    light_aircraft: "Light aircraft",
    heavy_aircraft: "Heavy aircraft",
    private_jet: "Private jet",
    helicopter: "Helicopter",
    plane: "Plane"
  };

  return labelMap[normalized] || (normalized ? normalized.replace(/_/g, " ") : "Unknown aircraft");
}

function getTravelingInfo(member) {
  const status = member?.status || {};
  const state = String(status.state ?? "").trim().toLowerCase();
  const description = String(status.description ?? "").trim();
  const isTraveling = state === "traveling" || /traveling/i.test(description);

  if (!isTraveling) {
    return null;
  }

  const fromToMatch = description.match(/traveling from\s+(.+?)\s+to\s+(.+)/i) || description.match(/from\s+(.+?)\s+to\s+(.+)/i);
  const from = fromToMatch?.[1]?.trim() || "an unknown location";
  const to = fromToMatch?.[2]?.trim() || "a new destination";

  return {
    from,
    to,
    aircraft: formatAircraftType(status.plane_image_type || status.aircraft_type || status.plane_type),
    description
  };
}

function showToast(title, detail) {
  if (!notificationStack) {
    return;
  }

  const timestamp = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const toast = document.createElement("div");
  toast.className = "notification";
  toast.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(detail)}</span>
    <div class="notification-meta">
      <span>Pinged at ${escapeHtml(timestamp)}</span>
    </div>
  `;

  toast.addEventListener("click", () => toast.remove());

  notificationStack.appendChild(toast);
}

let notificationPermissionRequested = false;

function requestNotificationPermission() {
  if (typeof window.Notification === "undefined" || notificationPermissionRequested) {
    return;
  }

  if (window.Notification.permission === "default") {
    notificationPermissionRequested = true;
    window.Notification.requestPermission().catch(() => undefined);
  }
}

function notifyTravelStatusChange(member, previousMember) {
  const currentTravel = getTravelingInfo(member);
  const previousTravel = getTravelingInfo(previousMember);

  if (!currentTravel) {
    return;
  }

  const changed = !previousTravel || previousTravel.description !== currentTravel.description || previousTravel.from !== currentTravel.from || previousTravel.to !== currentTravel.to;

  if (!changed) {
    return;
  }

  const title = `${member.name} is moving`;
  const detail = `${currentTravel.from} → ${currentTravel.to} • Aircraft: ${currentTravel.aircraft}`;

  showToast(title, detail);
  requestNotificationPermission();

  if (typeof window.Notification !== "undefined" && window.Notification.permission === "granted") {
    new window.Notification(title, {
      body: detail,
      icon: "https://cdn.jsdelivr.net/gh/twitter/twirpz@master/assets/emoji/airplane.png"
    });
  }
}

function compareRosterSnapshots(previousMembers, currentMembers) {
  const previousByKey = new Map();

  previousMembers.forEach((member) => {
    const key = String(member?.id ?? member?.name ?? "");
    previousByKey.set(key, member);
  });

  currentMembers.forEach((member) => {
    const key = String(member?.id ?? member?.name ?? "");
    const previousMember = previousByKey.get(key);
    notifyTravelStatusChange(member, previousMember);
  });
}

function applyUltrawideMode(enabled) {
  document.body.classList.toggle("ultrawide", enabled);
  if (ultrawideToggle) {
    ultrawideToggle.checked = enabled;
  }

  try {
    localStorage.setItem(ULTRAWIDE_STORAGE_KEY, enabled ? "1" : "0");
  } catch (error) {
    console.warn("Unable to persist ultrawide preference.", error);
  }
}

function initUltrawideMode() {
  if (!ultrawideToggle) {
    return;
  }

  try {
    const savedValue = localStorage.getItem(ULTRAWIDE_STORAGE_KEY) === "1";
    applyUltrawideMode(savedValue);
  } catch (error) {
    applyUltrawideMode(false);
  }

  ultrawideToggle.addEventListener("change", (event) => {
    applyUltrawideMode(event.target.checked);
    setMessage(event.target.checked ? "Ultrawide layout enabled." : "Ultrawide layout disabled.");
  });
}

function setSummary(name, count, source) {
  factionTitle.textContent = name || "Unknown faction";
  memberCount.textContent = String(count);
  dataSource.textContent = source;
}

function stopAutoRefresh() {
  if (autoRefreshTimerId !== null) {
    window.clearInterval(autoRefreshTimerId);
    autoRefreshTimerId = null;
  }
}

function syncAutoRefreshState() {
  if (!autoRefreshToggle.checked) {
    stopAutoRefresh();
    return;
  }

  stopAutoRefresh();
  autoRefreshTimerId = window.setInterval(() => {
    if (currentLiveRequest) {
      refreshLiveRoster(true);
    } else {
      showDemoData(true);
    }
    console.log("Auto-refresh executed at", new Date().toLocaleTimeString());
  }, 5000);
}

function setLiveRequestContext(factionName, apiKey) {
  currentLiveRequest = {
    factionName,
    apiKey
  };
}

function statusClass(color) {
  return STATUS_CLASS_MAP[color] || "status-default";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseRelativeTimeToMinutes(value) {
  const match = String(value ?? "").trim().match(/^(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago$/i);
  if (!match) {
    return Number.NaN;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    minute: 1,
    minutes: 1,
    hour: 60,
    hours: 60,
    day: 1440,
    days: 1440,
    week: 10080,
    weeks: 10080,
    month: 43200,
    months: 43200,
    year: 525600,
    years: 525600
  };

  return amount * (multipliers[unit] || 1);
}

function getSortValue(member, key) {
  switch (key) {
    case "name":
      return String(member?.name ?? "").toLowerCase();
    case "level":
      return Number(member?.level ?? 0);
    case "position":
      return String(member?.position ?? "").toLowerCase();
    case "status":
      return String(member?.status?.description ?? "").toLowerCase();
    case "revive":
      return member?.is_revivable ? 1 : 0;
    case "lastAction": {
      const relative = String(member?.last_action?.relative ?? "");
      const minutes = parseRelativeTimeToMinutes(relative);
      return Number.isNaN(minutes) ? relative.toLowerCase() : minutes;
    }
    case "fairFight": {
      const entry = fairFightMap[member?.id];
      return typeof entry?.fairFight === "number" ? entry.fairFight : -1;
    }
    default:
      return "";
  }
}

function compareValues(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  return String(a).localeCompare(String(b));
}

function getSortedMembers() {
  const members = [...currentMembers];

  if (!sortState.key) {
    return members;
  }

  return members.sort((first, second) => {
    const firstValue = getSortValue(first, sortState.key);
    const secondValue = getSortValue(second, sortState.key);
    const base = compareValues(firstValue, secondValue);
    return sortState.direction === "asc" ? base : -base;
  });
}

function updateSortIndicators() {
  sortButtons.forEach((button) => {
    const th = button.closest("th");
    const key = button.dataset.sortKey;
    const isActive = key === sortState.key;
    const direction = isActive ? sortState.direction : "none";

    button.dataset.direction = direction;
    button.setAttribute("aria-label", isActive
      ? `${SORT_LABELS[key] || key}, sorted ${direction}. Click to toggle order.`
      : `${SORT_LABELS[key] || key}, not sorted. Click to sort ascending.`);

    if (th) {
      th.setAttribute("aria-sort", isActive ? (direction === "asc" ? "ascending" : "descending") : "none");
    }
  });
}

function formatFairFight(member) {
  const entry = fairFightMap[member?.id];

  if (!entry || (entry.fairFight == null && !entry.bsEstimateHuman)) {
    return "";
  }

  const fairFightText = typeof entry.fairFight === "number" ? entry.fairFight.toFixed(2) : "?";
  const bsText = entry.bsEstimateHuman || "?";
  return `${fairFightText} (${bsText})`;
}

function renderMembers() {
  const members = getSortedMembers();

  if (!members.length) {
    memberBody.innerHTML = '<tr class="empty-row"><td colspan="7">No members found.</td></tr>';
    return;
  }

  memberBody.innerHTML = members
    .map((member) => {
      const status = member.status || {};
      const revive = member.is_revivable ? '<span class="revive-badge revive-yes">Yes</span>' : "";

      return `
        <tr>
          <td>${escapeHtml(member.name ?? "")}</td>
          <td>${escapeHtml(member.level ?? "")}</td>
          <td>${escapeHtml(member.position ?? "")}</td>
          <td><span class="status-badge ${statusClass(status.color)}">${escapeHtml(status.description ?? "")}</span></td>
          <td>${revive}</td>
          <td>${escapeHtml(member.last_action?.relative ?? "")}</td>
          <td>${escapeHtml(formatFairFight(member))}</td>
        </tr>
      `;
    })
    .join("");
}

function setMembers(members) {
  currentMembers = Array.isArray(members) ? [...members] : [];
  renderMembers();
}

function loadDemoData() {
  return DEMO_DATA;
}

async function loadFactionFromApi(factionName, apiKey) {
  const searchResponse = await fetch(`https://api.torn.com/v2/faction/search?name=${encodeURIComponent(factionName)}`, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${apiKey}`
    }
  });

  if (!searchResponse.ok) {
    throw new Error(`Faction search failed (${searchResponse.status})`);
  }

  const searchData = await searchResponse.json();
  const factionId = searchData?.search?.[0]?.id;

  if (!factionId) {
    throw new Error("No faction match found.");
  }

  const membersResponse = await fetch(`https://api.torn.com/v2/faction/${factionId}/members`, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${apiKey}`
    }
  });

  if (!membersResponse.ok) {
    throw new Error(`Member lookup failed (${membersResponse.status})`);
  }

  const membersData = await membersResponse.json();
  return {
    factionName,
    members: Object.values(membersData?.members || {})
  };
}

async function getFairFightData(userIdArray, apiKey) {
  if (!Array.isArray(userIdArray) || !userIdArray.length) {
    console.log("getFairFightData: no user IDs supplied, skipping fetch.");
    return {};
  }

  const targets = userIdArray.join(",");
  const url = `https://ffscouter.com/api/v1/get-stats?key=${encodeURIComponent(apiKey)}&targets=${encodeURIComponent(targets)}`;
  console.log(`getFairFightData: fetching fair fight data for ${userIdArray.length} member(s)...`, url);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Fair fight lookup failed (${response.status})`);
  }

  const data = await response.json();
  console.log("getFairFightData: received response.", data);

  const fairFightById = {};

  (Array.isArray(data) ? data : []).forEach((entry) => {
    if (entry?.player_id == null) {
      return;
    }

    fairFightById[entry.player_id] = {
      fairFight: typeof entry.fair_fight === "number" ? entry.fair_fight : null,
      bsEstimateHuman: entry.bs_estimate_human ?? null
    };
  });

  console.log(`getFairFightData: mapped ${Object.keys(fairFightById).length} player(s).`, fairFightById);
  return fairFightById;
}

async function loadFairFightForFaction(factionName, members, apiKey) {
  if (fairFightLoadedForFaction === factionName) {
    console.log(`loadFairFightForFaction: already loaded for "${factionName}", skipping.`);
    return;
  }

  const ids = members.map((member) => member?.id).filter((id) => id !== undefined && id !== null);

  if (!ids.length) {
    console.log("loadFairFightForFaction: no member IDs available (demo data has no IDs), skipping.");
    return;
  }

  fairFightLoadedForFaction = factionName;

  try {
    fairFightMap = await getFairFightData(ids, apiKey);
    console.log("loadFairFightForFaction: fair fight data applied, re-rendering table.");
    renderMembers();
  } catch (error) {
    console.error("loadFairFightForFaction: failed to load fair fight data.", error);
    fairFightLoadedForFaction = null;
    showToast("Fair fight data unavailable", error instanceof Error ? error.message : "Unknown error");
  }
}

async function refreshLiveRoster(silent = false, clearOnError = false) {
  if (!currentLiveRequest || isRefreshing) {
    return false;
  }

  isRefreshing = true;

  if (!silent) {
    setMessage("Loading roster from Torn API...");
  }

  try {
    const data = await loadFactionFromApi(currentLiveRequest.factionName, currentLiveRequest.apiKey);
    const previousMembers = [...lastRosterSnapshot];
    setMembers(data.members);
    setSummary(data.factionName, data.members.length, "Live API");
    compareRosterSnapshots(previousMembers, data.members);
    lastRosterSnapshot = data.members.map((member) => ({ ...member }));

    if (!silent) {
      setMessage("Roster loaded successfully.");
    }
    return true;
  } catch (error) {
    console.error(error);
    setMessage(error instanceof Error ? error.message : "Unable to load faction data.");
    setSummary(currentLiveRequest.factionName, 0, "Error");
    if (clearOnError) {
      setMembers([]);
    }
    return false;
  } finally {
    isRefreshing = false;
  }
}

function showDemoData(silent = false) {
  if (!silent) {
    setMessage("Rendering demo roster.");
  }

  const data = loadDemoData();
  const previousMembers = [...lastRosterSnapshot];
  setMembers(data.members);
  setSummary(data.factionName, data.members.length, "Demo data");
  compareRosterSnapshots(previousMembers, data.members);
  lastRosterSnapshot = data.members.map((member) => ({ ...member }));

  if (!silent && !currentLiveRequest) {
    setMessage("Demo roster loaded.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const factionName = factionNameInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  const ffscouterApiKey = ffscouterApiKeyInput.value.trim();

  if (!factionName) {
    setMessage("Enter a faction name first.");
    return;
  }

  if (!apiKey) {
    setMessage("Add a Torn API key or use the demo view.");
    return;
  }

  setLiveRequestContext(factionName, apiKey);
  setSummary(factionName, "...", "Live API");

  if (fairFightLoadedForFaction !== factionName) {
    fairFightMap = {};
  }

  const loaded = await refreshLiveRoster(false, true);

  if (!loaded) {
    return;
  }

  if (ffscouterApiKey) {
    console.log(`Faction "${factionName}" loaded with ${currentMembers.length} member(s), triggering fair fight lookup.`);
    loadFairFightForFaction(factionName, currentMembers, ffscouterApiKey);
  } else {
    console.log("No FFScouter API key provided, skipping fair fight lookup.");
  }

  syncAutoRefreshState();
  if (autoRefreshToggle.checked) {
    setMessage("Auto-refresh enabled. Updating every 5 seconds.");
  }
});

demoButton.addEventListener("click", () => {
  currentLiveRequest = null;
  fairFightMap = {};
  fairFightLoadedForFaction = null;
  showDemoData(false);
});

autoRefreshToggle.addEventListener("change", () => {
  if (!autoRefreshToggle.checked) {
    stopAutoRefresh();
    setMessage("Auto-refresh disabled.");
    return;
  }

  if (!currentLiveRequest && !currentMembers.length) {
    autoRefreshToggle.checked = false;
    setMessage("Load a live faction or demo roster first, then enable auto-refresh.");
    return;
  }

  syncAutoRefreshState();
  setMessage("Auto-refresh enabled. Updating every 5 seconds.");

  if (currentLiveRequest) {
    refreshLiveRoster(true);
  } else {
    showDemoData(true);
  }
});

sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sortKey;
    if (!key) {
      return;
    }

    if (sortState.key === key) {
      sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
    } else {
      sortState = {
        key,
        direction: "asc"
      };
    }

    updateSortIndicators();
    renderMembers();
  });
});

updateSortIndicators();
initUltrawideMode();

syncAutoRefreshState();

showDemoData(true);
