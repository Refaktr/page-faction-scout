const DIBBS_API_BASE_URL = "https://dibbs-api-upc8.onrender.com";
const remoteApiConfigured = !DIBBS_API_BASE_URL.includes("REPLACE_WITH_YOUR_RENDER_SERVICE");

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
const demoButton = document.getElementById("demo-button");
const apiKeyInput = document.getElementById("api-key");
const ffscouterApiKeyInput = document.getElementById("ffscouter-api-key");
const memberBody = document.getElementById("member-body");
const factionTitle = document.getElementById("faction-title");
const memberCount = document.getElementById("member-count");
const dataSource = document.getElementById("data-source");
const openCount = document.getElementById("open-count");
const claimedCount = document.getElementById("claimed-count");
const message = document.getElementById("message");
const sortButtons = Array.from(document.querySelectorAll(".sort-button"));
const filterButtons = Array.from(document.querySelectorAll(".filter-button"));
const targetSearch = document.getElementById("target-search");

let currentMembers = [];
let fairFightMap = {};
let fairFightLoadedForFaction = null;
let activeFilter = "all";
let claims = {};
let currentCallsign = "";
let currentRoomSlug = "";
let roomAccessToken = "";
let remoteMode = false;
let claimPollTimerId = null;
let claimEventSource = null;
let claimEventTokenRefreshTimerId = null;
let sortState = {
  key: null,
  direction: "asc"
};

const SORT_LABELS = {
  name: "Name",
  fairFight: "Fair Fight"
};

const CLAIMS_STORAGE_PREFIX = "dibbs-claims-";
const ROOM_CONTEXT_STORAGE_PREFIX = "dibbs-room-context-";
const CLAIM_POLL_INTERVAL_MS = 60000;

function setMessage(text) {
  message.textContent = text;
}

function getMemberKey(member) {
  return String(member?.id ?? member?.name ?? "");
}

function getDibsKey() {
  return `${CLAIMS_STORAGE_PREFIX}${(factionTitle.textContent || "unknown").trim().toLowerCase()}`;
}

function loadClaims() {
  if (remoteMode) {
    return;
  }

  try {
    claims = JSON.parse(localStorage.getItem(getDibsKey()) || "{}");
  } catch (error) {
    claims = {};
  }
}

function saveClaims() {
  if (remoteMode) {
    return;
  }

  try {
    localStorage.setItem(getDibsKey(), JSON.stringify(claims));
  } catch (error) {
    console.warn("Unable to persist dibs claims.", error);
  }
}

function getCallsign() {
  return currentCallsign || "Demo hitter";
}

function getRoomSlug() {
  return currentRoomSlug;
}

function saveRoomContext() {
  localStorage.setItem(ROOM_CONTEXT_STORAGE_PREFIX, JSON.stringify({
    roomSlug: getRoomSlug(),
    tornApiKey: apiKeyInput.value.trim(),
    ffscouterApiKey: ffscouterApiKeyInput.value.trim()
  }));
}

function restoreRoomContext() {
  const savedContext = JSON.parse(localStorage.getItem(ROOM_CONTEXT_STORAGE_PREFIX) || "{}");
  currentRoomSlug = savedContext.roomSlug || "";
  apiKeyInput.value = savedContext.tornApiKey || "";
  ffscouterApiKeyInput.value = savedContext.ffscouterApiKey || "";
}

async function dibbsApiRequest(path, options = {}) {
  const response = await fetch(`${DIBBS_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${roomAccessToken}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    let detail = `Dibbs API request failed (${response.status})`;
    try {
      const body = await response.json();
      detail = body.error || detail;
    } catch (error) {
      // Keep the HTTP status when the API does not return JSON.
    }
    throw new Error(detail);
  }

  return response.status === 204 ? null : response.json();
}

async function joinRoom(apiKey) {
  const response = await fetch(`${DIBBS_API_BASE_URL}/api/rooms/discover`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ tornApiKey: apiKey })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) {
      throw new Error("Faction room discovery is unavailable on the deployed API. Redeploy the updated DATABASE server.");
    }
    throw new Error(body.error || `War room join failed (${response.status}).`);
  }
  return response.json();
}

async function loadRemoteClaims() {
  if (!remoteApiConfigured) {
    throw new Error("The Render API URL has not been configured.");
  }

  const claimData = await dibbsApiRequest(`/api/rooms/${encodeURIComponent(getRoomSlug())}/claims`);
  claims = {};
  claimData.claims.forEach((claim) => {
    claims[String(claim.torn_id)] = {
      claimedBy: claim.callsign,
      claimedAt: new Date(claim.claimed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
  });
  if (!claimData.room?.enemyFaction) {
    throw new Error("War room metadata is unavailable. Deploy the latest Render backend, then try again.");
  }
  return claimData.room;
}

function stopClaimPolling() {
  if (claimPollTimerId !== null) {
    window.clearInterval(claimPollTimerId);
    claimPollTimerId = null;
  }
}

function stopClaimEvents() {
  if (claimEventSource) {
    claimEventSource.close();
    claimEventSource = null;
  }
  if (claimEventTokenRefreshTimerId !== null) {
    window.clearTimeout(claimEventTokenRefreshTimerId);
    claimEventTokenRefreshTimerId = null;
  }
}

function startClaimPolling() {
  stopClaimPolling();
  claimPollTimerId = window.setInterval(async () => {
    if (!remoteMode || document.hidden) {
      return;
    }

    try {
      await loadRemoteClaims();
      renderMembers();
    } catch (error) {
      console.warn("Shared dibs refresh failed.", error);
      if (error instanceof Error && /password|required|not found/i.test(error.message)) {
        stopClaimPolling();
        setMessage("Shared dibs refresh stopped. Re-enter the war room.");
      }
    }
  }, CLAIM_POLL_INTERVAL_MS);
}

async function startClaimEvents() {
  stopClaimEvents();
  const eventUrl = new URL(`/api/rooms/${encodeURIComponent(getRoomSlug())}/events`, DIBBS_API_BASE_URL);
  eventUrl.searchParams.set("token", roomAccessToken);
  claimEventSource = new EventSource(eventUrl);
  claimEventSource.addEventListener("claims-changed", async () => {
    try {
      await loadRemoteClaims();
      renderMembers();
    } catch (error) {
      console.warn("Unable to refresh shared dibs after an event.", error);
    }
  });
  claimEventSource.onerror = () => {
    console.warn("Shared dibs live connection interrupted; fallback refresh remains active.");
  };
  claimEventTokenRefreshTimerId = window.setTimeout(() => {
    if (remoteMode) {
      joinRoom(apiKeyInput.value.trim())
        .then((joinData) => {
          roomAccessToken = joinData.token;
          currentCallsign = joinData.player.name;
          return startClaimEvents();
        })
        .catch((error) => console.warn("Unable to renew shared dibs live connection.", error));
    }
  }, 55 * 60 * 1000);
}

async function loadFactionFromApi(factionName, apiKey) {
  const headers = { Accept: "application/json", Authorization: `ApiKey ${apiKey}` };
  const searchResponse = await fetch(`https://api.torn.com/v2/faction/search?name=${encodeURIComponent(factionName)}`, { headers });
  if (!searchResponse.ok) {
    throw new Error(`Faction search failed (${searchResponse.status}).`);
  }
  const searchData = await searchResponse.json();
  const factionMatches = Array.isArray(searchData?.search) ? searchData.search : [];
  console.log("Torn faction search results:", factionMatches);
  console.table(factionMatches);
  const factionId = searchData?.search?.[0]?.id;
  if (!factionId) {
    throw new Error("No faction match found.");
  }
  const membersResponse = await fetch(`https://api.torn.com/v2/faction/${factionId}/members`, { headers });
  if (!membersResponse.ok) {
    throw new Error(`Member lookup failed (${membersResponse.status}).`);
  }
  const membersData = await membersResponse.json();
  const factionMembers = Object.values(membersData?.members || {});
  console.log(`Torn faction members for ${factionId}:`, factionMembers);
  console.table(factionMembers);
  return factionMembers;
}


function updateClaimSummary() {
  const claimed = currentMembers.filter((member) => claims[getMemberKey(member)]).length;
  claimedCount.textContent = String(claimed);
  openCount.textContent = String(Math.max(currentMembers.length - claimed, 0));
}

function getVisibleMembers() {
  const query = targetSearch.value.trim().toLowerCase();

  return getSortedMembers().filter((member) => {
    const claim = claims[getMemberKey(member)];
    const matchesFilter = activeFilter === "all"
      || (activeFilter === "open" && !claim)
      || (activeFilter === "mine" && claim?.claimedBy === getCallsign());
    const searchText = String(member.name ?? "").toLowerCase();
    return matchesFilter && (!query || searchText.includes(query));
  });
}

function setSummary(name, count, source) {
  factionTitle.textContent = name || "Unknown faction";
  memberCount.textContent = String(count);
  dataSource.textContent = source;
  if (!remoteMode) {
    loadClaims();
  }
  updateClaimSummary();
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
  const members = getVisibleMembers();

  if (!members.length) {
    memberBody.innerHTML = '<tr class="empty-row"><td colspan="3">No targets match this view.</td></tr>';
    updateClaimSummary();
    return;
  }

  memberBody.innerHTML = members
    .map((member) => {
      const memberKey = getMemberKey(member);
      const claim = claims[memberKey];
      const isMine = claim?.claimedBy === getCallsign();
      const attackMarkup = isMine && member.id != null
        ? `<a class="attack-button" href="https://www.torn.com/page.php?sid=attack&user2ID=${encodeURIComponent(member.id)}" target="_blank" rel="noopener noreferrer">ATTACK</a>`
        : "";
      const claimMarkup = claim
        ? `<div class="claim-state ${isMine ? "claim-mine" : ""}"><strong>${escapeHtml(claim.claimedBy)}</strong><small>${escapeHtml(claim.claimedAt)}</small>${isMine ? `${attackMarkup}<button type="button" class="release-button" data-member-key="${escapeHtml(memberKey)}">Release</button>` : "<small>Held by another hitter</small>"}</div>`
        : `<button type="button" class="dibs-button" data-member-key="${escapeHtml(memberKey)}">Dibs</button>`;

      return `
        <tr class="${claim ? "is-claimed" : ""}">
          <td><strong class="target-name">${escapeHtml(member.name ?? "")}</strong></td>
          <td>${escapeHtml(formatFairFight(member))}</td>
          <td>${claimMarkup}</td>
        </tr>
      `;
    })
    .join("");
  updateClaimSummary();
}

function setMembers(members) {
  currentMembers = Array.isArray(members) ? [...members] : [];
  updateClaimSummary();
  renderMembers();
}

function loadDemoData() {
  return DEMO_DATA;
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
    setMessage(error instanceof Error ? error.message : "Fair fight data unavailable.");
  }
}

function showDemoData(silent = false) {
  stopClaimPolling();
  stopClaimEvents();
  roomAccessToken = "";
  remoteMode = false;
  if (!silent) {
    setMessage("Rendering demo roster.");
  }

  const data = loadDemoData();
  setMembers(data.members);
  setSummary(data.factionName, data.members.length, "Demo data");

  if (!silent) {
    setMessage("Demo roster loaded.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const apiKey = apiKeyInput?.value.trim() || "";
  const ffscouterApiKey = ffscouterApiKeyInput?.value.trim() || "";
  if (!apiKey) {
    setMessage("Enter a Torn API key.");
    return;
  }

  saveRoomContext();

  try {
    remoteMode = true;
    currentCallsign = "";
    const joinData = await joinRoom(apiKey);
    currentRoomSlug = joinData.room.slug;
    roomAccessToken = joinData.token;
    currentCallsign = joinData.player.name;
    const room = await loadRemoteClaims();
    const members = await loadFactionFromApi(room.enemyFaction, apiKey);
    setMembers(members);
    setSummary(room.enemyFaction, members.length, "Torn + shared dibs");
    fairFightMap = {};
    fairFightLoadedForFaction = null;
    saveRoomContext();
    setMessage("Shared war room loaded.");
    startClaimPolling();
    startClaimEvents().catch((error) => console.warn("Unable to start shared dibs live connection.", error));
    if (ffscouterApiKey) {
      loadFairFightForFaction(room.enemyFaction, members, ffscouterApiKey);
    }
  } catch (error) {
    remoteMode = false;
    roomAccessToken = "";
    setMessage(error instanceof Error ? error.message : "Unable to load the war room.");
  }
});

demoButton.addEventListener("click", () => {
  currentCallsign = "";
  fairFightMap = {};
  fairFightLoadedForFaction = null;
  showDemoData(false);
});

memberBody.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-member-key]");
  if (!actionButton) {
    return;
  }

  const memberKey = actionButton.dataset.memberKey;
  const member = currentMembers.find((entry) => getMemberKey(entry) === memberKey);
  if (!member) {
    return;
  }

  try {
    if (remoteMode) {
      const claim = claims[memberKey];
      if (actionButton.classList.contains("release-button")) {
        await dibbsApiRequest(`/api/rooms/${encodeURIComponent(getRoomSlug())}/claims/${encodeURIComponent(member.id)}`, {
          method: "DELETE"
        });
        setMessage(`${member.name} is back in the open queue.`);
      } else {
        const currentClaim = Object.entries(claims).find(([, entry]) => entry?.claimedBy === getCallsign());
        const currentMember = currentClaim
          ? currentMembers.find((entry) => getMemberKey(entry) === currentClaim[0])
          : null;
        const claimsPath = `/api/rooms/${encodeURIComponent(getRoomSlug())}/claims`;

        if (currentMember && currentMember.id !== member.id) {
          await dibbsApiRequest(`${claimsPath}/${encodeURIComponent(currentMember.id)}`, { method: "DELETE" });
        }

        try {
          await dibbsApiRequest(`${claimsPath}/${encodeURIComponent(member.id)}`, { method: "POST" });
        } catch (error) {
          if (currentMember && currentMember.id !== member.id) {
            await dibbsApiRequest(`${claimsPath}/${encodeURIComponent(currentMember.id)}`, { method: "POST" }).catch((restoreError) => {
              console.warn("Unable to restore the previous Dibs claim.", restoreError);
            });
          }
          throw error;
        }
        setMessage(`${member.name} is called by ${getCallsign()}.`);
      }
      await loadRemoteClaims();
    } else if (actionButton.classList.contains("release-button")) {
      delete claims[memberKey];
      saveClaims();
      setMessage(`${member.name} is back in the open queue.`);
    } else {
      const currentClaimEntry = Object.entries(claims).find(([, claim]) => claim?.claimedBy === getCallsign());
      if (currentClaimEntry) {
        delete claims[currentClaimEntry[0]];
      }
      const callsign = getCallsign();
      claims[memberKey] = {
        claimedBy: callsign,
        claimedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };
      saveClaims();
      setMessage(`${member.name} is called by ${callsign}.`);
    }
  } catch (error) {
    if (remoteMode) {
      try {
        await loadRemoteClaims();
      } catch (refreshError) {
        console.warn("Unable to refresh shared dibs after an update failure.", refreshError);
      }
    }
    setMessage(error instanceof Error ? error.message : "Unable to update dibs.");
  }

  renderMembers();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter || "all";
    filterButtons.forEach((filterButton) => filterButton.classList.toggle("active", filterButton === button));
    renderMembers();
  });
});

targetSearch?.addEventListener("input", renderMembers);

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
try {
  restoreRoomContext();
} catch (error) {
  currentRoomSlug = "";
  apiKeyInput.value = "";
  ffscouterApiKeyInput.value = "";
}

showDemoData(true);
